import { test } from '@japa/runner'
import {
  meetsActivityRequirements,
  meetsResidencyRequirement,
} from '#lib/rankings/activity_requirements'
import type { PlayerLocation, TournamentActivity } from '#lib/rankings/activity_requirements'

function activity(overrides: Partial<TournamentActivity> = {}): TournamentActivity {
  return {
    entrantCount: null,
    setsPlayed: 1,
    timesDisqualified: 0,
    country: null,
    state: null,
    city: null,
    ...overrides,
  }
}

test.group('meetsActivityRequirements', () => {
  test('an empty requirement list always passes', ({ assert }) => {
    assert.isTrue(meetsActivityRequirements([], []))
  })

  test('minEntrants excludes tournaments below the bar and unknown sizes', ({ assert }) => {
    const tournaments = [activity({ entrantCount: 4 }), activity({ entrantCount: null })]

    assert.isTrue(meetsActivityRequirements(tournaments, [{ count: 1, minEntrants: 4 }]))
    assert.isFalse(meetsActivityRequirements(tournaments, [{ count: 2, minEntrants: 4 }]))
  })

  test('exclude_no_shows (default) drops a DQ with nothing played, keeps one with something played', ({
    assert,
  }) => {
    const noShow = [activity({ setsPlayed: 0, timesDisqualified: 1 })]
    const playedThenDqd = [activity({ setsPlayed: 2, timesDisqualified: 1 })]

    assert.isFalse(meetsActivityRequirements(noShow, [{ count: 1, minEntrants: null }]))
    assert.isTrue(meetsActivityRequirements(playedThenDqd, [{ count: 1, minEntrants: null }]))
    // Same result when the policy is passed explicitly.
    assert.isFalse(
      meetsActivityRequirements(noShow, [{ count: 1, minEntrants: null }], 'exclude_no_shows')
    )
  })

  test('exclude_double_dq keeps a single DQ, drops two in the same tournament', ({ assert }) => {
    const singleDq = [activity({ setsPlayed: 0, timesDisqualified: 1 })]
    const doubleDq = [activity({ setsPlayed: 2, timesDisqualified: 2 })]

    assert.isTrue(
      meetsActivityRequirements(singleDq, [{ count: 1, minEntrants: null }], 'exclude_double_dq')
    )
    assert.isFalse(
      meetsActivityRequirements(doubleDq, [{ count: 1, minEntrants: null }], 'exclude_double_dq')
    )
  })

  test('exclude_any_dq drops a tournament on any disqualification, however much was played', ({
    assert,
  }) => {
    const oneDqAfterPlaying = [activity({ setsPlayed: 3, timesDisqualified: 1 })]

    assert.isFalse(
      meetsActivityRequirements(
        oneDqAfterPlaying,
        [{ count: 1, minEntrants: null }],
        'exclude_any_dq'
      )
    )
  })

  test('a clean tournament with no DQ counts under every policy', ({ assert }) => {
    const clean = [activity({ setsPlayed: 3, timesDisqualified: 0 })]

    for (const dqPolicy of ['exclude_no_shows', 'exclude_double_dq', 'exclude_any_dq'] as const) {
      assert.isTrue(
        meetsActivityRequirements(clean, [{ count: 1, minEntrants: null }], dqPolicy),
        `expected a DQ-free tournament to count under ${dqPolicy}`
      )
    }
  })

  test('every clause must independently hold', ({ assert }) => {
    const tournaments = [
      activity({ entrantCount: 8, setsPlayed: 2, timesDisqualified: 0 }),
      activity({ entrantCount: 2, setsPlayed: 0, timesDisqualified: 1 }),
    ]

    assert.isTrue(
      meetsActivityRequirements(tournaments, [
        { count: 1, minEntrants: 8 },
        { count: 1, minEntrants: null },
      ])
    )
    // The no-show tournament doesn't qualify under the default policy, so
    // only one tournament is left to satisfy a count of 2.
    assert.isFalse(meetsActivityRequirements(tournaments, [{ count: 2, minEntrants: null }]))
  })

  test('location restricts to tournaments matching every field given', ({ assert }) => {
    const tournaments = [
      activity({ country: 'US', state: 'WA', city: 'Spokane' }),
      activity({ country: 'US', state: 'CA', city: 'Los Angeles' }),
    ]

    assert.isTrue(
      meetsActivityRequirements(tournaments, [
        { count: 1, minEntrants: null, location: { state: 'WA' } },
      ])
    )
    assert.isFalse(
      meetsActivityRequirements(tournaments, [
        { count: 1, minEntrants: null, location: { state: 'OR' } },
      ])
    )
    // Both tournaments are in the US, so a count of 2 is satisfied.
    assert.isTrue(
      meetsActivityRequirements(tournaments, [
        { count: 2, minEntrants: null, location: { country: 'US' } },
      ])
    )
  })

  test('location matching is case- and whitespace-insensitive', ({ assert }) => {
    const tournaments = [activity({ country: 'US', state: 'WA', city: 'Spokane' })]

    assert.isTrue(
      meetsActivityRequirements(tournaments, [
        { count: 1, minEntrants: null, location: { city: ' spokane ' } },
      ])
    )
  })

  test('a tournament with no reported location never satisfies a location clause', ({ assert }) => {
    const unknown = [activity({ country: null, state: null, city: null })]

    assert.isFalse(
      meetsActivityRequirements(unknown, [
        { count: 1, minEntrants: null, location: { country: 'US' } },
      ])
    )
  })

  test('location omitted or null imposes no restriction', ({ assert }) => {
    const anywhere = [activity({ country: 'FR', state: null, city: 'Paris' })]

    assert.isTrue(
      meetsActivityRequirements(anywhere, [{ count: 1, minEntrants: null, location: null }])
    )
  })

  test('activity read back from a standing written before location tracking existed does not throw', ({
    assert,
  }) => {
    // `ranking_standings.tournament_activity` is a jsonb blob — a row written
    // before this feature shipped has no country/state/city key at all, so
    // these arrive as `undefined`, not the declared `null`.
    const preExisting = [
      { entrantCount: 8, setsPlayed: 2, timesDisqualified: 0 } as unknown as TournamentActivity,
    ]

    assert.doesNotThrow(() =>
      meetsActivityRequirements(preExisting, [
        { count: 1, minEntrants: null, location: { country: 'US' } },
      ])
    )
    assert.isFalse(
      meetsActivityRequirements(preExisting, [
        { count: 1, minEntrants: null, location: { country: 'US' } },
      ])
    )
  })
})

function player(overrides: Partial<PlayerLocation> = {}): PlayerLocation {
  return { country: null, state: null, city: null, ...overrides }
}

test.group('meetsResidencyRequirement', () => {
  test('an empty requirement list always passes, even for an unknown player', ({ assert }) => {
    assert.isTrue(meetsResidencyRequirement(player(), []))
  })

  test('a single region passes or fails on every field given', ({ assert }) => {
    const home = player({ country: 'US', state: 'WA', city: 'Spokane' })

    assert.isTrue(meetsResidencyRequirement(home, [{ state: 'WA' }]))
    assert.isFalse(meetsResidencyRequirement(home, [{ state: 'OR' }]))
  })

  test('a multi-field region requires every field in that entry to match', ({ assert }) => {
    const home = player({ country: 'US', state: 'WA', city: 'Spokane' })

    assert.isTrue(meetsResidencyRequirement(home, [{ country: 'US', state: 'WA' }]))
    assert.isFalse(meetsResidencyRequirement(home, [{ country: 'US', state: 'CA' }]))
  })

  test('multiple alternative regions: matching any one qualifies', ({ assert }) => {
    const home = player({ country: 'US', state: 'CA' })

    assert.isTrue(
      meetsResidencyRequirement(home, [{ state: 'WA' }, { state: 'CA' }, { state: 'OR' }])
    )
    assert.isFalse(meetsResidencyRequirement(home, [{ state: 'WA' }, { state: 'OR' }]))
  })

  test('matching is case- and whitespace-insensitive', ({ assert }) => {
    const home = player({ city: 'Spokane' })

    assert.isTrue(meetsResidencyRequirement(home, [{ city: ' spokane ' }]))
  })

  test('a player missing a field the matched requirement asks about never satisfies it', ({
    assert,
  }) => {
    const home = player({ country: 'US', state: null })

    assert.isFalse(meetsResidencyRequirement(home, [{ country: 'US', state: 'WA' }]))
  })
})
