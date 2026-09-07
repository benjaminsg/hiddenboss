import { test } from '@japa/runner'
import { RecordingSink } from '#lib/platforms/recording_sink'
import { RegionFilteringSink } from '#lib/platforms/region_filtering_sink'
import type {
  CanonicalBracket,
  CanonicalEntrant,
  CanonicalParticipant,
} from '#lib/platforms/canonical'

function participant(overrides: Partial<CanonicalParticipant> = {}): CanonicalParticipant {
  return {
    externalUserId: 'u1',
    gamerTag: 'Player',
    prefix: null,
    pronouns: null,
    profileSlug: null,
    country: null,
    state: null,
    city: null,
    ...overrides,
  }
}

function entrant(
  externalId: string,
  participants: CanonicalParticipant[] = [participant()]
): CanonicalEntrant {
  return {
    externalId,
    name: externalId,
    seed: null,
    placement: null,
    isDisqualified: false,
    participants,
  }
}

function bracket(sets: CanonicalBracket['sets']): CanonicalBracket {
  return { externalId: 'b1', name: 'Bracket', bracketType: 'double_elimination', sets }
}

function set(
  entrantAId: string | null,
  entrantBId: string | null
): CanonicalBracket['sets'][number] {
  return {
    externalId: `${entrantAId}-vs-${entrantBId}`,
    state: 'completed',
    round: 1,
    identifier: null,
    fullRoundText: null,
    ordinal: null,
    entrantAExternalId: entrantAId,
    entrantBExternalId: entrantBId,
    winnerEntrantExternalId: entrantAId,
    scoreA: 3,
    scoreB: 1,
    entrantADisqualified: false,
    entrantBDisqualified: false,
    completedAt: null,
    games: [],
  }
}

test.group('RegionFilteringSink', () => {
  test('a set between two in-region entrants passes through', async ({ assert }) => {
    const recording = new RecordingSink()
    const sink = new RegionFilteringSink([{ state: 'WA' }], recording)

    await sink.entrants('e1', [
      entrant('a', [participant({ state: 'WA', country: 'US' })]),
      entrant('b', [participant({ state: 'WA', country: 'US' })]),
    ])
    await sink.bracket('e1', 'p1', bracket([set('a', 'b')]))

    assert.lengthOf(recording.brackets[0].bracket.sets, 1)
    assert.equal(sink.excludedSetCount, 0)
  })

  test('a set with one out-of-region entrant is dropped', async ({ assert }) => {
    const recording = new RecordingSink()
    const sink = new RegionFilteringSink([{ state: 'WA' }], recording)

    await sink.entrants('e1', [
      entrant('a', [participant({ state: 'WA', country: 'US' })]),
      entrant('b', [participant({ state: 'CA', country: 'US' })]),
    ])
    await sink.bracket('e1', 'p1', bracket([set('a', 'b')]))

    assert.lengthOf(recording.brackets[0].bracket.sets, 0)
    assert.equal(sink.excludedSetCount, 1)
  })

  test('an entrant with no reported location never qualifies (fails closed)', async ({
    assert,
  }) => {
    const recording = new RecordingSink()
    const sink = new RegionFilteringSink([{ state: 'WA' }], recording)

    await sink.entrants('e1', [
      entrant('a', [participant({ state: 'WA', country: 'US' })]),
      entrant('b', [participant({ state: null, country: null })]),
    ])
    await sink.bracket('e1', 'p1', bracket([set('a', 'b')]))

    assert.lengthOf(recording.brackets[0].bracket.sets, 0)
  })

  test('a doubles/crew entrant requires every participant to match', async ({ assert }) => {
    const recording = new RecordingSink()
    const sink = new RegionFilteringSink([{ state: 'WA' }], recording)

    await sink.entrants('e1', [
      entrant('a', [
        participant({ state: 'WA', country: 'US' }),
        participant({ state: 'CA', country: 'US' }),
      ]),
      entrant('b', [
        participant({ state: 'WA', country: 'US' }),
        participant({ state: 'WA', country: 'US' }),
      ]),
    ])
    await sink.bracket('e1', 'p1', bracket([set('a', 'b')]))

    // Entrant "a" has one out-of-region teammate, so the set never qualifies.
    assert.lengthOf(recording.brackets[0].bracket.sets, 0)
  })

  test('an out-of-region entrant is never written, not just excluded from sets', async ({
    assert,
  }) => {
    const recording = new RecordingSink()
    const sink = new RegionFilteringSink([{ state: 'WA' }], recording)

    await sink.entrants('e1', [
      entrant('a', [participant({ state: 'WA', country: 'US' })]),
      entrant('b', [participant({ state: 'TX', country: 'US' })]),
    ])

    assert.deepEqual(
      recording.allEntrants.map((e) => e.externalId),
      ['a']
    )
    assert.equal(sink.excludedEntrantCount, 1)
  })

  test('an in-region entrant is forwarded even with no reported sets yet', async ({ assert }) => {
    const recording = new RecordingSink()
    const sink = new RegionFilteringSink([{ state: 'WA' }], recording)

    await sink.entrants('e1', [entrant('a', [participant({ state: 'WA', country: 'US' })])])

    assert.lengthOf(recording.allEntrants, 1)
    assert.equal(sink.excludedEntrantCount, 0)
  })

  test('multiple alternative regions: matching any one qualifies', async ({ assert }) => {
    const recording = new RecordingSink()
    const sink = new RegionFilteringSink([{ state: 'WA' }, { state: 'OR' }], recording)

    await sink.entrants('e1', [
      entrant('a', [participant({ state: 'WA', country: 'US' })]),
      entrant('b', [participant({ state: 'OR', country: 'US' })]),
    ])
    await sink.bracket('e1', 'p1', bracket([set('a', 'b')]))

    assert.lengthOf(recording.brackets[0].bracket.sets, 1)
    assert.lengthOf(recording.allEntrants, 2)
  })

  test('an empty region list is a no-op passthrough of every entrant and set', async ({
    assert,
  }) => {
    const recording = new RecordingSink()
    const sink = new RegionFilteringSink([], recording)

    await sink.entrants('e1', [
      entrant('a', [participant({ state: null, country: null })]),
      entrant('b'),
    ])
    await sink.bracket('e1', 'p1', bracket([set('a', 'b')]))

    assert.lengthOf(recording.allEntrants, 2)
    assert.lengthOf(recording.brackets[0].bracket.sets, 1)
    assert.equal(sink.excludedSetCount, 0)
    assert.equal(sink.excludedEntrantCount, 0)
  })

  test('excludedSetCount accumulates across multiple bracket calls', async ({ assert }) => {
    const recording = new RecordingSink()
    const sink = new RegionFilteringSink([{ state: 'WA' }], recording)

    await sink.entrants('e1', [
      entrant('a', [participant({ state: 'WA', country: 'US' })]),
      entrant('b', [participant({ state: 'CA', country: 'US' })]),
      entrant('c', [participant({ state: 'TX', country: 'US' })]),
    ])
    await sink.bracket('e1', 'p1', bracket([set('a', 'b')]))
    await sink.bracket('e1', 'p2', bracket([set('a', 'c')]))

    assert.equal(sink.excludedSetCount, 2)
  })

  test('excludedEntrantCount accumulates across multiple entrant batches', async ({ assert }) => {
    const recording = new RecordingSink()
    const sink = new RegionFilteringSink([{ state: 'WA' }], recording)

    await sink.entrants('e1', [entrant('a', [participant({ state: 'CA', country: 'US' })])])
    await sink.entrants('e1', [entrant('b', [participant({ state: 'TX', country: 'US' })])])

    assert.equal(sink.excludedEntrantCount, 2)
    assert.lengthOf(recording.allEntrants, 0)
  })
})
