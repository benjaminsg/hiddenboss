import db from '@adonisjs/lucid/services/db'
import type { RegionLocation } from '#lib/geo/region_filter'

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

    const map = new Map<string, RegionLocation[]>()

    for (const row of rows) {
      const list = map.get(row.entrant_id) ?? []
      list.push({ country: row.country, state: row.state, city: row.city })
      map.set(row.entrant_id, list)
    }

    return map
  }
}
