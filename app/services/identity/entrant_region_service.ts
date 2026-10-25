import db from '@adonisjs/lucid/services/db'
import { entrantMatchesRegions } from '#lib/geo/region_filter'
import type { LocationFilter, RegionLocation } from '#lib/geo/region_filter'

function groupByEntrant(
  rows: Array<{
    entrant_id: string
    country: string | null
    state: string | null
    city: string | null
  }>
): Map<string, RegionLocation[]> {
  const map = new Map<string, RegionLocation[]>()

  for (const row of rows) {
    const list = map.get(row.entrant_id) ?? []
    list.push({ country: row.country, state: row.state, city: row.city })
    map.set(row.entrant_id, list)
  }

  return map
}

/**
 * The location half of `entrantSides`, shared by the read-time region filter
 * in set selection and head-to-head.
 */
export class EntrantRegionService {
  /** Maps each entrant id to the locations of its league players. */
  async regionsByEntrant(
    leagueId: string,
    entrantIds: string[]
  ): Promise<Map<string, RegionLocation[]>> {
    const rows = await db
      .from('entrant_participants')
      .innerJoin(
        'league_player_accounts',
        'league_player_accounts.platform_account_id',
        'entrant_participants.platform_account_id'
      )
      .innerJoin('league_players', 'league_players.id', 'league_player_accounts.league_player_id')
      .where('league_player_accounts.league_id', leagueId)
      .whereIn('entrant_participants.entrant_id', entrantIds)
      .select(
        'entrant_participants.entrant_id',
        'league_players.country',
        'league_players.state',
        'league_players.city'
      )

    return groupByEntrant(rows)
  }

  /**
   * Entrants of `eventId` whose participants, by their own platform account's
   * reported location, all satisfy `regions` — before any league player
   * exists to read a location from.
   *
   * Used by identity resolution to decide which entrants are admitted to a
   * league at all when its import was region-filtered, and by the importer
   * to report how many were not.
   */
  async qualifyingEntrantIds(eventId: string, regions: LocationFilter[]): Promise<Set<string>> {
    const entrantRows = await db.from('entrants').where('event_id', eventId).select('id')
    const entrantIds = entrantRows.map((row) => row.id as string)

    if (entrantIds.length === 0) return new Set()
    if (regions.length === 0) return new Set(entrantIds)

    const locationRows = await db
      .from('entrant_participants as ep')
      .innerJoin('platform_accounts as pa', 'pa.id', 'ep.platform_account_id')
      .whereIn('ep.entrant_id', entrantIds)
      .select('ep.entrant_id', 'pa.country', 'pa.state', 'pa.city')

    const byEntrant = groupByEntrant(locationRows)

    return new Set(
      entrantIds.filter((id) => entrantMatchesRegions(byEntrant.get(id) ?? [], regions))
    )
  }
}
