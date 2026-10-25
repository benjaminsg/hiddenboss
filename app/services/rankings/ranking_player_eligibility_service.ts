import LeaguePlayer from '#models/league_player'
import type Ranking from '#models/ranking'
import RankingStanding from '#models/ranking_standing'
import RankingEligibilityOverride from '#models/ranking_eligibility_override'
import {
  DEFAULT_DQ_POLICY,
  meetsActivityRequirements,
  meetsResidencyRequirement,
} from '#lib/rankings/activity_requirements'
import type {
  ActivityRequirement,
  DqPolicy,
  LocationFilter,
} from '#lib/rankings/activity_requirements'

/**
 * Which of a set of league players a ranking currently counts as eligible.
 */
export class RankingPlayerEligibilityService {
  async eligiblePlayerIds(ranking: Ranking, leaguePlayerIds: string[]): Promise<Set<string>> {
    if (leaguePlayerIds.length === 0) return new Set()

    const requirements = (ranking.activityRequirements ?? []) as ActivityRequirement[]
    const dqPolicy = (ranking.dqPolicy ?? DEFAULT_DQ_POLICY) as DqPolicy
    const residencyRequirements = (ranking.residencyRequirements ?? []) as LocationFilter[]

    const players = await LeaguePlayer.query().whereIn('id', leaguePlayerIds)

    const standings = ranking.latestRecomputeId
      ? await RankingStanding.query()
          .where('rankingRecomputeId', ranking.latestRecomputeId)
          .whereIn('leaguePlayerId', leaguePlayerIds)
      : []
    const activityByPlayer = new Map(
      standings.map((standing) => [standing.leaguePlayerId, standing.tournamentActivity])
    )

    const overrideRows = await RankingEligibilityOverride.query()
      .where('rankingId', ranking.id)
      .whereIn('leaguePlayerId', leaguePlayerIds)
    const overrides = new Map(
      overrideRows.map((override) => [override.leaguePlayerId, override.kind])
    )

    const eligible = players.filter((player) => {
      const override = overrides.get(player.id) ?? null
      if (override === 'exclude') return false
      if (override === 'exempt') return true

      const activity = activityByPlayer.get(player.id) ?? []
      const active =
        requirements.length === 0 || meetsActivityRequirements(activity, requirements, dqPolicy)
      const resident =
        residencyRequirements.length === 0 ||
        meetsResidencyRequirement(player, residencyRequirements)

      return active && resident
    })

    return new Set(eligible.map((player) => player.id))
  }
}
