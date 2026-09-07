import db from '@adonisjs/lucid/services/db'
import Entrant from '#models/entrant'
import { entrantMatchesRegions, parseRegionFilter } from '#lib/geo/region_filter'
import type { RegionLocation } from '#lib/geo/region_filter'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'

/**
 * Deletes an event's entrants (and, by cascade, their participants and sets)
 * that fall outside the region filter it is now counted under.
 */
export class EventRegionReconcilerService {
  async reconcile(
    eventId: string,
    options: { client?: TransactionClientContract } = {}
  ): Promise<string[]> {
    const client = options.client ?? db

    const leagueEvents = await client
      .from('league_events')
      .where('event_id', eventId)
      .select('region_filter')

    if (leagueEvents.length !== 1) return []

    const regions = parseRegionFilter(leagueEvents[0].region_filter)
    if (regions.length === 0) return []

    const entrantRows = await client.from('entrants').where('event_id', eventId).select('id')
    const entrantIds = entrantRows.map((row) => row.id as string)

    if (entrantIds.length === 0) return []

    const locationRows = await client
      .from('entrant_participants as ep')
      .join('platform_accounts as pa', 'pa.id', 'ep.platform_account_id')
      .whereIn('ep.entrant_id', entrantIds)
      .select('ep.entrant_id', 'pa.country', 'pa.state', 'pa.city')

    const byEntrant = new Map<string, RegionLocation[]>()
    for (const row of locationRows) {
      const list = byEntrant.get(row.entrant_id) ?? []
      list.push({ country: row.country, state: row.state, city: row.city })
      byEntrant.set(row.entrant_id, list)
    }

    const doomed = entrantIds.filter(
      (id) => !entrantMatchesRegions(byEntrant.get(id) ?? [], regions)
    )

    if (doomed.length === 0) return []

    await Entrant.query({ client: options.client }).whereIn('id', doomed).delete()

    return doomed
  }
}
