import { EventImportSchema } from '#database/schema'
import { compose } from '@adonisjs/core/helpers'
import { belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { withUuid } from '#models/mixins/with_uuid'
import League from '#models/league'
import Tournament from '#models/tournament'
import Event from '#models/event'
import type { LocationFilter } from '#lib/geo/region_filter'

/**
 * A progress and audit record for one import, not an orchestrator: the job
 * chain drives itself. It exists so an admin can see how far an import got and
 * which stage failed.
 */
export default class EventImport extends compose(EventImportSchema, withUuid) {
  @column({ prepare: (value: LocationFilter[]) => JSON.stringify(value) })
  declare regionFilter: LocationFilter[]

  @belongsTo(() => League)
  declare league: BelongsTo<typeof League>

  @belongsTo(() => Tournament)
  declare tournament: BelongsTo<typeof Tournament>

  /** The one event this import hydrated. */
  @belongsTo(() => Event)
  declare event: BelongsTo<typeof Event>

  get isFinished() {
    return ['ok', 'partial', 'failed', 'cancelled'].includes(this.status)
  }

  /**
   * Why a successful import will not move any ranking, or null when it will.
   *
   * An upcoming or abandoned bracket imports perfectly and contains nothing to
   * rate, which otherwise reads as a silent failure: the row says "ok" and the
   * standings never change. Derived rather than stored so it stays true if the
   * definition of a ratable set changes.
   *
   * Null for imports recorded before these counts existed, since absent stats
   * mean unknown rather than zero.
   */
  get emptyWarning(): string | null {
    if (this.status !== 'ok') return null

    const stats = (this.stats ?? {}) as { sets?: number; ratableSets?: number }
    if (typeof stats.ratableSets !== 'number') return null
    if (stats.ratableSets > 0) return null

    if (!stats.sets) {
      return 'This tournament has no sets, so it will not affect any ranking. Brackets that have not been played yet look like this.'
    }

    return `None of this tournament's ${stats.sets} sets are finished, so it will not affect any ranking yet. Re-import once results are in.`
  }
}
