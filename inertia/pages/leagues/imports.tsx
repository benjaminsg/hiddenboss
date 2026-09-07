import type React from 'react'
import { Form, Link } from '@adonisjs/inertia/react'
import LeagueNav from '../../components/league_nav.js'
import ResidencyRequirementsEditor from '../../components/residency_requirements_editor.js'
import { useLiveUpdates } from '../../hooks/use_live_updates.js'
import { confirmSubmit } from '../../lib/confirm_submit.js'

type Props = {
  league: { slug: string; name: string }
  platforms: Array<{ key: string; displayName: string; needsCredentials: boolean }>
  imports: Array<{
    id: string
    platformKey: string
    label: string
    eventId: string | null
    targetUrl: string | null
    status: string
    stage: string | null
    bracketsDone: number
    bracketsTotal: number | null
    error: string | null
    warning: string | null
    counts: {
      entrants?: number
      sets?: number
      regionFilteredOutSets?: number
      regionFilteredOutEntrants?: number
    } | null
  }>
}

const Imports: React.FC<Props> = ({ league, platforms, imports }) => {
  /**
   * The worker writes progress as it goes, so a queued or running import means
   * this page is already out of date.
   */
  const running = imports.some((record) =>
    ['queued', 'running', 'cancelling'].includes(record.status)
  )
  const { gaveUp } = useLiveUpdates(running, { only: ['imports'] })

  return (
    <>
      <LeagueNav slug={league.slug} name={league.name} />

      <h1>Import events</h1>

      {running && !gaveUp && (
        <p role="status">Import in progress — this page is updating itself.</p>
      )}
      {gaveUp && (
        <p role="status">
          Still queued after a while. Imports run in a separate worker process, so check that{' '}
          <code>node ace queue:work</code> is running, then reload.
        </p>
      )}

      <Form route="imports.store" routeParams={{ league: league.slug }}>
        {({ errors, processing }) => (
          <>
            <label htmlFor="url">Event link</label>
            <input
              type="url"
              name="url"
              id="url"
              placeholder="https://www.start.gg/tournament/…/event/…"
            />
            {/*
              A tournament link is not enough: a tournament runs several events
              and a league usually wants one of them. The adapter says which are
              available if the wrong kind of link is pasted.
            */}
            <p>
              Link to a single event, not the whole tournament — so you can take the singles bracket
              and leave the doubles.
            </p>
            {errors.url && <p role="alert">{errors.url}</p>}

            <details>
              <summary>Region filter</summary>
              <ResidencyRequirementsEditor
                league={league.slug}
                initial={[]}
                errors={errors}
                fieldName="regionFilter"
                label="Region filter"
                description="Only import matches where every player is from one of the regions below."
                emptyText=""
                addButtonText="+ Add region"
              />
            </details>

            <button type="submit" disabled={processing}>
              Import
            </button>
          </>
        )}
      </Form>

      <p>
        Supported platforms:{' '}
        {platforms.map((platform) => platform.displayName).join(', ') || 'none'}. Some need an API
        key first —{' '}
        <Link route="credentials.index" routeParams={{ league: league.slug }}>
          add credentials
        </Link>
        .
      </p>

      <h2>Recent imports</h2>
      {imports.length === 0 ? (
        <p>Nothing imported yet.</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Platform</th>
                <th>Tournament</th>
                <th>Status</th>
                <th>Progress</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {imports.map((record) => (
                <tr key={record.id}>
                  <td>
                    {record.targetUrl ? (
                      <a href={record.targetUrl} rel="noreferrer noopener" target="_blank">
                        {record.platformKey}
                      </a>
                    ) : (
                      record.platformKey
                    )}
                  </td>
                  <td>
                    {record.eventId ? (
                      <Link
                        route="events.show"
                        routeParams={{ league: league.slug, event: record.eventId }}
                      >
                        {record.label}
                      </Link>
                    ) : (
                      record.label
                    )}
                  </td>
                  <td>
                    {record.status}
                    {record.stage && record.status === 'running' && <span> ({record.stage})</span>}
                    {record.error && <p role="alert">{record.error}</p>}
                    {record.warning && (
                      <p role="status" className="alert alert-destructive">
                        {record.warning}
                      </p>
                    )}
                  </td>
                  <td>
                    {record.bracketsTotal
                      ? `${record.bracketsDone} / ${record.bracketsTotal}`
                      : record.bracketsDone}{' '}
                    brackets
                    {/* Entrants and sets are what tell an empty import from a full one. */}
                    {record.counts && typeof record.counts.sets === 'number' && (
                      <>
                        <br />
                        {record.counts.entrants ?? 0} entrants, {record.counts.sets} sets
                        {/* Distinguishes "a region filter excluded most of this bracket" from "the bracket was just small." */}
                        {Boolean(record.counts.regionFilteredOutEntrants) &&
                          `, ${record.counts.regionFilteredOutEntrants} entrants excluded by region filter`}
                        {Boolean(record.counts.regionFilteredOutSets) &&
                          `, ${record.counts.regionFilteredOutSets} sets excluded by region filter`}
                      </>
                    )}
                  </td>
                  <td>
                    {(record.status === 'queued' || record.status === 'running') && (
                      <Form
                        route="imports.cancel"
                        routeParams={{ league: league.slug, import: record.id }}
                      >
                        {({ processing }) => (
                          <button
                            type="submit"
                            disabled={processing}
                            onClick={confirmSubmit(
                              'Cancel this import? Anything it already created will be rolled back.'
                            )}
                          >
                            Cancel
                          </button>
                        )}
                      </Form>
                    )}
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

export default Imports
