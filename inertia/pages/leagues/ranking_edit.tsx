import type React from 'react'
import { useState } from 'react'
import { Form } from '@adonisjs/inertia/react'
import LeagueNav from '../../components/league_nav.js'
import ActivityRequirementsEditor from '../../components/activity_requirements_editor.js'
import ResidencyRequirementsEditor from '../../components/residency_requirements_editor.js'
import EntityAutocompleteField from '../../components/entity_autocomplete_field.js'

type Props = {
  league: { slug: string; name: string }
  ranking: {
    slug: string
    name: string
    startsAt: string | null
    endsAt: string | null
    activityRequirements: Array<{ count: number; minEntrants: number | null }>
    dqPolicy: 'exclude_no_shows' | 'exclude_double_dq' | 'exclude_any_dq'
    residencyRequirements: Array<{ country?: string; state?: string; city?: string }>
  }
  eligibilityOverrides: Array<{
    id: string
    player: string
    kind: 'exempt' | 'exclude'
  }>
  players: Array<{ id: string; displayTag: string }>
}

const AddOverrideForm: React.FC<{
  leagueSlug: string
  rankingSlug: string
  players: Props['players']
}> = ({ leagueSlug, rankingSlug, players }) => {
  const [fieldKey, setFieldKey] = useState(0)
  const [selectedId, setSelectedId] = useState('')

  return (
    <Form
      route="rankings.eligibilityOverrides.store"
      routeParams={{ league: leagueSlug, ranking: rankingSlug }}
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
            name="leaguePlayerId"
            items={players}
            label={(player) => player.displayTag}
            ariaLabel="Player"
            placeholder="Player…"
            onSelectionChange={setSelectedId}
          />{' '}
          <select name="kind" defaultValue="exempt" aria-label="Override type">
            <option value="exempt">Exempt — always eligible</option>
            <option value="exclude">Exclude — never eligible</option>
          </select>{' '}
          <button type="submit" disabled={processing || selectedId === ''}>
            Add
          </button>
          {errors.leaguePlayerId && <p role="alert">{errors.leaguePlayerId}</p>}
        </>
      )}
    </Form>
  )
}

const EditRanking: React.FC<Props> = ({ league, ranking, eligibilityOverrides, players }) => {
  return (
    <>
      <LeagueNav slug={league.slug} name={league.name} />

      <h1>Edit {ranking.name}</h1>

      <Form route="rankings.update" routeParams={{ league: league.slug, ranking: ranking.slug }}>
        {({ errors, processing }) => (
          <>
            <div>
              <label htmlFor="startsAt">Counts events from</label>
              <input
                type="date"
                name="startsAt"
                id="startsAt"
                defaultValue={ranking.startsAt ?? ''}
              />
              {errors.startsAt && <p role="alert">{errors.startsAt}</p>}
            </div>

            <div>
              <label htmlFor="endsAt">Counts events until</label>
              <input type="date" name="endsAt" id="endsAt" defaultValue={ranking.endsAt ?? ''} />
              <small>Leave both blank to count every imported event.</small>
              {errors.endsAt && <p role="alert">{errors.endsAt}</p>}
            </div>

            <ActivityRequirementsEditor
              league={league.slug}
              initial={ranking.activityRequirements}
              errors={errors}
            />

            <div>
              <label htmlFor="dqPolicy">When a player is DQ&apos;d</label>
              <select name="dqPolicy" id="dqPolicy" defaultValue={ranking.dqPolicy}>
                <option value="exclude_no_shows">
                  Don&apos;t count that tournament if they played no sets
                </option>
                <option value="exclude_double_dq">
                  Don&apos;t count that tournament if they were DQ&apos;d twice
                </option>
                <option value="exclude_any_dq">Don&apos;t count that tournament at all</option>
              </select>{' '}
              <small>Only matters if activity requirements are set above.</small>
              {errors.dqPolicy && <p role="alert">{errors.dqPolicy}</p>}
            </div>

            <ResidencyRequirementsEditor
              league={league.slug}
              initial={ranking.residencyRequirements}
              errors={errors}
            />

            <button type="submit" disabled={processing}>
              Save
            </button>
          </>
        )}
      </Form>

      <details>
        <summary>Eligibility overrides</summary>
        <p>
          Manually mark a player always eligible or always ineligible for this ranking, regardless
          of the rules above. This applies to this ranking only.
        </p>

        {eligibilityOverrides.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Player</th>
                <th>Override</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {eligibilityOverrides.map((override) => (
                <tr key={override.id}>
                  <td>{override.player}</td>
                  <td>{override.kind === 'exempt' ? 'Exempt' : 'Excluded'}</td>
                  <td>
                    <Form
                      route="rankings.eligibilityOverrides.destroy"
                      routeParams={{
                        league: league.slug,
                        ranking: ranking.slug,
                        override: override.id,
                      }}
                    >
                      {({ processing }) => (
                        <button type="submit" disabled={processing}>
                          Remove
                        </button>
                      )}
                    </Form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <AddOverrideForm leagueSlug={league.slug} rankingSlug={ranking.slug} players={players} />
      </details>
    </>
  )
}

export default EditRanking
