import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { DateTime } from 'luxon'
import EventImport from '#models/event_import'
import Event from '#models/event'
import League from '#models/league'
import LeaguePlayer from '#models/league_player'
import Ranking from '#models/ranking'
import RankingStanding from '#models/ranking_standing'
import RankingSetDelta from '#models/ranking_set_delta'
import PlayerEventAttendance from '#models/player_event_attendance'
import { IdentityResolverService } from '#services/identity/identity_resolver_service'
import { RankingRecomputerService } from '#services/rankings/ranking_recomputer_service'
import { EventImporterService } from '#services/imports/event_importer_service'

/**
 * A manual attendance grant is merged into `RankingRecomputerService`'s own
 * `tournamentActivity()` output at replay time, so coverage here runs a real
 * recompute over real imported sets rather than hand-rolling standings —
 * the whole point is proving the merge happens for real.
 */
test.group('player attendance credit', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  async function importWeekly(
    league: League,
    slug: string,
    entrants: string,
    sets: string,
    startAt = '2026-01-10'
  ): Promise<string> {
    const tournamentImport = await EventImport.create({
      leagueId: league.id,
      platformKey: 'manual',
      status: 'queued',
      payload: { name: slug, slug, entrants, sets, startAt },
    })

    const finished = await new EventImporterService().run({ eventImportId: tournamentImport.id })
    await new IdentityResolverService().run({ leagueId: league.id, eventId: finished.eventId! })

    return finished.eventId!
  }

  async function playerNamed(league: League, displayTag: string): Promise<LeaguePlayer> {
    return LeaguePlayer.query()
      .where('leagueId', league.id)
      .where('displayTag', displayTag)
      .firstOrFail()
  }

  async function standingsFor(client: any, league: League, ranking: Ranking) {
    const response = await client
      .get(`/${league.slug}/rankings/${ranking.slug}`)
      .header('X-Inertia', 'true')
      .header('X-Inertia-Version', '1')

    return response.body().props.standings as Array<{ player: string; inactive: boolean }>
  }

  test('a manual grant lets a player with zero sets in a tournament satisfy an activity requirement', async ({
    client,
    assert,
  }) => {
    const league = await League.create({
      slug: 'attendance-satisfies',
      name: 'attendance-satisfies',
      visibility: 'public',
    })
    await importWeekly(
      league,
      'attendance-satisfies-week-1',
      'name\nAlice\nBob\n',
      'entrant_a,entrant_b,score_a,score_b\nAlice,Bob,3,1\n'
    )
    const week2EventId = await importWeekly(
      league,
      'attendance-satisfies-week-2',
      'name\nBob\nCarol\n',
      'entrant_a,entrant_b,score_a,score_b\nBob,Carol,3,0\n'
    )

    const ranking = await Ranking.create({
      leagueId: league.id,
      slug: 'ranking',
      name: 'Ranking',
      algorithm: 'elo',
      recomputeMode: 'manual',
      activityRequirements: [{ count: 2, minEntrants: null }],
      published: true,
    })
    await new RankingRecomputerService().run(ranking.id)

    const before = await standingsFor(client, league, ranking)
    assert.isTrue(before.find((standing) => standing.player === 'Alice')!.inactive)

    const alice = await playerNamed(league, 'Alice')
    await PlayerEventAttendance.create({ leaguePlayerId: alice.id, eventId: week2EventId })
    await new RankingRecomputerService().run(ranking.id, { force: true })

    const after = await standingsFor(client, league, ranking)
    assert.isFalse(after.find((standing) => standing.player === 'Alice')!.inactive)
  })

  test('a grant does not duplicate a tournament the player already has real activity in', async ({
    assert,
  }) => {
    const league = await League.create({
      slug: 'attendance-no-dup',
      name: 'attendance-no-dup',
      visibility: 'public',
    })
    const week1EventId = await importWeekly(
      league,
      'attendance-no-dup-week-1',
      'name\nAlice\nBob\n',
      'entrant_a,entrant_b,score_a,score_b\nAlice,Bob,3,1\n'
    )

    const alice = await playerNamed(league, 'Alice')
    await PlayerEventAttendance.create({ leaguePlayerId: alice.id, eventId: week1EventId })

    const ranking = await Ranking.create({
      leagueId: league.id,
      slug: 'ranking',
      name: 'Ranking',
      algorithm: 'elo',
      recomputeMode: 'manual',
      published: true,
    })
    const result = await new RankingRecomputerService().run(ranking.id)

    const standing = await RankingStanding.query()
      .where('rankingRecomputeId', result.recompute.id)
      .where('leaguePlayerId', alice.id)
      .firstOrFail()

    // One entry, carrying the real set count — not a second, zeroed entry.
    assert.lengthOf(standing.tournamentActivity, 1)
    assert.equal(standing.tournamentActivity[0].setsPlayed, 1)
  })

  test('a grant never affects wins, losses, sets played, or rating — no RankingSetDelta rows', async ({
    assert,
  }) => {
    const league = await League.create({
      slug: 'attendance-no-rating',
      name: 'attendance-no-rating',
      visibility: 'public',
    })
    await importWeekly(
      league,
      'attendance-no-rating-week-1',
      'name\nAlice\nBob\n',
      'entrant_a,entrant_b,score_a,score_b\nAlice,Bob,3,1\n'
    )
    const week2EventId = await importWeekly(
      league,
      'attendance-no-rating-week-2',
      'name\nBob\nCarol\n',
      'entrant_a,entrant_b,score_a,score_b\nBob,Carol,3,0\n'
    )
    const week2 = await Event.findOrFail(week2EventId)

    const alice = await playerNamed(league, 'Alice')
    await PlayerEventAttendance.create({ leaguePlayerId: alice.id, eventId: week2EventId })

    const ranking = await Ranking.create({
      leagueId: league.id,
      slug: 'ranking',
      name: 'Ranking',
      algorithm: 'elo',
      recomputeMode: 'manual',
      published: true,
    })
    const result = await new RankingRecomputerService().run(ranking.id)

    const standing = await RankingStanding.query()
      .where('rankingRecomputeId', result.recompute.id)
      .where('leaguePlayerId', alice.id)
      .firstOrFail()

    assert.equal(standing.wins, 1)
    assert.equal(standing.losses, 0)
    assert.equal(standing.setsPlayed, 1)

    const deltasForCreditedTournament = await RankingSetDelta.query()
      .where('leaguePlayerId', alice.id)
      .where('tournamentId', week2.tournamentId)
    assert.lengthOf(deltasForCreditedTournament, 0)
  })

  test('removing a grant and forcing a recompute drops the credit again', async ({
    client,
    assert,
  }) => {
    const league = await League.create({
      slug: 'attendance-removed',
      name: 'attendance-removed',
      visibility: 'public',
    })
    await importWeekly(
      league,
      'attendance-removed-week-1',
      'name\nAlice\nBob\n',
      'entrant_a,entrant_b,score_a,score_b\nAlice,Bob,3,1\n'
    )
    const week2EventId = await importWeekly(
      league,
      'attendance-removed-week-2',
      'name\nBob\nCarol\n',
      'entrant_a,entrant_b,score_a,score_b\nBob,Carol,3,0\n'
    )

    const ranking = await Ranking.create({
      leagueId: league.id,
      slug: 'ranking',
      name: 'Ranking',
      algorithm: 'elo',
      recomputeMode: 'manual',
      activityRequirements: [{ count: 2, minEntrants: null }],
      published: true,
    })
    await new RankingRecomputerService().run(ranking.id)

    const alice = await playerNamed(league, 'Alice')
    const grant = await PlayerEventAttendance.create({
      leaguePlayerId: alice.id,
      eventId: week2EventId,
    })
    await new RankingRecomputerService().run(ranking.id, { force: true })
    const credited = await standingsFor(client, league, ranking)
    assert.isFalse(credited.find((standing) => standing.player === 'Alice')!.inactive)

    await grant.delete()
    await new RankingRecomputerService().run(ranking.id, { force: true })

    const afterRemoval = await standingsFor(client, league, ranking)
    assert.isTrue(afterRemoval.find((standing) => standing.player === 'Alice')!.inactive)
  })

  test("a grant is excluded when its tournament falls outside the ranking's date range", async ({
    assert,
  }) => {
    const league = await League.create({
      slug: 'attendance-out-of-range',
      name: 'attendance-out-of-range',
      visibility: 'public',
    })
    await importWeekly(
      league,
      'attendance-out-of-range-week-1',
      'name\nAlice\nBob\n',
      'entrant_a,entrant_b,score_a,score_b\nAlice,Bob,3,1\n',
      '2026-01-10'
    )
    const lateEventId = await importWeekly(
      league,
      'attendance-out-of-range-week-2',
      'name\nBob\nCarol\n',
      'entrant_a,entrant_b,score_a,score_b\nBob,Carol,3,0\n',
      '2026-06-01'
    )

    const alice = await playerNamed(league, 'Alice')
    await PlayerEventAttendance.create({ leaguePlayerId: alice.id, eventId: lateEventId })

    const ranking = await Ranking.create({
      leagueId: league.id,
      slug: 'ranking',
      name: 'Ranking',
      algorithm: 'elo',
      recomputeMode: 'manual',
      activityRequirements: [{ count: 2, minEntrants: null }],
      // Bounds the replay to week 1 only — the credited week 2 tournament
      // falls outside this range.
      endsAt: DateTime.fromISO('2026-02-01'),
      published: true,
    })
    const result = await new RankingRecomputerService().run(ranking.id)

    const standing = await RankingStanding.query()
      .where('rankingRecomputeId', result.recompute.id)
      .where('leaguePlayerId', alice.id)
      .firstOrFail()

    assert.lengthOf(standing.tournamentActivity, 1)
  })

  test('a grant for a player with no real sets anywhere in the ranking produces no standing row', async ({
    assert,
  }) => {
    const league = await League.create({
      slug: 'attendance-inert',
      name: 'attendance-inert',
      visibility: 'public',
    })
    const week1EventId = await importWeekly(
      league,
      'attendance-inert-week-1',
      'name\nAlice\nBob\n',
      'entrant_a,entrant_b,score_a,score_b\nAlice,Bob,3,1\n'
    )

    const ghost = await LeaguePlayer.create({
      leagueId: league.id,
      slug: 'ghost',
      displayTag: 'Ghost',
    })
    await PlayerEventAttendance.create({ leaguePlayerId: ghost.id, eventId: week1EventId })

    const ranking = await Ranking.create({
      leagueId: league.id,
      slug: 'ranking',
      name: 'Ranking',
      algorithm: 'elo',
      recomputeMode: 'manual',
      published: true,
    })
    const result = await new RankingRecomputerService().run(ranking.id)

    const standing = await RankingStanding.query()
      .where('rankingRecomputeId', result.recompute.id)
      .where('leaguePlayerId', ghost.id)
      .first()

    assert.isNull(standing)
  })

  test('a grant against a player later merged into another still applies after the merge', async ({
    assert,
  }) => {
    const league = await League.create({
      slug: 'attendance-merge',
      name: 'attendance-merge',
      visibility: 'public',
    })
    await importWeekly(
      league,
      'attendance-merge-week-1',
      'name\nAlice\nBob\n',
      'entrant_a,entrant_b,score_a,score_b\nAlice,Bob,3,1\n'
    )
    const week2EventId = await importWeekly(
      league,
      'attendance-merge-week-2',
      'name\nBob\nCarol\n',
      'entrant_a,entrant_b,score_a,score_b\nBob,Carol,3,0\n'
    )

    const alice = await playerNamed(league, 'Alice')
    const aliceAlt = await LeaguePlayer.create({
      leagueId: league.id,
      slug: 'alice-alt',
      displayTag: 'AliceAlt',
    })
    await PlayerEventAttendance.create({ leaguePlayerId: aliceAlt.id, eventId: week2EventId })
    aliceAlt.mergedIntoId = alice.id
    await aliceAlt.save()

    const ranking = await Ranking.create({
      leagueId: league.id,
      slug: 'ranking',
      name: 'Ranking',
      algorithm: 'elo',
      recomputeMode: 'manual',
      published: true,
    })
    const result = await new RankingRecomputerService().run(ranking.id, { force: true })

    const standing = await RankingStanding.query()
      .where('rankingRecomputeId', result.recompute.id)
      .where('leaguePlayerId', alice.id)
      .firstOrFail()

    assert.lengthOf(standing.tournamentActivity, 2)
  })
})
