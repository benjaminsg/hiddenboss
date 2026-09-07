import db from '@adonisjs/lucid/services/db'
import LeaguePlayer from '#models/league_player'
import { entrantMatchesRegions, parseRegionFilter } from '#lib/geo/region_filter'
import type { RegionLocation } from '#lib/geo/region_filter'
import { EntrantRegionService } from '#services/identity/entrant_region_service'

export interface HeadToHeadPlayer {
  id: string
  slug: string
  displayTag: string
  city: string | null
  state: string | null
  country: string | null
}

/** One unordered pair's record, `loId` always the lexicographically smaller id. */
export interface HeadToHeadMatchup {
  loId: string
  hiId: string
  loWins: number
  hiWins: number
}

interface SetRow {
  set_id: string
  entrant_a_id: string
  entrant_b_id: string
  winner_entrant_id: string
  region_filter: unknown
}

/**
 * Head-to-head singles records for a league's players.
 *
 * A doubles or crew set is entrant-vs-entrant, not player-vs-player: crediting
 * it to individual players would conflate a team's identity with the
 * identity of the people on it. So only sets that resolve to exactly one
 * league player on each side count here — everything else is dropped.
 */
export class HeadToHeadService {
  async forLeague(
    leagueId: string
  ): Promise<{ players: HeadToHeadPlayer[]; matchups: HeadToHeadMatchup[] }> {
    const players = await LeaguePlayer.query()
      .where('leagueId', leagueId)
      .whereNull('mergedIntoId')
      .orderBy('displayTag')
      .select('id', 'slug', 'displayTag', 'city', 'state', 'country')

    const rows: SetRow[] = await db
      .from('sets')
      .innerJoin('brackets', 'brackets.id', 'sets.bracket_id')
      .innerJoin('phases', 'phases.id', 'brackets.phase_id')
      .innerJoin('events', 'events.id', 'phases.event_id')
      .innerJoin('league_events', 'league_events.event_id', 'events.id')
      .where('league_events.league_id', leagueId)
      .where('sets.state', 'completed')
      .whereNotNull('sets.entrant_a_id')
      .whereNotNull('sets.entrant_b_id')
      .whereNotNull('sets.winner_entrant_id')
      .select(
        'sets.id as set_id',
        'sets.entrant_a_id',
        'sets.entrant_b_id',
        'sets.winner_entrant_id',
        'league_events.region_filter as region_filter'
      )

    if (rows.length === 0) {
      return {
        players: players.map((player) => ({
          id: player.id,
          slug: player.slug,
          displayTag: player.displayTag,
          city: player.city,
          state: player.state,
          country: player.country,
        })),
        matchups: [],
      }
    }

    const sides = await this.entrantSides(leagueId, rows)

    const regionBySet = new Map(
      rows.map((row) => [row.set_id, parseRegionFilter(row.region_filter)])
    )
    const entrantIds = [...new Set(rows.flatMap((row) => [row.entrant_a_id, row.entrant_b_id]))]
    const entrantRegions = [...regionBySet.values()].some((filter) => filter.length > 0)
      ? await new EntrantRegionService().regionsByEntrant(leagueId, entrantIds)
      : new Map<string, RegionLocation[]>()

    const totals = new Map<string, { loId: string; hiId: string; loWins: number; hiWins: number }>()

    for (const row of rows) {
      const sideA = sides.get(row.entrant_a_id) ?? []
      const sideB = sides.get(row.entrant_b_id) ?? []

      // Doubles/crew sides, or an entrant identity resolution hasn't caught
      // up to yet, are not attributable to a single player pair.
      if (sideA.length !== 1 || sideB.length !== 1) continue

      const regions = regionBySet.get(row.set_id) ?? []
      if (
        regions.length > 0 &&
        (!entrantMatchesRegions(entrantRegions.get(row.entrant_a_id) ?? [], regions) ||
          !entrantMatchesRegions(entrantRegions.get(row.entrant_b_id) ?? [], regions))
      ) {
        continue
      }

      const [playerA] = sideA
      const [playerB] = sideB
      if (playerA === playerB) continue

      const lo = playerA < playerB ? playerA : playerB
      const hi = playerA < playerB ? playerB : playerA
      const key = `${lo}|${hi}`

      const totalsRow = totals.get(key) ?? { loId: lo, hiId: hi, loWins: 0, hiWins: 0 }
      const winnerIsA = row.winner_entrant_id === row.entrant_a_id
      const winner = winnerIsA ? playerA : playerB

      if (winner === lo) {
        totalsRow.loWins += 1
      } else {
        totalsRow.hiWins += 1
      }

      totals.set(key, totalsRow)
    }

    return {
      players: players.map((player) => ({
        id: player.id,
        slug: player.slug,
        displayTag: player.displayTag,
        city: player.city,
        state: player.state,
        country: player.country,
      })),
      matchups: [...totals.values()],
    }
  }

  /**
   * Maps each entrant to the league players behind it.
   *
   * Same join `SetSelectionService.entrantSides` uses (entrant -> participants
   * -> platform accounts -> league players), including merge-following, so a
   * player merged mid-history still gets credit for their earlier sets under
   * the surviving id.
   */
  private async entrantSides(leagueId: string, rows: SetRow[]): Promise<Map<string, string[]>> {
    const entrantIds = [...new Set(rows.flatMap((row) => [row.entrant_a_id, row.entrant_b_id]))]

    const links = await db
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
        'league_players.id as league_player_id',
        'league_players.merged_into_id'
      )

    const sides = new Map<string, string[]>()

    for (const link of links) {
      const playerId = link.merged_into_id ?? link.league_player_id
      const existing = sides.get(link.entrant_id) ?? []

      if (!existing.includes(playerId)) {
        existing.push(playerId)
      }

      sides.set(link.entrant_id, existing)
    }

    return sides
  }
}
