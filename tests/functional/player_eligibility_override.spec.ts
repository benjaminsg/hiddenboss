import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import League from '#models/league'
import LeagueAdmin from '#models/league_admin'
import LeaguePlayer from '#models/league_player'
import Ranking from '#models/ranking'
import RankingRecompute from '#models/ranking_recompute'
import RankingEligibilityOverride from '#models/ranking_eligibility_override'
import User from '#models/user'

/**
 * The player page surfaces the same eligibility override the ranking edit
 * page manages, scoped to whichever ranking the page resolved — a
 * convenience surface over `rankings.eligibilityOverrides.*`, not a second
 * source of truth.
 */
test.group('player eligibility override', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  async function makeLeagueWithOwner() {
    const owner = await User.create({
      email: `owner-${Math.random()}@example.com`,
      password: 'secret123',
      fullName: 'Owner',
    })

    const league = await League.create({
      slug: `player-override-${Math.random().toString(36).slice(2, 10)}`,
      name: 'Player Override League',
      visibility: 'public',
    })

    await LeagueAdmin.create({ leagueId: league.id, userId: owner.id, role: 'owner' })

    return { owner, league }
  }

  async function makeResolvableRanking(league: League) {
    const ranking = await Ranking.create({
      leagueId: league.id,
      slug: 'power-ranking',
      name: 'Power Ranking',
      algorithm: 'elo',
      recomputeMode: 'manual',
      published: true,
    })
    const recompute = await RankingRecompute.create({ rankingId: ranking.id, status: 'ok' })
    ranking.merge({ latestRecomputeId: recompute.id })
    await ranking.save()

    return ranking
  }

  test('shows no override and the player id when none is set', async ({ client, assert }) => {
    const { owner, league } = await makeLeagueWithOwner()
    await makeResolvableRanking(league)
    const player = await LeaguePlayer.create({
      leagueId: league.id,
      slug: 'player-one',
      displayTag: 'Player One',
    })

    const response = await client
      .get(`/${league.slug}/players/${player.slug}`)
      .loginAs(owner)
      .header('X-Inertia', 'true')
      .header('X-Inertia-Version', '1')

    response.assertStatus(200)
    const props = response.body().props as {
      player: { id: string }
      eligibilityOverride: unknown
    }
    assert.equal(props.player.id, player.id)
    assert.isNull(props.eligibilityOverride)
  })

  test('surfaces the current override for the resolved ranking', async ({ client, assert }) => {
    const { owner, league } = await makeLeagueWithOwner()
    const ranking = await makeResolvableRanking(league)
    const player = await LeaguePlayer.create({
      leagueId: league.id,
      slug: 'player-two',
      displayTag: 'Player Two',
    })
    await RankingEligibilityOverride.create({
      rankingId: ranking.id,
      leaguePlayerId: player.id,
      kind: 'exclude',
    })

    const response = await client
      .get(`/${league.slug}/players/${player.slug}`)
      .loginAs(owner)
      .header('X-Inertia', 'true')
      .header('X-Inertia-Version', '1')

    response.assertStatus(200)
    const props = response.body().props as {
      eligibilityOverride: { kind: string } | null
    }
    assert.equal(props.eligibilityOverride?.kind, 'exclude')
  })

  test('an override added from the player page is scoped to the resolved ranking', async ({
    client,
    assert,
  }) => {
    const { owner, league } = await makeLeagueWithOwner()
    const ranking = await makeResolvableRanking(league)
    const player = await LeaguePlayer.create({
      leagueId: league.id,
      slug: 'player-three',
      displayTag: 'Player Three',
    })

    const response = await client
      .post(`/${league.slug}/rankings/${ranking.slug}/eligibility-overrides`)
      .loginAs(owner)
      .withCsrfToken()
      .fields({ leaguePlayerId: player.id, kind: 'exempt' })
      .redirects(0)

    response.assertStatus(302)

    const override = await RankingEligibilityOverride.query()
      .where('rankingId', ranking.id)
      .where('leaguePlayerId', player.id)
      .firstOrFail()
    assert.equal(override.kind, 'exempt')
  })
})
