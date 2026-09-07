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
import { platforms } from '#lib/platforms/registry'
import { EventImporterService } from '#services/imports/event_importer_service'
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
   * entrant, Carol (also CA), added here. A `state: 'CA'` filter should keep
   * only Alice-vs-Carol.
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

  test('a region filter keeps only entrants from those regions, and the sets between them', async ({
    assert,
  }) => {
    platforms.unregister('fake')
    platforms.register(new RegionalFixture())

    const league = await seedLeague()
    const finished = await startImport(league, [{ state: 'CA' }])

    assert.equal(finished.status, 'ok')

    const sets = await TournamentSet.all()
    assert.lengthOf(sets, 1)
    assert.equal(sets[0].externalId, 's2')

    // Bob (no reported location) is never written at all, not merely
    // excluded from sets — only Alice and Carol, both CA, qualify.
    const entrants = await Entrant.all()
    assert.lengthOf(entrants, 2)
    assert.sameMembers(
      entrants.map((entrant) => entrant.name),
      ['Alice', 'Carol']
    )
    assert.lengthOf(await PlatformAccount.all(), 2)
  })

  test('capabilities reflect the raw import, even when the set carrying them was filtered out', async ({
    assert,
  }) => {
    platforms.unregister('fake')
    platforms.register(new RegionalFixture())

    const league = await seedLeague()
    // Alice-vs-Bob — the set with character selections — is excluded (Bob
    // has no reported location), leaving zero written sets with games.
    const finished = await startImport(league, [{ city: 'San Francisco' }])

    assert.lengthOf(await SetGame.all(), 0)
    assert.lengthOf(await SetGameSelection.all(), 0)

    const tournament = await Tournament.findOrFail(finished.tournamentId!)
    assert.isTrue(tournament.capabilities.characterSelections)
  })

  test('a filtered import of an event already counted unfiltered is rejected', async ({
    assert,
  }) => {
    const league = await seedLeague()
    await startImport(league)

    await assert.rejects(
      () => startImport(league, [{ state: 'CA' }]),
      /already counted by this league under a different/
    )

    // Nothing about the existing unfiltered link changed.
    const link = await LeagueEvent.query().where('leagueId', league.id).firstOrFail()
    assert.deepEqual(link.regionFilter, [])
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
