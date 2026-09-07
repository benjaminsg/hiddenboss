import { entrantMatchesRegions } from '#lib/geo/region_filter'
import type { LocationFilter } from '#lib/geo/region_filter'
import type { ImportSink } from './contracts.js'
import type {
  CanonicalBracket,
  CanonicalEntrant,
  CanonicalEvent,
  CanonicalPhase,
  CanonicalSet,
  CanonicalTournament,
} from './canonical.js'

/**
 * Filters a stream down to only the entrants from the given regions, and the sets played entirely
 * between them.
 */
export class RegionFilteringSink implements ImportSink {
  private readonly regions: LocationFilter[]
  private readonly delegate: ImportSink
  private readonly qualifiesByEntrant = new Map<string, boolean>()
  private excludedSets = 0
  private excludedEntrants = 0

  constructor(regions: LocationFilter[], delegate: ImportSink) {
    this.regions = regions
    this.delegate = delegate
  }

  get excludedSetCount(): number {
    return this.excludedSets
  }

  get excludedEntrantCount(): number {
    return this.excludedEntrants
  }

  async tournament(tournament: CanonicalTournament): Promise<void> {
    return this.delegate.tournament(tournament)
  }

  async event(event: CanonicalEvent): Promise<void> {
    return this.delegate.event(event)
  }

  async phase(eventExternalId: string, phase: CanonicalPhase): Promise<void> {
    return this.delegate.phase(eventExternalId, phase)
  }

  async progress(completed: number, total: number | null, label?: string): Promise<void> {
    return this.delegate.progress(completed, total, label)
  }

  async entrants(eventExternalId: string, entrants: CanonicalEntrant[]): Promise<void> {
    const qualifying: CanonicalEntrant[] = []

    for (const entrant of entrants) {
      const qualifies = this.entrantQualifies(entrant)
      this.qualifiesByEntrant.set(entrant.externalId, qualifies)
      if (qualifies) qualifying.push(entrant)
    }

    this.excludedEntrants += entrants.length - qualifying.length

    return this.delegate.entrants(eventExternalId, qualifying)
  }

  async bracket(
    eventExternalId: string,
    phaseExternalId: string,
    bracket: CanonicalBracket
  ): Promise<void> {
    const sets = bracket.sets.filter((set) => this.setQualifies(set))
    this.excludedSets += bracket.sets.length - sets.length

    return this.delegate.bracket(eventExternalId, phaseExternalId, { ...bracket, sets })
  }

  private entrantQualifies(entrant: CanonicalEntrant): boolean {
    return entrantMatchesRegions(entrant.participants, this.regions)
  }

  private setQualifies(set: CanonicalSet): boolean {
    const ids = [set.entrantAExternalId, set.entrantBExternalId]
    return ids.every((id) => id !== null && this.qualifiesByEntrant.get(id) === true)
  }
}
