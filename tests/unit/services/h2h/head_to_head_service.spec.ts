import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import EventImport from '#models/event_import'
import League from '#models/league'
import LeagueEvent from '#models/league_event'
import LeaguePlayer from '#models/league_player'
import LeaguePlayerAccount from '#models/league_player_account'
import { EventImporterService } from '#services/imports/event_importer_service'
import { TournamentWriterService } from '#services/imports/tournament_writer_service'
import { IdentityCorrectionService } from '#services/identity/identity_correction_service'
import { IdentityResolverService } from '#services/identity/identity_resolver_service'
import { HeadToHeadService, type HeadToHeadMatchup } from '#services/h2h/head_to_head_service'
import type { CanonicalEntrant } from '#lib/platforms/canonical'

/**
 * H2H is entrant-vs-entrant, not player-vs-player: a doubles set is never
 * cross-producted into individual credit, since that would conflate a team's
 * identity with the identity of the people on it. These tests exercise both
 * the aggregation and that exclusion, plus merge-following.
 */
test.group('HeadToHeadService', (group) => {
  /**
   * Truncates rather than wrapping in a transaction: the importer takes a
   * Postgres advisory lock released only at top-level commit.
   */
  group.each.setup(() => testUtils.db().truncate())

  async function seedLeague(slug: string): Promise<League> {
    return League.create({ slug, name: slug })
  }

  async function importManual(
    league: League,
    options: { name: string; slug: string; entrants: string; sets: string }
  ) {
    const eventImport = await EventImport.create({
      leagueId: league.id,
      platformKey: 'manual',
      status: 'queued',
      payload: {
        name: options.name,
        slug: options.slug,
        entrants: options.entrants,
        sets: options.sets,
      },
    })

    const finished = await new EventImporterService().run({ eventImportId: eventImport.id })
    await new IdentityResolverService().run({ leagueId: league.id, eventId: finished.eventId! })
    return finished
  }

  async function playerId(league: League, displayTag: string): Promise<string> {
    const player = await LeaguePlayer.query()
      .where('leagueId', league.id)
      .where('displayTag', displayTag)
      .firstOrFail()
    return player.id
  }

  function recordFor(
    matchups: HeadToHeadMatchup[],
    aId: string,
    bId: string
  ): { aWins: number; bWins: number } | null {
    const match = matchups.find(
      (m) => (m.loId === aId && m.hiId === bId) || (m.loId === bId && m.hiId === aId)
    )
    if (!match) return null

    return match.loId === aId
      ? { aWins: match.loWins, bWins: match.hiWins }
      : { aWins: match.hiWins, bWins: match.loWins }
  }

  test('counts singles wins and losses between two players in both directions', async ({
    assert,
  }) => {
    const league = await seedLeague('h2h-singles')

    await importManual(league, {
      name: 'Weekly',
      slug: 'h2h-weekly',
      entrants: 'name\nAlice\nBob\n',
      sets: 'entrant_a,entrant_b,winner\nAlice,Bob,Alice\nAlice,Bob,Alice\nAlice,Bob,Bob\n',
    })

    const alice = await playerId(league, 'Alice')
    const bob = await playerId(league, 'Bob')

    const { players, matchups } = await new HeadToHeadService().forLeague(league.id)

    assert.sameMembers(
      players.map((player) => player.displayTag),
      ['Alice', 'Bob']
    )

    const record = recordFor(matchups, alice, bob)
    assert.isNotNull(record)
    assert.equal(record!.aWins, 2)
    assert.equal(record!.bWins, 1)
  })

  test('excludes doubles sets from the player matrix entirely', async ({ assert }) => {
    const league = await seedLeague('h2h-doubles')

    await importManual(league, {
      name: 'Weekly',
      slug: 'h2h-weekly',
      entrants: 'name\nAlice\nBob\n',
      sets: 'entrant_a,entrant_b,winner\nAlice,Bob,Alice\n',
    })

    const writer = new TournamentWriterService('manual')
    await writer.writeTournament({
      externalId: 'doubles-1',
      slug: 'doubles-1',
      name: 'Doubles Bracket',
      url: null,
      startAt: null,
      endAt: null,
      country: null,
      state: null,
      city: null,
      address: null,
      isOnline: false,
    })
    const doublesEventId = await writer.writeEvent({
      externalId: 'doubles-1-event',
      name: 'Doubles',
      game: null,
      entryKind: 'doubles',
      teamSize: 2,
      entrantCount: 2,
    })
    await writer.writePhase('doubles-1-event', {
      externalId: 'phase-1',
      name: 'Bracket',
      order: 1,
    })

    // Real externalUserIds, one per participant: the manual CSV path always
    // synthesises `entrant:{eventId}:{entrantExternalId}` for a null id, which
    // is scoped to the *entrant* rather than the participant and would collide
    // two doubles partners onto the same platform account.
    const participant = (gamerTag: string, externalUserId: string) => ({
      externalUserId,
      profileSlug: null,
      gamerTag,
      prefix: null,
      pronouns: null,
      country: null,
      state: null,
      city: null,
    })

    const entrants: CanonicalEntrant[] = [
      {
        externalId: 'team-a',
        name: 'Alice & Carol',
        seed: null,
        placement: null,
        isDisqualified: false,
        participants: [participant('Erin', 'doubles-erin'), participant('Carol', 'doubles-carol')],
      },
      {
        externalId: 'team-b',
        name: 'Frank & Dave',
        seed: null,
        placement: null,
        isDisqualified: false,
        participants: [participant('Frank', 'doubles-frank'), participant('Dave', 'doubles-dave')],
      },
    ]
    await writer.writeEntrants('doubles-1-event', entrants)

    await writer.writeBracket('phase-1', {
      externalId: 'bracket-1',
      name: 'Bracket',
      bracketType: 'other',
      sets: [
        {
          externalId: 'set-1',
          state: 'completed',
          round: 1,
          identifier: null,
          fullRoundText: null,
          ordinal: 1,
          entrantAExternalId: 'team-a',
          entrantBExternalId: 'team-b',
          winnerEntrantExternalId: 'team-a',
          scoreA: 2,
          scoreB: 0,
          entrantADisqualified: false,
          entrantBDisqualified: false,
          completedAt: null,
          games: [],
        },
      ],
    })

    await LeagueEvent.updateOrCreate(
      { leagueId: league.id, eventId: doublesEventId },
      { addedByUserId: null }
    )
    await new IdentityResolverService().run({ leagueId: league.id, eventId: doublesEventId })

    const alice = await playerId(league, 'Alice')
    const bob = await playerId(league, 'Bob')
    const doublesIds = await Promise.all(
      ['Erin', 'Carol', 'Frank', 'Dave'].map((tag) => playerId(league, tag))
    )

    const { matchups } = await new HeadToHeadService().forLeague(league.id)

    // The singles baseline is untouched by the doubles set.
    const aliceVsBob = recordFor(matchups, alice, bob)
    assert.isNotNull(aliceVsBob)
    assert.equal(aliceVsBob!.aWins, 1)
    assert.equal(aliceVsBob!.bWins, 0)

    // None of the doubles-only players have a singles record against anyone —
    // a doubles set never gets cross-producted into individual credit.
    const involvesDoublesPlayer = matchups.some(
      (m) => doublesIds.includes(m.loId) || doublesIds.includes(m.hiId)
    )
    assert.isFalse(involvesDoublesPlayer)
  })

  test("a merged player's earlier sets roll up under the surviving player", async ({ assert }) => {
    const league = await seedLeague('h2h-merge')

    await importManual(league, {
      name: 'Week 1',
      slug: 'h2h-week-1',
      entrants: 'name\nAlice\nBob\n',
      sets: 'entrant_a,entrant_b,winner\nAlice,Bob,Alice\n',
    })
    // A second tournament where "Alice" is imported under a different
    // gamertag casing, creating a second league player before any merge.
    await importManual(league, {
      name: 'Week 2',
      slug: 'h2h-week-2',
      entrants: 'name\nAlice2\nBob\n',
      sets: 'entrant_a,entrant_b,winner\nAlice2,Bob,Alice2\n',
    })

    const alice = await playerId(league, 'Alice')
    const alice2 = await playerId(league, 'Alice2')
    const bob = await playerId(league, 'Bob')

    const alice2Account = await LeaguePlayerAccount.query()
      .where('leaguePlayerId', alice2)
      .firstOrFail()

    await new IdentityCorrectionService().reassign({
      leagueId: league.id,
      platformAccountId: alice2Account.platformAccountId,
      target: { existingPlayerId: alice },
      actorUserId: null,
    })

    const { matchups } = await new HeadToHeadService().forLeague(league.id)

    // Alice's two sets against Bob (one played as "Alice", one as "Alice2"
    // before the merge) both land under the surviving player id.
    const record = recordFor(matchups, alice, bob)
    assert.isNotNull(record)
    assert.equal(record!.aWins, 2)
    assert.equal(record!.bWins, 0)

    // The tombstoned player no longer appears in the player list or matchups.
    const { players } = await new HeadToHeadService().forLeague(league.id)
    assert.isFalse(players.some((player) => player.id === alice2))
  })
})
