import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import EventImport from '#models/event_import'
import League from '#models/league'
import LeagueAdmin from '#models/league_admin'
import LeaguePlayer from '#models/league_player'
import Ranking from '#models/ranking'
import PlayerEventAttendance from '#models/player_event_attendance'
import User from '#models/user'
import { IdentityResolverService } from '#services/identity/identity_resolver_service'
import { RankingRecomputerService } from '#services/rankings/ranking_recomputer_service'
import { EventImporterService } from '#services/imports/event_importer_service'

/**
 * Admin CRUD over a player's manual attendance credits. `truncate()`, not
 * `withGlobalTransaction()`: `makeEvent` runs the real import pipeline
 * (`EventImporterService`/`IdentityResolverService`), same as
 * `ranking_activity_filter.spec.ts` — those don't play well wrapped in one
 * outer test transaction.
 */
test.group('player attendance', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  async function makeLeagueWithOwner() {
    const owner = await User.create({
      email: `owner-${Math.random()}@example.com`,
      password: 'secret123',
      fullName: 'Owner',
    })

    const league = await League.create({
      slug: `attendance-${Math.random().toString(36).slice(2, 10)}`,
      name: 'Attendance League',
      visibility: 'public',
    })

    await LeagueAdmin.create({ leagueId: league.id, userId: owner.id, role: 'owner' })

    return { owner, league }
  }

  async function makePlayer(league: League, displayTag = 'Player One') {
    return LeaguePlayer.create({
      leagueId: league.id,
      slug: displayTag.toLowerCase().replace(/\s+/g, '-'),
      displayTag,
    })
  }

  /** A minimal real event/tournament, via the same import path production uses. */
  async function makeEvent(league: League, slug: string): Promise<string> {
    const tournamentImport = await EventImport.create({
      leagueId: league.id,
      platformKey: 'manual',
      status: 'queued',
      payload: {
        name: slug,
        slug,
        entrants: 'name\nAlice\nBob\n',
        sets: 'entrant_a,entrant_b,score_a,score_b\nAlice,Bob,3,1\n',
        startAt: '2026-01-10',
      },
    })
    const finished = await new EventImporterService().run({ eventImportId: tournamentImport.id })
    await new IdentityResolverService().run({ leagueId: league.id, eventId: finished.eventId! })

    return finished.eventId!
  }

  test('an admin can add an attendance credit', async ({ client, assert }) => {
    const { owner, league } = await makeLeagueWithOwner()
    const player = await makePlayer(league)
    const eventId = await makeEvent(league, 'add-credit')

    const response = await client
      .post(`/${league.slug}/players/${player.slug}/attendance`)
      .loginAs(owner)
      .withCsrfToken()
      .fields({ eventId })
      .redirects(0)

    response.assertStatus(302)

    const credit = await PlayerEventAttendance.query()
      .where('leaguePlayerId', player.id)
      .where('eventId', eventId)
      .first()
    assert.isNotNull(credit)
  })

  test('adding a duplicate credit is rejected, not duplicated', async ({ client, assert }) => {
    const { owner, league } = await makeLeagueWithOwner()
    const player = await makePlayer(league)
    const eventId = await makeEvent(league, 'dup-credit')
    await PlayerEventAttendance.create({ leaguePlayerId: player.id, eventId })

    const response = await client
      .post(`/${league.slug}/players/${player.slug}/attendance`)
      .loginAs(owner)
      .withCsrfToken()
      .fields({ eventId })
      .redirects(0)

    response.assertStatus(302)

    const credits = await PlayerEventAttendance.query()
      .where('leaguePlayerId', player.id)
      .where('eventId', eventId)
    assert.lengthOf(credits, 1)
  })

  test('an event from another league is rejected', async ({ client }) => {
    const { owner, league } = await makeLeagueWithOwner()
    const player = await makePlayer(league)
    const { league: otherLeague } = await makeLeagueWithOwner()
    const outsideEventId = await makeEvent(otherLeague, 'outside-league')

    const response = await client
      .post(`/${league.slug}/players/${player.slug}/attendance`)
      .loginAs(owner)
      .withCsrfToken()
      .fields({ eventId: outsideEventId })
      .redirects(0)

    response.assertStatus(404)
  })

  test('a nonexistent player is rejected', async ({ client }) => {
    const { owner, league } = await makeLeagueWithOwner()
    const eventId = await makeEvent(league, 'no-such-player')

    const response = await client
      .post(`/${league.slug}/players/no-such-player/attendance`)
      .loginAs(owner)
      .withCsrfToken()
      .fields({ eventId })
      .redirects(0)

    response.assertStatus(404)
  })

  test('an admin can remove a credit', async ({ client, assert }) => {
    const { owner, league } = await makeLeagueWithOwner()
    const player = await makePlayer(league)
    const eventId = await makeEvent(league, 'remove-credit')
    const credit = await PlayerEventAttendance.create({ leaguePlayerId: player.id, eventId })

    const response = await client
      .delete(`/${league.slug}/players/${player.slug}/attendance/${credit.id}`)
      .loginAs(owner)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    assert.isNull(await PlayerEventAttendance.find(credit.id))
  })

  test('removing a credit belonging to a different player 404s rather than deleting', async ({
    client,
    assert,
  }) => {
    const { owner, league } = await makeLeagueWithOwner()
    const player = await makePlayer(league, 'Player One')
    const otherPlayer = await makePlayer(league, 'Player Two')
    const eventId = await makeEvent(league, 'wrong-player')
    const credit = await PlayerEventAttendance.create({
      leaguePlayerId: otherPlayer.id,
      eventId,
    })

    const response = await client
      .delete(`/${league.slug}/players/${player.slug}/attendance/${credit.id}`)
      .loginAs(owner)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(404)
    assert.isNotNull(await PlayerEventAttendance.find(credit.id))
  })

  test('adding a credit forces a real recompute of an auto ranking, not a skipped one', async ({
    client,
    assert,
  }) => {
    const { owner, league } = await makeLeagueWithOwner()
    const player = await makePlayer(league)
    const eventId = await makeEvent(league, 'forces-recompute')

    const ranking = await Ranking.create({
      leagueId: league.id,
      slug: 'power-ranking',
      name: 'Power Ranking',
      algorithm: 'elo',
      recomputeMode: 'auto',
      published: true,
    })
    const before = await new RankingRecomputerService().run(ranking.id)
    assert.isFalse(before.skipped)

    const response = await client
      .post(`/${league.slug}/players/${player.slug}/attendance`)
      .loginAs(owner)
      .withCsrfToken()
      .fields({ eventId })
      .redirects(0)

    response.assertStatus(302)

    const reloaded = await Ranking.findOrFail(ranking.id)
    assert.notEqual(
      reloaded.latestRecomputeId,
      before.recompute.id,
      'a grant must force past the fingerprint skip-check, not be silently no-opped'
    )
  })

  test('the player show page returns attendance credits and, for admins, the events the league counts', async ({
    client,
    assert,
  }) => {
    const { owner, league } = await makeLeagueWithOwner()
    const player = await makePlayer(league)
    const eventId = await makeEvent(league, 'show-page-props')
    await PlayerEventAttendance.create({ leaguePlayerId: player.id, eventId })

    const response = await client
      .get(`/${league.slug}/players/${player.slug}`)
      .loginAs(owner)
      .header('X-Inertia', 'true')
      .header('X-Inertia-Version', '1')

    response.assertStatus(200)
    const props = response.body().props as {
      attendanceCredits: Array<{ id: string; label: string }>
      events: Array<{ id: string; label: string }>
    }

    assert.lengthOf(props.attendanceCredits, 1)
    assert.isTrue(props.events.some((event) => event.id === eventId))
  })
})
