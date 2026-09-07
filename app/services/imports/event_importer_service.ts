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
import { RegionFilteringSink } from '#lib/platforms/region_filtering_sink'
import { regionsEqual } from '#lib/geo/region_filter'
import { EventRegionReconcilerService } from '#services/imports/event_region_reconciler_service'
import { TournamentWriterService } from '#services/imports/tournament_writer_service'
import type { ImportSink, PlatformAdapter, PlatformFetch, EventRef } from '#lib/platforms/contracts'

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

        /**
         * A different region filter on an already imported tournament is rejected.
         */
        if (eventImport.regionFilter.length > 0) {
          const existing = await LeagueEvent.query()
            .where('leagueId', eventImport.leagueId)
            .where('eventId', eventImport.eventId)
            .first()

          if (existing && !regionsEqual(existing.regionFilter, eventImport.regionFilter)) {
            throw new PermanentPlatformError(
              'This event is already counted by this league under a different (or no) region filter — remove it from Events first, then re-import with this filter.',
              { platform: adapter.key }
            )
          }
        }
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

    /**
     * A region filter drops non-qualifying sets so capability observation sits in front of it.
     */
    const filtered: ImportSink =
      eventImport.regionFilter.length > 0
        ? new RegionFilteringSink(eventImport.regionFilter, writing)
        : writing

    const observing: ImportSink = {
      tournament: (tournament) => filtered.tournament(tournament),
      event: (event) => filtered.event(event),
      entrants: async (eventExternalId, entrants) => {
        observer.observeEntrants(entrants)
        await filtered.entrants(eventExternalId, entrants)
      },
      phase: (eventExternalId, phase) => filtered.phase(eventExternalId, phase),
      bracket: async (eventExternalId, phaseExternalId, bracket) => {
        observer.observeBracket(bracket)
        await filtered.bracket(eventExternalId, phaseExternalId, bracket)
      },
      progress: (completed, total, label) => filtered.progress(completed, total, label),
    }

    /**
     * Wrapped so contract violations fail this import with a specific message
     * rather than writing rows that are quietly wrong. Every adapter gets this,
     * including one nobody wrote a test for.
     */
    const sink = new ValidatingSink(adapter.key, observing)

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

      if (eventImport.regionFilter.length > 0) {
        await new EventRegionReconcilerService().reconcile(eventId, { client: trx })
      }
    })

    const filteredOutSets = filtered instanceof RegionFilteringSink ? filtered.excludedSetCount : 0
    const filteredOutEntrants =
      filtered instanceof RegionFilteringSink ? filtered.excludedEntrantCount : 0

    eventImport.status = 'ok'
    eventImport.stage = 'done'
    eventImport.stats = {
      capabilities: observer.result,
      brackets: bracketsDone,
      regionFilteredOutSets: filteredOutSets,
      regionFilteredOutEntrants: filteredOutEntrants,
      ...counts,
    }
    eventImport.finishedAt = DateTime.now()
    await eventImport.save()

    return eventImport
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
