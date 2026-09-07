import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import League from '#models/league'
import LeagueAdmin from '#models/league_admin'
import LeaguePlayer from '#models/league_player'
import Ranking from '#models/ranking'
import RankingEligibilityOverride from '#models/ranking_eligibility_override'
import User from '#models/user'

/** Admin CRUD over a ranking's manual eligibility overrides. */
test.group('ranking eligibility overrides', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  async function makeLeagueWithOwner() {
    const owner = await User.create({
      email: `owner-${Math.random()}@example.com`,
      password: 'secret123',
      fullName: 'Owner',
    })

    const league = await League.create({
      slug: `overrides-${Math.random().toString(36).slice(2, 10)}`,
      name: 'Overrides League',
      visibility: 'public',
    })

    await LeagueAdmin.create({ leagueId: league.id, userId: owner.id, role: 'owner' })

    return { owner, league }
  }

  async function makeRanking(league: League) {
    return Ranking.create({
      leagueId: league.id,
      slug: 'power-ranking',
      name: 'Power Ranking',
      algorithm: 'elo',
      recomputeMode: 'manual',
      published: true,
    })
  }

  async function makePlayer(league: League, displayTag = 'Player One') {
    return LeaguePlayer.create({
      leagueId: league.id,
      slug: displayTag.toLowerCase().replace(/\s+/g, '-'),
      displayTag,
    })
  }

  test('an admin can add an exempt override', async ({ client, assert }) => {
    const { owner, league } = await makeLeagueWithOwner()
    const ranking = await makeRanking(league)
    const player = await makePlayer(league)

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

  test('an admin can add an exclude override', async ({ client, assert }) => {
    const { owner, league } = await makeLeagueWithOwner()
    const ranking = await makeRanking(league)
    const player = await makePlayer(league)

    const response = await client
      .post(`/${league.slug}/rankings/${ranking.slug}/eligibility-overrides`)
      .loginAs(owner)
      .withCsrfToken()
      .fields({ leaguePlayerId: player.id, kind: 'exclude' })
      .redirects(0)

    response.assertStatus(302)

    const override = await RankingEligibilityOverride.query()
      .where('rankingId', ranking.id)
      .where('leaguePlayerId', player.id)
      .firstOrFail()
    assert.equal(override.kind, 'exclude')
  })

  test('adding a second override for the same player is rejected, not duplicated', async ({
    client,
    assert,
  }) => {
    const { owner, league } = await makeLeagueWithOwner()
    const ranking = await makeRanking(league)
    const player = await makePlayer(league)
    await RankingEligibilityOverride.create({
      rankingId: ranking.id,
      leaguePlayerId: player.id,
      kind: 'exempt',
    })

    const response = await client
      .post(`/${league.slug}/rankings/${ranking.slug}/eligibility-overrides`)
      .loginAs(owner)
      .withCsrfToken()
      .fields({ leaguePlayerId: player.id, kind: 'exclude' })
      .redirects(0)

    response.assertStatus(302)

    const overrides = await RankingEligibilityOverride.query()
      .where('rankingId', ranking.id)
      .where('leaguePlayerId', player.id)
    assert.lengthOf(overrides, 1)
    assert.equal(overrides[0].kind, 'exempt')
  })

  test('a league player from another league is rejected', async ({ client }) => {
    const { owner, league } = await makeLeagueWithOwner()
    const ranking = await makeRanking(league)
    const otherLeague = await League.create({
      slug: `other-${Math.random().toString(36).slice(2, 10)}`,
      name: 'Other League',
      visibility: 'public',
    })
    const outsider = await makePlayer(otherLeague, 'Outsider')

    const response = await client
      .post(`/${league.slug}/rankings/${ranking.slug}/eligibility-overrides`)
      .loginAs(owner)
      .withCsrfToken()
      .fields({ leaguePlayerId: outsider.id, kind: 'exempt' })
      .redirects(0)

    response.assertStatus(404)
  })

  test('an admin can remove an override', async ({ client, assert }) => {
    const { owner, league } = await makeLeagueWithOwner()
    const ranking = await makeRanking(league)
    const player = await makePlayer(league)
    const override = await RankingEligibilityOverride.create({
      rankingId: ranking.id,
      leaguePlayerId: player.id,
      kind: 'exempt',
    })

    const response = await client
      .delete(`/${league.slug}/rankings/${ranking.slug}/eligibility-overrides/${override.id}`)
      .loginAs(owner)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    assert.isNull(await RankingEligibilityOverride.find(override.id))
  })

  test('removing an override belonging to a different ranking 404s rather than deleting', async ({
    client,
    assert,
  }) => {
    const { owner, league } = await makeLeagueWithOwner()
    const ranking = await makeRanking(league)
    const otherRanking = await Ranking.create({
      leagueId: league.id,
      slug: 'other-ranking',
      name: 'Other Ranking',
      algorithm: 'elo',
      recomputeMode: 'manual',
      published: true,
    })
    const player = await makePlayer(league)
    const override = await RankingEligibilityOverride.create({
      rankingId: otherRanking.id,
      leaguePlayerId: player.id,
      kind: 'exempt',
    })

    const response = await client
      .delete(`/${league.slug}/rankings/${ranking.slug}/eligibility-overrides/${override.id}`)
      .loginAs(owner)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(404)
    assert.isNotNull(await RankingEligibilityOverride.find(override.id))
  })

  test('the edit page returns the league players and current overrides', async ({
    client,
    assert,
  }) => {
    const { owner, league } = await makeLeagueWithOwner()
    const ranking = await makeRanking(league)
    const player = await makePlayer(league)
    await RankingEligibilityOverride.create({
      rankingId: ranking.id,
      leaguePlayerId: player.id,
      kind: 'exempt',
    })

    const response = await client
      .get(`/${league.slug}/rankings/${ranking.slug}/edit`)
      .loginAs(owner)
      .header('X-Inertia', 'true')
      .header('X-Inertia-Version', '1')

    response.assertStatus(200)
    const props = response.body().props as {
      players: Array<{ id: string; displayTag: string }>
      eligibilityOverrides: Array<{ player: string; kind: string }>
    }

    assert.sameMembers(
      props.players.map((leaguePlayer) => leaguePlayer.displayTag),
      ['Player One']
    )
    assert.lengthOf(props.eligibilityOverrides, 1)
    assert.equal(props.eligibilityOverrides[0].player, 'Player One')
    assert.equal(props.eligibilityOverrides[0].kind, 'exempt')
  })
})
