/**
 * Whether a location matches one or more admin-specified regions.
 */

import { normalizeCountry, normalizeState } from '#lib/geo/country'

/** A location constraint: country/state/city, all of which must match if set. */
export interface LocationFilter {
  country?: string
  state?: string
  city?: string
}

export function normaliseLocation(location: LocationFilter | undefined): LocationFilter | null {
  if (!location) return null

  const country = location.country?.trim() || undefined
  const state = location.state?.trim() || undefined
  const city = location.city?.trim() || undefined

  if (!country && !state && !city) return null

  return { country, state, city }
}

export function normaliseLocations(locations: LocationFilter[] | undefined): LocationFilter[] {
  return (locations ?? [])
    .map((location) => normaliseLocation(location))
    .filter((location): location is LocationFilter => location !== null)
}

interface LocatedFields {
  country?: string | null
  state?: string | null
  city?: string | null
}

function normalise(value: string): string {
  return value.trim().toLowerCase()
}

function fieldMatches(actual: string | null | undefined, expected: string | undefined): boolean {
  if (!expected) return true
  if (actual === null || actual === undefined) return false
  return normalise(actual) === normalise(expected)
}

export function matchesLocation(entity: LocatedFields, location: LocationFilter | null): boolean {
  if (!location) return true

  return (
    fieldMatches(entity.country, location.country) &&
    fieldMatches(entity.state, location.state) &&
    fieldMatches(entity.city, location.city)
  )
}

/** An empty list means unrestricted; otherwise any one matching region qualifies. */
export function matchesAnyRegion(entity: LocatedFields, regions: LocationFilter[]): boolean {
  return regions.length === 0 || regions.some((region) => matchesLocation(entity, region))
}

export interface RegionLocation {
  country: string | null
  state: string | null
  city: string | null
}

export function parseRegionFilter(value: unknown): LocationFilter[] {
  if (Array.isArray(value)) return value as LocationFilter[]
  if (typeof value === 'string' && value.length > 0) {
    try {
      return JSON.parse(value) as LocationFilter[]
    } catch {
      return []
    }
  }
  return []
}

export function entrantMatchesRegions(
  participants: RegionLocation[],
  regions: LocationFilter[]
): boolean {
  if (regions.length === 0) return true
  if (participants.length === 0) return false

  return participants.every((participant) => {
    const country = normalizeCountry(participant.country)
    const state = normalizeState(participant.state, country)
    return matchesAnyRegion({ country, state, city: participant.city }, regions)
  })
}
