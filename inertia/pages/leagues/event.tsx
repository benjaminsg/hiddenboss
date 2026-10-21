import type React from 'react'
import { useState } from 'react'
import { Form, Link } from '@adonisjs/inertia/react'
import LeagueNav from '../../components/league_nav.js'
import PlayerLinkList from '../../components/player_link_list.js'
import EntityAutocompleteField from '../../components/entity_autocomplete_field.js'
import LocationFields from '../../components/location_fields.js'
import { formatLocation } from '../../lib/format_location.js'
import { confirmSubmit } from '../../lib/confirm_submit.js'

type Props = {
  league: { slug: string; name: string }
  canManage: boolean
  tournamentSharedWithOtherLeagues: boolean
  event: {
    id: string
    name: string
    tournamentName: string
    entryKind: string
    gameName: string | null
    entrantCount: number | null
    platformKey: string
    url: string | null
    startAt: string | null
    city: string | null
    state: string | null
    country: string | null
    address: string | null
  }
  players: Array<{ id: string; displayTag: string }>
  entrants: Array<{
    id: string
    name: string
    seed: number | null
    placement: number | null
    isDisqualified: boolean
    players: Array<{
      tag: string
      slug: string | null
      platformAccountId: string | null
      gamerTag: string | null
      platformKey: string | null
      profileUrl: string | null
      provisional: boolean
    }>
  }>
  sets: Array<{
    id: string
    phase: string | null
    bracket: string | null
    round: string | null
    entrantA: string | null
    entrantB: string | null
    scoreA: number | null
    scoreB: number | null
    disqualifiedA: boolean
    disqualifiedB: boolean
    winnerIsA: boolean
    decided: boolean
    state: string
  }>
}

type EventEditFormProps = {
  league: string
  event: string
  eventName: string
  tournamentName: string
  startAt: string | null
  city: string | null
  state: string | null
  country: string | null
}

const EventEditForm: React.FC<EventEditFormProps> = ({
  league,
  event,
  eventName,
  tournamentName,
  startAt,
  city,
  state,
  country,
}) => {
  return (
    <Form route="events.update" routeParams={{ league, event }}>
      {({ errors, processing }) => (
        <>
          <label>
            Event name <input type="text" name="eventName" defaultValue={eventName} />
          </label>
          <label>
            Tournament name{' '}
            <input type="text" name="tournamentName" defaultValue={tournamentName} />
          </label>
          <label>
            Date <input type="date" name="startAt" defaultValue={startAt ?? ''} />
          </label>
          <label>
            Location
            <LocationFields league={league} city={city} state={state} country={country} />
          </label>
          <button type="submit" disabled={processing}>
            Save
          </button>
          {errors.eventName && <p role="alert">{errors.eventName}</p>}
          {errors.tournamentName && <p role="alert">{errors.tournamentName}</p>}
          {errors.startAt && <p role="alert">{errors.startAt}</p>}
          {errors.city && <p role="alert">{errors.city}</p>}
          {errors.state && <p role="alert">{errors.state}</p>}
          {errors.country && <p role="alert">{errors.country}</p>}
        </>
      )}
    </Form>
  )
}

/**
 * Moves one imported account to another player, or splits it out into a player
 * created for it.
 */
const ReassignForm: React.FC<{
  leagueSlug: string
  platformAccountId: string
  gamerTag: string | null
  players: Props['players']
}> = ({ leagueSlug, platformAccountId, gamerTag, players }) => {
  const [creating, setCreating] = useState(false)
  const [selectedId, setSelectedId] = useState('')

  return (
    <Form route="identity.update" routeParams={{ league: leagueSlug }}>
      {({ processing }) => (
        <>
          <input type="hidden" name="platformAccountId" value={platformAccountId} />
          {creating ? (
            <>
              <input
                name="newPlayerTag"
                defaultValue={gamerTag ?? ''}
                placeholder="New player name"
                aria-label="New player name"
                required
              />{' '}
              <button type="button" onClick={() => setCreating(false)}>
                Cancel
              </button>{' '}
              <button type="submit" disabled={processing}>
                Create
              </button>
            </>
          ) : (
            <>
              <EntityAutocompleteField
                name="leaguePlayerId"
                items={players}
                label={(player) => player.displayTag}
                ariaLabel="Reassign to player"
                placeholder="Reassign to…"
                onSelectionChange={setSelectedId}
              />{' '}
              <button type="button" onClick={() => setCreating(true)}>
                New player
              </button>{' '}
              <button type="submit" disabled={processing || selectedId === ''}>
                Reassign
              </button>
            </>
          )}
        </>
      )}
    </Form>
  )
}

/** A walkover has no score, so the DQ is shown in its place. */
function scoreOf(set: Props['sets'][number]) {
  if (set.disqualifiedA || set.disqualifiedB) return 'DQ'
  if (set.scoreA === null && set.scoreB === null) return '—'
  return `${set.scoreA ?? '—'}–${set.scoreB ?? '—'}`
}

const IdentityTable: React.FC<{
  leagueSlug: string
  players: Props['players']
  entrants: Props['entrants']
}> = ({ leagueSlug, players, entrants }) => {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Entrant</th>
            <th>Imported account</th>
            <th>Counts as</th>
            <th>Reassign to</th>
          </tr>
        </thead>
        <tbody>
          {entrants.flatMap((entrant) =>
            entrant.players
              .filter((participant) => participant.platformAccountId !== null)
              .map((participant) => (
                <tr key={participant.platformAccountId!}>
                  <td>{entrant.name}</td>
                  <td>
                    {participant.profileUrl && participant.gamerTag ? (
                      <a href={participant.profileUrl} rel="noreferrer noopener" target="_blank">
                        {participant.gamerTag}
                      </a>
                    ) : (
                      (participant.gamerTag ?? '—')
                    )}
                    {participant.platformKey && <> · {participant.platformKey}</>}
                  </td>
                  <td>
                    {participant.slug ? (
                      <Link
                        route="players.show"
                        routeParams={{ league: leagueSlug, player: participant.slug }}
                      >
                        {participant.tag}
                      </Link>
                    ) : (
                      participant.tag
                    )}
                    {participant.provisional && ' · needs review'}
                  </td>
                  <td>
                    <ReassignForm
                      leagueSlug={leagueSlug}
                      platformAccountId={participant.platformAccountId!}
                      gamerTag={participant.gamerTag}
                      players={players}
                    />
                  </td>
                </tr>
              ))
          )}
        </tbody>
      </table>
    </div>
  )
}

const EventResults: React.FC<Props> = ({
  league,
  canManage,
  tournamentSharedWithOtherLeagues,
  event,
  players,
  entrants,
  sets,
}) => {
  return (
    <>
      <LeagueNav slug={league.slug} name={league.name} canManage={canManage} />

      <h1>
        {event.tournamentName} - {event.name}
      </h1>
      <p>
        {event.gameName && <>{event.gameName} · </>}
        {event.entryKind}
        {event.startAt && <> · {event.startAt}</>}
        {formatLocation(event) && <> · {formatLocation(event)}</>}
        {event.url && (
          <>
            {' · '}
            <a href={event.url} rel="noreferrer noopener" target="_blank">
              on {event.platformKey}
            </a>
          </>
        )}
      </p>

      {canManage && (
        <details className="edit-panel">
          <summary>Edit event</summary>
          <EventEditForm
            league={league.slug}
            event={event.id}
            eventName={event.name}
            tournamentName={event.tournamentName}
            startAt={event.startAt}
            city={event.city}
            state={event.state}
            country={event.country}
          />
          <div className="danger-zone">
            <strong>Danger zone</strong>
            <Form route="events.destroy" routeParams={{ league: league.slug, event: event.id }}>
              {({ processing }) => (
                <div className="danger-action">
                  <p>
                    Drops it from every ranking&apos;s next recompute. Nothing is deleted — pasting
                    the same link re-imports it.
                  </p>
                  <button
                    type="submit"
                    disabled={processing}
                    onClick={confirmSubmit(
                      `Remove ${event.name} from ${league.name}? It drops from every ranking's next recompute. Nothing is deleted — pasting the same link re-imports it.`
                    )}
                  >
                    Remove from league
                  </button>
                </div>
              )}
            </Form>

            {tournamentSharedWithOtherLeagues ? (
              <div className="danger-action">
                <p>
                  {event.tournamentName} is also counted by another league on this instance, so it
                  can&apos;t be deleted outright — that league would lose its history with no say in
                  it. It has to remove it first.
                </p>
              </div>
            ) : (
              <Form
                route="events.tournament.destroy"
                routeParams={{ league: league.slug, event: event.id }}
              >
                {({ processing }) => (
                  <div className="danger-action">
                    <p>
                      Permanently deletes {event.tournamentName} — every event, bracket and set
                      under it, not just this one. Cannot be undone; re-importing starts from
                      scratch.
                    </p>
                    <button
                      type="submit"
                      disabled={processing}
                      onClick={confirmSubmit(
                        `Permanently delete ${event.tournamentName}? This removes every event, bracket and set under it, for every league on this instance. This cannot be undone.`
                      )}
                    >
                      Delete tournament entirely
                    </button>
                  </div>
                )}
              </Form>
            )}
          </div>
        </details>
      )}

      <h2>Placements ({entrants.length})</h2>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Place</th>
              <th>Entrant</th>
              <th>Players</th>
              <th>Seed</th>
            </tr>
          </thead>
          <tbody>
            {entrants.map((entrant) => (
              <tr key={entrant.id}>
                <td>
                  {entrant.isDisqualified && 'DQ '}
                  {entrant.placement ?? '—'}
                </td>
                <td>{entrant.name}</td>
                <td>
                  <PlayerLinkList
                    leagueSlug={league.slug}
                    players={entrant.players.map((player) => ({
                      slug: player.slug,
                      label: player.tag,
                    }))}
                  />
                </td>
                <td>{entrant.seed ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canManage && (
        <>
          <h2>Identity</h2>
          <p>
            Each imported account is mapped to one league player. Two rows for one person is a merge
            away from correct, so fix it here — an account moves rather than being deleted, and the
            change is logged.
          </p>

          <IdentityTable leagueSlug={league.slug} players={players} entrants={entrants} />
        </>
      )}

      <h2>Sets ({sets.length})</h2>
      {sets.length === 0 ? (
        <p>No sets recorded. An event that has not been played yet looks like this.</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Round</th>
                <th>Winner</th>
                <th>Loser</th>
                <th>Score</th>
                <th>Bracket</th>
              </tr>
            </thead>
            <tbody>
              {sets.map((set) => (
                <tr key={set.id}>
                  <td>{set.round ?? '—'}</td>
                  <td>{set.decided ? (set.winnerIsA ? set.entrantA : set.entrantB) : '—'}</td>
                  <td>{set.decided ? (set.winnerIsA ? set.entrantB : set.entrantA) : '—'}</td>
                  <td>{scoreOf(set)}</td>
                  <td>
                    {set.phase ?? '—'}
                    {set.bracket && set.bracket !== set.phase && <> · {set.bracket}</>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

export default EventResults
