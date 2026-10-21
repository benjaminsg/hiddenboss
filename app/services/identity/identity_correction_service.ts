import db from '@adonisjs/lucid/services/db'
import IdentityEvent from '#models/identity_event'
import League from '#models/league'
import LeaguePlayer from '#models/league_player'
import LeaguePlayerAccount from '#models/league_player_account'
import { PlayerSlugService } from '#services/identity/player_slug_service'
import { StalenessService } from '#services/rankings/staleness_service'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'

/**
 * Where an account should end up: an existing player, or one made for it.
 *
 * Splitting needs the second. When automatic resolution has put two people under
 * one player there is, by definition, no existing row to reassign to, so without
 * this the mistake that actually loses information is the one an admin cannot
 * fix.
 */
export type ReassignTarget = { existingPlayerId: string } | { newPlayerTag: string }

export interface ReassignRequest {
  leagueId: string
  /** The account being moved. It belongs to at most one player per league. */
  platformAccountId: string
  target: ReassignTarget
  actorUserId: string | null
}

export interface ReassignResult {
  from: string
  to: string
  /** Set when the account was the last one holding its old player together. */
  tombstoned: string | null
  /** Set when the account was split out into a player made for it. */
  created: string | null
}

/**
 * Admin corrections to identity mapping.
 *
 * Automatic resolution errs towards splitting: two rows for one person is a
 * merge away from correct, whereas one row for two people has already lost
 * information. This is the other half of that bargain — the way an admin puts
 * the halves back together.
 *
 * Every correction is reversible. Accounts move rather than being deleted, an
 * emptied player is tombstoned instead of dropped, and each change appends to
 * `identity_events`.
 */
export class IdentityCorrectionService {
  async reassign(request: ReassignRequest): Promise<ReassignResult> {
    const { leagueId, platformAccountId, target: wanted, actorUserId } = request

    const mapping = await LeaguePlayerAccount.query()
      .where('leagueId', leagueId)
      .where('platformAccountId', platformAccountId)
      .firstOrFail()

    if ('existingPlayerId' in wanted && mapping.leaguePlayerId === wanted.existingPlayerId) {
      return {
        from: wanted.existingPlayerId,
        to: wanted.existingPlayerId,
        tombstoned: null,
        created: null,
      }
    }

    const previousPlayerId = mapping.leaguePlayerId

    const result = await db.transaction(async (trx) => {
      /**
       * Inside the transaction, so a reassignment that fails afterwards cannot
       * leave a player nothing points at.
       */
      const target = await this.resolveTarget(trx, leagueId, wanted)
      const created = 'newPlayerTag' in wanted ? target.id : null

      mapping.useTransaction(trx)
      mapping.leaguePlayerId = target.id
      /** Manual beats anything automatic, so re-resolution cannot undo it. */
      mapping.source = 'manual'
      mapping.provisional = false
      mapping.confidence = '1'
      mapping.confirmedByUserId = actorUserId
      await mapping.save()

      /**
       * A player with no accounts left is not a person any more, but the row
       * stays as a tombstone so the merge can be undone and so its URLs keep
       * resolving to whoever absorbed it.
       */
      const remaining = await LeaguePlayerAccount.query({ client: trx })
        .where('leagueId', leagueId)
        .where('leaguePlayerId', previousPlayerId)
        .count('* as total')

      const orphaned = Number(remaining[0].$extras.total) === 0

      if (orphaned) {
        await LeaguePlayer.query({ client: trx })
          .where('id', previousPlayerId)
          .update({ merged_into_id: target.id })
      }

      await IdentityEvent.create(
        {
          leagueId,
          actorUserId,
          /** Splitting one player into two is the opposite of a merge, not a link. */
          kind: created ? 'split' : orphaned ? 'merge' : 'link',
          payload: {
            platformAccountId,
            fromLeaguePlayerId: previousPlayerId,
            toLeaguePlayerId: target.id,
            tombstoned: orphaned,
            createdLeaguePlayerId: created,
          },
        },
        { client: trx }
      )

      /**
       * Every standing was built on the old mapping, so the version moves and
       * recomputes know their saved state is stale.
       */
      await League.query({ client: trx }).where('id', leagueId).increment('identity_version', 1)

      return {
        from: previousPlayerId,
        to: target.id,
        tombstoned: orphaned ? previousPlayerId : null,
        created,
      }
    })

    /** Outside the transaction: marking stale is independent of the correction. */
    await new StalenessService().markLeagueStale(leagueId)

    return result
  }

  /**
   * The player the account is moving to, creating one if that is what was asked
   * for. Scoped to the league on the way in, so an id belonging to another
   * league fails to resolve rather than reaching across.
   */
  private async resolveTarget(
    trx: TransactionClientContract,
    leagueId: string,
    wanted: ReassignTarget
  ): Promise<LeaguePlayer> {
    if ('existingPlayerId' in wanted) {
      return LeaguePlayer.query({ client: trx })
        .where('id', wanted.existingPlayerId)
        .where('leagueId', leagueId)
        .firstOrFail()
    }

    return LeaguePlayer.create(
      {
        leagueId,
        slug: await new PlayerSlugService().unique(trx, leagueId, wanted.newPlayerTag),
        displayTag: wanted.newPlayerTag,
        /**
         * No global player. The global tier takes confirmed evidence only, and an
         * admin splitting a league player has not asserted anything about who
         * this is instance-wide.
         */
        globalPlayerId: null,
      },
      { client: trx }
    )
  }
}
