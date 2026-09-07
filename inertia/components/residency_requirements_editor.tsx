import type React from 'react'
import { useState } from 'react'
import LocationAutocompleteInput from './location_autocomplete_input.js'
import { useLocationSuggestions } from '../hooks/use_location_suggestions.js'

type Row = {
  id: string
  city: string
  state: string
  country: string
}

type Props = {
  league: string
  initial: Array<{ country?: string; state?: string; city?: string }>
  errors: Record<string, string>
  fieldName?: string
  label?: string
  description?: string
  emptyText?: string
  addButtonText?: string
}

function newRow(city = '', state = '', country = ''): Row {
  return { id: crypto.randomUUID(), city, state, country }
}

type RowProps = {
  league: string
  fieldName: string
  index: number
  row: Row
  errors: Record<string, string>
  onChange: (field: keyof Omit<Row, 'id'>, value: string) => void
  onRemove: () => void
}

const RegionRow: React.FC<RowProps> = ({
  league,
  fieldName,
  index,
  row,
  errors,
  onChange,
  onRemove,
}) => {
  const countrySuggestions = useLocationSuggestions(league, 'country', row.country)
  const stateSuggestions = useLocationSuggestions(league, 'state', row.state, {
    country: row.country || undefined,
  })
  const citySuggestions = useLocationSuggestions(league, 'city', row.city, {
    country: row.country || undefined,
    state: row.state || undefined,
  })

  return (
    <div className="requirement-row">
      <LocationAutocompleteInput
        name={`${fieldName}[${index}][city]`}
        ariaLabel="City"
        placeholder="any city"
        value={row.city}
        suggestions={citySuggestions}
        onChange={(value) => onChange('city', value)}
        onSelect={(suggestion) => {
          onChange('city', suggestion.city ?? suggestion.label)
          if (suggestion.state) onChange('state', suggestion.state)
          if (suggestion.country) onChange('country', suggestion.country)
        }}
      />
      <span>, </span>
      <LocationAutocompleteInput
        name={`${fieldName}[${index}][state]`}
        ariaLabel="State or province"
        placeholder="any state/province"
        value={row.state}
        suggestions={stateSuggestions}
        onChange={(value) => onChange('state', value)}
        onSelect={(suggestion) => {
          onChange('state', suggestion.state ?? suggestion.label)
          if (suggestion.country) onChange('country', suggestion.country)
        }}
      />
      <span>, </span>
      <LocationAutocompleteInput
        name={`${fieldName}[${index}][country]`}
        ariaLabel="Country"
        placeholder="any country"
        value={row.country}
        suggestions={countrySuggestions}
        onChange={(value) => onChange('country', value)}
        onSelect={(suggestion) => onChange('country', suggestion.country ?? suggestion.label)}
      />{' '}
      <button type="button" onClick={onRemove}>
        Remove
      </button>
      {errors[`${fieldName}.${index}.city`] && (
        <p role="alert">{errors[`${fieldName}.${index}.city`]}</p>
      )}
      {errors[`${fieldName}.${index}.state`] && (
        <p role="alert">{errors[`${fieldName}.${index}.state`]}</p>
      )}
      {errors[`${fieldName}.${index}.country`] && (
        <p role="alert">{errors[`${fieldName}.${index}.country`]}</p>
      )}
    </div>
  )
}

const ResidencyRequirementsEditor: React.FC<Props> = ({
  league,
  initial,
  errors,
  fieldName = 'residencyRequirements',
  label = 'Residency requirement',
  description = 'A player must live in at least one of the regions below to be ranked.',
  emptyText = ' None set, so residency is unrestricted.',
  addButtonText = '+ Add region',
}) => {
  const [rows, setRows] = useState<Row[]>(() =>
    initial.map((region) => newRow(region.city ?? '', region.state ?? '', region.country ?? ''))
  )

  function updateRow(id: string, field: keyof Omit<Row, 'id'>, value: string) {
    setRows((prevRows) => prevRows.map((row) => (row.id === id ? { ...row, [field]: value } : row)))
  }

  return (
    <div>
      <label>{label}</label>
      <small>
        {description}
        {rows.length === 0 && emptyText}
      </small>

      {rows.map((row, index) => (
        <RegionRow
          key={row.id}
          league={league}
          fieldName={fieldName}
          index={index}
          row={row}
          errors={errors}
          onChange={(field, value) => updateRow(row.id, field, value)}
          onRemove={() => setRows((prevRows) => prevRows.filter((r) => r.id !== row.id))}
        />
      ))}

      <button type="button" onClick={() => setRows((prevRows) => [...prevRows, newRow()])}>
        {addButtonText}
      </button>
    </div>
  )
}

export default ResidencyRequirementsEditor
