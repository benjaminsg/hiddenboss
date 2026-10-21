import type React from 'react'
import { useEffect, useState } from 'react'
import { Link } from '@adonisjs/inertia/react'
import LeagueNav from '../../components/league_nav.js'
import LocationAutocompleteInput from '../../components/location_autocomplete_input.js'
import { useLocationSuggestions } from '../../hooks/use_location_suggestions.js'
import { formatLocation } from '../../lib/format_location.js'

/** Reads the page's own query string once, for the initial filter/page state. */
function initialQueryParams(): URLSearchParams {
  if (typeof window === 'undefined') return new URLSearchParams()
  return new URLSearchParams(window.location.search)
}

type PageSizeOption = '20' | '50' | '100' | 'custom'

const PRESET_PAGE_SIZES: PageSizeOption[] = ['20', '50', '100']
const DEFAULT_PAGE_SIZE = 50

type SortMode = 'rating-desc' | 'rating-asc' | 'alpha' | 'alpha-desc'

const SORT_LABELS: Record<SortMode, string> = {
  'rating-desc': 'Rating (high to low)',
  'rating-asc': 'Rating (low to high)',
  'alpha': 'Alphabetical (A–Z)',
  'alpha-desc': 'Alphabetical (Z–A)',
}
const SORT_MODES = Object.keys(SORT_LABELS) as SortMode[]
const DEFAULT_SORT_MODE: SortMode = 'rating-desc'

type Props = {
  league: { slug: string; name: string }
  canManage: boolean
  ranking: { slug: string; name: string } | null
  players: Array<{
    slug: string
    displayTag: string
    city: string | null
    state: string | null
    country: string | null
    rank: number | null
    rating: number | null
    wins: number
    losses: number
    setsPlayed: number
  }>
}

const Players: React.FC<Props> = ({ league, canManage, ranking, players }) => {
  const [search, setSearch] = useState(() => initialQueryParams().get('players') ?? '')
  const [countryFilter, setCountryFilter] = useState(
    () => initialQueryParams().get('country') ?? ''
  )
  const [stateFilter, setStateFilter] = useState(() => initialQueryParams().get('state') ?? '')
  const [cityFilter, setCityFilter] = useState(() => initialQueryParams().get('city') ?? '')
  const [sortMode, setSortMode] = useState<SortMode>(() => {
    const fromUrl = initialQueryParams().get('sort')
    return (SORT_MODES as string[]).includes(fromUrl ?? '')
      ? (fromUrl as SortMode)
      : DEFAULT_SORT_MODE
  })

  // `pageSize` from the URL is a plain row count — whichever preset it matches,
  // or "custom" carrying that exact number, so the link doesn't care whether the
  // sharer picked a preset or typed one in by hand.
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

  // An `offset` (how many players precede this page) keeps its meaning across
  // page-size changes, so that's what the URL stores; `page` is derived from it.
  const [page, setPage] = useState(() => {
    const fromUrl = Number.parseInt(initialQueryParams().get('offset') ?? '', 10)
    return Number.isFinite(fromUrl) && fromUrl > 0 ? Math.floor(fromUrl / pageSize) : 0
  })

  // Any change to what's being shown invalidates the current page — starting
  // back at the first page beats landing on a now-out-of-range one.
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
  const changeSortMode = (mode: SortMode) => {
    setSortMode(mode)
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

  // A custom set of league players: semicolon-separated tags matched case-insensitively against
  // the exact display tag, same rule the rankings page uses. A term that matches
  // nobody is reported back rather than silently dropped.
  const searchTerms = search
    .split(';')
    .map((term) => term.trim())
    .filter((term) => term.length > 0)
  const isSearching = searchTerms.length > 0
  const unmatchedTerms = searchTerms.filter(
    (term) => !players.some((player) => player.displayTag.toLowerCase() === term.toLowerCase())
  )

  // Trimmed, case-insensitive, exact equality: city/state/country are
  // admin-editable free text, not guaranteed ISO codes, so a substring or
  // code-aware match would be unsafe.
  const locationFieldMatches = (actual: string | null, expected: string): boolean => {
    if (expected.trim() === '') return true
    if (actual === null) return false
    return actual.trim().toLowerCase() === expected.trim().toLowerCase()
  }
  const isRegionFiltering =
    countryFilter.trim() !== '' || stateFilter.trim() !== '' || cityFilter.trim() !== ''
  const isFiltering = isSearching || isRegionFiltering

  // Rank is the rating position (1 = best); an unrated player has none, so they
  // always trail — alphabetically among themselves — whichever way it's sorted.
  // Same rule as the head-to-head page.
  const sortPlayers = (list: Props['players']): Props['players'] => {
    const byRating = (a: Props['players'][number], b: Props['players'][number], sign: 1 | -1) => {
      if (a.rank !== null && b.rank !== null) return (a.rank - b.rank) * sign
      if (a.rank !== null) return -1
      if (b.rank !== null) return 1
      return a.displayTag.localeCompare(b.displayTag)
    }

    const sorted = [...list]
    switch (sortMode) {
      case 'rating-desc':
        return sorted.sort((a, b) => byRating(a, b, 1))
      case 'rating-asc':
        return sorted.sort((a, b) => byRating(a, b, -1))
      case 'alpha':
        return sorted.sort((a, b) => a.displayTag.localeCompare(b.displayTag))
      case 'alpha-desc':
        return sorted.sort((a, b) => b.displayTag.localeCompare(a.displayTag))
    }
  }

  const filtered = sortPlayers(
    players
      .filter(
        (player) =>
          !isSearching ||
          searchTerms.some((term) => player.displayTag.toLowerCase() === term.toLowerCase())
      )
      .filter(
        (player) =>
          locationFieldMatches(player.country, countryFilter) &&
          locationFieldMatches(player.state, stateFilter) &&
          locationFieldMatches(player.city, cityFilter)
      )
  )

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(page, pageCount - 1)

  // Keeps the address bar in sync without a navigation, so copying the link
  // reopens on the same page, page size and filters. `replaceState` rather than
  // `push`, so paging through the table doesn't spam browser history.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const offset = currentPage * pageSize

    if (offset > 0) params.set('offset', String(offset))
    else params.delete('offset')

    if (pageSize !== DEFAULT_PAGE_SIZE) params.set('pageSize', String(pageSize))
    else params.delete('pageSize')

    const sync = (key: string, value: string) =>
      value.trim() !== '' ? params.set(key, value) : params.delete(key)
    sync('players', search)
    sync('country', countryFilter)
    sync('state', stateFilter)
    sync('city', cityFilter)

    if (sortMode !== DEFAULT_SORT_MODE) params.set('sort', sortMode)
    else params.delete('sort')

    const query = params.toString()
    const url = `${window.location.pathname}${query ? `?${query}` : ''}`
    window.history.replaceState(window.history.state, '', url)
  }, [currentPage, pageSize, search, countryFilter, stateFilter, cityFilter, sortMode])

  const shown = filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize)

  // Rendered both above and below the table, so paging doesn't require scrolling
  // back up to find the control. The bottom copy sits right against the table.
  // Shown only once the results actually overflow a page.
  const renderPager = (extraClassName?: string) =>
    filtered.length > pageSize && (
      <p className={extraClassName ? `pager ${extraClassName}` : 'pager'}>
        <button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>
          Previous
        </button>
        <span>
          Page {currentPage + 1} of {pageCount} ({filtered.length} player
          {filtered.length === 1 ? '' : 's'})
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

      <h1>Players</h1>

      <p>
        {isFiltering ? (
          <>
            {filtered.length} of {players.length} players
          </>
        ) : (
          <>
            {players.length} player{players.length === 1 ? '' : 's'}
          </>
        )}
        {ranking && <> · rated against {ranking.name}</>}
      </p>

      {canManage && players.length > 1 && (
        <p>
          <Link route="players.merge" routeParams={{ league: league.slug }}>
            Merge players
          </Link>
        </p>
      )}

      {players.length > 0 && (
        <p className="players-sort">
          <label>
            Sort{' '}
            <select
              value={sortMode}
              onChange={(event) => changeSortMode(event.target.value as SortMode)}
            >
              {SORT_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {SORT_LABELS[mode]}
                </option>
              ))}
            </select>
          </label>
        </p>
      )}

      {players.length > 0 && (
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
              Location{' '}
              <LocationAutocompleteInput
                name="country"
                ariaLabel="Country"
                placeholder="any country"
                value={countryFilter}
                suggestions={countrySuggestions}
                onChange={changeCountryFilter}
                onSelect={(suggestion) =>
                  changeCountryFilter(suggestion.country ?? suggestion.label)
                }
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
      )}

      {renderPager()}

      {players.length === 0 ? (
        <p>No players yet. They arrive with the first imported event.</p>
      ) : filtered.length === 0 ? (
        <p>No players match your filters.</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Player</th>
                <th>Location</th>
                <th>Rating</th>
                <th>W–L</th>
                <th>Sets</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((player) => (
                <tr key={player.slug}>
                  {/* Unranked players still belong to the league — they just have no rated sets. */}
                  <td>{player.rank ?? '—'}</td>
                  <td>
                    <Link
                      route="players.show"
                      routeParams={{ league: league.slug, player: player.slug }}
                    >
                      {player.displayTag}
                    </Link>
                  </td>
                  <td>{formatLocation(player) ?? '—'}</td>
                  <td>{player.rating ?? '—'}</td>
                  <td>
                    {player.wins}–{player.losses}
                  </td>
                  <td>{player.setsPlayed}</td>
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

export default Players
