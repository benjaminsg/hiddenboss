import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import EventImport from '#models/event_import'
import League from '#models/league'
import LeagueAdmin from '#models/league_admin'
import LeagueCredential from '#models/league_credential'
import LeagueEvent from '#models/league_event'
import LeaguePlayer from '#models/league_player'
import LeaguePlayerAccount from '#models/league_player_account'
import IdentityEvent from '#models/identity_event'
import Ranking from '#models/ranking'
import User from '#models/user'
import { platforms } from '#lib/platforms/registry'
import { EventImporterService } from '#services/imports/event_importer_service'
import { IdentityResolverService } from '#services/identity/identity_resolver_service'
import { RankingRecomputerService } from '#services/rankings/ranking_recomputer_service'
import { FakePlatformAdapter } from '../unit/platforms/fake_adapter.js'

/**
 * Truncates rather than wrapping in a transaction: the importer takes a
 * Postgres advisory lock released only at top-level commit, so importing
 * twice inside one test (removed, then re-imported) would block on its own
 * lock under a transaction.
 */
test.group('event destroy', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  group.each.setup(() => {
    platforms.register(new FakePlatformAdapter())
    return () => platforms.unregister('fake')
  })

  async function seedLeagueWithOwner() {
    const owner = await User.create({
      email: `owner-${Math.random()}@example.com`,
      password: 'secret123',
      fullName: 'Owner',
    })

    const league = await League.create({
      slug: `destroy-${Math.random().toString(36).slice(2, 10)}`,
      name: 'Destroy League',
      visibility: 'public',
    })

    await LeagueAdmin.create({ leagueId: league.id, userId: owner.id, role: 'owner' })

    const credential = new LeagueCredential()
    credential.leagueId = league.id
    credential.platformKey = 'fake'
    credential.values = { apiKey: 'test-key' }
    await credential.save()

    return { owner, league }
  }

  async function importEvent(league: League) {
    const eventImport = await EventImport.create({
      leagueId: league.id,
      platformKey: 'fake',
      targetUrl: 'https://fake.test/t/fake-major',
      status: 'queued',
    })

    const finished = await new EventImporterService().run({ eventImportId: eventImport.id })
    await new IdentityResolverService().run({
      leagueId: league.id,
      eventId: finished.eventId!,
    })

    return finished
  }

  test('an admin can remove an event from the league', async ({ client, assert }) => {
    const { owner, league } = await seedLeagueWithOwner()
    const eventImport = await importEvent(league)

    const response = await client
      .delete(`/${league.slug}/events/${eventImport.eventId}`)
      .loginAs(owner)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)

    const link = await LeagueEvent.query()
      .where('leagueId', league.id)
      .where('eventId', eventImport.eventId!)
      .first()
    assert.isNull(link, 'the league_events row should be gone')
  })

  test('nothing canonical is deleted, so the same link re-imports it', async ({
    client,
    assert,
  }) => {
    const { owner, league } = await seedLeagueWithOwner()
    const eventImport = await importEvent(league)

    await client
      .delete(`/${league.slug}/events/${eventImport.eventId}`)
      .loginAs(owner)
      .withCsrfToken()

    await importEvent(league)

    const link = await LeagueEvent.query()
      .where('leagueId', league.id)
      .where('eventId', eventImport.eventId!)
      .first()
    assert.isNotNull(link, 're-importing should recreate the link')
  })

  test('unlinking an event prunes the league players its import built', async ({
    client,
    assert,
  }) => {
    const { owner, league } = await seedLeagueWithOwner()
    const eventImport = await importEvent(league)

    assert.isNotEmpty(await LeaguePlayer.query().where('leagueId', league.id))

    await client
      .delete(`/${league.slug}/events/${eventImport.eventId}`)
      .loginAs(owner)
      .withCsrfToken()

    const remaining = await LeaguePlayer.query().where('leagueId', league.id)
    assert.lengthOf(remaining, 0)

    const events = await IdentityEvent.query().where('leagueId', league.id).where('kind', 'unlink')
    assert.isAbove(events.length, 0, 'each pruned player leaves an audit row')
  })

  test('re-importing after an unlink does not leave the old league players behind', async ({
    client,
    assert,
  }) => {
    const { owner, league } = await seedLeagueWithOwner()
    const eventImport = await importEvent(league)
    const initial = await LeaguePlayer.query().where('leagueId', league.id)

    await client
      .delete(`/${league.slug}/events/${eventImport.eventId}`)
      .loginAs(owner)
      .withCsrfToken()

    await importEvent(league)

    const rebuilt = await LeaguePlayer.query().where('leagueId', league.id)
    assert.lengthOf(rebuilt, initial.length)
  })

  test('a manually held player survives an unlink', async ({ client, assert }) => {
    const { owner, league } = await seedLeagueWithOwner()
    const eventImport = await importEvent(league)

    const [held, ...rest] = await LeaguePlayer.query()
      .where('leagueId', league.id)
      .orderBy('displayTag')
    assert.isNotEmpty(rest)
    await LeaguePlayerAccount.query().where('leaguePlayerId', held.id).update({ source: 'manual' })

    await client
      .delete(`/${league.slug}/events/${eventImport.eventId}`)
      .loginAs(owner)
      .withCsrfToken()

    const survivors = await LeaguePlayer.query().where('leagueId', league.id)
    assert.deepEqual(
      survivors.map((player) => player.id),
      [held.id]
    )
  })

  test('marks manual rankings stale without recomputing them', async ({ client, assert }) => {
    const { owner, league } = await seedLeagueWithOwner()
    const eventImport = await importEvent(league)

    const ranking = await Ranking.create({
      leagueId: league.id,
      slug: 'ranking',
      name: 'Ranking',
      algorithm: 'elo',
      recomputeMode: 'manual',
      published: true,
    })
    await new RankingRecomputerService().run(ranking.id)

    await client
      .delete(`/${league.slug}/events/${eventImport.eventId}`)
      .loginAs(owner)
      .withCsrfToken()

    const reloaded = await Ranking.findOrFail(ranking.id)
    assert.isNotNull(reloaded.recomputeRequestedAt)
  })

  test('a removed event drops out of the next recompute', async ({ client, assert }) => {
    const { owner, league } = await seedLeagueWithOwner()
    const eventImport = await importEvent(league)

    const ranking = await Ranking.create({
      leagueId: league.id,
      slug: 'ranking',
      name: 'Ranking',
      algorithm: 'elo',
      recomputeMode: 'manual',
      published: true,
    })
    const before = await new RankingRecomputerService().run(ranking.id)
    assert.isAbove(before.recompute.playerCount, 0)

    await client
      .delete(`/${league.slug}/events/${eventImport.eventId}`)
      .loginAs(owner)
      .withCsrfToken()

    const after = await new RankingRecomputerService().run(ranking.id)
    assert.isFalse(after.skipped, 'removing the only event should change what the ranking counts')
    assert.equal(after.recompute.playerCount, 0)
  })
})
