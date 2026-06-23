import { useState, useRef, useEffect } from 'react'
import { Search, MapPin, X } from 'lucide-react'

export function SearchBar({ onSearch, results, onSelect, onUseLocation, onClear, onActivate, autoFocus, initialQuery, children }) {
  const [query, setQuery] = useState(initialQuery ?? '')
  const [open, setOpen] = useState(!!initialQuery)
  const [pendingSearch, setPendingSearch] = useState(false)
  const timerRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus()
    // Fire the initial search if the overlay was opened by a keypress
    if (initialQuery) {
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => onSearch(initialQuery), 0)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleChange = (e) => {
    const val = e.target.value
    setQuery(val)
    setOpen(true)
    setPendingSearch(true)
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => { setPendingSearch(false); onSearch(val) }, 300)
  }

  const handleClear = () => {
    setQuery('')
    setOpen(false)
    setPendingSearch(false)
    clearTimeout(timerRef.current)
    onClear()
    inputRef.current?.focus()
  }

  const handleSelect = (city) => {
    setQuery(`${city.name}${city.admin1 ? `, ${city.admin1}` : ''}, ${city.country_code}`)
    setOpen(false)
    onSelect(city)
  }

  useEffect(() => () => clearTimeout(timerRef.current), [])

  const hasQuery = query.trim().length > 0
  const showDropdown = open

  return (
    <div className="search-wrapper">
      <div className={`search-bar ${open ? 'focused' : ''}`}>
        <Search size={17} className="search-icon" />
        <input
          ref={inputRef}
          type="text"
          placeholder="Search for a city..."
          value={query}
          onChange={handleChange}
          onFocus={() => { setOpen(true); onActivate?.() }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          autoComplete="off"
        />
        {query && (
          <button className="clear-btn" onClick={handleClear} aria-label="Clear">
            <X size={15} />
          </button>
        )}
      </div>

      {showDropdown && (
        <div className="search-dropdown" onMouseDown={(e) => e.preventDefault()}>
          <button className="dropdown-item location-item" onMouseDown={onUseLocation}>
            <MapPin size={15} />
            <span>Use my location</span>
          </button>
          {!hasQuery && children}
          {hasQuery && results.map((city, i) => (
            <button key={i} className="dropdown-item" onMouseDown={() => handleSelect(city)}>
              <span className="city-name">{city.name}</span>
              <span className="city-sub">
                {[city.admin1, city.country].filter(Boolean).join(', ')}
              </span>
            </button>
          ))}
          {hasQuery && results.length === 0 && !pendingSearch && (
            <div className="dropdown-empty">No results found</div>
          )}
        </div>
      )}
    </div>
  )
}
