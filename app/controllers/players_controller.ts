import db from '@adonisjs/lucid/services/db'
import LeaguePlayer from '#models/league_player'
import Ranking from '#models/ranking'
import RankingEligibilityOverride from '#models/ranking_eligibility_override'
import PlayerEventAttendance from '#models/player_event_attendance'
import LeaguePolicy from '#policies/league_policy'
import RecomputeRankingJob from '#jobs/recompute_ranking_job'
import { StalenessService } from '#services/rankings/staleness_service'
import { updatePlayerValidator } from '#validators/player'
import { addPlayerEventAttendanceValidator } from '#validators/player_event_attendance'
import { DEFAULT_TIMEZONE } from '#lib/geo/timezones'
import { normalizeCountry, normalizeState } from '#lib/geo/country'
import { platforms } from '#lib/platforms/registry'
import { DateTime } from 'luxon'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * The league's roster, and one player's record within it.
 *
 * Both pages read a ranking's latest completed recompute rather than computing
 * anything, so they stay a handful of indexed reads.
 */
export default class PlayersController {
  async index({ league, bouncer, request, inertia }: HttpContext) {
    const ranking = await resolveRanking(league.id, request.input('ranking'))

    /**
     * Merged players are kept as tombstones so a merge stays reversible, but
     * they are not people — the roster shows only live rows.
     */
    const players = await LeaguePlayer.query()
      .where('leagueId', league.id)
      .whereNull('mergedIntoId')
      .orderBy('displayTag')

    const standings = ranking?.latestRecomputeId
      ? await db
          .from('ranking_standings')
          .where('ranking_recompute_id', ranking.latestRecomputeId)
          .select('league_player_id', 'rank', 'value', 'wins', 'losses', 'sets_played')
      : []

    const byPlayer = new Map(standings.map((row) => [row.league_player_id, row]))

    return inertia.render('leagues/players', {
      league: { slug: league.slug, name: league.name },
      canManage: await bouncer.with(LeaguePolicy).allows('manage', league),
      ranking: ranking ? { slug: ranking.slug, name: ranking.name } : null,
      players: players
        .map((player) => {
          const standing = byPlayer.get(player.id)

          return {
            slug: player.slug,
            displayTag: player.displayTag,
            city: player.city,
            state: player.state,
            country: player.country,
            rank: standing?.rank ?? null,
            rating: standing ? Math.round(Number(standing.value)) : null,
            wins: standing?.wins ?? 0,
            losses: standing?.losses ?? 0,
            setsPlayed: standing?.sets_played ?? 0,
          }
        })
        /**
         * Ranked players first in rank order, then everyone else by name. Sorting
         * the whole roster alphabetically buries the standings among players who
         * have no rated sets yet.
         */
        .sort((a, b) => {
          if (a.rank !== null && b.rank !== null) return a.rank - b.rank
          if (a.rank !== null) return -1
          if (b.rank !== null) return 1
          return a.displayTag.localeCompare(b.displayTag)
        }),
    })
  }

  async show({ league, bouncer, params, request, response, inertia }: HttpContext) {
    let player = await LeaguePlayer.query()
      .where('leagueId', league.id)
      .where('slug', params.player)
      .first()

    /** A merged player's URL keeps working by following the tombstone. */
    while (player?.mergedIntoId) {
      player = await LeaguePlayer.find(player.mergedIntoId)
    }

    if (!player) {
      response.status(404)
      return inertia.render('leagues/player_not_found', {
        league: { slug: league.slug, name: league.name },
        canManage: await bouncer.with(LeaguePolicy).allows('manage', league),
        slug: params.player,
      })
    }

    const ranking = await resolveRanking(league.id, request.input('ranking'))

    const standing = ranking?.latestRecomputeId
      ? await db
          .from('ranking_standings')
          .where('ranking_recompute_id', ranking.latestRecomputeId)
          .where('league_player_id', player.id)
          .first()
      : null

    /**
     * Per-set rating changes, newest first, each carrying the set that caused it.
     * This is what `ranking_set_deltas` exists for — the answer to "why did my
     * rating move" rather than just "it moved".
     */
    const matches = ranking
      ? await db
          .from('ranking_set_deltas as d')
          .innerJoin('sets as s', 's.id', 'd.set_id')
          .innerJoin('brackets as b', 'b.id', 's.bracket_id')
          .innerJoin('phases as p', 'p.id', 'b.phase_id')
          .innerJoin('events as e', 'e.id', 'p.event_id')
          .innerJoin('tournaments as t', 't.id', 'e.tournament_id')
          .where('d.ranking_id', ranking.id)
          .where('d.league_player_id', player.id)
          .select(
            'd.value_before',
            'd.value_after',
            'd.delta',
            'd.occurred_at',
            's.id as set_id',
            's.full_round_text',
            's.score_a',
            's.score_b',
            's.entrant_a_id',
            's.entrant_b_id',
            's.winner_entrant_id',
            'e.id as event_id',
            'e.name as event_name',
            't.name as tournament_name'
          )
          .orderBy('d.occurred_at', 'desc')
          .limit(100)
      : []

    const sides = await sidesOf(
      league.id,
      matches.map((row) => row.set_id)
    )

    /** Every event this player entered, with where they placed. */
    const entries = await db
      .from('entrants as en')
      .innerJoin('entrant_participants as ep', 'ep.entrant_id', 'en.id')
      .innerJoin(
        'league_player_accounts as lpa',
        'lpa.platform_account_id',
        'ep.platform_account_id'
      )
      .innerJoin('events as e', 'e.id', 'en.event_id')
      .innerJoin('tournaments as t', 't.id', 'e.tournament_id')
      .innerJoin('league_events as le', 'le.event_id', 'e.id')
      .where('lpa.league_player_id', player.id)
      .where('le.league_id', league.id)
      .select(
        'e.id as event_id',
        'e.name as event_name',
        'e.entrant_count',
        'e.entry_kind',
        't.name as tournament_name',
        't.start_at',
        'en.placement',
        'en.is_disqualified'
      )
      .orderBy('t.start_at', 'desc')

    /**
     * One point per tournament in the ranking, including tournaments this player
     * did not enter — the recompute carries their standing forward, which is what
     * makes the line continuous rather than a scatter of the events they played.
     */
    const history = ranking
      ? await db
          .from('ranking_tournament_standings')
          .where('ranking_id', ranking.id)
          .where('league_player_id', player.id)
          .whereNotNull('occurred_at')
          .select('occurred_at', 'rank', 'value')
          .orderBy('occurred_at')
      : []

    const accounts = await db
      .from('league_player_accounts as lpa')
      .innerJoin('platform_accounts as pa', 'pa.id', 'lpa.platform_account_id')
      .where('lpa.league_player_id', player.id)
      .select(
        'pa.platform_key',
        'pa.gamer_tag',
        'pa.prefix',
        'pa.external_user_id',
        'pa.profile_slug',
        'pa.weak_identity',
        'lpa.source',
        'lpa.provisional'
      )

    const zone = league.timezone ?? DEFAULT_TIMEZONE

    const eligibilityOverride = ranking
      ? await RankingEligibilityOverride.query()
          .where('rankingId', ranking.id)
          .where('leaguePlayerId', player.id)
          .first()
      : null

    const canManage = await bouncer.with(LeaguePolicy).allows('manage', league)

    const attendanceCredits = await PlayerEventAttendance.query()
      .where('leaguePlayerId', player.id)
      .preload('event', (query) => query.preload('tournament'))
      .orderBy('createdAt', 'desc')

    const leagueEvents = canManage
      ? await db
          .from('league_events as le')
          .innerJoin('events as e', 'e.id', 'le.event_id')
          .innerJoin('tournaments as t', 't.id', 'e.tournament_id')
          .where('le.league_id', league.id)
          .select('e.id', 'e.name as event_name', 't.name as tournament_name', 't.start_at')
          .orderBy('t.start_at', 'desc')
      : []

    return inertia.render('leagues/player', {
      league: { slug: league.slug, name: league.name },
      canManage,
      player: {
        id: player.id,
        slug: player.slug,
        displayTag: player.displayTag,
        pronouns: player.pronouns,
        city: player.city,
        state: player.state,
        country: player.country,
      },
      ranking: ranking ? { slug: ranking.slug, name: ranking.name } : null,
      eligibilityOverride: eligibilityOverride
        ? { id: eligibilityOverride.id, kind: eligibilityOverride.kind }
        : null,
      attendanceCredits: attendanceCredits.map((credit) => ({
        id: credit.id,
        label: `${credit.event.tournament.name} — ${credit.event.name}`,
        startAt: credit.event.tournament.startAt?.setZone(zone).toISODate() ?? null,
      })),
      events: leagueEvents.map((row) => ({
        id: row.id,
        label: `${row.tournament_name} — ${row.event_name}`,
      })),
      standing: standing
        ? {
            rank: standing.rank,
            rating: Math.round(Number(standing.value)),
            wins: standing.wins,
            losses: standing.losses,
            setsPlayed: standing.sets_played,
          }
        : null,
      history: history.map((row) => ({
        date: isoDate(row.occurred_at, zone),
        rank: row.rank,
        rating: Math.round(Number(row.value)),
      })),
      matches: matches.map((row) => {
        const side = sides.get(row.set_id)
        const playerIsA = side?.aPlayers.has(player.id) ?? false
        const mine = playerIsA ? row.score_a : row.score_b
        const theirs = playerIsA ? row.score_b : row.score_a

        return {
          setId: row.set_id,
          eventId: row.event_id,
          label: `${row.tournament_name} — ${row.event_name}`,
          round: row.full_round_text,
          opponents: side?.opponents.get(player.id) ?? [],
          won: row.winner_entrant_id === (playerIsA ? row.entrant_a_id : row.entrant_b_id),
          score: mine === null && theirs === null ? null : `${mine ?? '—'}–${theirs ?? '—'}`,
          before: Math.round(Number(row.value_before)),
          after: Math.round(Number(row.value_after)),
          delta: Math.round(Number(row.delta)),
          occurredAt: row.occurred_at ? isoDate(row.occurred_at, zone) : null,
        }
      }),
      entries: entries.map((row) => ({
        eventId: row.event_id,
        label: `${row.tournament_name} — ${row.event_name}`,
        entryKind: row.entry_kind,
        placement: row.placement,
        entrantCount: row.entrant_count,
        isDisqualified: row.is_disqualified,
        startAt: row.start_at ? isoDate(row.start_at, zone) : null,
      })),
      accounts: accounts.map((row) => ({
        platformKey: row.platform_key,
        platformName: platforms.has(row.platform_key)
          ? platforms.get(row.platform_key).displayName
          : row.platform_key,
        gamerTag: row.gamer_tag,
        prefix: row.prefix,
        source: row.source,
        provisional: row.provisional,
        /**
         * A weak-identity row is a bracket entrant the platform never tied to an account.
         */
        weakIdentity: row.weak_identity,
        profileUrl:
          row.weak_identity || !platforms.has(row.platform_key)
            ? null
            : platforms.get(row.platform_key).profileUrl({
                externalUserId: row.external_user_id,
                profileSlug: row.profile_slug,
                gamerTag: row.gamer_tag,
              }),
      })),
    })
  }

  /**
   * A league admin's manual correction to a player
   */
  async update({ league, params, request, response, session }: HttpContext) {
    const player = await LeaguePlayer.query()
      .where('leagueId', league.id)
      .where('slug', params.player)
      .whereNull('mergedIntoId')
      .first()

    if (!player) {
      return response.notFound({ message: 'No such player' })
    }

    const payload = await request.validateUsing(updatePlayerValidator)

    const country = normalizeCountry(payload.country || null)
    player.merge({
      displayTag: payload.displayTag,
      city: payload.city || null,
      state: normalizeState(payload.state || null, country),
      country,
    })
    await player.save()

    session.flash('success', `Updated ${player.displayTag}`)

    return response.redirect().toRoute('players.show', { league: league.slug, player: player.slug })
  }

  /**
   * A manual "this player attended this event" grant, league-wide.
   */
  async addAttendance({ league, params, request, response, session }: HttpContext) {
    const player = await LeaguePlayer.query()
      .where('leagueId', league.id)
      .where('slug', params.player)
      .whereNull('mergedIntoId')
      .first()

    if (!player) {
      return response.notFound({ message: 'No such player' })
    }

    const payload = await request.validateUsing(addPlayerEventAttendanceValidator)

    const counted = await db
      .from('league_events')
      .where('league_id', league.id)
      .where('event_id', payload.eventId)
      .first()

    if (!counted) {
      return response.notFound({ message: 'No such event in this league' })
    }

    const existing = await PlayerEventAttendance.query()
      .where('leaguePlayerId', player.id)
      .where('eventId', payload.eventId)
      .first()

    if (existing) {
      session.flash('error', `${player.displayTag} already has attendance credit for that event.`)
      return response.redirect().back()
    }

    await PlayerEventAttendance.create({ leaguePlayerId: player.id, eventId: payload.eventId })
    await this.restaleAndForceRecompute(league.id)

    session.flash('success', `Credited ${player.displayTag} with attendance.`)

    return response.redirect().back()
  }

  async removeAttendance({ league, params, response, session }: HttpContext) {
    const player = await LeaguePlayer.query()
      .where('leagueId', league.id)
      .where('slug', params.player)
      .first()

    if (!player) {
      return response.notFound({ message: 'No such player' })
    }

    const attendance = await PlayerEventAttendance.query()
      .where('id', params.eventAttendance)
      .where('leaguePlayerId', player.id)
      .first()

    if (!attendance) {
      return response.notFound({ message: 'No such attendance credit' })
    }

    await attendance.delete()
    await this.restaleAndForceRecompute(league.id)

    session.flash('success', 'Attendance credit removed.')

    return response.redirect().back()
  }

  private async restaleAndForceRecompute(leagueId: string): Promise<void> {
    const auto = await new StalenessService().markLeagueStale(leagueId)
    for (const rankingId of auto) {
      await RecomputeRankingJob.dispatch({ rankingId, force: true })
    }
  }
}

/**
 * Resolve ranking a profile is read against.
 */
async function resolveRanking(leagueId: string, slug: unknown): Promise<Ranking | null> {
  if (typeof slug === 'string' && slug.length > 0) {
    const named = await Ranking.query().where('leagueId', leagueId).where('slug', slug).first()
    if (named) return named
  }

  return Ranking.query()
    .where('leagueId', leagueId)
    .whereNotNull('latestRecomputeId')
    .orderBy('published', 'desc')
    .orderBy('name')
    .first()
}

type Opponent = { slug: string; displayTag: string }

/**
 * Who played on each side of the given sets.
 */
async function sidesOf(
  leagueId: string,
  setIds: string[]
): Promise<Map<string, { aPlayers: Set<string>; opponents: Map<string, Opponent[]> }>> {
  const result = new Map<string, { aPlayers: Set<string>; opponents: Map<string, Opponent[]> }>()
  if (setIds.length === 0) return result

  const rows = await db
    .from('sets as s')
    .innerJoin('entrants as en', (join) =>
      join.on('en.id', 's.entrant_a_id').orOn('en.id', 's.entrant_b_id')
    )
    .innerJoin('entrant_participants as ep', 'ep.entrant_id', 'en.id')
    .innerJoin('league_player_accounts as lpa', 'lpa.platform_account_id', 'ep.platform_account_id')
    .innerJoin('league_players as lp', 'lp.id', 'lpa.league_player_id')
    .whereIn('s.id', setIds)
    .where('lpa.league_id', leagueId)
    .select(
      's.id as set_id',
      's.entrant_a_id',
      'en.id as entrant_id',
      'lp.id as player_id',
      'lp.slug',
      'lp.display_tag'
    )

  const bySet = new Map<string, typeof rows>()
  for (const row of rows) {
    const list = bySet.get(row.set_id) ?? []
    list.push(row)
    bySet.set(row.set_id, list)
  }

  for (const [setId, list] of bySet) {
    const aPlayers = new Set<string>()
    const opponents = new Map<string, Opponent[]>()

    for (const row of list) {
      if (row.entrant_id === row.entrant_a_id) aPlayers.add(row.player_id)

      /**
       * Everyone on the other entrant, deduped by player.
       */
      const others = new Map<string, Opponent>()
      for (const other of list) {
        if (other.entrant_id !== row.entrant_id) {
          others.set(other.player_id, { slug: other.slug, displayTag: other.display_tag })
        }
      }

      if (others.size > 0) opponents.set(row.player_id, [...others.values()])
    }

    result.set(setId, { aPlayers, opponents })
  }

  return result
}

function isoDate(value: unknown, zone: string): string {
  return DateTime.fromJSDate(new Date(value as string))
    .setZone(zone)
    .toISODate()!
}
