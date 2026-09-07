import EventImport from '#models/event_import'
import ImportEventJob from '#jobs/import_event_job'
import { platforms } from '#lib/platforms/registry'
import { importValidator } from '#validators/import'
import type { LocationFilter } from '#lib/geo/region_filter'
import type { HttpContext } from '@adonisjs/core/http'

/** Collapses an all-empty region row to `null`. */
function normaliseLocation(
  location: { country?: string; state?: string; city?: string } | undefined
): LocationFilter | null {
  if (!location) return null

  const country = location.country?.trim() || undefined
  const state = location.state?.trim() || undefined
  const city = location.city?.trim() || undefined

  if (!country && !state && !city) return null

  return { country, state, city }
}

/**
 * Drops any all-blank row.
 */
function normaliseRegionFilter(
  regions: Array<{ country?: string; state?: string; city?: string }> | undefined
): LocationFilter[] {
  return (regions ?? [])
    .map((region) => normaliseLocation(region))
    .filter((region): region is LocationFilter => region !== null)
}

function regionFilterTag(regions: LocationFilter[]): string | null {
  if (regions.length === 0) return null

  const regionNames = regions.map((region) =>
    [region.city, region.state, region.country].filter(Boolean).join(', ')
  )

  return `${regionNames.join(' / ')} Filtered`
}

/**
 * Starting and monitoring imports.
 *
 * Nothing here names a platform: the registry decides which adapter owns a
 * pasted link, so supporting a new one requires no change to this file.
 */
export default class ImportsController {
  async index({ league, inertia }: HttpContext) {
    const imports = await EventImport.query()
      .where('leagueId', league.id)
      .preload('tournament')
      .preload('event')
      .orderBy('createdAt', 'desc')
      .limit(25)

    return inertia.render('leagues/imports', {
      league: { slug: league.slug, name: league.name },
      platforms: platforms.all().map((adapter) => ({
        key: adapter.key,
        displayName: adapter.displayName,
        needsCredentials: adapter.credentials !== null,
      })),
      imports: imports.map((record) => {
        const baseLabel = record.event?.name
          ? `${record.tournament?.name ?? ''} — ${record.event.name}`.replace(/^ — /, '')
          : (record.tournament?.name ?? record.targetUrl ?? 'Pending')

        const tag = regionFilterTag(record.regionFilter)

        return {
          id: record.id,
          platformKey: record.platformKey,
          label: tag ? `${baseLabel} [${tag}]` : baseLabel,
          /**
           * Only linkable once the import has actually succeeded
           */
          eventId: record.status === 'ok' ? record.eventId : null,
          targetUrl: record.targetUrl,
          status: record.status,
          stage: record.stage,
          bracketsDone: record.bracketsDone,
          bracketsTotal: record.bracketsTotal,
          error: record.error,
          warning: record.emptyWarning,
          counts: record.stats as {
            entrants?: number
            sets?: number
            regionFilteredOutSets?: number
          } | null,
        }
      }),
    })
  }

  /**
   * Accepts an event link, works out which platform owns it, and queues the
   * import. A link naming a whole tournament is recognised here and rejected by
   * the adapter, which can say which events it holds.
   */
  async store({ league, auth, request, response, session }: HttpContext) {
    const { url, regionFilter } = await request.validateUsing(importValidator)

    const resolved = platforms.resolveUrl(url)
    if (!resolved) {
      session.flash('errors', { url: 'No supported platform recognises that link.' })
      return response.redirect().back()
    }

    const eventImport = await EventImport.create({
      leagueId: league.id,
      platformKey: resolved.adapter.key,
      targetUrl: url,
      status: 'queued',
      createdByUserId: auth.getUserOrFail().id,
      regionFilter: normaliseRegionFilter(regionFilter),
    })

    await ImportEventJob.dispatch({ eventImportId: eventImport.id })

    return response.redirect().toRoute('imports.index', { league: league.slug })
  }

  /**
   * Requests cancellation of a queued or running import by setting a flag for the worker to noice and begin rollback.
   */
  async cancel({ league, params, response, session }: HttpContext) {
    const eventImport = await EventImport.query()
      .where('id', params.import)
      .where('leagueId', league.id)
      .first()

    if (!eventImport) {
      return response.notFound({ message: 'No such import' })
    }

    if (eventImport.status !== 'queued' && eventImport.status !== 'running') {
      session.flash('error', 'That import can no longer be cancelled.')
      return response.redirect().back()
    }

    eventImport.status = 'cancelling'
    await eventImport.save()

    return response.redirect().back()
  }
}
