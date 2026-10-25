import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import Entrant from '#models/entrant'
import EventImport from '#models/event_import'
import League from '#models/league'
import LeagueCredential from '#models/league_credential'
import LeaguePlayer from '#models/league_player'
import LeaguePlayerAccount from '#models/league_player_account'
import { IdentityResolverService } from '#services/identity/identity_resolver_service'
import { EventImporterService } from '#services/imports/event_importer_service'
import { fixtureHttp, hasFixtures } from '../unit/platforms/fixture_http.js'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { LocationFilter } from '#lib/geo/region_filter'

const FIXTURE_ROOT = fileURLToPath(new URL('../fixtures/platforms/', import.meta.url))
const recorded = await hasFixtures('startgg')
const manifest: { events: Array<{ url: string }> } = recorded
  ? JSON.parse(await readFile(join(FIXTURE_ROOT, 'startgg', 'manifest.json'), 'utf8'))
  : { events: [] }

const eventUrl = (kind: 'singles' | 'doubles') =>
  manifest.events.find((event) => event.url.endsWith(kind))!.url

const ENTRANTS = `name,placement
Alice,1
Bob,2
`

test.group('identity resolution', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  // The real adapters are registered at boot by start/platforms.ts.

  async function league(slug: string) {
    return League.create({ slug, name: slug })
  }

  async function importManual(target: League, payload: Record<string, unknown>) {
    const eventImport = await EventImport.create({
      leagueId: target.id,
      platformKey: 'manual',
      status: 'queued',
      payload,
    })

    const finished = await new EventImporterService().run({
      eventImportId: eventImport.id,
    })
    await new IdentityResolverService().run({
      leagueId: target.id,
      eventId: finished.eventId!,
    })

    return finished
  }

  test('creates one league player per competitor', async ({ assert }) => {
    const target = await league('identity')
    await importManual(target, { name: 'Weekly 1', slug: 'weekly-1', entrants: ENTRANTS })

    const players = await LeaguePlayer.query().where('leagueId', target.id)
    assert.lengthOf(players, 2)
    assert.deepEqual(players.map((player) => player.displayTag).sort(), ['Alice', 'Bob'])
  })

  test('gives each player a url-safe unique slug', async ({ assert }) => {
    const target = await league('slugs')
    await importManual(target, {
      name: 'Weekly',
      slug: 'weekly-slugs',
      entrants: 'name\n"Smith, John"\nBob\n',
    })

    const players = await LeaguePlayer.query().where('leagueId', target.id).orderBy('slug')
    assert.deepEqual(
      players.map((player) => player.slug),
      ['bob', 'smith-john']
    )
  })

  /**
   * The core of the tier: a CSV has no account concept, so the same person in
   * two weeklies must still be one competitor.
   */
  test('matches tag-only accounts across tournaments in a league', async ({ assert }) => {
    const target = await league('tags')

    await importManual(target, { name: 'Weekly 1', slug: 'tag-week-1', entrants: ENTRANTS })
    await importManual(target, {
      name: 'Weekly 2',
      slug: 'tag-week-2',
      entrants: 'name\nalice\nBOB\nCarol\n',
    })

    const players = await LeaguePlayer.query().where('leagueId', target.id)
    // Alice and Bob matched despite different casing; Carol is new.
    assert.lengthOf(players, 3)

    const mappings = await LeaguePlayerAccount.query().where('leagueId', target.id)
    assert.lengthOf(mappings, 5)
  })

  test('keeps leagues independent', async ({ assert }) => {
    const first = await league('league-a')
    const second = await league('league-b')

    await importManual(first, { name: 'W', slug: 'shared-week', entrants: ENTRANTS })
    await importManual(second, { name: 'W', slug: 'shared-week', entrants: ENTRANTS })

    // Same canonical tournament, but each league owns its own players.
    assert.lengthOf(await LeaguePlayer.query().where('leagueId', first.id), 2)
    assert.lengthOf(await LeaguePlayer.query().where('leagueId', second.id), 2)
  })

  test('bumps the league identity version when mappings change', async ({ assert }) => {
    const target = await league('versioned')
    // Database defaults are not hydrated onto a freshly created model.
    const initial = await League.findOrFail(target.id)
    const before = initial.identityVersion
    assert.equal(before, 0)

    await importManual(target, { name: 'W', slug: 'versioned-week', entrants: ENTRANTS })

    const reloaded = await League.findOrFail(target.id)
    assert.isAbove(reloaded.identityVersion, before)
  })

  test('is idempotent', async ({ assert }) => {
    const target = await league('idempotent')
    const eventImport = await importManual(target, {
      name: 'W',
      slug: 'idem-week',
      entrants: ENTRANTS,
    })

    const second = await new IdentityResolverService().run({
      leagueId: target.id,
      eventId: eventImport.eventId!,
    })

    assert.equal(second.created, 0)
    assert.equal(second.mapped, 0)
    assert.equal(second.reused, 2)
    assert.lengthOf(await LeaguePlayer.query().where('leagueId', target.id), 2)
  })

  /**
   * Real start.gg data: several people entered both singles and doubles. They
   * must resolve to one league player each on their platform account id alone,
   * with no tag matching involved.
   */
  test('resolves a person entering two events to one player', async ({ assert }) => {
    const target = await league('startgg-identity')

    const credential = new LeagueCredential()
    credential.leagueId = target.id
    credential.platformKey = 'startgg'
    credential.values = { token: 'recorded-fixture-token' }
    await credential.save()

    // Replay recorded responses through the same code path production uses.
    const replay = await fixtureHttp('startgg')
    const importer = new EventImporterService({ httpFactory: () => replay })

    async function importEvent(kind: 'singles' | 'doubles') {
      const eventImport = await EventImport.create({
        leagueId: target.id,
        platformKey: 'startgg',
        targetUrl: eventUrl(kind),
        status: 'queued',
      })

      const finished = await importer.run({ eventImportId: eventImport.id })
      await new IdentityResolverService().run({
        leagueId: target.id,
        eventId: finished.eventId!,
      })

      return finished
    }

    const singles = await importEvent('singles')
    const doubles = await importEvent('doubles')

    // Two events of one tournament, imported separately, share its row.
    assert.equal(singles.tournamentId, doubles.tournamentId)
    assert.notEqual(singles.eventId, doubles.eventId)

    const mappings = await LeaguePlayerAccount.query().where('leagueId', target.id)
    const players = await LeaguePlayer.query().where('leagueId', target.id)

    /**
     * Several people played both events. They are one player each because the
     * platform account id ties the two imports together — no tag matching.
     */
    assert.equal(players.length, mappings.length)
    assert.isAbove(players.length, 0)
  }).skip(!recorded, 'no start.gg fixtures recorded yet')
})

/**
 * A region-filtered import always writes the whole event now — the filter
 * instead gates which of its entrants this league resolves into players.
 * See `IdentityResolverService.accountsIn`.
 */
test.group('identity resolution with a region filter', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  async function league(slug: string) {
    return League.create({ slug, name: slug })
  }

  async function importManualFiltered(
    target: League,
    payload: Record<string, unknown>,
    regionFilter: LocationFilter[]
  ) {
    const eventImport = await EventImport.create({
      leagueId: target.id,
      platformKey: 'manual',
      status: 'queued',
      payload,
      regionFilter,
    })

    return new EventImporterService().run({ eventImportId: eventImport.id })
  }

  const REGIONAL_ENTRANTS = `name,state,country
Alice,CA,US
Bob,NY,US
`

  test('writes every entrant, but resolves only the ones the filter admits', async ({ assert }) => {
    const target = await league('identity-region')
    const finished = await importManualFiltered(
      target,
      { name: 'Weekly', slug: 'identity-region-week', entrants: REGIONAL_ENTRANTS },
      [{ state: 'CA' }]
    )

    assert.equal(finished.status, 'ok')
    const entrants = await Entrant.query().where('eventId', finished.eventId!)
    assert.sameMembers(
      entrants.map((entrant) => entrant.name),
      ['Alice', 'Bob']
    )

    await new IdentityResolverService().run({ leagueId: target.id, eventId: finished.eventId! })

    const players = await LeaguePlayer.query().where('leagueId', target.id)
    assert.deepEqual(
      players.map((player) => player.displayTag),
      ['Alice']
    )
  })

  test('re-resolving under a widened filter admits the previously-excluded entrant too', async ({
    assert,
  }) => {
    const target = await league('identity-region-widen')
    const first = await importManualFiltered(
      target,
      { name: 'Weekly', slug: 'identity-region-widen-week', entrants: REGIONAL_ENTRANTS },
      [{ state: 'CA' }]
    )
    await new IdentityResolverService().run({ leagueId: target.id, eventId: first.eventId! })
    const afterFirst = await LeaguePlayer.query().where('leagueId', target.id)
    assert.deepEqual(
      afterFirst.map((player) => player.displayTag),
      ['Alice']
    )

    const second = await importManualFiltered(
      target,
      { name: 'Weekly', slug: 'identity-region-widen-week', entrants: REGIONAL_ENTRANTS },
      []
    )
    await new IdentityResolverService().run({ leagueId: target.id, eventId: second.eventId! })

    const afterSecond = await LeaguePlayer.query().where('leagueId', target.id)
    assert.sameMembers(
      afterSecond.map((player) => player.displayTag),
      ['Alice', 'Bob']
    )
  })
})
