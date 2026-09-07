import type React from 'react'
import { useState } from 'react'
import AutocompleteInput from './autocomplete_input.js'

type Props<T> = {
  name: string
  items: T[]
  label: (item: T) => string
  /** Defaults to reading `.id` off the item. */
  id?: (item: T) => string
  ariaLabel: string
  placeholder?: string
  /** Max suggestions shown. */
  limit?: number
  /**
   * Reported on every change so a submit button can stay disabled until a suggestion is picked.
   */
  onSelectionChange?: (id: string) => void
}

/**
 * An `AutocompleteInput` bound to a list of entities.
 */
export default function EntityAutocompleteField<T>({
  name,
  items,
  label,
  id = (item) => (item as { id: string }).id,
  ariaLabel,
  placeholder,
  limit = 8,
  onSelectionChange,
}: Props<T>): React.ReactElement {
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState('')

  const needle = query.trim().toLowerCase()
  const matches = needle
    ? items
        .filter((item) => label(item).toLowerCase().includes(needle))
        .slice(0, limit)
        .map((item) => ({ id: id(item), label: label(item) }))
    : []

  return (
    <>
      <AutocompleteInput
        ariaLabel={ariaLabel}
        placeholder={placeholder}
        value={query}
        suggestions={matches}
        keyOf={(suggestion) => suggestion.id}
        onChange={(value) => {
          setQuery(value)
          setSelectedId('')
          onSelectionChange?.('')
        }}
        onSelect={(suggestion) => {
          setQuery(suggestion.label)
          setSelectedId(suggestion.id)
          onSelectionChange?.(suggestion.id)
        }}
      />
      {selectedId && <input type="hidden" name={name} value={selectedId} />}
    </>
  )
}
