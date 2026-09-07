import { RankingSchema } from '#database/schema'
import { compose } from '@adonisjs/core/helpers'
import { belongsTo, column, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import { withUuid } from '#models/mixins/with_uuid'
import League from '#models/league'
import RankingRecompute from '#models/ranking_recompute'
import type {
  ActivityRequirement,
  DqPolicy,
  LocationFilter,
} from '#lib/rankings/activity_requirements'

export default class Ranking extends compose(RankingSchema, withUuid) {
  /**
   * `pg` sends a bare JS array as a Postgres array literal rather than JSON,
   * which a jsonb column rejects — an explicit `prepare` is needed for any
   * jsonb column holding an array; plain-object jsonb columns don't need one.
   */
  @column({ prepare: (value: ActivityRequirement[]) => JSON.stringify(value) })
  declare activityRequirements: ActivityRequirement[]

  @column()
  declare dqPolicy: DqPolicy

  @column({ prepare: (value: LocationFilter[]) => JSON.stringify(value) })
  declare residencyRequirements: LocationFilter[]

  @belongsTo(() => League)
  declare league: BelongsTo<typeof League>

  @hasMany(() => RankingRecompute)
  declare recomputes: HasMany<typeof RankingRecompute>

  @belongsTo(() => RankingRecompute, { foreignKey: 'latestRecomputeId' })
  declare latestRecompute: BelongsTo<typeof RankingRecompute>

  /** Standings are behind the data and an admin has not yet asked for a recompute. */
  get isStale() {
    return this.recomputeRequestedAt !== null
  }

  get updatesAutomatically() {
    return this.recomputeMode === 'auto'
  }
}
