import Ranking from '#models/ranking'

/**
 * The ranking a league-scoped page reads against when nothing names one explicitly.
 */
export class DefaultRankingService {
  async resolve(leagueId: string, slug?: string | null): Promise<Ranking | null> {
    if (typeof slug === 'string' && slug.length > 0) {
      const named = await Ranking.query().where('leagueId', leagueId).where('slug', slug).first()
      if (named) return named
    }

    return Ranking.query()
      .where('leagueId', leagueId)
      .whereNotNull('latestRecomputeId')
      .orderBy('published', 'desc')
      .orderBy('name')
      .first()
  }
}
