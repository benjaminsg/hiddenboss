import { test } from '@japa/runner'
import {
  entrantMatchesRegions,
  matchesAnyRegion,
  matchesLocation,
  regionsEqual,
} from '#lib/geo/region_filter'

test.group('matchesLocation', () => {
  test('null requirement imposes no restriction', ({ assert }) => {
    assert.isTrue(matchesLocation({ country: 'FR', state: null, city: 'Paris' }, null))
  })

  test('every field given on the filter must match', ({ assert }) => {
    const home = { country: 'US', state: 'WA', city: 'Spokane' }

    assert.isTrue(matchesLocation(home, { state: 'WA' }))
    assert.isTrue(matchesLocation(home, { country: 'US', state: 'WA' }))
    assert.isFalse(matchesLocation(home, { country: 'US', state: 'CA' }))
  })

  test('matching is case- and whitespace-insensitive', ({ assert }) => {
    assert.isTrue(matchesLocation({ city: 'Spokane' }, { city: ' spokane ' }))
  })

  test('a missing entity field never satisfies a specified filter field', ({ assert }) => {
    assert.isFalse(matchesLocation({ country: 'US', state: null }, { country: 'US', state: 'WA' }))
  })
})

test.group('matchesAnyRegion', () => {
  test('an empty region list always passes', ({ assert }) => {
    assert.isTrue(matchesAnyRegion({}, []))
  })

  test('matching any one of several alternative regions qualifies', ({ assert }) => {
    const home = { state: 'CA' }

    assert.isTrue(matchesAnyRegion(home, [{ state: 'WA' }, { state: 'CA' }, { state: 'OR' }]))
    assert.isFalse(matchesAnyRegion(home, [{ state: 'WA' }, { state: 'OR' }]))
  })
})

test.group('entrantMatchesRegions', () => {
  const wa = [{ state: 'WA' }]

  test('an empty region list qualifies any entrant', ({ assert }) => {
    assert.isTrue(entrantMatchesRegions([], []))
    assert.isTrue(entrantMatchesRegions([{ country: null, state: null, city: null }], []))
  })

  test('an entrant with no participants never qualifies', ({ assert }) => {
    assert.isFalse(entrantMatchesRegions([], wa))
  })

  test('every participant must be in region', ({ assert }) => {
    assert.isTrue(
      entrantMatchesRegions(
        [
          { country: 'US', state: 'WA', city: 'Seattle' },
          { country: 'US', state: 'WA', city: 'Tacoma' },
        ],
        wa
      )
    )
    assert.isFalse(
      entrantMatchesRegions(
        [
          { country: 'US', state: 'WA', city: 'Seattle' },
          { country: 'US', state: 'OR', city: 'Portland' },
        ],
        wa
      )
    )
  })

  test('an unlocated participant fails a specified filter', ({ assert }) => {
    assert.isFalse(entrantMatchesRegions([{ country: null, state: null, city: null }], wa))
  })

  test('state is normalised against country before matching', ({ assert }) => {
    assert.isTrue(
      entrantMatchesRegions([{ country: 'United States', state: 'Washington', city: null }], wa)
    )
  })
})

test.group('regionsEqual', () => {
  test('two empty lists are equal', ({ assert }) => {
    assert.isTrue(regionsEqual([], []))
  })

  test('the same regions in a different order are equal', ({ assert }) => {
    assert.isTrue(
      regionsEqual([{ state: 'WA' }, { state: 'OR' }], [{ state: 'OR' }, { state: 'WA' }])
    )
  })

  test('matching is case- and whitespace-insensitive', ({ assert }) => {
    assert.isTrue(regionsEqual([{ state: 'WA' }], [{ state: ' wa ' }]))
  })

  test('a different set of regions is not equal', ({ assert }) => {
    assert.isFalse(regionsEqual([{ state: 'WA' }], [{ state: 'WA' }, { state: 'OR' }]))
    assert.isFalse(regionsEqual([{ state: 'WA' }], [{ state: 'OR' }]))
  })

  test('an empty list is never equal to a non-empty one', ({ assert }) => {
    assert.isFalse(regionsEqual([], [{ state: 'WA' }]))
  })
})
