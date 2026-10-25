import db from '@adonisjs/lucid/services/db'
import Ranking from '#models/ranking'
import LeaguePolicy from '#policies/league_policy'
import { HeadToHeadService } from '#services/h2h/head_to_head_service'
import { DefaultRankingService } from '#services/rankings/default_ranking_service'
import { DEFAULT_DQ_POLICY, meetsActivityRequirements } from '#lib/rankings/activity_requirements'
import type {
  ActivityRequirement,
  DqPolicy,
  TournamentActivity,
} from '#lib/rankings/activity_requirements'
import type { HttpContext } from '@adonisjs/core/http'

export default class HeadToHeadController {
  async index({ league, bouncer, request, inertia }: HttpContext) {
    const { players, matchups } = await new HeadToHeadService().forLeague(league.id)
    const ranking = await new DefaultRankingService().resolve(league.id, request.input('ranking'))
    const rankings = await Ranking.query().where('leagueId', league.id).orderBy('name')

    const standings = ranking?.latestRecomputeId
      ? await db
          .from('ranking_standings')
          .where('ranking_recompute_id', ranking.latestRecomputeId)
          .select('league_player_id', 'rank', 'value', 'tournament_activity')
      : []

    const byPlayer = new Map(standings.map((row) => [row.league_player_id, row]))
    const requirements = (ranking?.activityRequirements ?? []) as ActivityRequirement[]
    const dqPolicy = (ranking?.dqPolicy ?? DEFAULT_DQ_POLICY) as DqPolicy

    return inertia.render('leagues/h2h', {
      league: { slug: league.slug, name: league.name },
      canManage: await bouncer.with(LeaguePolicy).allows('manage', league),
      ranking: ranking ? { slug: ranking.slug, name: ranking.name } : null,
      rankings: rankings.map((r) => ({ slug: r.slug, name: r.name })),
      players: players
        .map((player) => {
          const standing = byPlayer.get(player.id)
          const tournamentActivity = (standing?.tournament_activity ?? []) as TournamentActivity[]

          return {
            id: player.id,
            slug: player.slug,
            displayTag: player.displayTag,
            city: player.city,
            state: player.state,
            country: player.country,
            rank: standing?.rank ?? null,
            rating: standing ? Math.round(Number(standing.value)) : null,
            inactive:
              requirements.length > 0 &&
              !meetsActivityRequirements(tournamentActivity, requirements, dqPolicy),
          }
        })
        /**
         * Ranked players first in rating order, then by name
         */
        .sort((a, b) => {
          if (a.rank !== null && b.rank !== null) return a.rank - b.rank
          if (a.rank !== null) return -1
          if (b.rank !== null) return 1
          return a.displayTag.localeCompare(b.displayTag)
        }),
      matchups,
    })
  }
}
