import vine from '@vinejs/vine'
import { ELIGIBILITY_OVERRIDE_KINDS } from '#lib/rankings/activity_requirements'

/**
 * League membership of `leaguePlayerId` is an authorisation check, not a
 * shape check — verified in the controller.
 */
export const addEligibilityOverrideValidator = vine.create({
  leaguePlayerId: vine.string().uuid(),
  kind: vine.enum(ELIGIBILITY_OVERRIDE_KINDS),
})
