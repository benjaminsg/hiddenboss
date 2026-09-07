import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import Bracket from '#models/bracket'
import Entrant from '#models/entrant'
import Event from '#models/event'
import EventImport from '#models/event_import'
import League from '#models/league'
import LeagueAdmin from '#models/league_admin'
import LeagueCredential from '#models/league_credential'
import LeagueEvent from '#models/league_event'
import Tournament from '#models/tournament'
import TournamentSet from '#models/tournament_set'
import User from '#models/user'
import { platforms } from '#lib/platforms/registry'
import { EventImporterService } from '#services/imports/event_importer_service'
import { FakePlatformAdapter } from '../unit/platforms/fake_adapter.js'
import type { EventRef, ImportSink, PlatformContext } from '#lib/platforms/contracts'

/**
 * Cancelling an import stops the fetch and rolls back whatever it had already
 * created — the fix for the same "additive writer leaves partial junk behind"
 * problem `events.tournament.destroy` addresses, but for a run that never
 * finished rather than one that did.
 *
 * Truncates rather than wrapping in a transaction, matching `import
 * pipeline.spec.ts`: the importer takes a real advisory lock that a global
 * test transaction would hold across imports within the same test.
 */
test.group('import cancellation', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  group.each.setup(() => {
    platforms.register(new FakePlatformAdapter())
    return () => platforms.unregister('fake')
  })

  async function seedLeague(slug = 'importers') {
    const league = await League.create({ slug, name: 'Importers' })

    const credential = new LeagueCredential()
    credential.leagueId = league.id
    credential.platformKey = 'fake'
    credential.values = { apiKey: 'test-key' }
    await credential.save()

    return league
  }

  async function seedLeagueWithOwner(slug = 'importers') {
    const league = await seedLeague(slug)

    const owner = await User.create({
      email: `owner-${Math.random()}@example.com`,
      password: 'secret123',
      fullName: 'Owner',
    })
    await LeagueAdmin.create({ leagueId: league.id, userId: owner.id, role: 'owner' })

    return { league, owner }
  }

  /**
   * Runs the fake adapter's normal sequence, but sets the import to
   * `cancelling` right before a chosen sink call — standing in for a cancel
   * request arriving from a web request while this run is mid-fetch.
   */
  class CancellingAdapter extends FakePlatformAdapter {
    constructor(
      private eventImportId: string,
      private cancelBefore: 'event' | 'entrants' | 'progress'
    ) {
      super()
    }

    async fetchEvent(ref: EventRef, _context: PlatformContext, sink: ImportSink): Promise<void> {
      await sink.tournament(this.tournament(ref))

      if (this.cancelBefore === 'event') await this.requestCancel()

      await sink.event({
        externalId: 'e1',
        name: 'Singles',
        game: 'rivals-2',
        entryKind: 'singles',
        teamSize: 1,
        entrantCount: 2,
      })

      if (this.cancelBefore === 'entrants') await this.requestCancel()

      await sink.entrants('e1', this.entrants())
      await sink.phase('e1', { externalId: 'p1', name: 'Bracket', order: 1 })
      await sink.bracket('e1', 'p1', this.bracket())

      if (this.cancelBefore === 'progress') await this.requestCancel()

      await sink.progress(1, 1)
    }

    private async requestCancel(): Promise<void> {
      await EventImport.query().where('id', this.eventImportId).update({ status: 'cancelling' })
    }
  }

  test('cancelling a fresh import rolls back the event it created', async ({ assert }) => {
    const league = await seedLeague()
    const eventImport = await EventImport.create({
      leagueId: league.id,
      platformKey: 'fake',
      targetUrl: 'https://fake.test/t/fake-major',
      status: 'queued',
    })

    platforms.unregister('fake')
    platforms.register(new CancellingAdapter(eventImport.id, 'progress'))

    const finished = await new EventImporterService().run({ eventImportId: eventImport.id })

    assert.equal(finished.status, 'cancelled')
    assert.isNull(finished.eventId)

    assert.lengthOf(await Event.all(), 0)
    assert.lengthOf(await Entrant.all(), 0)
    assert.lengthOf(await Bracket.all(), 0)
    assert.lengthOf(await TournamentSet.all(), 0)
    assert.isNull(await LeagueEvent.query().where('leagueId', league.id).first())

    // The tournament itself is an accepted, harmless orphan — the same gap
    // an ordinary failure between writing the tournament and the event
    // already leaves today.
    assert.lengthOf(await Tournament.all(), 1)
  })

  test('cancelling before the event is even written leaves nothing to roll back', async ({
    assert,
  }) => {
    const league = await seedLeague()
    const eventImport = await EventImport.create({
      leagueId: league.id,
      platformKey: 'fake',
      targetUrl: 'https://fake.test/t/fake-major',
      status: 'queued',
    })

    platforms.unregister('fake')
    platforms.register(new CancellingAdapter(eventImport.id, 'event'))

    const finished = await new EventImporterService().run({ eventImportId: eventImport.id })

    assert.equal(finished.status, 'cancelled')
    assert.lengthOf(await Event.all(), 0)
  })

  test('cancelling a re-import leaves the event another run already created intact', async ({
    assert,
  }) => {
    const league = await seedLeague()

    const first = await EventImport.create({
      leagueId: league.id,
      platformKey: 'fake',
      targetUrl: 'https://fake.test/t/fake-major',
      status: 'queued',
    })
    const finishedFirst = await new EventImporterService().run({ eventImportId: first.id })
    assert.equal(finishedFirst.status, 'ok')

    const second = await EventImport.create({
      leagueId: league.id,
      platformKey: 'fake',
      targetUrl: 'https://fake.test/t/fake-major',
      status: 'queued',
    })

    platforms.unregister('fake')
    platforms.register(new CancellingAdapter(second.id, 'entrants'))

    const finishedSecond = await new EventImporterService().run({ eventImportId: second.id })

    assert.equal(finishedSecond.status, 'cancelled')

    // The event, its entrants and its set all survive from the first import.
    assert.lengthOf(await Event.all(), 1)
    assert.lengthOf(await Entrant.all(), 2)
    assert.lengthOf(await TournamentSet.all(), 1)
    assert.isNotNull(await LeagueEvent.query().where('leagueId', league.id).first())
  })

  test('cancelling a queued import that a worker never picked up needs no rollback', async ({
    assert,
  }) => {
    const league = await seedLeague()
    const eventImport = await EventImport.create({
      leagueId: league.id,
      platformKey: 'fake',
      targetUrl: 'https://fake.test/t/fake-major',
      status: 'cancelling',
    })

    const finished = await new EventImporterService().run({ eventImportId: eventImport.id })

    assert.equal(finished.status, 'cancelled')
    assert.lengthOf(await Tournament.all(), 0)
  })

  test('a retried execution of an already-cancelled import is a no-op', async ({ assert }) => {
    const league = await seedLeague()
    const eventImport = await EventImport.create({
      leagueId: league.id,
      platformKey: 'fake',
      targetUrl: 'https://fake.test/t/fake-major',
      status: 'cancelled',
    })

    const result = await new EventImporterService().run({ eventImportId: eventImport.id })

    assert.equal(result.status, 'cancelled')
    assert.lengthOf(await Tournament.all(), 0)
  })

  test('a completed import cannot be cancelled after the fact', async ({ client, assert }) => {
    const { league, owner } = await seedLeagueWithOwner()
    const queued = await EventImport.create({
      leagueId: league.id,
      platformKey: 'fake',
      targetUrl: 'https://fake.test/t/fake-major',
      status: 'queued',
    })
    const eventImport = await new EventImporterService().run({ eventImportId: queued.id })
    assert.equal(eventImport.status, 'ok')

    const response = await client
      .post(`/${league.slug}/imports/${eventImport.id}/cancel`)
      .loginAs(owner)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)

    const reloaded = await EventImport.findOrFail(eventImport.id)
    assert.equal(reloaded.status, 'ok')
  })

  test('an admin can request cancellation of a running import', async ({ client, assert }) => {
    const { league, owner } = await seedLeagueWithOwner()
    const eventImport = await EventImport.create({
      leagueId: league.id,
      platformKey: 'fake',
      targetUrl: 'https://fake.test/t/fake-major',
      status: 'running',
    })

    const response = await client
      .post(`/${league.slug}/imports/${eventImport.id}/cancel`)
      .loginAs(owner)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)

    const reloaded = await EventImport.findOrFail(eventImport.id)
    assert.equal(reloaded.status, 'cancelling')
  })

  test('cancelling an import belonging to another league 404s', async ({ client, assert }) => {
    const { league: otherLeague } = await seedLeagueWithOwner('other-importers')
    const { league, owner } = await seedLeagueWithOwner()

    const eventImport = await EventImport.create({
      leagueId: otherLeague.id,
      platformKey: 'fake',
      targetUrl: 'https://fake.test/t/fake-major',
      status: 'running',
    })

    const response = await client
      .post(`/${league.slug}/imports/${eventImport.id}/cancel`)
      .loginAs(owner)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(404)
    const reloaded = await EventImport.findOrFail(eventImport.id)
    assert.equal(reloaded.status, 'running')
  })
})
