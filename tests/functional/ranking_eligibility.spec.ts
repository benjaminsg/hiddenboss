import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import League from '#models/league'
import LeaguePlayer from '#models/league_player'
import Ranking from '#models/ranking'
import RankingRecompute from '#models/ranking_recompute'
import RankingStanding from '#models/ranking_standing'
import RankingEligibilityOverride from '#models/ranking_eligibility_override'
import type { LocationFilter } from '#lib/rankings/activity_requirements'

/**
 * Residency requirements and manual eligibility overrides are, like activity
 * requirements, a read-time filter over standings that already exist — a
 * player's home location lives on `LeaguePlayer` and an override lives in
 * its own table, so neither needs a recompute or the import pipeline to
 * exercise. Standings are built directly.
 */
test.group('ranking eligibility', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  async function seedRanking(
    slug: string,
    options: {
      residencyRequirements?: LocationFilter[]
      activityRequirements?: Array<{ count: number; minEntrants: number | null }>
    } = {}
  ) {
    const league = await League.create({ slug, name: slug, visibility: 'public' })
    const ranking = await Ranking.create({
      leagueId: league.id,
      slug: 'ranking',
      name: 'Ranking',
      algorithm: 'elo',
      recomputeMode: 'manual',
      residencyRequirements: options.residencyRequirements ?? [],
      activityRequirements: options.activityRequirements ?? [],
      published: true,
    })
    const recompute = await RankingRecompute.create({ rankingId: ranking.id, status: 'ok' })
    ranking.merge({ latestRecomputeId: recompute.id })
    await ranking.save()

    return { league, ranking, recompute }
  }

  async function seedStanding(
    league: League,
    recompute: RankingRecompute,
    rank: number,
    options: {
      displayTag: string
      city?: string | null
      state?: string | null
      country?: string | null
      tournamentActivity?: RankingStanding['tournamentActivity']
    }
  ) {
    const player = await LeaguePlayer.create({
      leagueId: league.id,
      slug: options.displayTag.toLowerCase(),
      displayTag: options.displayTag,
      city: options.city ?? null,
      state: options.state ?? null,
      country: options.country ?? null,
    })

    await RankingStanding.create({
      rankingRecomputeId: recompute.id,
      leaguePlayerId: player.id,
      rank,
      value: '1500',
      tournamentActivity: options.tournamentActivity ?? [
        {
          entrantCount: 8,
          setsPlayed: 2,
          timesDisqualified: 0,
          country: null,
          state: null,
          city: null,
        },
      ],
    })

    return player
  }

  async function standingsFor(client: any, league: League, ranking: Ranking) {
    const response = await client
      .get(`/${league.slug}/rankings/${ranking.slug}`)
      .header('X-Inertia', 'true')
      .header('X-Inertia-Version', '1')

    return response.body().props.standings as Array<{
      player: string
      inactive: boolean
      ineligible: boolean
      eligibilityOverride: 'exempt' | 'exclude' | null
    }>
  }

  test('a residency requirement flags a player outside every listed region as ineligible, not inactive', async ({
    client,
    assert,
  }) => {
    const { league, ranking, recompute } = await seedRanking('residency-flag', {
      residencyRequirements: [{ state: 'WA' }],
    })
    await seedStanding(league, recompute, 1, { displayTag: 'Alice', state: 'WA' })
    await seedStanding(league, recompute, 2, { displayTag: 'Bob', state: 'CA' })

    const standings = await standingsFor(client, league, ranking)
    const alice = standings.find((standing) => standing.player === 'Alice')!
    const bob = standings.find((standing) => standing.player === 'Bob')!

    assert.isFalse(alice.ineligible)
    assert.isTrue(bob.ineligible)
    // No activity requirements are set on this ranking, so a residency miss
    // is never also counted as inactivity.
    assert.isFalse(bob.inactive)
  })

  test('a player matching any one of several alternative regions qualifies', async ({
    client,
    assert,
  }) => {
    const { league, ranking, recompute } = await seedRanking('residency-alternatives', {
      residencyRequirements: [{ state: 'WA' }, { state: 'CA' }],
    })
    await seedStanding(league, recompute, 1, { displayTag: 'Carol', state: 'CA' })

    const standings = await standingsFor(client, league, ranking)

    assert.isFalse(standings.find((standing) => standing.player === 'Carol')!.ineligible)
  })

  test('activity and residency failures are independent flags', async ({ client, assert }) => {
    const { league, ranking, recompute } = await seedRanking('independent-flags', {
      residencyRequirements: [{ state: 'WA' }],
      activityRequirements: [{ count: 2, minEntrants: null }],
    })
    // Two clean tournaments, enough to clear the `count: 2` activity requirement.
    const twoTournaments: RankingStanding['tournamentActivity'] = [
      {
        entrantCount: 8,
        setsPlayed: 2,
        timesDisqualified: 0,
        country: null,
        state: null,
        city: null,
      },
      {
        entrantCount: 8,
        setsPlayed: 2,
        timesDisqualified: 0,
        country: null,
        state: null,
        city: null,
      },
    ]

    // Fails activity only.
    await seedStanding(league, recompute, 1, {
      displayTag: 'OnlyInactive',
      state: 'WA',
      tournamentActivity: [],
    })
    // Fails residency only.
    await seedStanding(league, recompute, 2, {
      displayTag: 'OnlyIneligible',
      state: 'CA',
      tournamentActivity: twoTournaments,
    })
    // Fails both.
    await seedStanding(league, recompute, 3, {
      displayTag: 'Both',
      state: 'CA',
      tournamentActivity: [],
    })
    // Fails neither.
    await seedStanding(league, recompute, 4, {
      displayTag: 'Neither',
      state: 'WA',
      tournamentActivity: twoTournaments,
    })

    const standings = await standingsFor(client, league, ranking)
    const byPlayer = new Map(standings.map((standing) => [standing.player, standing]))

    assert.deepEqual(
      {
        inactive: byPlayer.get('OnlyInactive')!.inactive,
        ineligible: byPlayer.get('OnlyInactive')!.ineligible,
      },
      { inactive: true, ineligible: false }
    )
    assert.deepEqual(
      {
        inactive: byPlayer.get('OnlyIneligible')!.inactive,
        ineligible: byPlayer.get('OnlyIneligible')!.ineligible,
      },
      { inactive: false, ineligible: true }
    )
    assert.deepEqual(
      { inactive: byPlayer.get('Both')!.inactive, ineligible: byPlayer.get('Both')!.ineligible },
      { inactive: true, ineligible: true }
    )
    assert.deepEqual(
      {
        inactive: byPlayer.get('Neither')!.inactive,
        ineligible: byPlayer.get('Neither')!.ineligible,
      },
      { inactive: false, ineligible: false }
    )
  })

  test('an exempt override clears a player failing both activity and residency requirements', async ({
    client,
    assert,
  }) => {
    const { league, ranking, recompute } = await seedRanking('exempt-override', {
      residencyRequirements: [{ state: 'WA' }],
      activityRequirements: [{ count: 5, minEntrants: null }],
    })
    const dan = await seedStanding(league, recompute, 1, {
      displayTag: 'Dan',
      state: 'CA',
      tournamentActivity: [],
    })
    await RankingEligibilityOverride.create({
      rankingId: ranking.id,
      leaguePlayerId: dan.id,
      kind: 'exempt',
    })

    const standings = await standingsFor(client, league, ranking)
    const found = standings.find((standing) => standing.player === 'Dan')!

    assert.isFalse(found.inactive)
    assert.isFalse(found.ineligible)
    assert.equal(found.eligibilityOverride, 'exempt')
  })

  test('an exclude override marks a player who passes every requirement ineligible, not inactive', async ({
    client,
    assert,
  }) => {
    const { league, ranking, recompute } = await seedRanking('exclude-override')
    const eve = await seedStanding(league, recompute, 1, { displayTag: 'Eve' })
    await RankingEligibilityOverride.create({
      rankingId: ranking.id,
      leaguePlayerId: eve.id,
      kind: 'exclude',
    })

    const standings = await standingsFor(client, league, ranking)
    const found = standings.find((standing) => standing.player === 'Eve')!

    assert.isFalse(found.inactive)
    assert.isTrue(found.ineligible)
    assert.equal(found.eligibilityOverride, 'exclude')
  })

  test('a non-overridden, failing player stays flagged ineligible', async ({ client, assert }) => {
    const { league, ranking, recompute } = await seedRanking('no-override', {
      residencyRequirements: [{ state: 'WA' }],
    })
    await seedStanding(league, recompute, 1, { displayTag: 'Faye', state: 'CA' })

    const standings = await standingsFor(client, league, ranking)
    const found = standings.find((standing) => standing.player === 'Faye')!

    assert.isTrue(found.ineligible)
    assert.isNull(found.eligibilityOverride)
  })

  test('an override is scoped to its own ranking', async ({ client, assert }) => {
    const league = await League.create({
      slug: 'override-scoping',
      name: 'override-scoping',
      visibility: 'public',
    })
    const rankingA = await Ranking.create({
      leagueId: league.id,
      slug: 'ranking-a',
      name: 'Ranking A',
      algorithm: 'elo',
      recomputeMode: 'manual',
      residencyRequirements: [{ state: 'WA' }],
      published: true,
    })
    const rankingB = await Ranking.create({
      leagueId: league.id,
      slug: 'ranking-b',
      name: 'Ranking B',
      algorithm: 'elo',
      recomputeMode: 'manual',
      residencyRequirements: [{ state: 'WA' }],
      published: true,
    })
    const recomputeA = await RankingRecompute.create({ rankingId: rankingA.id, status: 'ok' })
    rankingA.merge({ latestRecomputeId: recomputeA.id })
    await rankingA.save()
    const recomputeB = await RankingRecompute.create({ rankingId: rankingB.id, status: 'ok' })
    rankingB.merge({ latestRecomputeId: recomputeB.id })
    await rankingB.save()

    const grace = await seedStanding(league, recomputeA, 1, { displayTag: 'Grace', state: 'CA' })
    await RankingStanding.create({
      rankingRecomputeId: recomputeB.id,
      leaguePlayerId: grace.id,
      rank: 1,
      value: '1500',
      tournamentActivity: [],
    })
    await RankingEligibilityOverride.create({
      rankingId: rankingA.id,
      leaguePlayerId: grace.id,
      kind: 'exempt',
    })

    const standingsA = await standingsFor(client, league, rankingA)
    const standingsB = await standingsFor(client, league, rankingB)

    assert.isFalse(standingsA.find((standing) => standing.player === 'Grace')!.ineligible)
    assert.isTrue(standingsB.find((standing) => standing.player === 'Grace')!.ineligible)
  })
})
