import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import EventImport from '#models/event_import'
import League from '#models/league'
import LeaguePlayer from '#models/league_player'
import Ranking from '#models/ranking'
import RankingEligibilityOverride from '#models/ranking_eligibility_override'
import { EventImporterService } from '#services/imports/event_importer_service'
import { IdentityResolverService } from '#services/identity/identity_resolver_service'
import { RankingRecomputerService } from '#services/rankings/ranking_recomputer_service'
import { RankingPlayerEligibilityService } from '#services/rankings/ranking_player_eligibility_service'

/**
 * Mirrors the activity/residency/override logic `RankingsController#show`
 * already applies to standings, generalised to a league player who may have
 * no standing yet.
 */
test.group('RankingPlayerEligibilityService', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  async function importWeekly(league: League, slug: string, entrants: string, sets: string) {
    const eventImport = await EventImport.create({
      leagueId: league.id,
      platformKey: 'manual',
      status: 'queued',
      payload: { name: slug, slug, entrants, sets, startAt: '2026-01-10' },
    })

    const finished = await new EventImporterService().run({ eventImportId: eventImport.id })
    await new IdentityResolverService().run({ leagueId: league.id, eventId: finished.eventId! })
  }

  async function playerId(league: League, displayTag: string): Promise<string> {
    const player = await LeaguePlayer.query()
      .where('leagueId', league.id)
      .where('displayTag', displayTag)
      .firstOrFail()
    return player.id
  }

  /** Alice and Bob play both weeklies; Carol only shows up once. */
  async function seedTwoWeeklies(slug: string): Promise<League> {
    const league = await League.create({ slug, name: slug, visibility: 'public' })

    await importWeekly(
      league,
      `${slug}-week-1`,
      'name,country,state\nAlice,US,CA\nBob,US,NY\nCarol,US,CA\n',
      'entrant_a,entrant_b,score_a,score_b\nAlice,Bob,3,1\nBob,Carol,3,0\n'
    )
    await importWeekly(
      league,
      `${slug}-week-2`,
      'name,country,state\nAlice,US,CA\nBob,US,NY\n',
      'entrant_a,entrant_b,score_a,score_b\nAlice,Bob,3,2\n'
    )

    return league
  }

  test('everyone is eligible when the ranking has no requirements', async ({ assert }) => {
    const league = await seedTwoWeeklies('elig-none')
    const ranking = await Ranking.create({
      leagueId: league.id,
      slug: 'ranking',
      name: 'Ranking',
      algorithm: 'elo',
      recomputeMode: 'manual',
      published: true,
    })
    await new RankingRecomputerService().run(ranking.id)
    await ranking.refresh()

    const ids = [
      await playerId(league, 'Alice'),
      await playerId(league, 'Bob'),
      await playerId(league, 'Carol'),
    ]
    const eligible = await new RankingPlayerEligibilityService().eligiblePlayerIds(ranking, ids)

    assert.sameMembers([...eligible], ids)
  })

  test('a player who fails the activity requirement is not eligible', async ({ assert }) => {
    const league = await seedTwoWeeklies('elig-activity')
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
    await ranking.refresh()

    const alice = await playerId(league, 'Alice')
    const carol = await playerId(league, 'Carol')
    const eligible = await new RankingPlayerEligibilityService().eligiblePlayerIds(ranking, [
      alice,
      carol,
    ])

    assert.sameMembers([...eligible], [alice])
  })

  test('a player who fails the residency requirement is not eligible', async ({ assert }) => {
    const league = await seedTwoWeeklies('elig-residency')
    const ranking = await Ranking.create({
      leagueId: league.id,
      slug: 'ranking',
      name: 'Ranking',
      algorithm: 'elo',
      recomputeMode: 'manual',
      residencyRequirements: [{ state: 'CA' }],
      published: true,
    })
    await new RankingRecomputerService().run(ranking.id)
    await ranking.refresh()

    const alice = await playerId(league, 'Alice')
    const bob = await playerId(league, 'Bob')
    const eligible = await new RankingPlayerEligibilityService().eligiblePlayerIds(ranking, [
      alice,
      bob,
    ])

    assert.sameMembers([...eligible], [alice])
  })

  test('an exempt override admits a player who would otherwise fail', async ({ assert }) => {
    const league = await seedTwoWeeklies('elig-exempt')
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
    await ranking.refresh()

    const carol = await playerId(league, 'Carol')
    await RankingEligibilityOverride.create({
      rankingId: ranking.id,
      leaguePlayerId: carol,
      kind: 'exempt',
    })

    const eligible = await new RankingPlayerEligibilityService().eligiblePlayerIds(ranking, [carol])

    assert.isTrue(eligible.has(carol))
  })

  test('an exclude override drops a player who would otherwise pass', async ({ assert }) => {
    const league = await seedTwoWeeklies('elig-exclude')
    const ranking = await Ranking.create({
      leagueId: league.id,
      slug: 'ranking',
      name: 'Ranking',
      algorithm: 'elo',
      recomputeMode: 'manual',
      published: true,
    })
    await new RankingRecomputerService().run(ranking.id)
    await ranking.refresh()

    const alice = await playerId(league, 'Alice')
    await RankingEligibilityOverride.create({
      rankingId: ranking.id,
      leaguePlayerId: alice,
      kind: 'exclude',
    })

    const eligible = await new RankingPlayerEligibilityService().eligiblePlayerIds(ranking, [alice])

    assert.isFalse(eligible.has(alice))
  })

  /**
   * No recompute has ever run, so there is no standing to read a history
   * from — treated the same as a standing with no attendance, which fails
   * any non-trivial activity requirement rather than being skipped.
   */
  test('a player with no standing yet fails a non-trivial activity requirement', async ({
    assert,
  }) => {
    const league = await League.create({ slug: 'elig-unrecomputed', name: 'Unrecomputed' })
    await importWeekly(league, 'elig-unrecomputed-week', 'name\nAlice\n', '')
    const ranking = await Ranking.create({
      leagueId: league.id,
      slug: 'ranking',
      name: 'Ranking',
      algorithm: 'elo',
      recomputeMode: 'manual',
      activityRequirements: [{ count: 1, minEntrants: null }],
      published: true,
    })

    const alice = await playerId(league, 'Alice')
    const eligible = await new RankingPlayerEligibilityService().eligiblePlayerIds(ranking, [alice])

    assert.isFalse(eligible.has(alice))
  })
})
