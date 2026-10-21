import db from '@adonisjs/lucid/services/db'
import type Ranking from '#models/ranking'
import type { RatableSet } from '#lib/rankings/contracts'
import { DEFAULT_TIMEZONE } from '#lib/geo/timezones'
import { fromLocalDate } from '#lib/time/local_date'
import { entrantMatchesRegions, parseRegionFilter } from '#lib/geo/region_filter'
import type { RegionLocation } from '#lib/geo/region_filter'
import { EntrantRegionService } from '#services/identity/entrant_region_service'

/**
 * Which sets a ranking counts, in the order they should be replayed.
 *
 * This is the single place sets are selected for rating. Per-league
 * corrections will resolve here and nowhere else, so every read path
 * inherits them without each one having to remember. Adding a filter anywhere
 * but here is a bug.
 */
export interface SelectionRequirements {
  /** ISO dates. Bounds the tournaments considered. */
  dateRange?: { from?: string; to?: string }
  /** `singles`, `doubles`, `crew`, `other`. Omitted means all. */
  entryKinds?: string[]
  /** Platform-native game names, matched exactly. Omitted means all. */
  games?: string[]
}

/**
 * A manual "this player attended this event" grant, resolved against one tournament
 */
export interface ManualAttendanceCredit {
  leaguePlayerId: string
  tournamentId: string
  entrantCount: number | null
  country: string | null
  state: string | null
  city: string | null
}

interface SetRow {
  set_id: string
  tournament_id: string
  tournament_start_at: Date | null
  entrant_a_id: string
  entrant_b_id: string
  winner_entrant_id: string
  completed_at: Date | null
  event_entrant_count: number | null
  entrant_a_disqualified: boolean
  entrant_b_disqualified: boolean
  tournament_country: string | null
  tournament_state: string | null
  tournament_city: string | null
  region_filter: unknown
}

export class SetSelectionService {
  /**
   * Returns the ranking's sets, oldest first.
   *
   * Ordering is `tournament start -> phase order -> bracket -> set ordinal ->
   * completion time -> set id`. Completion timestamps alone are not enough:
   * they are frequently null on imported data and always null for CSV imports,
   * and rating systems are order-dependent, so an unstable order would mean a
   * recompute produced different standings from the same data.
   */
  async forRanking(ranking: Ranking, zone: string = DEFAULT_TIMEZONE): Promise<RatableSet[]> {
    const requirements = (ranking.requirements ?? {}) as SelectionRequirements

    const query = db
      .from('sets')
      .innerJoin('brackets', 'brackets.id', 'sets.bracket_id')
      .innerJoin('phases', 'phases.id', 'brackets.phase_id')
      .innerJoin('events', 'events.id', 'phases.event_id')
      .innerJoin('tournaments', 'tournaments.id', 'events.tournament_id')
      /**
       * A league takes events, not tournaments, so this is where the ranking's
       * pool is bounded. Tournaments are still joined for their date, which is
       * the outer sort of the replay.
       */
      .innerJoin('league_events', 'league_events.event_id', 'events.id')
      .where('league_events.league_id', ranking.leagueId)
      /**
       * Only decided sets between two known entrants can move a rating.
       * Byes, walkovers with a missing side and pending sets are excluded
       * here rather than in each algorithm.
       */
      .where('sets.state', 'completed')
      .whereNotNull('sets.entrant_a_id')
      .whereNotNull('sets.entrant_b_id')
      .whereNotNull('sets.winner_entrant_id')
      .select(
        'sets.id as set_id',
        'tournaments.id as tournament_id',
        'tournaments.start_at as tournament_start_at',
        'sets.entrant_a_id',
        'sets.entrant_b_id',
        'sets.winner_entrant_id',
        'sets.completed_at',
        'events.entrant_count as event_entrant_count',
        'sets.entrant_a_disqualified',
        'sets.entrant_b_disqualified',
        'tournaments.country as tournament_country',
        'tournaments.state as tournament_state',
        'tournaments.city as tournament_city',
        'league_events.region_filter as region_filter'
      )
      /**
       * Tournaments group first so each one's sets stay contiguous; the
       * per-tournament standing boundary depends on it.
       *
       * Within a tournament, completion time wins. Bracket position is only a
       * fallback for imports without timestamps — `sets.ordinal` is the order
       * sets were called to stations, which is not the order they finished.
       */
      .orderByRaw(
        `tournaments.start_at asc nulls last,
         sets.completed_at asc nulls last,
         phases."order" asc nulls last,
         brackets.id asc,
         sets.ordinal asc nulls last,
         sets.id asc`
      )

    this.applyDateRange(query, ranking, requirements, zone)

    if (requirements.entryKinds?.length) {
      query.whereIn('events.entry_kind', requirements.entryKinds)
    }

    if (requirements.games?.length) {
      query.whereIn('events.game_name', requirements.games)
    }

    const rows: SetRow[] = await query
    if (rows.length === 0) return []

    const sides = await this.entrantSides(ranking.leagueId, rows)

    const regionBySet = new Map(
      rows.map((row) => [row.set_id, parseRegionFilter(row.region_filter)])
    )
    const entrantIds = [...new Set(rows.flatMap((row) => [row.entrant_a_id, row.entrant_b_id]))]
    const entrantRegions = [...regionBySet.values()].some((filter) => filter.length > 0)
      ? await new EntrantRegionService().regionsByEntrant(ranking.leagueId, entrantIds)
      : new Map<string, RegionLocation[]>()

    return rows
      .map((row) => {
        const sideA = sides.get(row.entrant_a_id) ?? []
        const sideB = sides.get(row.entrant_b_id) ?? []

        /**
         * An entrant with no mapped players cannot be rated. That happens when
         * identity resolution has not run yet, and dropping the set is far
         * better than crediting it to the wrong person.
         */
        if (sideA.length === 0 || sideB.length === 0) return null

        /**
         * The set rows are the union of every league's import of this event, so a league that
         * counts it under a region filter re-applies that here
         */
        const regions = regionBySet.get(row.set_id) ?? []
        if (
          regions.length > 0 &&
          (!entrantMatchesRegions(entrantRegions.get(row.entrant_a_id) ?? [], regions) ||
            !entrantMatchesRegions(entrantRegions.get(row.entrant_b_id) ?? [], regions))
        ) {
          return null
        }

        return {
          setId: row.set_id,
          tournamentId: row.tournament_id,
          tournamentStartAt: row.tournament_start_at,
          sideA,
          sideB,
          winner: row.winner_entrant_id === row.entrant_a_id ? ('a' as const) : ('b' as const),
          occurredAt: row.completed_at,
          entrantCount: row.event_entrant_count,
          sideADisqualified: row.entrant_a_disqualified,
          sideBDisqualified: row.entrant_b_disqualified,
          tournamentCountry: row.tournament_country,
          tournamentState: row.tournament_state,
          tournamentCity: row.tournament_city,
        }
      })
      .filter((set): set is RatableSet => set !== null)
  }

  async forManualAttendanceCredit(
    ranking: Ranking,
    zone: string = DEFAULT_TIMEZONE
  ): Promise<ManualAttendanceCredit[]> {
    const requirements = (ranking.requirements ?? {}) as SelectionRequirements

    const query = db
      .from('player_event_attendances')
      .innerJoin('league_players', 'league_players.id', 'player_event_attendances.league_player_id')
      .innerJoin('events', 'events.id', 'player_event_attendances.event_id')
      .innerJoin('tournaments', 'tournaments.id', 'events.tournament_id')
      .innerJoin('league_events', 'league_events.event_id', 'events.id')
      .where('league_events.league_id', ranking.leagueId)
      .select(
        'league_players.id as league_player_id',
        'league_players.merged_into_id',
        'tournaments.id as tournament_id',
        'events.entrant_count as event_entrant_count',
        'tournaments.country as tournament_country',
        'tournaments.state as tournament_state',
        'tournaments.city as tournament_city'
      )

    this.applyDateRange(query, ranking, requirements, zone)

    if (requirements.entryKinds?.length) {
      query.whereIn('events.entry_kind', requirements.entryKinds)
    }

    if (requirements.games?.length) {
      query.whereIn('events.game_name', requirements.games)
    }

    const rows = await query

    return rows.map((row) => ({
      leaguePlayerId: row.merged_into_id ?? row.league_player_id,
      tournamentId: row.tournament_id,
      entrantCount: row.event_entrant_count,
      country: row.tournament_country,
      state: row.tournament_state,
      city: row.tournament_city,
    }))
  }

  private applyDateRange(
    query: any,
    ranking: Ranking,
    requirements: SelectionRequirements,
    zone: string
  ) {
    // Requirements win over the ranking's own dates when both are present.
    const fromDate = requirements.dateRange?.from ?? ranking.startsAt?.toISODate()
    const toDate = requirements.dateRange?.to ?? ranking.endsAt?.toISODate()

    const from = fromLocalDate(fromDate ?? null, zone)
    // Exclusive next-midnight rather than an inclusive `23:59:59`, so a DST
    // transition day is still bounded correctly.
    const to = toDate ? fromLocalDate(toDate, zone)!.plus({ days: 1 }) : null

    if (from) query.where('tournaments.start_at', '>=', from.toJSDate())
    if (to) query.where('tournaments.start_at', '<', to.toJSDate())
  }

  /**
   * Maps each entrant to the league players behind it.
   *
   * The join goes entrant -> participants -> platform accounts -> league
   * players, so a two-person entrant resolves to two players.
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
        /**
         * A merged-away player is kept for reversibility, so credit follows the
         * merge target. Without this, sets played before a merge would be
         * attributed to a player no longer shown anywhere.
         */
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
