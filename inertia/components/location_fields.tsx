import type React from 'react'
import { useState } from 'react'
import LocationAutocompleteInput from './location_autocomplete_input.js'
import { useLocationSuggestions } from '../hooks/use_location_suggestions.js'

type Props = {
  league: string
  city: string | null
  state: string | null
  country: string | null
}

/**
 * The city / state / country trio for editing an entity's location.
 */
export default function LocationFields({
  league,
  city,
  state,
  country,
}: Props): React.ReactElement {
  const [cityValue, setCityValue] = useState(city ?? '')
  const [stateValue, setStateValue] = useState(state ?? '')
  const [countryValue, setCountryValue] = useState(country ?? '')

  const citySuggestions = useLocationSuggestions(league, 'city', cityValue, {
    country: countryValue || undefined,
    state: stateValue || undefined,
  })
  const stateSuggestions = useLocationSuggestions(league, 'state', stateValue, {
    country: countryValue || undefined,
  })
  const countrySuggestions = useLocationSuggestions(league, 'country', countryValue)

  return (
    <div className="location-fields">
      <LocationAutocompleteInput
        name="city"
        ariaLabel="City"
        placeholder="city"
        value={cityValue}
        suggestions={citySuggestions}
        onChange={setCityValue}
        onSelect={(suggestion) => {
          setCityValue(suggestion.city ?? suggestion.label)
          if (suggestion.state) setStateValue(suggestion.state)
          if (suggestion.country) setCountryValue(suggestion.country)
        }}
      />
      <LocationAutocompleteInput
        name="state"
        ariaLabel="State or province"
        placeholder="state/province"
        value={stateValue}
        suggestions={stateSuggestions}
        onChange={setStateValue}
        onSelect={(suggestion) => {
          setStateValue(suggestion.state ?? suggestion.label)
          if (suggestion.country) setCountryValue(suggestion.country)
        }}
      />
      <LocationAutocompleteInput
        name="country"
        ariaLabel="Country"
        placeholder="country"
        value={countryValue}
        suggestions={countrySuggestions}
        onChange={setCountryValue}
        onSelect={(suggestion) => setCountryValue(suggestion.country ?? suggestion.label)}
      />
    </div>
  )
}
