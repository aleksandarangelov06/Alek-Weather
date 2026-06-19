import { useState, useRef, useEffect } from 'react'
import { Search, MapPin, X } from 'lucide-react'

export function SearchBar({ onSearch, results, onSelect, onUseLocation, onClear, onActivate, autoFocus }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const timerRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus()
  }, [autoFocus])

  const handleChange = (e) => {
    const val = e.target.value
    setQuery(val)
    setOpen(true)
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => onSearch(val), 300)
  }

  const handleClear = () => {
    setQuery('')
    setOpen(false)
    onClear()
    inputRef.current?.focus()
  }

  const handleSelect = (city) => {
    setQuery(`${city.name}${city.admin1 ? `, ${city.admin1}` : ''}, ${city.country_code}`)
    setOpen(false)
    onSelect(city)
  }

  useEffect(() => () => clearTimeout(timerRef.current), [])

  const showDropdown = open && query.trim().length > 0

  return (
    <div className="search-wrapper">
      <div className={`search-bar ${open ? 'focused' : ''}`}>
        <Search size={17} className="search-icon" />
        <input
          ref={inputRef}
          type="text"
          placeholder="Search city..."
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
        <div className="search-dropdown">
          <button className="dropdown-item location-item" onMouseDown={onUseLocation}>
            <MapPin size={15} />
            <span>Use my location</span>
          </button>
          {results.map((city, i) => (
            <button key={i} className="dropdown-item" onMouseDown={() => handleSelect(city)}>
              <span className="city-name">{city.name}</span>
              <span className="city-sub">
                {[city.admin1, city.country].filter(Boolean).join(', ')}
              </span>
            </button>
          ))}
          {results.length === 0 && query.trim() && (
            <div className="dropdown-empty">No results found</div>
          )}
        </div>
      )}
    </div>
  )
}
