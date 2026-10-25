import { test } from '@japa/runner'
import { RecordingSink } from '#lib/platforms/recording_sink'
import { SizeLimitingSink } from '#lib/platforms/size_limiting_sink'
import { PermanentPlatformError } from '#lib/platforms/errors'
import type { CanonicalBracket, CanonicalEntrant, CanonicalEvent } from '#lib/platforms/canonical'

function event(overrides: Partial<CanonicalEvent> = {}): CanonicalEvent {
  return {
    externalId: 'e1',
    name: 'Singles',
    game: null,
    entryKind: 'singles',
    teamSize: null,
    entrantCount: null,
    ...overrides,
  }
}

function entrant(externalId: string): CanonicalEntrant {
  return {
    externalId,
    name: externalId,
    seed: null,
    placement: null,
    isDisqualified: false,
    participants: [],
  }
}

function bracket(externalId: string): CanonicalBracket {
  return { externalId, name: null, bracketType: 'double_elimination', sets: [] }
}

test.group('SizeLimitingSink', () => {
  test('passes through an event within both limits', async ({ assert }) => {
    const recording = new RecordingSink()
    const sink = new SizeLimitingSink('fake', { maxBrackets: 2, maxEntrants: 2 }, recording)

    await sink.event(event({ entrantCount: 2 }))
    await sink.progress(0, 2)
    await sink.entrants('e1', [entrant('a'), entrant('b')])
    await sink.bracket('e1', 'p1', bracket('b1'))

    assert.lengthOf(recording.allEntrants, 2)
    assert.lengthOf(recording.brackets, 1)
  })

  test('rejects on a known-upfront entrant count before writing the event', async ({ assert }) => {
    const recording = new RecordingSink()
    const sink = new SizeLimitingSink('fake', { maxBrackets: 200, maxEntrants: 2 }, recording)

    await assert.rejects(
      () => sink.event(event({ entrantCount: 3 })),
      PermanentPlatformError,
      /3 entrants, over the 2/
    )
    assert.lengthOf(recording.calls, 0)
  })

  test('rejects on a known-upfront bracket total before fetching any bracket', async ({
    assert,
  }) => {
    const recording = new RecordingSink()
    const sink = new SizeLimitingSink('fake', { maxBrackets: 2, maxEntrants: 3000 }, recording)

    await assert.rejects(
      () => sink.progress(0, 3),
      PermanentPlatformError,
      /3 brackets, over the 2/
    )
    assert.lengthOf(recording.calls, 0)
  })

  test('an entrant count exactly at the limit is accepted', async ({ assert }) => {
    const recording = new RecordingSink()
    const sink = new SizeLimitingSink('fake', { maxBrackets: 200, maxEntrants: 2 }, recording)

    await sink.event(event({ entrantCount: 2 }))

    assert.lengthOf(recording.calls, 1)
  })

  test('a null entrant count defers to counting entrants as they stream in', async ({ assert }) => {
    const recording = new RecordingSink()
    const sink = new SizeLimitingSink('fake', { maxBrackets: 200, maxEntrants: 2 }, recording)

    await sink.event(event({ entrantCount: null }))
    await sink.entrants('e1', [entrant('a'), entrant('b')])

    await assert.rejects(
      () => sink.entrants('e1', [entrant('c')]),
      PermanentPlatformError,
      /3 entrants, over the 2/
    )
    assert.deepEqual(
      recording.allEntrants.map((e) => e.externalId),
      ['a', 'b']
    )
  })

  test('entrant counting accumulates across multiple batches', async ({ assert }) => {
    const recording = new RecordingSink()
    const sink = new SizeLimitingSink('fake', { maxBrackets: 200, maxEntrants: 2 }, recording)

    await sink.entrants('e1', [entrant('a')])
    await assert.rejects(() => sink.entrants('e1', [entrant('b'), entrant('c')]))
  })

  test('a null bracket total defers to counting brackets as they stream in', async ({ assert }) => {
    const recording = new RecordingSink()
    const sink = new SizeLimitingSink('fake', { maxBrackets: 2, maxEntrants: 3000 }, recording)

    await sink.progress(0, null)
    await sink.bracket('e1', 'p1', bracket('b1'))
    await sink.bracket('e1', 'p1', bracket('b2'))

    await assert.rejects(
      () => sink.bracket('e1', 'p1', bracket('b3')),
      PermanentPlatformError,
      /3 brackets, over the 2/
    )
    assert.lengthOf(recording.brackets, 2)
  })

  test('a bracket total exactly at the limit is accepted', async ({ assert }) => {
    const recording = new RecordingSink()
    const sink = new SizeLimitingSink('fake', { maxBrackets: 2, maxEntrants: 3000 }, recording)

    await sink.progress(0, 2)
    await sink.progress(2, 2)

    assert.lengthOf(recording.calls, 2)
  })
})
