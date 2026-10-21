import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { DateTime } from 'luxon'
import League from '#models/league'
import LeagueAdmin from '#models/league_admin'
import Ranking from '#models/ranking'
import User from '#models/user'
import { RankingRecomputerService } from '#services/rankings/ranking_recomputer_service'

/**
 * The date range and activity requirements are edited independently of name,
 * slug, algorithm and recompute mode, which this app has no edit path for at
 * all. Coverage here is about what each field does to the ranking's
 * recompute state, not form plumbing already covered by `league_scoping`.
 */
test.group('ranking edit', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  async function makeLeagueWithOwner() {
    const owner = await User.create({
      email: `owner-${Math.random()}@example.com`,
      password: 'secret123',
      fullName: 'Owner',
    })

    const league = await League.create({
      slug: `edit-${Math.random().toString(36).slice(2, 10)}`,
      name: 'Edit League',
      visibility: 'public',
    })

    await LeagueAdmin.create({ leagueId: league.id, userId: owner.id, role: 'owner' })

    return { owner, league }
  }

  async function makeRanking(league: League, overrides: Partial<Ranking> = {}) {
    return Ranking.create({
      leagueId: league.id,
      slug: 'power-ranking',
      name: 'Power Ranking',
      algorithm: 'elo',
      recomputeMode: 'manual',
      published: true,
      ...overrides,
    })
  }

  test('updating the date range persists it and requests a recompute', async ({
    client,
    assert,
  }) => {
    const { owner, league } = await makeLeagueWithOwner()
    const ranking = await makeRanking(league)

    const response = await client
      .patch(`/${league.slug}/rankings/${ranking.slug}`)
      .loginAs(owner)
      .withCsrfToken()
      .fields({ startsAt: '2026-01-01', endsAt: '2026-06-30' })
      .redirects(0)

    response.assertStatus(302)

    const reloaded = await Ranking.findOrFail(ranking.id)
    assert.equal(reloaded.startsAt?.toISODate(), '2026-01-01')
    assert.equal(reloaded.endsAt?.toISODate(), '2026-06-30')
    /**
     * The queue runs jobs inline under test (`QUEUE_DRIVER=sync`), so by the
     * time the response comes back the dispatched recompute has already run
     * and cleared `recomputeRequestedAt` again — a fresh `latestRecomputeId`
     * is what proves the job actually fired.
     */
    assert.isNotNull(
      reloaded.latestRecomputeId,
      'changing which sets are counted must trigger a recompute'
    )
  })

  test('updating only the activity requirements does not request a recompute', async ({
    client,
    assert,
  }) => {
    const { owner, league } = await makeLeagueWithOwner()
    const ranking = await makeRanking(league)

    const response = await client
      .patch(`/${league.slug}/rankings/${ranking.slug}`)
      .loginAs(owner)
      .withCsrfToken()
      .fields({
        'activityRequirements[0][count]': 3,
        'activityRequirements[0][minEntrants]': 8,
      })
      .redirects(0)

    response.assertStatus(302)

    const reloaded = await Ranking.findOrFail(ranking.id)
    assert.deepEqual(reloaded.activityRequirements, [{ count: 3, minEntrants: 8, location: null }])
    /**
     * `latestRecomputeId`, not `recomputeRequestedAt` — the sync queue driver
     * clears the requested-at flag the instant a dispatched job finishes, so
     * only "no recompute ever ran" proves the clauses alone triggered none.
     */
    assert.isNull(
      reloaded.latestRecomputeId,
      'tournament_entrant_counts is already stored per standing, so new clauses need no replay'
    )
  })

  test('adding a location clause forces a real recompute, not a skipped one', async ({
    client,
    assert,
  }) => {
    const { owner, league } = await makeLeagueWithOwner()
    const ranking = await makeRanking(league)

    /**
     * An `ok` recompute already on file is what makes this a meaningful
     * regression test: nothing about the sets, algorithm, config or identity
     * versions is about to change, so the recomputer's fingerprint
     * skip-check would otherwise no-op the follow-up recompute below and
     * leave every standing without the location data the new clause needs.
     */
    const before = await new RankingRecomputerService().run(ranking.id)
    assert.isFalse(before.skipped)

    const response = await client
      .patch(`/${league.slug}/rankings/${ranking.slug}`)
      .loginAs(owner)
      .withCsrfToken()
      .fields({
        'activityRequirements[0][count]': 1,
        'activityRequirements[0][minEntrants]': 25,
        'activityRequirements[0][location][city]': 'Seattle',
      })
      .redirects(0)

    response.assertStatus(302)

    const reloaded = await Ranking.findOrFail(ranking.id)
    assert.notEqual(
      reloaded.latestRecomputeId,
      before.recompute.id,
      'a location clause must force past the fingerprint skip-check, not be silently no-opped'
    )
  })

  test('updating the DQ policy does not request a recompute', async ({ client, assert }) => {
    const { owner, league } = await makeLeagueWithOwner()
    const ranking = await makeRanking(league)

    const response = await client
      .patch(`/${league.slug}/rankings/${ranking.slug}`)
      .loginAs(owner)
      .withCsrfToken()
      .fields({ dqPolicy: 'exclude_any_dq' })
      .redirects(0)

    response.assertStatus(302)

    const reloaded = await Ranking.findOrFail(ranking.id)
    assert.equal(reloaded.dqPolicy, 'exclude_any_dq')
    assert.isNull(
      reloaded.latestRecomputeId,
      'the DQ policy is a read-time filter over data already stored per standing'
    )
  })

  test('the "update rankings" button forces a real recompute even if nothing tracked changed', async ({
    client,
    assert,
  }) => {
    const { owner, league } = await makeLeagueWithOwner()
    const ranking = await makeRanking(league)

    const before = await new RankingRecomputerService().run(ranking.id)
    assert.isFalse(before.skipped)

    const response = await client
      .post(`/${league.slug}/rankings/${ranking.slug}/recompute`)
      .loginAs(owner)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)

    const reloaded = await Ranking.findOrFail(ranking.id)
    assert.notEqual(
      reloaded.latestRecomputeId,
      before.recompute.id,
      'a button called "update rankings" must not silently no-op via the fingerprint skip-check'
    )
  })

  test('leaving the date range blank and submitting no rows clears both', async ({
    client,
    assert,
  }) => {
    const { owner, league } = await makeLeagueWithOwner()
    const ranking = await makeRanking(league, {
      startsAt: DateTime.fromISO('2026-01-01'),
      endsAt: DateTime.fromISO('2026-06-30'),
      activityRequirements: [{ count: 3, minEntrants: null }],
    })

    const response = await client
      .patch(`/${league.slug}/rankings/${ranking.slug}`)
      .loginAs(owner)
      .withCsrfToken()
      .fields({ startsAt: '', endsAt: '' })
      .redirects(0)

    response.assertStatus(302)

    const reloaded = await Ranking.findOrFail(ranking.id)
    assert.isNull(reloaded.startsAt)
    assert.isNull(reloaded.endsAt)
    assert.deepEqual(reloaded.activityRequirements, [])
  })

  test('updating only the residency requirement does not request a recompute', async ({
    client,
    assert,
  }) => {
    const { owner, league } = await makeLeagueWithOwner()
    const ranking = await makeRanking(league)

    const response = await client
      .patch(`/${league.slug}/rankings/${ranking.slug}`)
      .loginAs(owner)
      .withCsrfToken()
      .fields({ 'residencyRequirements[0][state]': 'WA' })
      .redirects(0)

    response.assertStatus(302)

    const reloaded = await Ranking.findOrFail(ranking.id)
    assert.deepEqual(reloaded.residencyRequirements, [{ state: 'WA' }])
    assert.isNull(
      reloaded.latestRecomputeId,
      "a league player's own location is always current, so residency needs no replay"
    )
  })

  test('submitting an all-blank residency row drops it', async ({ client, assert }) => {
    const { owner, league } = await makeLeagueWithOwner()
    const ranking = await makeRanking(league, {
      residencyRequirements: [{ state: 'WA' }],
    })

    const response = await client
      .patch(`/${league.slug}/rankings/${ranking.slug}`)
      .loginAs(owner)
      .withCsrfToken()
      .fields({ 'residencyRequirements[0][city]': '' })
      .redirects(0)

    response.assertStatus(302)

    const reloaded = await Ranking.findOrFail(ranking.id)
    assert.deepEqual(reloaded.residencyRequirements, [])
  })

  test('the edit form is reachable by an admin', async ({ client }) => {
    const { owner, league } = await makeLeagueWithOwner()
    const ranking = await makeRanking(league)

    const response = await client
      .get(`/${league.slug}/rankings/${ranking.slug}/edit`)
      .loginAs(owner)

    response.assertStatus(200)
  })
})
