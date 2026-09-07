import db from '@adonisjs/lucid/services/db'
import IdentityEvent from '#models/identity_event'
import League from '#models/league'
import LeaguePlayer from '#models/league_player'
import { entrantMatchesRegions, parseRegionFilter } from '#lib/geo/region_filter'
import type { RegionLocation } from '#lib/geo/region_filter'

export interface PruneRequest {
  leagueId: string
  actorUserId: string | null
}

/**
 * Removes league players that no counted, in-region entrant backs.
 */
export class LeaguePlayerReconcilerService {
  async pruneUnbackedPlayers(request: PruneRequest): Promise<string[]> {
    const { leagueId, actorUserId } = request

    return db.transaction(async (trx) => {
      const candidates = await LeaguePlayer.query({ client: trx })
        .where('leagueId', leagueId)
        .whereNull('mergedIntoId')

      if (candidates.length === 0) return []

      const idSet = (rows: Array<Record<string, string>>, column: string) =>
        new Set(rows.map((row) => row[column]))

      const mergeTargets = idSet(
        await trx
          .from('league_players')
          .where('league_id', leagueId)
          .whereNotNull('merged_into_id')
          .distinct('merged_into_id')
          .select('merged_into_id'),
        'merged_into_id'
      )

      const withAccounts = idSet(
        await trx
          .from('league_player_accounts')
          .where('league_id', leagueId)
          .distinct('league_player_id')
          .select('league_player_id'),
        'league_player_id'
      )

      const adminHeld = idSet(
        await trx
          .from('league_player_accounts')
          .where('league_id', leagueId)
          .where((query) => query.whereNot('source', 'auto').orWhereNotNull('confirmed_by_user_id'))
          .distinct('league_player_id')
          .select('league_player_id'),
        'league_player_id'
      )

      const backed = await this.backedPlayerIds(trx, leagueId)

      const doomed = candidates.filter(
        (player) =>
          withAccounts.has(player.id) &&
          !mergeTargets.has(player.id) &&
          !adminHeld.has(player.id) &&
          !backed.has(player.id)
      )

      if (doomed.length === 0) return []

      for (const player of doomed) {
        const accounts = await trx
          .from('league_player_accounts')
          .where('league_player_id', player.id)
          .select('platform_account_id', 'source', 'confidence', 'provisional')

        await IdentityEvent.create(
          {
            leagueId,
            actorUserId,
            kind: 'unlink',
            payload: {
              leaguePlayerId: player.id,
              slug: player.slug,
              displayTag: player.displayTag,
              globalPlayerId: player.globalPlayerId,
              country: player.country,
              pronouns: player.pronouns,
              socials: player.socials,
              accounts,
              reason: 'no counted, in-region event references this player',
            },
          },
          { client: trx }
        )

        await LeaguePlayer.query({ client: trx }).where('id', player.id).delete()
      }

      await League.query({ client: trx }).where('id', leagueId).increment('identity_version', 1)

      return doomed.map((player) => player.id)
    })
  }

  /**
   * Players with an account on an entrant of a counted event, where that entrant satisfies the
   * event's region filter.
   */
  private async backedPlayerIds(trx: any, leagueId: string): Promise<Set<string>> {
    const links: Array<{ league_player_id: string; entrant_id: string; region_filter: unknown }> =
      await trx
        .from('league_player_accounts as lpa')
        .join('entrant_participants as ep', 'ep.platform_account_id', 'lpa.platform_account_id')
        .join('entrants as e', 'e.id', 'ep.entrant_id')
        .join('league_events as le', 'le.event_id', 'e.event_id')
        .where('lpa.league_id', leagueId)
        .where('le.league_id', leagueId)
        .select('lpa.league_player_id', 'ep.entrant_id', 'le.region_filter')

    if (links.length === 0) return new Set()

    const entrantIds = [...new Set(links.map((link) => link.entrant_id))]
    const locationRows = await trx
      .from('entrant_participants as ep')
      .join('league_player_accounts as lpa', 'lpa.platform_account_id', 'ep.platform_account_id')
      .join('league_players as lp', 'lp.id', 'lpa.league_player_id')
      .where('lpa.league_id', leagueId)
      .whereIn('ep.entrant_id', entrantIds)
      .select('ep.entrant_id', 'lp.country', 'lp.state', 'lp.city')

    const byEntrant = new Map<string, RegionLocation[]>()
    for (const row of locationRows) {
      const list = byEntrant.get(row.entrant_id) ?? []
      list.push({ country: row.country, state: row.state, city: row.city })
      byEntrant.set(row.entrant_id, list)
    }

    const backed = new Set<string>()
    for (const link of links) {
      const regions = parseRegionFilter(link.region_filter)
      if (
        regions.length === 0 ||
        entrantMatchesRegions(byEntrant.get(link.entrant_id) ?? [], regions)
      ) {
        backed.add(link.league_player_id)
      }
    }

    return backed
  }
}
