import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import Entrant from '#models/entrant'
import EventImport from '#models/event_import'
import League from '#models/league'
import LeaguePlayer from '#models/league_player'
import LeaguePlayerAccount from '#models/league_player_account'
import PlatformAccount from '#models/platform_account'
import { EventImporterService } from '#services/imports/event_importer_service'
import { IdentityResolverService } from '#services/identity/identity_resolver_service'
import { LeagueEventEligibilityService } from '#services/leagues/league_event_eligibility_service'
import type { LocationFilter } from '#lib/geo/region_filter'

/**
 * The entrant rows are the union of every league's import of one canonical
 * event, so these tests always have a second league importing it unfiltered —
 * that is what puts an out-of-region entrant in front of a league that would
 * never have imported them itself.
 */
test.group('LeagueEventEligibilityService', (group) => {
  /** The importer takes an advisory lock released only at top-level commit. */
  group.each.setup(() => testUtils.db().truncate())

  const ENTRANTS = `name,country,state
Alice,US,CA
Bob,US,NY
`

  const SETS = `entrant_a,entrant_b,winner
Alice,Bob,Alice
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

  async function entrantId(eventId: string, name: string): Promise<string> {
    const entrant = await Entrant.query()
      .where('eventId', eventId)
      .where('name', name)
      .firstOrFail()
    return entrant.id
  }

  test('counts every entrant behind a league player when nothing is filtered', async ({
    assert,
  }) => {
    const league = await League.create({ slug: 'open', name: 'Open' })
    const eventId = await importWeekly(league)

    const eligible = await new LeagueEventEligibilityService().eligibleEntrantIds(
      league.id,
      eventId
    )

    assert.isTrue(eligible.has(await entrantId(eventId, 'Alice')))
    assert.isTrue(eligible.has(await entrantId(eventId, 'Bob')))
  })

  test('drops an entrant no player of this league is behind', async ({ assert }) => {
    const open = await League.create({ slug: 'open', name: 'Open' })
    const eventId = await importWeekly(open)

    const cali = await League.create({ slug: 'cali', name: 'Cali' })
    await importWeekly(cali, [{ country: 'US', state: 'CA' }])

    const eligible = await new LeagueEventEligibilityService().eligibleEntrantIds(cali.id, eventId)

    assert.isTrue(eligible.has(await entrantId(eventId, 'Alice')))
    assert.isFalse(eligible.has(await entrantId(eventId, 'Bob')))
  })

  /**
   * An admin-assigned account survives the reconciler's prune, so the region
   * filter has to be re-applied here rather than inferred from a player
   * existing at all.
   */
  test('drops an out-of-region entrant that does have a league player', async ({ assert }) => {
    const open = await League.create({ slug: 'open', name: 'Open' })
    const eventId = await importWeekly(open)

    const cali = await League.create({ slug: 'cali', name: 'Cali' })
    await importWeekly(cali, [{ country: 'US', state: 'CA' }])

    const account = await PlatformAccount.query().where('gamerTag', 'Bob').firstOrFail()
    const player = await LeaguePlayer.create({
      leagueId: cali.id,
      slug: 'bob',
      displayTag: 'Bob',
      country: 'US',
      state: 'NY',
    })
    await LeaguePlayerAccount.create({
      leagueId: cali.id,
      leaguePlayerId: player.id,
      platformAccountId: account.id,
      source: 'manual',
    })

    const eligible = await new LeagueEventEligibilityService().eligibleEntrantIds(cali.id, eventId)

    assert.isFalse(eligible.has(await entrantId(eventId, 'Bob')))
  })

  test('counts nothing for a league that does not count the event', async ({ assert }) => {
    const open = await League.create({ slug: 'open', name: 'Open' })
    const eventId = await importWeekly(open)

    const other = await League.create({ slug: 'other', name: 'Other' })

    const eligible = await new LeagueEventEligibilityService().eligibleEntrantIds(other.id, eventId)

    assert.equal(eligible.size, 0)
  })
})
