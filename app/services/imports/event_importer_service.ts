import vine from '@vinejs/vine'
import db from '@adonisjs/lucid/services/db'
import logger from '@adonisjs/core/services/logger'
import { DateTime } from 'luxon'
import Event from '#models/event'
import EventImport from '#models/event_import'
import LeagueCredential from '#models/league_credential'
import LeagueEvent from '#models/league_event'
import Tournament from '#models/tournament'
import { CapabilityObserver } from '#lib/platforms/capabilities'
import { PermanentPlatformError, PlatformError } from '#lib/platforms/errors'
import { platforms } from '#lib/platforms/registry'
import { createPlatformHttp } from '#lib/platforms/http'
import { ValidatingSink } from '#lib/platforms/validating_sink'
import { DEFAULT_SIZE_LIMITS, SizeLimitingSink } from '#lib/platforms/size_limiting_sink'
import { TournamentWriterService } from '#services/imports/tournament_writer_service'
import { EntrantRegionService } from '#services/identity/entrant_region_service'
import type { ImportSink, PlatformAdapter, PlatformFetch, EventRef } from '#lib/platforms/contracts'
import type { LocationFilter } from '#lib/geo/region_filter'

export interface ImportRequest {
  eventImportId: string
  signal?: AbortSignal
}

/**
 * Builds the HTTP function handed to an adapter. Injectable so tests can
 * replay recorded responses through exactly the code path production uses,
 * rather than exercising a parallel one.
 */
export type HttpFactory = (adapter: PlatformAdapter, signal: AbortSignal) => PlatformFetch

const liveHttpFactory: HttpFactory = (adapter, signal) =>
  createPlatformHttp({ platform: adapter.key, rateLimit: adapter.rateLimit, signal })

class ImportCancelledError extends Error {
  constructor() {
    super('Import cancelled')
    this.name = 'ImportCancelledError'
  }
}

/**
 * Runs one tournament import end to end.
 *
 * Deliberately a plain service rather than logic inside a job class: it can be
 * driven from an ace command for debugging without a worker, it is directly
 * testable, and if the experimental queue API changes only the thin job wrapper
 * moves.
 */
export class EventImporterService {
  private readonly httpFactory: HttpFactory

  constructor(options: { httpFactory?: HttpFactory } = {}) {
    this.httpFactory = options.httpFactory ?? liveHttpFactory
  }

  async run({ eventImportId, signal }: ImportRequest): Promise<EventImport> {
    const controller = new AbortController()
    signal?.addEventListener('abort', () => controller.abort(signal.reason), { once: true })

    const eventImport = await EventImport.findOrFail(eventImportId)

    if (eventImport.isFinished) {
      return eventImport
    }

    if (eventImport.status === 'cancelling') {
      return this.finishCancelled(eventImport)
    }

    eventImport.status = 'running'
    eventImport.stage = 'resolving'
    eventImport.error = null
    await eventImport.save()

    try {
      const adapter = platforms.get(eventImport.platformKey)
      const ref = this.resolveRef(adapter, eventImport)
      const credentials = await this.loadCredentials(adapter, eventImport)

      /**
       * One in-flight import per credential across the whole instance. This is
       * what makes rate limiting tractable: with a single job per API key,
       * pacing is a local concern needing no cross-process coordination.
       */
      return await this.withCredentialLock(eventImport, async () => {
        return this.stream(adapter, ref, credentials, eventImport, controller)
      })
    } catch (error) {
      if (error instanceof ImportCancelledError) {
        return this.finishCancelled(eventImport)
      }

      eventImport.status = 'failed'
      eventImport.error = this.describe(error)
      eventImport.finishedAt = DateTime.now()
      await eventImport.save()

      throw error
    }
  }

  private resolveRef(adapter: PlatformAdapter, eventImport: EventImport): EventRef {
    if (eventImport.targetUrl) {
      const ref = adapter.matchUrl(eventImport.targetUrl)
      if (!ref) {
        throw new PermanentPlatformError(
          `${adapter.displayName} did not recognise ${eventImport.targetUrl}`,
          { platform: adapter.key }
        )
      }
      return ref
    }

    return {
      platform: adapter.key,
      slug: String(eventImport.payload?.slug ?? eventImport.id),
      url: null,
      payload: eventImport.payload ?? undefined,
    }
  }

  private async loadCredentials(
    adapter: PlatformAdapter,
    eventImport: EventImport
  ): Promise<Record<string, string>> {
    if (adapter.credentials === null) {
      return {}
    }

    const stored = await LeagueCredential.query()
      .where('leagueId', eventImport.leagueId)
      .where('platformKey', adapter.key)
      .first()

    if (!stored) {
      throw new PermanentPlatformError(
        `This league has no ${adapter.displayName} credentials. Add them in league settings.`,
        { platform: adapter.key }
      )
    }

    /**
     * Validated with the adapter's own schema, so a malformed credential fails
     * here with a readable message rather than as an opaque 401 mid-import.
     */
    const validator = vine.compile(adapter.credentials.schema)
    return validator.validate(stored.values) as Promise<Record<string, string>>
  }

  private async withCredentialLock<T>(
    eventImport: EventImport,
    work: () => Promise<T>
  ): Promise<T> {
    const lockKey = `${eventImport.leagueId}:${eventImport.platformKey}`

    const client = await db.connection().transaction()
    try {
      const { rows } = await client.rawQuery(
        'select pg_try_advisory_xact_lock(hashtext(?)) as ok',
        [lockKey]
      )

      if (!rows[0]?.ok) {
        throw new PermanentPlatformError(
          'Another import is already running for this platform. Try again once it finishes.',
          { platform: eventImport.platformKey }
        )
      }

      const result = await work()
      await client.commit()
      return result
    } catch (error) {
      await client.rollback()
      throw error
    }
  }

  private async stream(
    adapter: PlatformAdapter,
    ref: EventRef,
    credentials: Record<string, string>,
    eventImport: EventImport,
    controller: AbortController
  ): Promise<EventImport> {
    const signal = controller.signal
    const writer = new TournamentWriterService(adapter.key)
    const observer = new CapabilityObserver()

    const http = this.httpFactory(adapter, signal)

    eventImport.stage = 'fetching'
    await eventImport.save()

    let bracketsDone = 0

    let eventCreatedByThisRun = false

    /**
     * Counted as records pass so an import that succeeded but contained nothing
     * rateable can say so. `ratable` mirrors what `SetSelectionService` accepts,
     * because that is what decides whether a ranking moves.
     */
    const counts = { entrants: 0, sets: 0, ratableSets: 0 }

    /**
     * The sink is also where cancellation reaches the adapter: throwing here
     * unwinds `fetchEvent`, so an abort stops the fetch rather than only
     * stopping the writes.
     */
    const writing: ImportSink = {
      tournament: async (tournament) => {
        await this.checkCancelled(eventImport, controller)
        eventImport.tournamentId = await writer.writeTournament(tournament)
        await eventImport.save()
      },

      event: async (event) => {
        await this.checkCancelled(eventImport, controller)

        const preexisting = await Event.query()
          .where('tournamentId', eventImport.tournamentId!)
          .where('externalId', event.externalId)
          .first()
        eventCreatedByThisRun = preexisting === null

        eventImport.eventId = await writer.writeEvent(event)
        await eventImport.save()
      },

      entrants: async (eventExternalId, entrants) => {
        await this.checkCancelled(eventImport, controller)
        await writer.writeEntrants(eventExternalId, entrants)

        counts.entrants += entrants.length
      },

      phase: async (eventExternalId, phase) => {
        await this.checkCancelled(eventImport, controller)
        await writer.writePhase(eventExternalId, phase)
      },

      bracket: async (_eventExternalId, phaseExternalId, bracket) => {
        await this.checkCancelled(eventImport, controller)
        await writer.writeBracket(phaseExternalId, bracket)

        counts.sets += bracket.sets.length
        counts.ratableSets += bracket.sets.filter(
          (set) =>
            set.state === 'completed' &&
            set.entrantAExternalId !== null &&
            set.entrantBExternalId !== null &&
            set.winnerEntrantExternalId !== null
        ).length

        bracketsDone += 1
        eventImport.bracketsDone = bracketsDone
        await eventImport.save()
      },

      progress: async (_completed, total) => {
        await this.checkCancelled(eventImport, controller)
        if (total === null) return

        eventImport.bracketsTotal = total
        await eventImport.save()
      },
    }

    const observing: ImportSink = {
      tournament: (tournament) => writing.tournament(tournament),
      event: (event) => writing.event(event),
      entrants: async (eventExternalId, entrants) => {
        observer.observeEntrants(entrants)
        await writing.entrants(eventExternalId, entrants)
      },
      phase: (eventExternalId, phase) => writing.phase(eventExternalId, phase),
      bracket: async (eventExternalId, phaseExternalId, bracket) => {
        observer.observeBracket(bracket)
        await writing.bracket(eventExternalId, phaseExternalId, bracket)
      },
      progress: (completed, total, label) => writing.progress(completed, total, label),
    }

    /**
     * Wrapped so contract violations fail this import with a specific message
     * rather than writing rows that are quietly wrong. Every adapter gets this,
     * including one nobody wrote a test for.
     */
    const validating = new ValidatingSink(adapter.key, observing)

    /**
     * Outermost, so an oversized event is rejected before `ValidatingSink` or
     * anything behind it does any work, not just before the writer does.
     */
    const sink = new SizeLimitingSink(adapter.key, DEFAULT_SIZE_LIMITS, validating)

    try {
      await adapter.fetchEvent(ref, { credentials, http, signal, logger }, sink)
    } catch (error) {
      if (error instanceof ImportCancelledError) {
        await this.rollbackCancelledImport(eventImport, eventCreatedByThisRun)
      }
      throw error
    }

    const tournamentId = eventImport.tournamentId
    const eventId = eventImport.eventId

    if (!tournamentId || !eventId) {
      throw new PermanentPlatformError(`${adapter.displayName} returned no event for ${ref.slug}`, {
        platform: adapter.key,
      })
    }

    eventImport.stage = 'linking'
    await eventImport.save()

    await db.transaction(async (trx) => {
      /**
       * Capabilities record what this import actually contained, rather than
       * what the platform claims to support. See app/lib/platforms/capabilities.ts.
       */
      await Tournament.query({ client: trx })
        .where('id', tournamentId)
        .update({ capabilities: observer.result })

      /**
       * The league takes the event, not the tournament. A sibling event of the
       * same tournament is a separate import and a separate decision.
       */
      await LeagueEvent.updateOrCreate(
        { leagueId: eventImport.leagueId, eventId },
        { addedByUserId: eventImport.createdByUserId, regionFilter: eventImport.regionFilter },
        { client: trx }
      )
    })

    /**
     * The event is always written in full regardless of the region filter —
     * this counts how much of it this league actually admits, not what got
     * written. Identity resolution is what the filter actually gates: see
     * `IdentityResolverService.accountsIn`.
     */
    const { entrantsImported, setsImported } = await this.importedCounts(
      eventId,
      eventImport.regionFilter,
      counts
    )

    eventImport.status = 'ok'
    eventImport.stage = 'done'
    eventImport.stats = {
      capabilities: observer.result,
      brackets: bracketsDone,
      entrantsImported,
      setsImported,
      ...counts,
    }
    eventImport.finishedAt = DateTime.now()
    await eventImport.save()

    return eventImport
  }

  private async importedCounts(
    eventId: string,
    regionFilter: LocationFilter[],
    counts: { entrants: number; sets: number }
  ): Promise<{ entrantsImported: number; setsImported: number }> {
    if (regionFilter.length === 0) {
      return { entrantsImported: counts.entrants, setsImported: counts.sets }
    }

    const qualifying = await new EntrantRegionService().qualifyingEntrantIds(eventId, regionFilter)

    const setRows = await db
      .from('sets as s')
      .innerJoin('brackets as b', 'b.id', 's.bracket_id')
      .innerJoin('phases as p', 'p.id', 'b.phase_id')
      .where('p.event_id', eventId)
      .select('s.entrant_a_id', 's.entrant_b_id')

    const setsImported = setRows.filter(
      (row) =>
        (row.entrant_a_id === null || qualifying.has(row.entrant_a_id)) &&
        (row.entrant_b_id === null || qualifying.has(row.entrant_b_id))
    ).length

    return { entrantsImported: qualifying.size, setsImported }
  }

  /**
   * Polls the row for a cancellation request. Cross-process by necessity.
   */
  private async checkCancelled(
    eventImport: EventImport,
    controller: AbortController
  ): Promise<void> {
    controller.signal.throwIfAborted()

    const row = await EventImport.query().where('id', eventImport.id).select('status').first()
    if (row?.status === 'cancelling') {
      controller.abort(new ImportCancelledError())
    }

    controller.signal.throwIfAborted()
  }

  private async rollbackCancelledImport(
    eventImport: EventImport,
    eventCreatedByThisRun: boolean
  ): Promise<void> {
    if (!eventCreatedByThisRun || !eventImport.eventId) return

    await Event.query().where('id', eventImport.eventId).delete()
    eventImport.eventId = null
  }

  private async finishCancelled(eventImport: EventImport): Promise<EventImport> {
    eventImport.status = 'cancelled'
    eventImport.finishedAt = DateTime.now()
    await eventImport.save()
    return eventImport
  }

  private describe(error: unknown): string {
    if (error instanceof PlatformError) {
      return error.message
    }

    return error instanceof Error ? error.message : String(error)
  }
}
