import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import Entrant from '#models/entrant'
import Event from '#models/event'
import EventImport from '#models/event_import'
import League from '#models/league'
import LeagueCredential from '#models/league_credential'
import LeagueEvent from '#models/league_event'
import TournamentSet from '#models/tournament_set'
import PlatformAccount from '#models/platform_account'
import Bracket from '#models/bracket'
import SetGame from '#models/set_game'
import SetGameSelection from '#models/set_game_selection'
import Tournament from '#models/tournament'
import Ranking from '#models/ranking'
import LeaguePlayer from '#models/league_player'
import { platforms } from '#lib/platforms/registry'
import { EventImporterService } from '#services/imports/event_importer_service'
import { IdentityResolverService } from '#services/identity/identity_resolver_service'
import { LeaguePlayerReconcilerService } from '#services/identity/league_player_reconciler_service'
import { SetSelectionService } from '#services/rankings/set_selection_service'
import ImportEventJob from '#jobs/import_event_job'
import { errors as queueErrors } from '@boringnode/queue'
import { FakePlatformAdapter } from '../unit/platforms/fake_adapter.js'
import type { EventRef } from '#lib/platforms/contracts'
import type { CanonicalBracket, CanonicalEntrant } from '#lib/platforms/canonical'
import type { LocationFilter } from '#lib/geo/region_filter'

/**
 * These tests truncate rather than wrapping each test in a transaction.
 *
 * The importer takes `pg_try_advisory_xact_lock`, which is released at the end
 * of the top-level transaction. Under a global test transaction the lock would
 * still be held on a second import within the same test, so re-import
 * behaviour could not be exercised at all.
 */
test.group('import pipeline', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  group.each.setup(() => {
    platforms.register(new FakePlatformAdapter())
    // Undo only our own registration; the real adapters are registered at boot.
    return () => platforms.unregister('fake')
  })

  async function seedLeague() {
    const league = await League.create({ slug: 'importers', name: 'Importers' })

    const credential = new LeagueCredential()
    credential.leagueId = league.id
    credential.platformKey = 'fake'
    credential.values = { apiKey: 'test-key' }
    await credential.save()

    return league
  }

  async function startImport(league: League, regionFilter: LocationFilter[] = []) {
    const eventImport = await EventImport.create({
      leagueId: league.id,
      platformKey: 'fake',
      targetUrl: 'https://fake.test/t/fake-major',
      status: 'queued',
      regionFilter,
    })

    return new EventImporterService().run({ eventImportId: eventImport.id })
  }

  test('imports an event end to end', async ({ assert }) => {
    const league = await seedLeague()
    const eventImport = await startImport(league)

    assert.equal(eventImport.status, 'ok')
    assert.isNotNull(eventImport.tournamentId)

    const tournament = await Tournament.findOrFail(eventImport.tournamentId!)
    assert.equal(tournament.platformKey, 'fake')
    assert.equal(tournament.name, 'Fake Major')

    assert.lengthOf(await Event.all(), 1)
    assert.lengthOf(await Bracket.all(), 1)
    assert.lengthOf(await Entrant.all(), 2)
    assert.lengthOf(await TournamentSet.all(), 1)
    assert.lengthOf(await SetGame.all(), 1)
    assert.lengthOf(await SetGameSelection.all(), 2)
  })

  test('links the event to the importing league, not its tournament', async ({ assert }) => {
    const league = await seedLeague()
    const eventImport = await startImport(league)

    const link = await LeagueEvent.query()
      .where('leagueId', league.id)
      .where('eventId', eventImport.eventId!)
      .first()

    assert.isNotNull(link)
  })

  test('records what the import actually contained', async ({ assert }) => {
    const league = await seedLeague()
    const eventImport = await startImport(league)
    const tournament = await Tournament.findOrFail(eventImport.tournamentId!)

    assert.deepEqual(tournament.capabilities, {
      participantIds: true,
      seeds: true,
      placements: true,
      games: true,
      characterSelections: true,
      stages: true,
    })
  })

  /**
   * `ManualAdapter` rejects a bad country itself, since there is a human on
   * the other end to hand the error back to — but `TournamentWriterService`
   * is what every adapter's output actually passes through, and a
   * non-manual platform has no such human. `tournaments.country` is
   * `varchar(2)`, so writing a value like this straight through would fail
   * the whole import with a raw database error instead of just dropping one
   * non-essential field.
   */
  test('a country the writer cannot resolve is dropped to null, not written raw', async ({
    assert,
  }) => {
    class BadCountry extends FakePlatformAdapter {
      protected override tournament(ref: EventRef) {
        return { ...super.tournament(ref), country: 'Not A Real Country' }
      }
    }

    platforms.unregister('fake')
    platforms.register(new BadCountry())

    const league = await seedLeague()
    const finished = await startImport(league)

    assert.equal(finished.status, 'ok')
    const tournament = await Tournament.findOrFail(finished.tournamentId!)
    assert.isNull(tournament.country)
  })

  async function rowCounts() {
    const models = {
      tournaments: Tournament,
      events: Event,
      entrants: Entrant,
      sets: TournamentSet,
      games: SetGame,
      selections: SetGameSelection,
      accounts: PlatformAccount,
      links: LeagueEvent,
    }

    const counts: Record<string, number> = {}
    for (const [name, model] of Object.entries(models)) {
      const rows = await model.all()
      counts[name] = rows.length
    }

    return counts
  }

  test('re-importing creates no duplicate rows', async ({ assert }) => {
    const league = await seedLeague()
    await startImport(league)
    const before = await rowCounts()

    await startImport(league)

    assert.deepEqual(await rowCounts(), before)
  })

  test('two leagues importing the same event share one copy', async ({ assert }) => {
    const first = await seedLeague()
    await startImport(first)

    const second = await League.create({ slug: 'other', name: 'Other' })
    const credential = new LeagueCredential()
    credential.leagueId = second.id
    credential.platformKey = 'fake'
    credential.values = { apiKey: 'test-key' }
    await credential.save()

    await startImport(second)

    assert.lengthOf(await Tournament.all(), 1)
    assert.lengthOf(await LeagueEvent.all(), 2)
  })

  test('platform accounts are deduplicated across tournaments', async ({ assert }) => {
    const league = await seedLeague()
    await startImport(league)
    await startImport(league)

    const accounts = await PlatformAccount.all()
    assert.lengthOf(accounts, 2)
    assert.deepEqual(accounts.map((account) => account.normalizedTag).sort(), ['alice', 'bob'])
  })

  test('fails with a readable message when credentials are missing', async ({ assert }) => {
    const league = await League.create({ slug: 'no-creds', name: 'No credentials' })

    const eventImport = await EventImport.create({
      leagueId: league.id,
      platformKey: 'fake',
      targetUrl: 'https://fake.test/t/fake-major',
      status: 'queued',
    })

    await assert.rejects(
      () => new EventImporterService().run({ eventImportId: eventImport.id }),
      /no Fake Platform credentials/
    )

    const reloaded = await EventImport.findOrFail(eventImport.id)
    assert.equal(reloaded.status, 'failed')
    assert.match(reloaded.error!, /credentials/)
  })

  test('fails when the URL belongs to another platform', async ({ assert }) => {
    const league = await seedLeague()

    const eventImport = await EventImport.create({
      leagueId: league.id,
      platformKey: 'fake',
      targetUrl: 'https://www.start.gg/tournament/genesis-9',
      status: 'queued',
    })

    await assert.rejects(
      () => new EventImporterService().run({ eventImportId: eventImport.id }),
      /did not recognise/
    )
  })

  test('records how much arrived, so an empty import is visible', async ({ assert }) => {
    const league = await seedLeague()
    const finished = await startImport(league)

    assert.deepInclude(finished.stats, { brackets: 1, entrants: 2, sets: 1, ratableSets: 1 })
    assert.isNull(finished.emptyWarning)
  })

  /**
   * A bracket that has not been played imports perfectly and changes no
   * standings. Without a warning that reads as a silent failure: the row says
   * "ok" and the ranking never moves.
   */
  test('warns when an import contains nothing to rank', async ({ assert }) => {
    class NotPlayedYet extends FakePlatformAdapter {
      protected override bracket() {
        return { ...super.bracket(), sets: [] }
      }
    }

    platforms.unregister('fake')
    platforms.register(new NotPlayedYet())

    const league = await seedLeague()
    const finished = await startImport(league)

    assert.equal(finished.status, 'ok')
    assert.deepInclude(finished.stats, { sets: 0, ratableSets: 0 })
    assert.match(finished.emptyWarning!, /no sets/)
  })

  test('warns when every set is unfinished', async ({ assert }) => {
    class InProgress extends FakePlatformAdapter {
      protected override bracket() {
        const bracket = super.bracket()
        bracket.sets[0].state = 'started'
        bracket.sets[0].winnerEntrantExternalId = null
        bracket.sets[0].games = []
        return bracket
      }
    }

    platforms.unregister('fake')
    platforms.register(new InProgress())

    const league = await seedLeague()
    const finished = await startImport(league)

    assert.deepInclude(finished.stats, { sets: 1, ratableSets: 0 })
    assert.match(finished.emptyWarning!, /none of this tournament's 1 sets are finished/i)
  })

  /**
   * The queue swaps the thrown error for `E_JOB_MAX_ATTEMPTS_REACHED` before
   * calling `failed()`, so the job hook must not treat it as the cause. Losing
   * the real message once cost a debugging session: every failed import read
   * "has reached the maximum number of retry attempts" and said nothing about
   * why.
   */
  test('keeps the real cause when the queue reports retries exhausted', async ({ assert }) => {
    const league = await League.create({ slug: 'no-creds-job', name: 'No credentials' })

    const eventImport = await EventImport.create({
      leagueId: league.id,
      platformKey: 'fake',
      targetUrl: 'https://fake.test/t/fake-major',
      status: 'queued',
    })

    // The importer records the cause and rethrows, as it does under a worker.
    await assert.rejects(() => new EventImporterService().run({ eventImportId: eventImport.id }))

    const job = hydrated(new ImportEventJob(), { eventImportId: eventImport.id })
    await job.failed(new queueErrors.E_JOB_MAX_ATTEMPTS_REACHED(['ImportEventJob']))

    const reloaded = await EventImport.findOrFail(eventImport.id)
    assert.equal(reloaded.status, 'failed')
    assert.match(reloaded.error!, /no Fake Platform credentials/)
    assert.notMatch(reloaded.error!, /maximum number of retry attempts/)
  })

  test('a successful import is not marked failed by a later job error', async ({ assert }) => {
    const league = await seedLeague()
    const finished = await startImport(league)
    assert.equal(finished.status, 'ok')

    const job = hydrated(new ImportEventJob(), { eventImportId: finished.id })
    await job.failed(new Error('dispatching identity mapping blew up'))

    const reloaded = await EventImport.findOrFail(finished.id)
    assert.equal(reloaded.status, 'ok', 'the import itself completed')
    assert.match(reloaded.error!, /identity mapping/)
  })

  /**
   * Alice (CA) beats Bob (no reported location) — the base fixture's only
   * set, carrying its character-selection data — and also beats a third
   * entrant, Carol (also CA), added here. A `state: 'CA'` filter admits only
   * Alice and Carol as this league's players; the event itself is always
   * written in full regardless of the filter.
   */
  class RegionalFixture extends FakePlatformAdapter {
    protected override entrants(): CanonicalEntrant[] {
      return [
        ...super.entrants(),
        {
          externalId: 'en3',
          name: 'Carol',
          seed: 3,
          placement: 3,
          isDisqualified: false,
          participants: [
            {
              externalUserId: 'u3',
              gamerTag: 'Carol',
              prefix: null,
              pronouns: null,
              profileSlug: null,
              country: 'US',
              state: 'CA',
              city: 'San Francisco',
            },
          ],
        },
      ]
    }

    protected override bracket(): CanonicalBracket {
      const base = super.bracket()

      return {
        ...base,
        sets: [
          ...base.sets,
          {
            externalId: 's2',
            state: 'completed',
            round: 1,
            identifier: 'B',
            fullRoundText: 'Winners Final',
            ordinal: 2,
            entrantAExternalId: 'en1',
            entrantBExternalId: 'en3',
            winnerEntrantExternalId: 'en3',
            scoreA: 1,
            scoreB: 3,
            entrantADisqualified: false,
            entrantBDisqualified: false,
            completedAt: new Date('2026-03-02T20:00:00Z'),
            games: [],
          },
        ],
      }
    }
  }

  test('a region filter admits only matching entrants as this league’s players; the event is still imported in full', async ({
    assert,
  }) => {
    platforms.unregister('fake')
    platforms.register(new RegionalFixture())

    const league = await seedLeague()
    const finished = await startImport(league, [{ state: 'CA' }])

    assert.equal(finished.status, 'ok')

    // Nothing about the event is dropped at import time any more — Bob (no
    // reported location) is written just like Alice and Carol.
    const entrants = await Entrant.all()
    assert.lengthOf(entrants, 3)
    assert.sameMembers(
      entrants.map((entrant) => entrant.name),
      ['Alice', 'Bob', 'Carol']
    )
    assert.lengthOf(await TournamentSet.all(), 2)
    assert.lengthOf(await PlatformAccount.all(), 3)

    // The filter instead gates identity resolution: only the CA entrants
    // become this league's players.
    await new IdentityResolverService().run({ leagueId: league.id, eventId: finished.eventId! })
    assert.sameMembers(await leaguePlayerTags(league), ['Alice', 'Carol'])
  })

  test('stats report how much of the event the filter admits, not the raw totals', async ({
    assert,
  }) => {
    platforms.unregister('fake')
    platforms.register(new RegionalFixture())

    const league = await seedLeague()
    const finished = await startImport(league, [{ state: 'CA' }])

    // Alice and Carol (both CA) are admitted; Bob (no reported location) is
    // not, and neither is Alice-vs-Bob, since Bob is one of its two sides.
    assert.deepInclude(finished.stats, {
      entrants: 3,
      sets: 2,
      entrantsImported: 2,
      setsImported: 1,
    })
  })

  test('stats report every entrant and set as imported when there is no filter', async ({
    assert,
  }) => {
    const league = await seedLeague()
    const finished = await startImport(league)

    assert.deepInclude(finished.stats, {
      entrants: 2,
      sets: 1,
      entrantsImported: 2,
      setsImported: 1,
    })
  })

  test('capabilities reflect the whole import, regardless of the league’s region filter', async ({
    assert,
  }) => {
    platforms.unregister('fake')
    platforms.register(new RegionalFixture())

    const league = await seedLeague()
    // Alice-vs-Bob carries the character-selection data; a region filter no
    // longer keeps it from being written.
    const finished = await startImport(league, [{ city: 'San Francisco' }])

    assert.lengthOf(await SetGame.all(), 1)
    assert.lengthOf(await SetGameSelection.all(), 2)

    const tournament = await Tournament.findOrFail(finished.tournamentId!)
    assert.isTrue(tournament.capabilities.characterSelections)
  })

  test('an event already counted under one filter can be re-imported under a different one', async ({
    assert,
  }) => {
    const league = await seedLeague()
    const first = await startImport(league)
    await new IdentityResolverService().run({ leagueId: league.id, eventId: first.eventId! })
    assert.sameMembers(await leaguePlayerTags(league), ['Alice', 'Bob'])

    const second = await startImport(league, [{ state: 'CA' }])
    assert.equal(second.status, 'ok')

    const link = await LeagueEvent.query().where('leagueId', league.id).firstOrFail()
    assert.deepEqual(link.regionFilter, [{ state: 'CA' }])

    // The event itself is untouched by the filter change — nothing about it
    // is ever deleted.
    assert.sameMembers(await entrantNames(), ['Alice', 'Bob'])

    // Resolving again under the new filter is what actually drops Bob (no
    // reported location) from this league's roster.
    await new IdentityResolverService().run({ leagueId: league.id, eventId: second.eventId! })
    assert.sameMembers(await leaguePlayerTags(league), ['Alice'])
  })

  test('re-importing under the exact same filter succeeds', async ({ assert }) => {
    const league = await seedLeague()
    await startImport(league, [{ state: 'CA' }])

    const second = await startImport(league, [{ state: 'CA' }])

    assert.equal(second.status, 'ok')
  })

  test('a normal unfiltered re-import of an already-filtered event is unaffected', async ({
    assert,
  }) => {
    const league = await seedLeague()
    await startImport(league, [{ state: 'CA' }])

    const second = await startImport(league)

    assert.equal(second.status, 'ok')
    const link = await LeagueEvent.query().where('leagueId', league.id).firstOrFail()
    assert.deepEqual(link.regionFilter, [])
  })

  test('the region filter is re-applied on read, so relocating a player drops their sets', async ({
    assert,
  }) => {
    platforms.unregister('fake')
    platforms.register(new RegionalFixture())

    const league = await seedLeague()
    const finished = await startImport(league, [{ state: 'CA' }])
    assert.equal(finished.status, 'ok')

    await new IdentityResolverService().run({ leagueId: league.id, eventId: finished.eventId! })

    const ranking = await Ranking.create({
      leagueId: league.id,
      slug: 'pr',
      name: 'PR',
      algorithm: 'elo',
      recomputeMode: 'manual',
      published: true,
    })
    const selection = new SetSelectionService()

    assert.lengthOf(await selection.forRanking(ranking), 1)

    const alice = await LeaguePlayer.query()
      .where('leagueId', league.id)
      .where('displayTag', 'Alice')
      .firstOrFail()
    alice.country = 'US'
    alice.state = 'NY'
    await alice.save()

    // Nothing is deleted by the relocation — it only changes what the next
    // read counts.
    assert.lengthOf(await selection.forRanking(ranking), 0)
    assert.lengthOf(await TournamentSet.all(), 2)
  })

  async function leaguePlayerTags(league: League) {
    const players = await LeaguePlayer.query().where('leagueId', league.id)
    return players.map((player) => player.displayTag)
  }

  async function entrantNames() {
    const entrants = await Entrant.all()
    return entrants.map((entrant) => entrant.name)
  }

  test('re-importing under a new filter updates which entrants are admitted, without touching the event itself', async ({
    assert,
  }) => {
    platforms.unregister('fake')
    platforms.register(new RegionalFixture())

    const league = await seedLeague()

    // No unlinking needed — a different filter on an already-counted event
    // just updates `league_events.region_filter` in place.
    const first = await startImport(league, [{ city: 'Los Angeles' }])
    await new IdentityResolverService().run({ leagueId: league.id, eventId: first.eventId! })
    assert.sameMembers(await leaguePlayerTags(league), ['Alice'])

    const second = await startImport(league, [{ city: 'San Francisco' }])
    await new IdentityResolverService().run({ leagueId: league.id, eventId: second.eventId! })

    // Carol is admitted under the new filter, and Alice — no longer backed
    // by any entrant it admits — is pruned from the roster...
    assert.sameMembers(await leaguePlayerTags(league), ['Carol'])
    // ...but the event itself never changed.
    assert.sameMembers(await entrantNames(), ['Alice', 'Bob', 'Carol'])
  })

  test("destroy tournament, import filtered, unlink, re-import filtered leaves only the new region's players", async ({
    assert,
  }) => {
    platforms.unregister('fake')
    platforms.register(new RegionalFixture())

    const league = await seedLeague()
    const prune = () =>
      new LeaguePlayerReconcilerService().pruneUnbackedPlayers({
        leagueId: league.id,
        actorUserId: null,
      })

    const seed = await startImport(league)
    await new IdentityResolverService().run({ leagueId: league.id, eventId: seed.eventId! })
    await Tournament.query().where('id', seed.tournamentId!).delete()
    await prune()
    assert.lengthOf(await leaguePlayerTags(league), 0)

    const la = await startImport(league, [{ city: 'Los Angeles' }])
    await new IdentityResolverService().run({ leagueId: league.id, eventId: la.eventId! })
    assert.sameMembers(await leaguePlayerTags(league), ['Alice'])

    await LeagueEvent.query().where('leagueId', league.id).where('eventId', la.eventId!).delete()
    await prune()
    assert.lengthOf(await leaguePlayerTags(league), 0)

    const sf = await startImport(league, [{ city: 'San Francisco' }])
    await new IdentityResolverService().run({ leagueId: league.id, eventId: sf.eventId! })

    assert.sameMembers(await leaguePlayerTags(league), ['Carol'])
    // The tournament delete in step one wiped the event along with it, but
    // re-importing it brought the whole thing back — not just Carol's slice.
    assert.sameMembers(await entrantNames(), ['Alice', 'Bob', 'Carol'])
  })
})

/**
 * The worker hydrates a job with its payload before running it. These tests call
 * `failed()` on its own, so they have to do the same.
 */
function hydrated<T extends ImportEventJob>(job: T, payload: { eventImportId: string }): T {
  job.$hydrate(payload, {
    jobId: 'test',
    name: 'ImportEventJob',
    attempt: 3,
    queue: 'default',
    priority: 0,
    acquiredAt: new Date(),
  } as never)

  return job
}
