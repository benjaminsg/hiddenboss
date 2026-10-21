import type React from 'react'
import { Form } from '@adonisjs/inertia/react'
import LeagueNav from '../../components/league_nav.js'
import ActivityRequirementsEditor from '../../components/activity_requirements_editor.js'
import ResidencyRequirementsEditor from '../../components/residency_requirements_editor.js'

type Props = {
  league: { slug: string; name: string }
}

const CreateRanking: React.FC<Props> = ({ league }) => {
  return (
    <>
      <LeagueNav slug={league.slug} name={league.name} />

      <h1>Create a ranking</h1>

      <Form route="rankings.store" routeParams={{ league: league.slug }}>
        {({ errors, processing }) => (
          <>
            <div>
              <label htmlFor="name">Name</label>
              <input type="text" name="name" id="name" placeholder="Power Ranking" />
              {errors.name && <p role="alert">{errors.name}</p>}
            </div>

            <div>
              <label htmlFor="slug">URL</label>
              <input type="text" name="slug" id="slug" placeholder="power-ranking" />
              {errors.slug && <p role="alert">{errors.slug}</p>}
            </div>

            <div>
              <label htmlFor="algorithm">Rating method</label>
              <select name="algorithm" id="algorithm" defaultValue="elo">
                <option value="elo">Elo — singles only, the familiar 1500 scale</option>
                <option value="glicko2">
                  Glicko-2 — singles only, accounts for how certain a rating is
                </option>
                <option value="openskill">
                  OpenSkill — Bayesian, like TrueSkill without the patent
                </option>
              </select>
              <small>Glicko-2, TrueSkill and circuit points are not built yet.</small>
              {errors.algorithm && <p role="alert">{errors.algorithm}</p>}
            </div>

            <div>
              <label htmlFor="recomputeMode">Updates</label>
              <select name="recomputeMode" id="recomputeMode" defaultValue="manual">
                <option value="manual">When I ask — review imports before standings move</option>
                <option value="auto">Automatically after every import</option>
              </select>
            </div>

            <div>
              <label htmlFor="startsAt">Counts events from</label>
              <input type="date" name="startsAt" id="startsAt" />
              {errors.startsAt && <p role="alert">{errors.startsAt}</p>}
            </div>

            <div>
              <label htmlFor="endsAt">Counts events until</label>
              <input type="date" name="endsAt" id="endsAt" />
              <small>Leave both blank to count every imported event.</small>
              {errors.endsAt && <p role="alert">{errors.endsAt}</p>}
            </div>

            <ActivityRequirementsEditor league={league.slug} initial={[]} errors={errors} />

            <div>
              <label htmlFor="dqPolicy">When a player is DQ&apos;d</label>
              <select name="dqPolicy" id="dqPolicy" defaultValue="exclude_no_shows">
                <option value="exclude_no_shows">
                  Don&apos;t count that tournament if they played no sets
                </option>
                <option value="exclude_double_dq">
                  Don&apos;t count that tournament if they were DQ&apos;d twice
                </option>
                <option value="exclude_any_dq">Don&apos;t count that tournament at all</option>
              </select>
              <small>Only matters if activity requirements are set above.</small>
              {errors.dqPolicy && <p role="alert">{errors.dqPolicy}</p>}
            </div>

            <ResidencyRequirementsEditor league={league.slug} initial={[]} errors={errors} />

            <button type="submit" disabled={processing}>
              Create ranking
            </button>
          </>
        )}
      </Form>
    </>
  )
}

export default CreateRanking
