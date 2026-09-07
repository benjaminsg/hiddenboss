import db from '@adonisjs/lucid/services/db'
import League from '#models/league'
import LeaguePlayer from '#models/league_player'
import LeaguePlayerAccount from '#models/league_player_account'
import PlatformAccount from '#models/platform_account'
import { PlayerSlugService } from '#services/identity/player_slug_service'
import { LeaguePlayerReconcilerService } from '#services/identity/league_player_reconciler_service'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'

export interface ResolveRequest {
  leagueId: string
  eventId: string
}

export interface ResolveResult {
  mapped: number
  created: number
  reused: number
}

/** How a mapping was arrived at, kept so the review queue can rank them later. */
type MatchSource = 'auto' | 'manual' | 'global'

interface Match {
  leaguePlayerId: string
  confidence: number
  source: MatchSource
  provisional: boolean
}

/**
 * Maps the platform accounts in a tournament to this league's players, in
 * descending order of certainty:
 *
 *  1. already mapped in this league
 *  2. the account's global player already has a league player here
 *  3. no stable id, but the normalized tag matches an existing player exactly
 *
 * An unmatched account becomes its own league player. Two rows for one person
 * is a merge away from correct; one row for two people has already lost
 * information.
 */
export class IdentityResolverService {
  async run({ leagueId, eventId }: ResolveRequest): Promise<ResolveResult> {
    const accounts = await this.accountsIn(eventId)
    const result: ResolveResult = { mapped: 0, created: 0, reused: 0 }

    if (accounts.length > 0) {
      await this.resolve(leagueId, accounts, result)
    }

    /**
     * A re-import under a tighter region filter writes the new region's
     * entrants without removing the old ones, so the previous region's
     * players have to be pruned after resolution rather than during it.
     */
    await new LeaguePlayerReconcilerService().pruneUnbackedPlayers({ leagueId, actorUserId: null })

    return result
  }

  private async resolve(
    leagueId: string,
    accounts: PlatformAccount[],
    result: ResolveResult
  ): Promise<void> {
    await db.transaction(async (trx) => {
      for (const account of accounts) {
        const existing = await LeaguePlayerAccount.query({ client: trx })
          .where('leagueId', leagueId)
          .where('platformAccountId', account.id)
          .first()

        if (existing) {
          result.reused += 1
          continue
        }

        const match =
          (await this.viaGlobalPlayer(trx, leagueId, account)) ??
          (await this.viaExactTag(trx, leagueId, account))

        if (match) {
          await this.link(trx, leagueId, account, match)
          result.mapped += 1
          continue
        }

        const player = await this.createPlayer(trx, leagueId, account)
        await this.link(trx, leagueId, account, {
          leaguePlayerId: player.id,
          confidence: 1,
          source: 'auto',
          provisional: false,
        })
        result.created += 1
      }

      /**
       * Any change to the mapping invalidates every standing built on it, so
       * the version counter moves and recomputes know their saved state is stale.
       */
      if (result.mapped > 0 || result.created > 0) {
        await League.query({ client: trx }).where('id', leagueId).increment('identity_version', 1)
      }
    })
  }

  /**
   * Every platform account that competed in this event.
   *
   * Scoped to the event rather than its tournament, so a league that imports the
   * singles bracket does not acquire the doubles field as league players.
   */
  private async accountsIn(eventId: string): Promise<PlatformAccount[]> {
    return PlatformAccount.query()
      .whereIn(
        'id',
        db
          .from('entrant_participants')
          .select('entrant_participants.platform_account_id')
          .innerJoin('entrants', 'entrants.id', 'entrant_participants.entrant_id')
          .where('entrants.event_id', eventId)
      )
      .orderBy('gamerTag')
  }

  /**
   * A confirmed cross-platform link is the strongest signal available, because
   * a platform asserted it rather than us inferring it.
   */
  private async viaGlobalPlayer(
    trx: TransactionClientContract,
    leagueId: string,
    account: PlatformAccount
  ): Promise<Match | null> {
    if (!account.globalPlayerId) return null

    const player = await LeaguePlayer.query({ client: trx })
      .where('leagueId', leagueId)
      .where('globalPlayerId', account.globalPlayerId)
      .whereNull('mergedIntoId')
      .first()

    return player
      ? { leaguePlayerId: player.id, confidence: 0.95, source: 'global', provisional: false }
      : null
  }

  /**
   * Only for accounts with no stable identity of their own.
   *
   * An account that *does* carry a platform user id is deliberately not matched
   * by tag: two different people can share a gamertag, and where the platform
   * has already told us they are different accounts, believing the tag over the
   * platform would be a step backwards.
   */
  private async viaExactTag(
    trx: TransactionClientContract,
    leagueId: string,
    account: PlatformAccount
  ): Promise<Match | null> {
    if (!account.weakIdentity) return null

    const row = await trx
      .from('league_player_accounts')
      .innerJoin(
        'platform_accounts',
        'platform_accounts.id',
        'league_player_accounts.platform_account_id'
      )
      .innerJoin('league_players', 'league_players.id', 'league_player_accounts.league_player_id')
      .where('league_player_accounts.league_id', leagueId)
      .where('platform_accounts.normalized_tag', account.normalizedTag)
      // Never attach to a player that has been merged away.
      .whereNull('league_players.merged_into_id')
      .select('league_player_accounts.league_player_id as leaguePlayerId')
      .first()

    return row
      ? { leaguePlayerId: row.leaguePlayerId, confidence: 0.8, source: 'auto', provisional: false }
      : null
  }

  private async createPlayer(
    trx: TransactionClientContract,
    leagueId: string,
    account: PlatformAccount
  ): Promise<LeaguePlayer> {
    return LeaguePlayer.create(
      {
        leagueId,
        slug: await new PlayerSlugService().unique(
          trx,
          leagueId,
          account.normalizedTag || account.gamerTag
        ),
        displayTag: account.gamerTag,
        globalPlayerId: account.globalPlayerId,
        pronouns: account.pronouns,
        country: account.country,
        state: account.state,
        city: account.city,
      },
      { client: trx }
    )
  }

  private async link(
    trx: TransactionClientContract,
    leagueId: string,
    account: PlatformAccount,
    match: Match
  ): Promise<void> {
    await LeaguePlayerAccount.create(
      {
        leagueId,
        leaguePlayerId: match.leaguePlayerId,
        platformAccountId: account.id,
        confidence: String(match.confidence),
        source: match.source,
        provisional: match.provisional,
      },
      { client: trx }
    )
  }
}
