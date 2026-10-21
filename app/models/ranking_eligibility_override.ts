import { RankingEligibilityOverrideSchema } from '#database/schema'
import { compose } from '@adonisjs/core/helpers'
import { belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { withUuid } from '#models/mixins/with_uuid'
import Ranking from '#models/ranking'
import LeaguePlayer from '#models/league_player'
import type { EligibilityOverrideKind } from '#lib/rankings/activity_requirements'

/**
 * A manual, per-ranking player eligibility override.
 */
export default class RankingEligibilityOverride extends compose(
  RankingEligibilityOverrideSchema,
  withUuid
) {
  @column()
  declare kind: EligibilityOverrideKind

  @belongsTo(() => Ranking)
  declare ranking: BelongsTo<typeof Ranking>

  @belongsTo(() => LeaguePlayer)
  declare leaguePlayer: BelongsTo<typeof LeaguePlayer>
}
