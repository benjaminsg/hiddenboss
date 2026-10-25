import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import EventImport from '#models/event_import'
import League from '#models/league'
import Ranking from '#models/ranking'
import { EventImporterService } from '#services/imports/event_importer_service'
import { IdentityResolverService } from '#services/identity/identity_resolver_service'
import { RankingRecomputerService } from '#services/rankings/ranking_recomputer_service'
import type { LocationFilter } from '#lib/geo/region_filter'

/**
 * The event page marks who the league counts; the page itself decides what to
 * do with that. Filtering happens there, so what matters here is that the
 * flags reach it.
 */
test.group('event league view', (group) => {
  /** The importer takes an advisory lock released only at top-level commit. */
  group.each.setup(() => testUtils.db().truncate())

  const ENTRANTS = `name,country,state
Alice,US,CA
Carol,US,CA
Bob,US,NY
Dave,US,NY
`

  const SETS = `entrant_a,entrant_b,winner
Alice,Carol,Alice
Alice,Bob,Alice
Bob,Dave,Bob
`

  async function importWeekly(league: League, regionFilter: LocationFilter[] = []) {
    const eventImport = await EventImport.create({
      leagueId: league.id,
      platformKey: 'manual',
      status: 'queued',
      regionFilter,
      payload: { name: 'Weekly', slug: 'weekly', entrants: ENTRANTS, sets: SETS },
    })

    const finished = await new EventImporterService().run({ eventImportId: eventImport.id })
    await new IdentityResolverService().run({ leagueId: league.id, eventId: finished.eventId! })

    return finished.eventId!
  }

  test('flags which entrants and sets the league counts', async ({ client, assert }) => {
    const open = await League.create({ slug: 'open', name: 'Open', visibility: 'public' })
    const eventId = await importWeekly(open)

    const cali = await League.create({ slug: 'cali', name: 'Cali', visibility: 'public' })
    await importWeekly(cali, [{ country: 'US', state: 'CA' }])

    const response = await client
      .get(`/${cali.slug}/events/${eventId}`)
      .header('X-Inertia', 'true')
      .header('X-Inertia-Version', '1')

    response.assertStatus(200)

    const props = response.body().props as {
      entrants: Array<{ name: string; eligible: boolean }>
      sets: Array<{ entrantA: string; entrantB: string; eligibleA: boolean; eligibleB: boolean }>
    }

    const eligibility = Object.fromEntries(
      props.entrants.map((entrant) => [entrant.name, entrant.eligible])
    )
    assert.deepEqual(eligibility, { Alice: true, Carol: true, Bob: false, Dave: false })

    const sets = props.sets.map((set) => [
      `${set.entrantA}-${set.entrantB}`,
      set.eligibleA,
      set.eligibleB,
    ])
    assert.deepEqual(sets, [
      ['Alice-Carol', true, true],
      ['Alice-Bob', true, false],
      ['Bob-Dave', false, false],
    ])
  })

  /**
   * Ranking eligibility is read-time, against whichever players already
   * belong to the league — unlike region/league admission, which it doesn't
   * replace, so a player can be a league member and still read as not
   * currently eligible under "only eligible players."
   */
  test('flags which league members the default ranking currently counts as eligible', async ({
    client,
    assert,
  }) => {
    const league = await League.create({ slug: 'wa', name: 'WA', visibility: 'public' })

    async function importManual(slug: string, entrants: string, sets: string) {
      const eventImport = await EventImport.create({
        leagueId: league.id,
        platformKey: 'manual',
        status: 'queued',
        payload: { name: slug, slug, entrants, sets },
      })

      const finished = await new EventImporterService().run({ eventImportId: eventImport.id })
      await new IdentityResolverService().run({ leagueId: league.id, eventId: finished.eventId! })

      return finished.eventId!
    }

    // Alice and Bob play both weeklies; Carol only shows up once.
    await importManual(
      'wa-week-1',
      'name\nAlice\nBob\nCarol\n',
      'entrant_a,entrant_b,winner\nAlice,Bob,Alice\nBob,Carol,Bob\n'
    )
    const eventId = await importManual(
      'wa-week-2',
      'name\nAlice\nBob\n',
      'entrant_a,entrant_b,winner\nAlice,Bob,Alice\n'
    )

    const ranking = await Ranking.create({
      leagueId: league.id,
      slug: 'ranking',
      name: 'Ranking',
      algorithm: 'elo',
      recomputeMode: 'manual',
      activityRequirements: [{ count: 2, minEntrants: null }],
      published: true,
    })
    await new RankingRecomputerService().run(ranking.id)

    const response = await client
      .get(`/${league.slug}/events/${eventId}`)
      .header('X-Inertia', 'true')
      .header('X-Inertia-Version', '1')

    const props = response.body().props as {
      rankingName: string | null
      entrants: Array<{ name: string; eligible: boolean; rankingEligible: boolean }>
    }

    assert.equal(props.rankingName, 'Ranking')

    const eligibility = Object.fromEntries(
      props.entrants.map((entrant) => [entrant.name, entrant.rankingEligible])
    )
    // All three are league members (eligible), but Carol hasn't played the
    // two tournaments the ranking requires.
    assert.deepEqual(eligibility, { Alice: true, Bob: true })
    assert.isTrue(props.entrants.every((entrant) => entrant.eligible))
  })

  test('rankingName is null when the league has no ranking yet', async ({ client, assert }) => {
    const league = await League.create({ slug: 'no-ranking', name: 'No Ranking' })

    const eventImport = await EventImport.create({
      leagueId: league.id,
      platformKey: 'manual',
      status: 'queued',
      payload: { name: 'Weekly', slug: 'weekly', entrants: 'name\nAlice\n' },
    })
    const finished = await new EventImporterService().run({ eventImportId: eventImport.id })

    const response = await client
      .get(`/${league.slug}/events/${finished.eventId}`)
      .header('X-Inertia', 'true')
      .header('X-Inertia-Version', '1')

    const props = response.body().props as { rankingName: string | null }
    assert.isNull(props.rankingName)
  })
})
