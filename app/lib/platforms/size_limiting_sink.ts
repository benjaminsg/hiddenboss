import { PermanentPlatformError } from './errors.js'
import type { ImportSink } from './contracts.js'
import type {
  CanonicalBracket,
  CanonicalEntrant,
  CanonicalEvent,
  CanonicalPhase,
  CanonicalTournament,
} from './canonical.js'

export interface SizeLimits {
  maxBrackets: number
  maxEntrants: number
}

/** The instance-wide safety cap on how large an import is allowed to be. For context, the largest
 * ever FGC event, SF6 at EVO Japan 2026, had 7683 entrants and 692 brackets. */
export const DEFAULT_SIZE_LIMITS: SizeLimits = {
  maxBrackets: 800,
  maxEntrants: 8000,
}

/**
 * Rejects an event too large to import.
 */
export class SizeLimitingSink implements ImportSink {
  private readonly key: string
  private readonly limits: SizeLimits
  private readonly delegate: ImportSink
  private entrantsSeen = 0
  private bracketsSeen = 0

  constructor(key: string, limits: SizeLimits, delegate: ImportSink) {
    this.key = key
    this.limits = limits
    this.delegate = delegate
  }

  async tournament(tournament: CanonicalTournament): Promise<void> {
    return this.delegate.tournament(tournament)
  }

  async event(event: CanonicalEvent): Promise<void> {
    if (event.entrantCount !== null) {
      this.checkEntrants(event.entrantCount)
    }
    return this.delegate.event(event)
  }

  async phase(eventExternalId: string, phase: CanonicalPhase): Promise<void> {
    return this.delegate.phase(eventExternalId, phase)
  }

  async entrants(eventExternalId: string, entrants: CanonicalEntrant[]): Promise<void> {
    this.entrantsSeen += entrants.length
    this.checkEntrants(this.entrantsSeen)
    return this.delegate.entrants(eventExternalId, entrants)
  }

  async bracket(
    eventExternalId: string,
    phaseExternalId: string,
    bracket: CanonicalBracket
  ): Promise<void> {
    this.bracketsSeen += 1
    this.checkBrackets(this.bracketsSeen)
    return this.delegate.bracket(eventExternalId, phaseExternalId, bracket)
  }

  async progress(completed: number, total: number | null, label?: string): Promise<void> {
    if (total !== null) {
      this.checkBrackets(total)
    }
    return this.delegate.progress(completed, total, label)
  }

  private checkEntrants(count: number): void {
    if (count <= this.limits.maxEntrants) return

    throw new PermanentPlatformError(
      `This event has ${count} entrants, over the ${this.limits.maxEntrants} this instance will import at once.`,
      { platform: this.key }
    )
  }

  private checkBrackets(count: number): void {
    if (count <= this.limits.maxBrackets) return

    throw new PermanentPlatformError(
      `This event has ${count} brackets, over the ${this.limits.maxBrackets} this instance will import at once.`,
      { platform: this.key }
    )
  }
}
