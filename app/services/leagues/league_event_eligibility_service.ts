import db from '@adonisjs/lucid/services/db'
import { entrantMatchesRegions, parseRegionFilter } from '#lib/geo/region_filter'
import { EntrantRegionService } from '#services/identity/entrant_region_service'

/**
 * Which of an event's entrants a league counts.
 */
export class LeagueEventEligibilityService {
  async eligibleEntrantIds(leagueId: string, eventId: string): Promise<Set<string>> {
    const counted = await db
      .from('league_events')
      .where('league_id', leagueId)
      .where('event_id', eventId)
      .select('region_filter')
      .first()

    if (!counted) return new Set()

    const regions = parseRegionFilter(counted.region_filter)

    const entrants: Array<{ id: string }> = await db
      .from('entrants')
      .where('event_id', eventId)
      .select('id')

    const entrantIds = entrants.map((entrant) => entrant.id)
    if (entrantIds.length === 0) return new Set()

    const regionsByEntrant = await new EntrantRegionService().regionsByEntrant(leagueId, entrantIds)

    return new Set(
      entrantIds.filter((entrantId) => {
        const participants = regionsByEntrant.get(entrantId) ?? []

        /** No league player behind it, so there is nobody for the league to count. */
        if (participants.length === 0) return false

        return entrantMatchesRegions(participants, regions)
      })
    )
  }
}
