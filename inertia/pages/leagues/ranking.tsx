import type React from 'react'
import { useEffect, useState } from 'react'
import { Form, Link } from '@adonisjs/inertia/react'
import LeagueNav from '../../components/league_nav.js'
import LocationAutocompleteInput from '../../components/location_autocomplete_input.js'
import { useLocationSuggestions } from '../../hooks/use_location_suggestions.js'
import { useLiveUpdates } from '../../hooks/use_live_updates.js'
import { formatLocation } from '../../lib/format_location.js'

/** Reads the page's own query string once, for the initial state below. */
function initialQueryParams(): URLSearchParams {
  if (typeof window === 'undefined') return new URLSearchParams()
  return new URLSearchParams(window.location.search)
}

type PageSizeOption = '20' | '50' | '100' | 'custom'

const PRESET_PAGE_SIZES: PageSizeOption[] = ['20', '50', '100']
const DEFAULT_PAGE_SIZE = 50

type Props = {
  league: { slug: string; name: string }
  canManage: boolean
  ranking: {
    slug: string
    name: string
    algorithm: string
    isStale: boolean
    staleCount: number
    hasRecompute: boolean
    isRecomputing: boolean
    startsAt: string | null
    endsAt: string | null
    activityRequirements: Array<{ count: number; minEntrants: number | null }>
    dqPolicy: 'exclude_no_shows' | 'exclude_double_dq' | 'exclude_any_dq'
    residencyRequirements: Array<{ country?: string; state?: string; city?: string }>
  }
  standings: Array<{
    rank: number
    previousRank: number | null
    player: string
    playerSlug: string
    city: string | null
    state: string | null
    country: string | null
    rating: number
    wins: number
    losses: number
    setsPlayed: number
    eventsCounted: number
    inactive: boolean
    ineligible: boolean
    eligibilityOverride: 'exempt' | 'exclude' | null
  }>
}

const DQ_POLICY_LABEL: Record<Props['ranking']['dqPolicy'], string> = {
  exclude_no_shows: " (no show DQs don't count)",
  exclude_double_dq: " (double DQs don't count)",
  exclude_any_dq: " (any DQs don't count)",
}

/** Places gained or lost since the previous recompute. */
function rankDelta(rank: number, previousRank: number | null) {
  if (previousRank === null) return 'new'
  const delta = previousRank - rank
  if (delta === 0) return '–'
  return delta > 0 ? `▲ ${delta}` : `▼ ${Math.abs(delta)}`
}

const RankingPage: React.FC<Props> = ({ league, canManage, ranking, standings }) => {
  /**
   * Set when the button is pressed, to cover the gap before a worker picks the
   * job up and reports itself as running. It needs no reset: completing the
   * recompute clears `recomputeRequestedAt`, which drops `isStale` and with it
   * the whole term.
   */
  const [requested, setRequested] = useState(false)
  const working = ranking.isRecomputing || (requested && ranking.isStale)
  const { gaveUp } = useLiveUpdates(working, { only: ['ranking', 'standings'] })

  const [excludeInactive, setExcludeInactive] = useState(
    () => initialQueryParams().get('excludeInactive') === '1'
  )
  const [search, setSearch] = useState(() => initialQueryParams().get('players') ?? '')
  const [countryFilter, setCountryFilter] = useState(
    () => initialQueryParams().get('country') ?? ''
  )
  const [stateFilter, setStateFilter] = useState(() => initialQueryParams().get('state') ?? '')
  const [cityFilter, setCityFilter] = useState(() => initialQueryParams().get('city') ?? '')

  // `pageSize` from the URL is a plain row count
  const [pageSizeOption, setPageSizeOption] = useState<PageSizeOption>(() => {
    const fromUrl = Number.parseInt(initialQueryParams().get('pageSize') ?? '', 10)
    if (!Number.isFinite(fromUrl) || fromUrl <= 0) return '50'
    return PRESET_PAGE_SIZES.includes(String(fromUrl) as PageSizeOption)
      ? (String(fromUrl) as PageSizeOption)
      : 'custom'
  })
  const [customPageSize, setCustomPageSize] = useState(() => {
    const fromUrl = Number.parseInt(initialQueryParams().get('pageSize') ?? '', 10)
    return Number.isFinite(fromUrl) && fromUrl > 0 ? fromUrl : DEFAULT_PAGE_SIZE
  })
  const pageSize =
    pageSizeOption === 'custom' ? Math.max(1, customPageSize) : Number(pageSizeOption)

  const [page, setPage] = useState(() => {
    const fromUrl = Number.parseInt(initialQueryParams().get('offset') ?? '', 10)
    return Number.isFinite(fromUrl) && fromUrl > 0 ? Math.floor(fromUrl / pageSize) : 0
  })

  const changeExcludeInactive = (value: boolean) => {
    setExcludeInactive(value)
    setPage(0)
  }
  const changeSearch = (value: string) => {
    setSearch(value)
    setPage(0)
  }
  const changeCountryFilter = (value: string) => {
    setCountryFilter(value)
    setPage(0)
  }
  const changeStateFilter = (value: string) => {
    setStateFilter(value)
    setPage(0)
  }
  const changeCityFilter = (value: string) => {
    setCityFilter(value)
    setPage(0)
  }
  const changePageSizeOption = (value: PageSizeOption) => {
    setPageSizeOption(value)
    setPage(0)
  }
  const changeCustomPageSize = (raw: string) => {
    const parsed = Number.parseInt(raw, 10)
    setCustomPageSize(Number.isFinite(parsed) && parsed > 0 ? parsed : 1)
    setPage(0)
  }

  const countrySuggestions = useLocationSuggestions(league.slug, 'country', countryFilter)
  const stateSuggestions = useLocationSuggestions(league.slug, 'state', stateFilter, {
    country: countryFilter || undefined,
  })
  const citySuggestions = useLocationSuggestions(league.slug, 'city', cityFilter, {
    country: countryFilter || undefined,
    state: stateFilter || undefined,
  })

  const searchTerms = search
    .split(';')
    .map((term) => term.trim())
    .filter((term) => term.length > 0)
  const isSearching = searchTerms.length > 0
  const unmatchedTerms = searchTerms.filter(
    (term) => !standings.some((standing) => standing.player.toLowerCase() === term.toLowerCase())
  )

  const locationFieldMatches = (actual: string | null, expected: string): boolean => {
    if (expected.trim() === '') return true
    if (actual === null) return false
    return actual.trim().toLowerCase() === expected.trim().toLowerCase()
  }
  const isRegionFiltering =
    countryFilter.trim() !== '' || stateFilter.trim() !== '' || cityFilter.trim() !== ''
  const matchesRegion = (standing: Props['standings'][number]): boolean =>
    locationFieldMatches(standing.country, countryFilter) &&
    locationFieldMatches(standing.state, stateFilter) &&
    locationFieldMatches(standing.city, cityFilter)

  const filtered = (
    excludeInactive
      ? standings.filter((standing) => !standing.inactive && !standing.ineligible)
      : standings
  ).filter(matchesRegion)

  const searched = isSearching
    ? filtered.filter((standing) =>
        searchTerms.some((term) => standing.player.toLowerCase() === term.toLowerCase())
      )
    : filtered

  const isFiltering = isSearching || isRegionFiltering || excludeInactive

  const pageCount = Math.max(1, Math.ceil(searched.length / pageSize))
  const currentPage = Math.min(page, pageCount - 1)

  // Keeps the address bar in sync without a navigation.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const offset = currentPage * pageSize

    if (offset > 0) params.set('offset', String(offset))
    else params.delete('offset')

    if (pageSize !== DEFAULT_PAGE_SIZE) params.set('pageSize', String(pageSize))
    else params.delete('pageSize')

    if (search.trim() !== '') params.set('players', search)
    else params.delete('players')

    if (excludeInactive) params.set('excludeInactive', '1')
    else params.delete('excludeInactive')

    if (countryFilter.trim() !== '') params.set('country', countryFilter)
    else params.delete('country')

    if (stateFilter.trim() !== '') params.set('state', stateFilter)
    else params.delete('state')

    if (cityFilter.trim() !== '') params.set('city', cityFilter)
    else params.delete('city')

    const query = params.toString()
    const url = `${window.location.pathname}${query ? `?${query}` : ''}`
    window.history.replaceState(window.history.state, '', url)
  }, [currentPage, pageSize, search, excludeInactive, countryFilter, stateFilter, cityFilter])

  const shown = searched.slice(currentPage * pageSize, (currentPage + 1) * pageSize)

  const renderPager = (extraClassName?: string) =>
    searched.length > pageSize && (
      <p className={extraClassName ? `pager ${extraClassName}` : 'pager'}>
        <button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>
          Previous
        </button>
        <span>
          Page {currentPage + 1} of {pageCount} ({searched.length} player
          {searched.length === 1 ? '' : 's'})
        </span>
        <button
          type="button"
          disabled={currentPage >= pageCount - 1}
          onClick={() => setPage(currentPage + 1)}
        >
          Next
        </button>
      </p>
    )

  return (
    <>
      <LeagueNav slug={league.slug} name={league.name} canManage={canManage} />

      <h1>{ranking.name}</h1>

      {(ranking.startsAt ||
        ranking.endsAt ||
        ranking.activityRequirements.length > 0 ||
        ranking.residencyRequirements.length > 0) && (
        <p>
          {ranking.startsAt || ranking.endsAt
            ? `Counts events from ${ranking.startsAt ?? 'the start'} to ${ranking.endsAt ?? 'now'}.`
            : null}
          {ranking.activityRequirements.length > 0 && (
            <>
              {' '}
              To meet required activity, a player needs{' '}
              {ranking.activityRequirements
                .map(
                  (requirement) =>
                    `at least ${requirement.count} tournament${requirement.count === 1 ? '' : 's'}${requirement.minEntrants ? ` with ${requirement.minEntrants}+ entrants` : ' of any size'}`
                )
                .join(', and ')}
              {DQ_POLICY_LABEL[ranking.dqPolicy]}
              {' — otherwise they are flagged inactive.'}
            </>
          )}
          {ranking.residencyRequirements.length > 0 && (
            <>
              {' '}
              Players must live in{' '}
              {ranking.residencyRequirements
                .map((region) => formatLocation(region) ?? 'an unspecified region')
                .join(', or ')}
              {' — otherwise they are flagged ineligible.'}
            </>
          )}
        </p>
      )}

      {/*
        Standings are recomputed on request rather than on every import, so the
        page has to say plainly how far behind it is.
      */}
      {ranking.isStale && (
        <p>
          {ranking.hasRecompute
            ? `${ranking.staleCount} tournament${ranking.staleCount === 1 ? '' : 's'} imported since these standings were last updated.`
            : 'These standings have not been calculated yet.'}
        </p>
      )}

      {working && !gaveUp && <p role="status">Updating standings…</p>}
      {gaveUp && (
        <p role="status">
          Still waiting. Recomputes run in a separate worker process, so check that{' '}
          <code>node ace queue:work</code> is running, then reload.
        </p>
      )}

      {canManage && (
        <>
          <Link
            className="ranking-edit-link"
            route="rankings.edit"
            routeParams={{ league: league.slug, ranking: ranking.slug }}
          >
            Edit date range &amp; activity requirements
          </Link>{' '}
          <Form
            className="ranking-recompute-form"
            route="rankings.recompute"
            routeParams={{ league: league.slug, ranking: ranking.slug }}
            onSuccess={() => setRequested(true)}
          >
            {({ processing }) => (
              <button type="submit" disabled={processing || working}>
                {working ? 'Updating…' : 'Update rankings'}
              </button>
            )}
          </Form>
        </>
      )}

      <details className="list-filters edit-panel">
        <summary>Filter players</summary>

        <p>
          <label>
            Show only{' '}
            <input
              type="text"
              className="h2h-search-input"
              placeholder="e.g. Armada; Hungrybox; PPMD"
              value={search}
              onChange={(event) => changeSearch(event.target.value)}
            />
          </label>
          {unmatchedTerms.length > 0 && <> — no player named {unmatchedTerms.join(', ')}</>}
        </p>

        <p>
          <label>
            Region{' '}
            <LocationAutocompleteInput
              name="country"
              ariaLabel="Country"
              placeholder="any country"
              value={countryFilter}
              suggestions={countrySuggestions}
              onChange={changeCountryFilter}
              onSelect={(suggestion) => changeCountryFilter(suggestion.country ?? suggestion.label)}
            />{' '}
            <LocationAutocompleteInput
              name="state"
              ariaLabel="State or province"
              placeholder="any state/province"
              value={stateFilter}
              suggestions={stateSuggestions}
              onChange={changeStateFilter}
              onSelect={(suggestion) => changeStateFilter(suggestion.state ?? suggestion.label)}
            />{' '}
            <LocationAutocompleteInput
              name="city"
              ariaLabel="City"
              placeholder="any city"
              value={cityFilter}
              suggestions={citySuggestions}
              onChange={changeCityFilter}
              onSelect={(suggestion) => changeCityFilter(suggestion.city ?? suggestion.label)}
            />
          </label>
        </p>
      </details>

      <p className="ranking-exclude-inactive">
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={excludeInactive}
            onChange={(event) => changeExcludeInactive(event.target.checked)}
          />
          Exclude inactive or ineligible players
        </label>
      </p>

      {renderPager()}

      {searched.length === 0 ? (
        <p>
          {standings.length === 0
            ? 'No standings yet.'
            : isFiltering
              ? 'No players match your filters.'
              : 'No standings yet.'}
        </p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Move</th>
                <th>Player</th>
                <th>Location</th>
                <th>Rating</th>
                <th>W–L</th>
                <th>Sets</th>
                <th>Events</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((standing) => (
                <tr key={standing.playerSlug}>
                  <td>{standing.rank}</td>
                  <td>{rankDelta(standing.rank, standing.previousRank)}</td>
                  <td>
                    <Link
                      route="players.show"
                      routeParams={{ league: league.slug, player: standing.playerSlug }}
                    >
                      {standing.player}
                    </Link>
                    {standing.inactive && ' · inactive'}
                    {standing.ineligible && ' · ineligible'}
                    {standing.eligibilityOverride === 'exempt' && ' · exempt'}
                    {standing.eligibilityOverride === 'exclude' && ' · excluded by admin'}
                  </td>
                  <td>{formatLocation(standing) ?? '—'}</td>
                  <td>{standing.rating}</td>
                  <td>
                    {standing.wins}–{standing.losses}
                  </td>
                  <td>{standing.setsPlayed}</td>
                  <td>{standing.eventsCounted}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {renderPager('pager-bottom')}

      <p>
        <label>
          Rows per page{' '}
          <select
            value={pageSizeOption}
            onChange={(event) => changePageSizeOption(event.target.value as PageSizeOption)}
          >
            <option value="20">20</option>
            <option value="50">50</option>
            <option value="100">100</option>
            <option value="custom">Custom</option>
          </select>
        </label>
        {pageSizeOption === 'custom' && (
          <>
            {' '}
            <input
              className="h2h-page-size-input"
              type="number"
              min={1}
              value={customPageSize}
              onChange={(event) => changeCustomPageSize(event.target.value)}
            />
          </>
        )}
      </p>
    </>
  )
}

export default RankingPage
