import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import Entrant from '#models/entrant'
import Event from '#models/event'
import EventImport from '#models/event_import'
import League from '#models/league'
import LeagueCredential from '#models/league_credential'
import { platforms } from '#lib/platforms/registry'
import { EventImporterService } from '#services/imports/event_importer_service'
import { FakePlatformAdapter } from '../unit/platforms/fake_adapter.js'
import type { ImportSink, PlatformContext, EventRef } from '#lib/platforms/contracts'

/**
 * The limits are enforced through `SizeLimitingSink`
 * (`tests/unit/platforms/size_limiting_sink.spec.ts` covers the sink itself in
 * isolation); these exercise the same rejection through the real pipeline, so a
 * rejected import lands in `event_imports` the way any other failure does, and
 * nothing it would have written survives.
 */
test.group('import size limits', (group) => {
  /**
   * Truncates rather than wrapping in a transaction: the importer takes
   * `pg_try_advisory_xact_lock`, released only at top-level commit.
   */
  group.each.setup(() => testUtils.db().truncate())

  group.each.setup(() => {
    return () => platforms.unregister('fake')
  })

  async function seedLeague() {
    const league = await League.create({ slug: 'size-limits', name: 'Size Limits' })

    const credential = new LeagueCredential()
    credential.leagueId = league.id
    credential.platformKey = 'fake'
    credential.values = { apiKey: 'test-key' }
    await credential.save()

    return league
  }

  async function startImport(league: League) {
    return EventImport.create({
      leagueId: league.id,
      platformKey: 'fake',
      targetUrl: 'https://fake.test/t/fake-major',
      status: 'queued',
    })
  }

  test('rejects an event whose declared entrant count is over the limit', async ({ assert }) => {
    class TooManyEntrants extends FakePlatformAdapter {
      override async fetchEvent(
        ref: EventRef,
        _context: PlatformContext,
        sink: ImportSink
      ): Promise<void> {
        await sink.tournament(this.tournament(ref))
        await sink.event({
          externalId: 'e1',
          name: 'Singles',
          game: null,
          entryKind: 'singles',
          teamSize: 1,
          entrantCount: 8001,
        })
      }
    }

    platforms.register(new TooManyEntrants())

    const league = await seedLeague()
    const eventImport = await startImport(league)

    await assert.rejects(
      () => new EventImporterService().run({ eventImportId: eventImport.id }),
      /8001 entrants, over the 8000/
    )

    const reloaded = await EventImport.findOrFail(eventImport.id)
    assert.equal(reloaded.status, 'failed')
    assert.match(reloaded.error!, /8001 entrants, over the 8000/)
    assert.lengthOf(await Event.all(), 0)
    assert.lengthOf(await Entrant.all(), 0)
  })

  test('rejects an event whose declared bracket total is over the limit', async ({ assert }) => {
    class TooManyBrackets extends FakePlatformAdapter {
      override async fetchEvent(
        ref: EventRef,
        _context: PlatformContext,
        sink: ImportSink
      ): Promise<void> {
        await sink.tournament(this.tournament(ref))
        await sink.progress(0, 801)
      }
    }

    platforms.register(new TooManyBrackets())

    const league = await seedLeague()
    const eventImport = await startImport(league)

    await assert.rejects(
      () => new EventImporterService().run({ eventImportId: eventImport.id }),
      /801 brackets, over the 800/
    )

    const reloaded = await EventImport.findOrFail(eventImport.id)
    assert.equal(reloaded.status, 'failed')
    assert.match(reloaded.error!, /801 brackets, over the 800/)
    assert.lengthOf(await Event.all(), 0)
  })

  /**
   * A count known only once records stream in (no upfront total) is still
   * caught, just after some of those records have already been fetched and
   * written — unlike the upfront case, this is discovered mid-import.
   */
  test('rejects a bracket count that only exceeds the limit once brackets stream in', async ({
    assert,
  }) => {
    class ManyUnannouncedBrackets extends FakePlatformAdapter {
      override async fetchEvent(
        ref: EventRef,
        _context: PlatformContext,
        sink: ImportSink
      ): Promise<void> {
        await sink.tournament(this.tournament(ref))
        await sink.event({
          externalId: 'e1',
          name: 'Singles',
          game: null,
          entryKind: 'singles',
          teamSize: 1,
          entrantCount: null,
        })
        await sink.entrants('e1', this.entrants())
        await sink.phase('e1', { externalId: 'p1', name: 'Bracket', order: 1 })

        for (let i = 0; i < 801; i += 1) {
          await sink.bracket('e1', 'p1', {
            externalId: `b${i}`,
            name: null,
            bracketType: 'double_elimination',
            sets: [],
          })
        }
      }
    }

    platforms.register(new ManyUnannouncedBrackets())

    const league = await seedLeague()
    const eventImport = await startImport(league)

    await assert.rejects(
      () => new EventImporterService().run({ eventImportId: eventImport.id }),
      /801 brackets, over the 800/
    )

    const reloaded = await EventImport.findOrFail(eventImport.id)
    assert.equal(reloaded.status, 'failed')
    assert.match(reloaded.error!, /801 brackets, over the 800/)
  })
})
