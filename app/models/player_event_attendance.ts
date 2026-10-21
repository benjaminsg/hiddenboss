import { PlayerEventAttendanceSchema } from '#database/schema'
import { compose } from '@adonisjs/core/helpers'
import { belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { withUuid } from '#models/mixins/with_uuid'
import LeaguePlayer from '#models/league_player'
import Event from '#models/event'

/**
 * A manual, league-wide attendance correction
 */
export default class PlayerEventAttendance extends compose(PlayerEventAttendanceSchema, withUuid) {
  @belongsTo(() => LeaguePlayer)
  declare leaguePlayer: BelongsTo<typeof LeaguePlayer>

  @belongsTo(() => Event)
  declare event: BelongsTo<typeof Event>
}
