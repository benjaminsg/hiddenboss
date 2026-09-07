import type React from 'react'
import { useState } from 'react'
import { Form, Link } from '@adonisjs/inertia/react'
import LeagueNav from '../../components/league_nav.js'
import PlayerLinkList from '../../components/player_link_list.js'
import RankingHistoryChart from '../../components/ranking_history_chart.js'
import type { HistoryPoint } from '../../components/ranking_history_chart.js'
import LocationFields from '../../components/location_fields.js'
import EntityAutocompleteField from '../../components/entity_autocomplete_field.js'
import { formatLocation } from '../../lib/format_location.js'

type Props = {
  league: { slug: string; name: string }
  canManage: boolean
  player: {
    id: string
    slug: string
    displayTag: string
    pronouns: string | null
    city: string | null
    state: string | null
    country: string | null
  }
  ranking: { slug: string; name: string } | null
  eligibilityOverride: { id: string; kind: 'exempt' | 'exclude' } | null
  attendanceCredits: Array<{ id: string; label: string; startAt: string | null }>
  events: Array<{ id: string; label: string }>
  standing: {
    rank: number
    rating: number
    wins: number
    losses: number
    setsPlayed: number
  } | null
  history: HistoryPoint[]
  matches: Array<{
    setId: string
    eventId: string
    label: string
    round: string | null
    opponents: Array<{ slug: string; displayTag: string }>
    won: boolean
    score: string | null
    before: number
    after: number
    delta: number
    occurredAt: string | null
  }>
  entries: Array<{
    eventId: string
    label: string
    entryKind: string
    placement: number | null
    entrantCount: number | null
    isDisqualified: boolean
    startAt: string | null
  }>
  accounts: Array<{
    platformKey: string
    platformName: string
    gamerTag: string
    prefix: string | null
    source: string
    provisional: boolean
    weakIdentity: boolean
    profileUrl: string | null
  }>
}

type PlayerEditFormProps = {
  league: string
  player: string
  displayTag: string
  city: string | null
  state: string | null
  country: string | null
}

const PlayerEditForm: React.FC<PlayerEditFormProps> = ({
  league,
  player,
  displayTag,
  city,
  state,
  country,
}) => {
  return (
    <Form route="players.update" routeParams={{ league, player }}>
      {({ errors, processing }) => (
        <>
          <label>
            Tag <input type="text" name="displayTag" defaultValue={displayTag} />
          </label>
          <label>
            Location
            <LocationFields league={league} city={city} state={state} country={country} />
          </label>
          <button type="submit" disabled={processing}>
            Save
          </button>
          {errors.displayTag && <p role="alert">{errors.displayTag}</p>}
          {errors.city && <p role="alert">{errors.city}</p>}
          {errors.state && <p role="alert">{errors.state}</p>}
          {errors.country && <p role="alert">{errors.country}</p>}
        </>
      )}
    </Form>
  )
}

const PlayerEligibilityOverride: React.FC<{
  league: string
  playerId: string
  rankingSlug: string
  rankingName: string
  canManage: boolean
  override: Props['eligibilityOverride']
}> = ({ league, playerId, rankingSlug, rankingName, canManage, override }) => {
  return (
    <>
      <h2>Eligibility</h2>
      <p>
        {override === null && `No manual override — eligibility follows ${rankingName}'s rules.`}
        {override?.kind === 'exempt' && `Exempt — always eligible for ${rankingName}.`}
        {override?.kind === 'exclude' && `Excluded — never eligible for ${rankingName}.`}
      </p>

      {canManage && override && (
        <Form
          route="rankings.eligibilityOverrides.destroy"
          routeParams={{ league, ranking: rankingSlug, override: override.id }}
        >
          {({ processing }) => (
            <button type="submit" disabled={processing}>
              Remove override
            </button>
          )}
        </Form>
      )}

      {canManage && !override && (
        <Form
          route="rankings.eligibilityOverrides.store"
          routeParams={{ league, ranking: rankingSlug }}
        >
          {({ errors, processing }) => (
            <>
              <input type="hidden" name="leaguePlayerId" value={playerId} />
              <select name="kind" defaultValue="exempt" aria-label="Override type">
                <option value="exempt">Exempt — always eligible</option>
                <option value="exclude">Exclude — never eligible</option>
              </select>{' '}
              <button type="submit" disabled={processing}>
                Add override
              </button>
              {errors.leaguePlayerId && <p role="alert">{errors.leaguePlayerId}</p>}
            </>
          )}
        </Form>
      )}
    </>
  )
}

const AddAttendanceForm: React.FC<{
  league: string
  playerSlug: string
  events: Props['events']
}> = ({ league, playerSlug, events }) => {
  const [fieldKey, setFieldKey] = useState(0)
  const [selectedId, setSelectedId] = useState('')

  return (
    <Form
      route="players.attendance.store"
      routeParams={{ league, player: playerSlug }}
      resetOnSuccess
      onSuccess={() => {
        setFieldKey((key) => key + 1)
        setSelectedId('')
      }}
    >
      {({ errors, processing }) => (
        <>
          <EntityAutocompleteField
            key={fieldKey}
            name="eventId"
            items={events}
            label={(event) => event.label}
            ariaLabel="Event"
            placeholder="Event…"
            onSelectionChange={setSelectedId}
          />{' '}
          <button type="submit" disabled={processing || selectedId === ''}>
            Add
          </button>
          {errors.eventId && <p role="alert">{errors.eventId}</p>}
        </>
      )}
    </Form>
  )
}

/**
 * League-wide
 */
const AttendanceCredits: React.FC<{
  league: string
  playerSlug: string
  canManage: boolean
  credits: Props['attendanceCredits']
  events: Props['events']
}> = ({ league, playerSlug, canManage, credits, events }) => {
  return (
    <>
      <h2>Attendance credit</h2>
      <p>
        Manually credit this player with attending an event even though none of their matches were
        recorded — counts toward activity requirements in every ranking in this league.
      </p>

      {credits.length === 0 ? (
        <p>No manually credited events.</p>
      ) : (
        <ul>
          {credits.map((credit) => (
            <li key={credit.id}>
              {credit.label}
              {credit.startAt && ` (${credit.startAt})`}
              {canManage && (
                <>
                  {' '}
                  <Form
                    route="players.attendance.destroy"
                    routeParams={{ league, player: playerSlug, eventAttendance: credit.id }}
                  >
                    {({ processing }) => (
                      <button type="submit" disabled={processing}>
                        Remove
                      </button>
                    )}
                  </Form>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {canManage && <AddAttendanceForm league={league} playerSlug={playerSlug} events={events} />}
    </>
  )
}

/** Groups consecutive matches under the event they were played in. */
function byEvent(matches: Props['matches']) {
  const groups: Array<{ eventId: string; label: string; matches: Props['matches'] }> = []

  for (const match of matches) {
    const last = groups[groups.length - 1]
    if (last?.label === match.label) last.matches.push(match)
    else groups.push({ eventId: match.eventId, label: match.label, matches: [match] })
  }

  return groups
}

const MatchLog: React.FC<{ leagueSlug: string; matches: Props['matches'] }> = ({
  leagueSlug,
  matches,
}) => {
  if (matches.length === 0) return <p>No rated sets yet.</p>

  return (
    <>
      {byEvent(matches).map((group) => (
        <div key={group.label}>
          <h3>
            <Link route="events.show" routeParams={{ league: leagueSlug, event: group.eventId }}>
              {group.label}
            </Link>
          </h3>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Result</th>
                  <th>Opponent</th>
                  <th>Score</th>
                  <th>Round</th>
                  <th>Rating</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {group.matches.map((match) => (
                  <tr key={match.setId}>
                    <td>{match.won ? 'Win' : 'Loss'}</td>
                    <td>
                      <PlayerLinkList
                        leagueSlug={leagueSlug}
                        players={match.opponents.map((opponent) => ({
                          slug: opponent.slug,
                          label: opponent.displayTag,
                        }))}
                      />
                    </td>
                    <td>{match.score ?? '—'}</td>
                    <td>{match.round ?? '—'}</td>
                    {/* The point of ranking_set_deltas: not just that it moved, but by how much. */}
                    <td>
                      {match.after} ({match.delta >= 0 ? '+' : ''}
                      {match.delta})
                    </td>
                    <td>{match.occurredAt ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </>
  )
}

const PlayerProfile: React.FC<Props> = ({
  league,
  canManage,
  player,
  ranking,
  eligibilityOverride,
  attendanceCredits,
  events,
  standing,
  history,
  matches,
  entries,
  accounts,
}) => {
  return (
    <>
      <LeagueNav slug={league.slug} name={league.name} canManage={canManage} />

      <h1>{player.displayTag}</h1>
      {(player.pronouns || formatLocation(player)) && (
        <p>
          {player.pronouns}
          {player.pronouns && formatLocation(player) && ' · '}
          {formatLocation(player)}
        </p>
      )}

      {canManage && (
        <>
          <details className="edit-panel">
            <summary>Edit player</summary>
            <PlayerEditForm
              league={league.slug}
              player={player.slug}
              displayTag={player.displayTag}
              city={player.city}
              state={player.state}
              country={player.country}
            />
          </details>
          <p>
            <Link
              route="players.merge"
              routeParams={{ league: league.slug }}
              data={{ a: player.id }}
            >
              Merge with another player
            </Link>
          </p>
        </>
      )}

      <h2>Ranking</h2>
      {standing && ranking ? (
        <p>
          <strong>#{standing.rank}</strong> · {standing.rating} in {ranking.name} · {standing.wins}–
          {standing.losses} across {standing.setsPlayed} set
          {standing.setsPlayed === 1 ? '' : 's'}
        </p>
      ) : (
        <p>Not rated{ranking ? ` in ${ranking.name}` : ' yet'} — no counted sets.</p>
      )}

      {ranking && (
        <>
          <h2>Ranking history</h2>
          <RankingHistoryChart history={history} rankingName={ranking.name} />
        </>
      )}

      <h2>Matches ({matches.length})</h2>
      <MatchLog leagueSlug={league.slug} matches={matches} />

      <h2>Events ({entries.length})</h2>
      {entries.length === 0 ? (
        <p>No events entered.</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Event</th>
                <th>Placement</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={`${entry.eventId}-${entry.label}`}>
                  <td>
                    <Link
                      route="events.show"
                      routeParams={{ league: league.slug, event: entry.eventId }}
                    >
                      {entry.label}
                    </Link>{' '}
                    <span>({entry.entryKind})</span>
                  </td>
                  <td>
                    {entry.isDisqualified && 'DQ '}
                    {entry.placement ?? '—'}
                    {entry.entrantCount ? ` / ${entry.entrantCount}` : ''}
                  </td>
                  <td>{entry.startAt ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AttendanceCredits
        league={league.slug}
        playerSlug={player.slug}
        canManage={canManage}
        credits={attendanceCredits}
        events={events}
      />

      {ranking && (
        <PlayerEligibilityOverride
          league={league.slug}
          playerId={player.id}
          rankingSlug={ranking.slug}
          rankingName={ranking.name}
          canManage={canManage}
          override={eligibilityOverride}
        />
      )}

      <h2>Accounts ({accounts.length})</h2>
      <ul>
        {accounts.map((account, index) => (
          <li key={`${account.platformKey}-${account.gamerTag}-${index}`}>
            {account.prefix ? `${account.prefix} | ` : ''}
            {account.profileUrl ? (
              <a href={account.profileUrl} rel="noreferrer noopener" target="_blank">
                {account.gamerTag}
              </a>
            ) : (
              account.gamerTag
            )}{' '}
            {account.weakIdentity
              ? `· ${account.platformName} entrant, no linked account`
              : `· ${account.platformName}`}
            {account.provisional && ' · needs review'}
          </li>
        ))}
      </ul>
    </>
  )
}

export default PlayerProfile
