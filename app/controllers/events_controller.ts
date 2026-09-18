import db from '@adonisjs/lucid/services/db'
import Event from '#models/event'
import LeagueEvent from '#models/league_event'
import LeaguePolicy from '#policies/league_policy'
import RecomputeRankingJob from '#jobs/recompute_ranking_job'
import { StalenessService } from '#services/rankings/staleness_service'
import { LeaguePlayerReconcilerService } from '#services/identity/league_player_reconciler_service'
import { updateEventValidator } from '#validators/event'
import { DEFAULT_TIMEZONE } from '#lib/geo/timezones'
import { fromLocalDate, toLocalDate } from '#lib/time/local_date'
import { platforms } from '#lib/platforms/registry'
import { DateTime } from 'luxon'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * The events a league counts, and one event's results.
 *
 * Events rather than tournaments, because that is the unit a league takes: a
 * tournament's other events belong to whoever imported them.
 */
export default class EventsController {
  async index({ league, bouncer, inertia }: HttpContext) {
    const rows = await db
      .from('league_events as le')
      .innerJoin('events as e', 'e.id', 'le.event_id')
      .innerJoin('tournaments as t', 't.id', 'e.tournament_id')
      .where('le.league_id', league.id)
      .select(
        'e.id',
        'e.name as event_name',
        'e.entry_kind',
        'e.game_name',
        'e.entrant_count',
        't.name as tournament_name',
        't.platform_key',
        't.start_at',
        't.url',
        't.country',
        't.state',
        't.city',
        't.address',
        db.raw(`(
          select count(*) from sets s
          join brackets b on b.id = s.bracket_id
          join phases p on p.id = b.phase_id
          where p.event_id = e.id and s.state = 'completed'
        ) as completed_sets`)
      )
      .orderBy('t.start_at', 'desc')

    const zone = league.timezone ?? DEFAULT_TIMEZONE

    return inertia.render('leagues/events', {
      league: { slug: league.slug, name: league.name },
      canManage: await bouncer.with(LeaguePolicy).allows('manage', league),
      events: rows.map((row) => ({
        id: row.id,
        name: row.event_name,
        tournamentName: row.tournament_name,
        entryKind: row.entry_kind,
        gameName: row.game_name,
        entrantCount: row.entrant_count,
        completedSets: Number(row.completed_sets),
        platformKey: row.platform_key,
        url: row.url,
        startAt: row.start_at ? isoDate(row.start_at, zone) : null,
        city: row.city,
        state: row.state,
        country: row.country,
        address: row.address,
      })),
    })
  }

  async show(ctx: HttpContext) {
    const { league, params, bouncer, inertia } = ctx

    /**
     * The `:event` param is a bare UUID; a bad one would otherwise reach
     * Postgres as invalid syntax and surface as a 500.
     */
    if (!isUuid(params.event)) {
      return this.renderEventNotFound(ctx)
    }

    /**
     * Scoped through `league_events` rather than looked up directly: canonical
     * events are instance-wide, so a league may only read the ones it counts.
     */
    const counted = await db
      .from('league_events')
      .where('league_id', league.id)
      .where('event_id', params.event)
      .first()

    if (!counted) {
      return this.renderEventNotFound(ctx)
    }

    const event = await Event.query().where('id', params.event).preload('tournament').first()

    if (!event) {
      return this.renderEventNotFound(ctx)
    }

    /**
     * Entrants with the tags behind them, so doubles teams read as people, plus
     * the account each one resolved through — that is what an admin corrects.
     */
    const entrants = await db
      .from('entrants as en')
      .leftJoin('entrant_participants as ep', 'ep.entrant_id', 'en.id')
      .leftJoin('platform_accounts as pa', 'pa.id', 'ep.platform_account_id')
      .leftJoin('league_player_accounts as lpa', (join) =>
        join.on('lpa.platform_account_id', 'pa.id').andOnVal('lpa.league_id', league.id)
      )
      .leftJoin('league_players as lp', 'lp.id', 'lpa.league_player_id')
      .where('en.event_id', event.id)
      .select(
        'en.id',
        'en.name',
        'en.seed',
        'en.placement',
        'en.is_disqualified',
        'lp.slug as player_slug',
        'lp.display_tag',
        'pa.id as platform_account_id',
        'pa.gamer_tag',
        'pa.platform_key',
        'pa.external_user_id',
        'pa.profile_slug',
        'lpa.source',
        'lpa.provisional'
      )
      .orderByRaw('en.placement asc nulls last, en.seed asc nulls last, en.name asc')

    const sets = await db
      .from('sets as s')
      .innerJoin('brackets as b', 'b.id', 's.bracket_id')
      .innerJoin('phases as p', 'p.id', 'b.phase_id')
      .leftJoin('entrants as ea', 'ea.id', 's.entrant_a_id')
      .leftJoin('entrants as eb', 'eb.id', 's.entrant_b_id')
      .where('p.event_id', event.id)
      .select(
        's.id',
        's.full_round_text',
        's.round',
        's.state',
        's.score_a',
        's.score_b',
        's.entrant_a_disqualified',
        's.entrant_b_disqualified',
        's.winner_entrant_id',
        's.entrant_a_id',
        's.completed_at',
        'ea.name as entrant_a_name',
        'eb.name as entrant_b_name',
        'p.name as phase_name',
        'b.name as bracket_name'
      )
      .orderByRaw(
        `p."order" asc nulls last, b.id asc, s.completed_at asc nulls last, s.ordinal asc nulls last`
      )

    /** One row per participant of a team, so entrants group rather than repeat. */
    const entrantPlayers = new Map<
      string,
      Array<{
        tag: string
        slug: string | null
        platformAccountId: string | null
        gamerTag: string | null
        platformKey: string | null
        profileUrl: string | null
        provisional: boolean
      }>
    >()

    for (const row of entrants) {
      const list = entrantPlayers.get(row.id) ?? []
      list.push({
        tag: row.display_tag ?? row.gamer_tag ?? row.name,
        slug: row.player_slug,
        platformAccountId: row.platform_account_id,
        gamerTag: row.gamer_tag,
        platformKey: row.platform_key,
        /**
         * The adapter turns whatever it stored for this account into a link to
         * the person's page on that platform, or null if it has none.
         */
        profileUrl:
          row.platform_key && platforms.has(row.platform_key)
            ? platforms.get(row.platform_key).profileUrl({
                externalUserId: row.external_user_id,
                profileSlug: row.profile_slug,
                gamerTag: row.gamer_tag,
              })
            : null,
        provisional: row.provisional ?? false,
      })
      entrantPlayers.set(row.id, list)
    }

    const canManage = await bouncer.with(LeaguePolicy).allows('manage', league)

    /**
     * Every league player, so a correction can point an account at any of them.
     * Only sent to admins — visitors have nothing to do with it.
     */
    const players = canManage
      ? await db
          .from('league_players')
          .where('league_id', league.id)
          .whereNull('merged_into_id')
          .select('id', 'display_tag')
          .orderBy('display_tag')
      : []

    const seen = new Set<string>()
    const zone = league.timezone ?? DEFAULT_TIMEZONE

    /**
     * Tournament data is canonical and shared instance-wide, so delete only when no other league
     * shares the tournament.
     */
    const otherLeague = canManage
      ? await db
          .from('league_events as le')
          .innerJoin('events as e', 'e.id', 'le.event_id')
          .where('e.tournament_id', event.tournament.id)
          .whereNot('le.league_id', league.id)
          .first()
      : null

    return inertia.render('leagues/event', {
      league: { slug: league.slug, name: league.name },
      canManage,
      tournamentSharedWithOtherLeagues: otherLeague !== null,
      players: players.map((row) => ({ id: row.id, displayTag: row.display_tag })),
      event: {
        id: event.id,
        name: event.name,
        tournamentName: event.tournament.name,
        entryKind: event.entryKind,
        gameName: event.gameName,
        entrantCount: event.entrantCount,
        platformKey: event.tournament.platformKey,
        url: event.tournament.url,
        startAt: toLocalDate(event.tournament.startAt, zone),
        city: event.tournament.city,
        state: event.tournament.state,
        country: event.tournament.country,
        address: event.tournament.address,
      },
      entrants: entrants
        .filter((row) => (seen.has(row.id) ? false : seen.add(row.id)))
        .map((row) => ({
          id: row.id,
          name: row.name,
          seed: row.seed,
          placement: row.placement,
          isDisqualified: row.is_disqualified,
          players: entrantPlayers.get(row.id) ?? [],
        })),
      sets: sets.map((row) => ({
        id: row.id,
        phase: row.phase_name,
        bracket: row.bracket_name,
        round: row.full_round_text,
        entrantA: row.entrant_a_name,
        entrantB: row.entrant_b_name,
        scoreA: row.score_a,
        scoreB: row.score_b,
        disqualifiedA: row.entrant_a_disqualified,
        disqualifiedB: row.entrant_b_disqualified,
        winnerIsA: row.winner_entrant_id !== null && row.winner_entrant_id === row.entrant_a_id,
        decided: row.winner_entrant_id !== null,
        state: row.state,
      })),
    })
  }

  /**
   * Un-counts an event rather than deleting it: canonical tournament data is
   * shared across the instance, so removing it here could break another
   * league that counts the same tournament. The event stays importable again
   * later — re-pasting the link upserts the same canonical rows and recreates
   * this league's `league_events` row.
   */
  async destroy({ league, params, response, session, auth }: HttpContext) {
    const counted = isUuid(params.event)
      ? await LeagueEvent.query()
          .where('leagueId', league.id)
          .where('eventId', params.event)
          .first()
      : null

    if (!counted) {
      return response.notFound({ message: 'No such event in this league' })
    }

    await counted.delete()

    /**
     * Unlinking removes the join row but not the league players the import built,
     * so players now backed by no counted event are pruned here — otherwise a
     * re-import under a different filter strands the old set.
     */
    await new LeaguePlayerReconcilerService().pruneUnbackedPlayers({
      leagueId: league.id,
      actorUserId: auth.user?.id ?? null,
    })

    /**
     * The next recompute of each ranking replays only the events this league
     * still counts, so a departed tournament's sets and standings are dropped
     * the same way a retroactive correction drops them — nothing here needs
     * to touch ranking tables directly.
     */
    const auto = await new StalenessService().markLeagueStale(league.id)
    for (const rankingId of auto) {
      await RecomputeRankingJob.dispatch({ rankingId })
    }

    session.flash('success', 'Removed the event from this league')

    return response.redirect().toRoute('events.index', { league: league.slug })
  }

  /**
   * Deletes the tournament itself.
   *
   * Blocked when another league still counts any event of this tournament.
   */
  async destroyTournament({ league, params, response, session, auth }: HttpContext) {
    const event = await this.loadCountedEvent(league.id, params.event)

    if (!event) {
      return response.notFound({ message: 'No such event in this league' })
    }

    const tournamentName = event.tournament.name

    const otherLeague = await db
      .from('league_events as le')
      .innerJoin('events as e', 'e.id', 'le.event_id')
      .where('e.tournament_id', event.tournament.id)
      .whereNot('le.league_id', league.id)
      .first()

    if (otherLeague) {
      session.flash(
        'error',
        `${tournamentName} is also counted by another league on this instance — it must remove it first.`
      )
      return response.redirect().back()
    }

    await event.tournament.delete()

    await new LeaguePlayerReconcilerService().pruneUnbackedPlayers({
      leagueId: league.id,
      actorUserId: auth.user?.id ?? null,
    })

    const auto = await new StalenessService().markLeagueStale(league.id)
    for (const rankingId of auto) {
      await RecomputeRankingJob.dispatch({ rankingId })
    }

    session.flash('success', `Deleted ${tournamentName} entirely`)

    return response.redirect().toRoute('events.index', { league: league.slug })
  }

  /**
   * A league admin's manual correction to an event and its tournament.
   */
  async update({ league, params, request, response, session }: HttpContext) {
    const event = await this.loadCountedEvent(league.id, params.event)

    if (!event) {
      return response.notFound({ message: 'No such event in this league' })
    }

    const payload = await request.validateUsing(updateEventValidator)

    const zone = league.timezone ?? DEFAULT_TIMEZONE
    event.name = payload.eventName
    event.tournament.merge({
      name: payload.tournamentName,
      city: payload.city || null,
      state: payload.state || null,
      country: payload.country || null,
      startAt: payload.startAt ? fromLocalDate(payload.startAt.toISODate(), zone) : null,
    })
    await event.save()
    await event.tournament.save()

    /**
     * Corrections that don't reorder or add/drop sets get silently skipped so we need to force
     * a recompute. A start date correction additionally reorders replay (ratings are
     * order-dependent) and moves the date plotted for the tournament's standing.
     */
    await this.restaleAndForceRecompute(league.id)

    session.flash('success', `Updated ${event.tournament.name}`)

    return response.redirect().toRoute('events.show', { league: league.slug, event: event.id })
  }

  private async renderEventNotFound(ctx: HttpContext) {
    ctx.response.status(404)
    return ctx.inertia.render('leagues/event_not_found', {
      league: { slug: ctx.league.slug, name: ctx.league.name },
      canManage: await ctx.bouncer.with(LeaguePolicy).allows('manage', ctx.league),
    })
  }

  private async loadCountedEvent(leagueId: string, eventId: string): Promise<Event | null> {
    if (!isUuid(eventId)) return null

    const counted = await db
      .from('league_events')
      .where('league_id', leagueId)
      .where('event_id', eventId)
      .first()

    if (!counted) return null

    return Event.query().where('id', eventId).preload('tournament').first()
  }

  private async restaleAndForceRecompute(leagueId: string): Promise<void> {
    const auto = await new StalenessService().markLeagueStale(leagueId)
    for (const rankingId of auto) {
      await RecomputeRankingJob.dispatch({ rankingId, force: true })
    }
  }
}

/** The `:event` route param is a bare UUID; anything else can't be an event id. */
function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

function isoDate(value: unknown, zone: string): string {
  return DateTime.fromJSDate(new Date(value as string))
    .setZone(zone)
    .toISODate()!
}
