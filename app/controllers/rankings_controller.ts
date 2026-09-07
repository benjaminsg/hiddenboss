import Ranking from '#models/ranking'
import RankingRecompute from '#models/ranking_recompute'
import RankingStanding from '#models/ranking_standing'
import RankingEligibilityOverride from '#models/ranking_eligibility_override'
import LeaguePlayer from '#models/league_player'
import RecomputeRankingJob from '#jobs/recompute_ranking_job'
import LeaguePolicy from '#policies/league_policy'
import { StalenessService } from '#services/rankings/staleness_service'
import { createRankingValidator, updateRankingValidator } from '#validators/ranking'
import { addEligibilityOverrideValidator } from '#validators/ranking_eligibility_override'
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
import type { HttpContext } from '@adonisjs/core/http'

/** A stored requirement, read back with `location` normalised to an explicit `null` for the page props — never `undefined`, even for a clause saved before this field existed. */
type NormalisedActivityRequirement = {
  count: number
  minEntrants: number | null
  location: LocationFilter | null
}

function activityRequirementsOf(ranking: Ranking): NormalisedActivityRequirement[] {
  const requirements = (ranking.activityRequirements ?? []) as ActivityRequirement[]
  return requirements.map((requirement) => ({
    count: requirement.count,
    minEntrants: requirement.minEntrants,
    location: requirement.location ?? null,
  }))
}

/** Collapses an all-empty location row to `null`. */
function normaliseLocation(
  location: { country?: string; state?: string; city?: string } | undefined
): LocationFilter | null {
  if (!location) return null

  const country = location.country?.trim() || undefined
  const state = location.state?.trim() || undefined
  const city = location.city?.trim() || undefined

  if (!country && !state && !city) return null

  return { country, state, city }
}

function hasLocationRequirement(requirements: ActivityRequirement[]): boolean {
  return requirements.some(
    (requirement) => requirement.location !== null && requirement.location !== undefined
  )
}

function normaliseActivityRequirements(
  requirements:
    | Array<{
        count: number
        minEntrants?: number
        location?: { country?: string; state?: string; city?: string }
      }>
    | undefined
): ActivityRequirement[] {
  return (requirements ?? []).map((requirement) => ({
    count: requirement.count,
    minEntrants: requirement.minEntrants ?? null,
    location: normaliseLocation(requirement.location),
  }))
}

function normaliseResidencyRequirements(
  requirements: Array<{ country?: string; state?: string; city?: string }> | undefined
): LocationFilter[] {
  return (requirements ?? [])
    .map((requirement) => normaliseLocation(requirement))
    .filter((requirement): requirement is LocationFilter => requirement !== null)
}

export default class RankingsController {
  /** Every ranking in the league, public. */
  async index({ league, bouncer, inertia }: HttpContext) {
    const rankings = await Ranking.query().where('leagueId', league.id).orderBy('name')

    return inertia.render('leagues/rankings', {
      league: { slug: league.slug, name: league.name },
      canManage: await bouncer.with(LeaguePolicy).allows('manage', league),
      rankings: rankings.map((ranking) => ({
        slug: ranking.slug,
        name: ranking.name,
        algorithm: ranking.algorithm,
        published: ranking.published,
        isStale: ranking.recomputeRequestedAt !== null,
        staleCount: ranking.staleTournamentCount,
        hasRecompute: ranking.latestRecomputeId !== null,
      })),
    })
  }

  /**
   * A ranking's standings.
   */
  async show({ league, params, bouncer, response, inertia }: HttpContext) {
    const ranking = await Ranking.query()
      .where('leagueId', league.id)
      .where('slug', params.ranking)
      .first()

    if (!ranking) {
      response.status(404)
      return inertia.render('leagues/ranking_not_found', {
        league: { slug: league.slug, name: league.name },
        canManage: await bouncer.with(LeaguePolicy).allows('manage', league),
        slug: params.ranking,
      })
    }

    const standings = ranking.latestRecomputeId
      ? await RankingStanding.query()
          .where('rankingRecomputeId', ranking.latestRecomputeId)
          .preload('leaguePlayer')
          .orderBy('rank')
      : []

    const requirements = activityRequirementsOf(ranking)
    const dqPolicy = (ranking.dqPolicy ?? DEFAULT_DQ_POLICY) as DqPolicy
    const residencyRequirements = (ranking.residencyRequirements ?? []) as LocationFilter[]

    const overrideRows = await RankingEligibilityOverride.query().where('rankingId', ranking.id)
    const overrides = new Map(
      overrideRows.map((override) => [override.leaguePlayerId, override.kind])
    )

    /**
     * `inactive` — too few counted tournaments.
     * `ineligible` — wrong home region, or manual exclusion.
     */
    const failsActivity = (standing: RankingStanding) =>
      requirements.length > 0 &&
      !meetsActivityRequirements(standing.tournamentActivity ?? [], requirements, dqPolicy)

    const failsResidency = (standing: RankingStanding) =>
      residencyRequirements.length > 0 &&
      !meetsResidencyRequirement(standing.leaguePlayer, residencyRequirements)

    const overrideOf = (standing: RankingStanding) => overrides.get(standing.leaguePlayerId) ?? null

    const inactive = (standing: RankingStanding) =>
      overrideOf(standing) !== 'exempt' && failsActivity(standing)

    const ineligible = (standing: RankingStanding) => {
      const override = overrideOf(standing)
      if (override === 'exempt') return false
      if (override === 'exclude') return true
      return failsResidency(standing)
    }

    return inertia.render('leagues/ranking', {
      league: { slug: league.slug, name: league.name },
      canManage: await bouncer.with(LeaguePolicy).allows('manage', league),
      ranking: {
        slug: ranking.slug,
        name: ranking.name,
        algorithm: ranking.algorithm,
        isStale: ranking.recomputeRequestedAt !== null,
        staleCount: ranking.staleTournamentCount,
        hasRecompute: ranking.latestRecomputeId !== null,
        startsAt: ranking.startsAt?.toISODate() ?? null,
        endsAt: ranking.endsAt?.toISODate() ?? null,
        activityRequirements: requirements,
        dqPolicy,
        residencyRequirements,
        /**
         * A worker is replaying this ranking right now.
         */
        isRecomputing:
          (await RankingRecompute.query()
            .where('rankingId', ranking.id)
            .where('status', 'running')
            .first()) !== null,
      },
      standings: standings.map((standing) => ({
        rank: standing.rank,
        previousRank: standing.previousRank,
        player: standing.leaguePlayer.displayTag,
        playerSlug: standing.leaguePlayer.slug,
        city: standing.leaguePlayer.city,
        state: standing.leaguePlayer.state,
        country: standing.leaguePlayer.country,
        // Postgres returns numeric as a string; ratings are whole numbers here.
        rating: Math.round(Number(standing.value)),
        wins: standing.wins,
        losses: standing.losses,
        setsPlayed: standing.setsPlayed,
        eventsCounted: standing.eventsCounted,
        inactive: inactive(standing),
        ineligible: ineligible(standing),
        eligibilityOverride: overrideOf(standing),
      })),
    })
  }

  async create({ league, inertia }: HttpContext) {
    return inertia.render('leagues/ranking_create', {
      league: { slug: league.slug, name: league.name },
    })
  }

  async store({ league, request, response }: HttpContext) {
    const payload = await request.validateUsing(createRankingValidator)

    const ranking = await Ranking.create({
      leagueId: league.id,
      name: payload.name,
      slug: payload.slug,
      algorithm: payload.algorithm,
      recomputeMode: payload.recomputeMode ?? 'manual',
      startsAt: payload.startsAt ?? null,
      endsAt: payload.endsAt ?? null,
      activityRequirements: normaliseActivityRequirements(payload.activityRequirements),
      dqPolicy: payload.dqPolicy ?? DEFAULT_DQ_POLICY,
      residencyRequirements: normaliseResidencyRequirements(payload.residencyRequirements),
      published: true,
    })

    // Queue the first build so a new ranking is not permanently empty.
    await new StalenessService().request(ranking.id)
    await RecomputeRankingJob.dispatch({ rankingId: ranking.id })

    return response
      .redirect()
      .toRoute('rankings.show', { league: league.slug, ranking: ranking.slug })
  }

  async edit({ league, params, bouncer, response, inertia }: HttpContext) {
    const ranking = await Ranking.query()
      .where('leagueId', league.id)
      .where('slug', params.ranking)
      .first()

    if (!ranking) {
      response.status(404)
      return inertia.render('leagues/ranking_not_found', {
        league: { slug: league.slug, name: league.name },
        canManage: await bouncer.with(LeaguePolicy).allows('manage', league),
        slug: params.ranking,
      })
    }

    const [overrides, leaguePlayers] = await Promise.all([
      RankingEligibilityOverride.query()
        .where('rankingId', ranking.id)
        .preload('leaguePlayer')
        .orderBy('createdAt'),
      LeaguePlayer.query()
        .where('leagueId', league.id)
        .whereNull('mergedIntoId')
        .select('id', 'displayTag')
        .orderBy('displayTag'),
    ])

    return inertia.render('leagues/ranking_edit', {
      league: { slug: league.slug, name: league.name },
      ranking: {
        slug: ranking.slug,
        name: ranking.name,
        startsAt: ranking.startsAt?.toISODate() ?? null,
        endsAt: ranking.endsAt?.toISODate() ?? null,
        activityRequirements: activityRequirementsOf(ranking),
        dqPolicy: (ranking.dqPolicy ?? DEFAULT_DQ_POLICY) as DqPolicy,
        residencyRequirements: (ranking.residencyRequirements ?? []) as LocationFilter[],
      },
      eligibilityOverrides: overrides.map((override) => ({
        id: override.id,
        player: override.leaguePlayer.displayTag,
        kind: override.kind,
      })),
      players: leaguePlayers.map((player) => ({ id: player.id, displayTag: player.displayTag })),
    })
  }

  async update({ league, params, request, response, session }: HttpContext) {
    const ranking = await Ranking.query()
      .where('leagueId', league.id)
      .where('slug', params.ranking)
      .firstOrFail()

    const payload = await request.validateUsing(updateRankingValidator)

    const dateRangeChanged =
      (payload.startsAt?.toISODate() ?? null) !== (ranking.startsAt?.toISODate() ?? null) ||
      (payload.endsAt?.toISODate() ?? null) !== (ranking.endsAt?.toISODate() ?? null)

    const newActivityRequirements = normaliseActivityRequirements(payload.activityRequirements)

    /**
     * `force`d because the fingerprint skip-check doesn't cover
     * `activityRequirements`, so a location clause alone would otherwise be
     * skipped.
     */
    const needsLocationBackfill = hasLocationRequirement(newActivityRequirements)
    const needsRecompute = dateRangeChanged || needsLocationBackfill

    ranking.merge({
      startsAt: payload.startsAt ?? null,
      endsAt: payload.endsAt ?? null,
      activityRequirements: newActivityRequirements,
      dqPolicy: payload.dqPolicy ?? DEFAULT_DQ_POLICY,
      residencyRequirements: normaliseResidencyRequirements(payload.residencyRequirements),
    })
    await ranking.save()

    /**
     * The date range bounds which sets are selected for rating, so a change
     * needs replaying.
     */
    if (needsRecompute) {
      await new StalenessService().request(ranking.id)
      await RecomputeRankingJob.dispatch({ rankingId: ranking.id, force: needsLocationBackfill })
    }

    session.flash('success', `Updated ${ranking.name}`)

    return response
      .redirect()
      .toRoute('rankings.show', { league: league.slug, ranking: ranking.slug })
  }

  async recompute({ league, params, response, session }: HttpContext) {
    const ranking = await Ranking.query()
      .where('leagueId', league.id)
      .where('slug', params.ranking)
      .firstOrFail()

    await new StalenessService().request(ranking.id)
    /** Force so fingerprint check isn't silently skipped. */
    await RecomputeRankingJob.dispatch({ rankingId: ranking.id, force: true })

    session.flash('success', `Updating ${ranking.name}`)

    return response
      .redirect()
      .toRoute('rankings.show', { league: league.slug, ranking: ranking.slug })
  }

  async addEligibilityOverride({ league, params, request, response, session }: HttpContext) {
    const ranking = await Ranking.query()
      .where('leagueId', league.id)
      .where('slug', params.ranking)
      .firstOrFail()

    const payload = await request.validateUsing(addEligibilityOverrideValidator)

    const player = await LeaguePlayer.query()
      .where('id', payload.leaguePlayerId)
      .where('leagueId', league.id)
      .first()

    if (!player) {
      return response.notFound({ message: 'No such player' })
    }

    const existing = await RankingEligibilityOverride.query()
      .where('rankingId', ranking.id)
      .where('leaguePlayerId', player.id)
      .first()

    if (existing) {
      session.flash('error', `${player.displayTag} already has an eligibility override.`)
      return response.redirect().back()
    }

    await RankingEligibilityOverride.create({
      rankingId: ranking.id,
      leaguePlayerId: player.id,
      kind: payload.kind,
    })

    session.flash(
      'success',
      payload.kind === 'exempt'
        ? `Exempted ${player.displayTag}.`
        : `Excluded ${player.displayTag}.`
    )

    return response.redirect().back()
  }

  async removeEligibilityOverride({ league, params, response, session }: HttpContext) {
    const ranking = await Ranking.query()
      .where('leagueId', league.id)
      .where('slug', params.ranking)
      .firstOrFail()

    const override = await RankingEligibilityOverride.query()
      .where('id', params.override)
      .where('rankingId', ranking.id)
      .first()

    if (!override) {
      return response.notFound({ message: 'No such override' })
    }

    await override.delete()
    session.flash('success', 'Override removed.')

    return response.redirect().back()
  }
}
