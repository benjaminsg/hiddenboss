import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { DateTime } from 'luxon'
import Bracket from '#models/bracket'
import Entrant from '#models/entrant'
import Event from '#models/event'
import League from '#models/league'
import LeagueAdmin from '#models/league_admin'
import LeagueEvent from '#models/league_event'
import Phase from '#models/phase'
import Ranking from '#models/ranking'
import Tournament from '#models/tournament'
import TournamentSet from '#models/tournament_set'
import User from '#models/user'

/**
 * `events.tournament.destroy` deletes the whole tournament, not just this
 * league's link to it — the actual fix for a bad import, since `destroy()`
 * only ever uncounts and can never clean up canonical rows a since-fixed bug
 * already wrote.
 */
test.group('tournament destroy', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  async function makeLeagueWithOwner(slugPrefix = 'destroy') {
    const owner = await User.create({
      email: `owner-${Math.random()}@example.com`,
      password: 'secret123',
      fullName: 'Owner',
    })

    const league = await League.create({
      slug: `${slugPrefix}-${Math.random().toString(36).slice(2, 10)}`,
      name: 'Tournament Destroy League',
      visibility: 'public',
    })

    await LeagueAdmin.create({ leagueId: league.id, userId: owner.id, role: 'owner' })

    return { owner, league }
  }

  /** A tournament with a full hierarchy under it, counted by the given league. */
  async function makeCountedTournament(league: League) {
    const tournament = await Tournament.create({
      externalId: `t-${Math.random().toString(36).slice(2, 10)}`,
      platformKey: 'fake',
      slug: `tournament-${Math.random().toString(36).slice(2, 10)}`,
      name: 'Fake Major',
      startAt: DateTime.fromISO('2026-01-05'),
    })

    const event = await Event.create({
      tournamentId: tournament.id,
      externalId: `e-${Math.random().toString(36).slice(2, 10)}`,
      name: 'Singles',
      entryKind: 'singles',
    })

    const phase = await Phase.create({
      eventId: event.id,
      externalId: `p-${Math.random().toString(36).slice(2, 10)}`,
      name: 'Bracket',
    })

    const bracket = await Bracket.create({
      phaseId: phase.id,
      externalId: `b-${Math.random().toString(36).slice(2, 10)}`,
      bracketType: 'double_elimination',
    })

    const entrantA = await Entrant.create({
      eventId: event.id,
      externalId: 'en1',
      name: 'Alice',
      isDisqualified: false,
    })
    const entrantB = await Entrant.create({
      eventId: event.id,
      externalId: 'en2',
      name: 'Bob',
      isDisqualified: false,
    })

    await TournamentSet.create({
      bracketId: bracket.id,
      externalId: 's1',
      state: 'completed',
      entrantAId: entrantA.id,
      entrantBId: entrantB.id,
      winnerEntrantId: entrantA.id,
      entrantADisqualified: false,
      entrantBDisqualified: false,
    })

    await LeagueEvent.create({ leagueId: league.id, eventId: event.id })

    return { tournament, event }
  }

  test('an admin can delete a tournament counted only by their league', async ({
    client,
    assert,
  }) => {
    const { owner, league } = await makeLeagueWithOwner()
    const { tournament, event } = await makeCountedTournament(league)

    const response = await client
      .delete(`/${league.slug}/events/${event.id}/tournament`)
      .loginAs(owner)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)

    assert.isNull(await Tournament.find(tournament.id))
    assert.isNull(await Event.find(event.id))
    assert.isNull(await LeagueEvent.query().where('eventId', event.id).first())
    assert.lengthOf(await Entrant.query().where('eventId', event.id), 0)
    assert.lengthOf(await Bracket.all(), 0)
    assert.lengthOf(await TournamentSet.all(), 0)
  })

  test('deleting a tournament marks the league’s rankings stale', async ({ client, assert }) => {
    const { owner, league } = await makeLeagueWithOwner()
    const { event } = await makeCountedTournament(league)

    const ranking = await Ranking.create({
      leagueId: league.id,
      slug: 'ranking',
      name: 'Ranking',
      algorithm: 'elo',
      recomputeMode: 'manual',
      published: true,
    })

    await client
      .delete(`/${league.slug}/events/${event.id}/tournament`)
      .loginAs(owner)
      .withCsrfToken()
      .redirects(0)

    const reloaded = await Ranking.findOrFail(ranking.id)
    assert.isNotNull(reloaded.recomputeRequestedAt)
  })

  test('is rejected when another league also counts the tournament', async ({ client, assert }) => {
    const { owner, league } = await makeLeagueWithOwner('destroy-a')
    const { league: otherLeague } = await makeLeagueWithOwner('destroy-b')
    const { tournament, event } = await makeCountedTournament(league)

    // A second event of the same tournament, counted by the other league.
    const siblingEvent = await Event.create({
      tournamentId: tournament.id,
      externalId: `e-${Math.random().toString(36).slice(2, 10)}`,
      name: 'Doubles',
      entryKind: 'doubles',
    })
    await LeagueEvent.create({ leagueId: otherLeague.id, eventId: siblingEvent.id })

    const response = await client
      .delete(`/${league.slug}/events/${event.id}/tournament`)
      .loginAs(owner)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)

    // Nothing was deleted.
    assert.isNotNull(await Tournament.find(tournament.id))
    assert.isNotNull(await Event.find(event.id))
    assert.isNotNull(await LeagueEvent.query().where('eventId', event.id).first())
  })

  test('an event not counted by the league is rejected', async ({ client }) => {
    const { owner, league } = await makeLeagueWithOwner()
    const { league: otherLeague } = await makeLeagueWithOwner('destroy-other')
    const { event } = await makeCountedTournament(otherLeague)

    const response = await client
      .delete(`/${league.slug}/events/${event.id}/tournament`)
      .loginAs(owner)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(404)
  })
})
