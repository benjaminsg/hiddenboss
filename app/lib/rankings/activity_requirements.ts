/**
 * Whether a league player counts as active enough for a ranking's standings
 * page — evaluated at read time against the tournaments a standing already
 * counted, never against a recompute.
 */

import { matchesAnyRegion, matchesLocation } from '#lib/geo/region_filter'
import type { LocationFilter } from '#lib/geo/region_filter'

export type { LocationFilter } from '#lib/geo/region_filter'

/**
 * One clause: at least `count` qualifying tournaments. `minEntrants: null`
 * means any tournament qualifies, including one whose entrant count the
 * platform never reported. A specific `minEntrants` excludes those unknowns,
 * since there is no evidence they clear the bar. `location` restricts to a
 * country/state/city combination; omitted or `null` means anywhere.
 */
export interface ActivityRequirement {
  count: number
  minEntrants: number | null
  location?: LocationFilter | null
}

/**
 * How a ranking treats a tournament where a player was disqualified, for the
 * purpose of activity requirements:
 *
 * - `exclude_no_shows`: a DQ with no sets actually played does not count —
 *   the default, since a player removed before playing a single set was
 *   never really in attendance.
 * - `exclude_double_dq`: a tournament where the player was disqualified more
 *   than once does not count. A single DQ still counts, even with nothing
 *   played.
 * - `exclude_any_dq`: any disqualification anywhere in the tournament drops
 *   it, regardless of what else the player played.
 */
export type DqPolicy = 'exclude_no_shows' | 'exclude_double_dq' | 'exclude_any_dq'

export const DQ_POLICIES: DqPolicy[] = ['exclude_no_shows', 'exclude_double_dq', 'exclude_any_dq']

export const DEFAULT_DQ_POLICY: DqPolicy = 'exclude_no_shows'

/**
 * One tournament's contribution to a player's activity: its entrant count
 * and location, for `minEntrants`/`location` clauses, plus enough of the
 * player's own set history — sets genuinely played versus times
 * disqualified — to apply a DQ policy without needing to know which sets
 * those were.
 */
export interface TournamentActivity {
  entrantCount: number | null
  setsPlayed: number
  timesDisqualified: number
  country: string | null
  state: string | null
  city: string | null
}

function qualifiesUnderDqPolicy(activity: TournamentActivity, dqPolicy: DqPolicy): boolean {
  switch (dqPolicy) {
    case 'exclude_no_shows':
      return activity.timesDisqualified === 0 || activity.setsPlayed > 0
    case 'exclude_double_dq':
      return activity.timesDisqualified < 2
    case 'exclude_any_dq':
      return activity.timesDisqualified === 0
  }
}

/** A league player's own home location. */
export interface PlayerLocation {
  country?: string | null
  state?: string | null
  city?: string | null
}

export function meetsResidencyRequirement(
  player: PlayerLocation,
  requirements: LocationFilter[]
): boolean {
  return matchesAnyRegion(player, requirements)
}

export type EligibilityOverrideKind = 'exempt' | 'exclude'

export const ELIGIBILITY_OVERRIDE_KINDS: EligibilityOverrideKind[] = ['exempt', 'exclude']

function qualifyingCount(
  tournamentActivity: TournamentActivity[],
  requirement: ActivityRequirement,
  dqPolicy: DqPolicy
): number {
  return tournamentActivity
    .filter((activity) => qualifiesUnderDqPolicy(activity, dqPolicy))
    .filter(
      (activity) =>
        requirement.minEntrants === null ||
        requirement.minEntrants <= 0 ||
        (activity.entrantCount !== null && activity.entrantCount >= requirement.minEntrants)
    )
    .filter((activity) => matchesLocation(activity, requirement.location ?? null)).length
}

/** All clauses must hold — an empty list of requirements means everyone qualifies. */
export function meetsActivityRequirements(
  tournamentActivity: TournamentActivity[],
  requirements: ActivityRequirement[],
  dqPolicy: DqPolicy = DEFAULT_DQ_POLICY
): boolean {
  return requirements.every(
    (requirement) => qualifyingCount(tournamentActivity, requirement, dqPolicy) >= requirement.count
  )
}
