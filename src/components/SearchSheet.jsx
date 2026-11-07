import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Bookmark, Clock, House, LocateFixed, MapPin, Search, SearchX, X } from 'lucide-react'
import { sameCity, placeRegion } from '../utils/location'
import { PlaceRow, PlaceSection } from './PlaceRows'

// The phone shells' search page. One full-screen sheet rather than a field with
// a dropdown under it: the dropdown closed whenever the field lost focus, so
// tapping anywhere else emptied the screen, and its one-line rows squeezed the
// region in beside the name until long names wrapped mid-word.
//
// Before you type it is a launcher — your location, your places, your recent
// searches — and once you type it is the results list, in the same rows.
// The desktop layout keeps SearchBar, which is built for its splash.

const region = placeRegion

// The part of the name you've typed, drawn in bold, so a result shows why it
// matched. Prefix only: that is how the geocoder matches, and highlighting a
// stray inner substring would suggest a match that isn't the reason.
function Highlight({ text, query }) {
  const q = query.trim()
  if (!q || !text.toLowerCase().startsWith(q.toLowerCase())) return text
  return (
    <>
      <mark className="ss-match">{text.slice(0, q.length)}</mark>
      {text.slice(q.length)}
    </>
  )
}

const Row = PlaceRow
const Section = PlaceSection

export function SearchSheet({
  barRef, initialQuery, onBack, onSearch, results, onClear,
  onSelect, onSelectPlace, onUseLocation,
  recents = [], onRemoveRecent, cities = [], onRemoveSaved, home, onRemoveHome,
  isSaved, isHome, currentLocation,
  onSaveCurrent, onUnsaveCurrent, onSetHomeCurrent, onUnsetHomeCurrent,
}) {
  const [query, setQuery] = useState(initialQuery ?? '')
  // From the keystroke until the results for it land: covers the debounce and
  // the request, so "No matches" never flashes up while a search is in flight.
  const [searching, setSearching] = useState(!!initialQuery)
  const timerRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    inputRef.current?.focus()
    if (initialQuery) timerRef.current = setTimeout(() => onSearch(initialQuery), 0)
    return () => clearTimeout(timerRef.current)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // useWeather hands back a new array for every finished search, empty or not,
  // so a change of identity is the signal that the search has come back.
  const [seenResults, setSeenResults] = useState(results)
  if (results !== seenResults) {
    setSeenResults(results)
    setSearching(false)
  }

  const handleChange = (e) => {
    const val = e.target.value
    setQuery(val)
    clearTimeout(timerRef.current)
    if (!val.trim()) { setSearching(false); onClear(); return }
    setSearching(true)
    timerRef.current = setTimeout(() => onSearch(val), 300)
  }

  const clear = () => {
    setQuery('')
    setSearching(false)
    clearTimeout(timerRef.current)
    onClear()
    inputRef.current?.focus()
  }

  const hasQuery = query.trim().length > 0

  // The geocoder often returns one city several times over (administrative
  // variants at near-identical coordinates); keep the first of each.
  const matches = hasQuery
    ? results.reduce((acc, c) => (acc.some(a => sameCity(a, c)) ? acc : [...acc, c]), [])
    : []

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && matches[0]) { e.preventDefault(); onSelect(matches[0]) }
    else if (e.key === 'Escape') { e.preventDefault(); query ? clear() : onBack() }
  }

  // Places first (Home, then saved), and recents without anything already
  // listed above them, so no city shows up twice on the page.
  const saved = home ? cities.filter(c => !sameCity(c, home)) : cities
  const places = [home, ...saved].filter(Boolean)
  const recentList = recents.filter(r => !places.some(p => sameCity(p, r)))
  const isCurrent = (c) => !!currentLocation && sameCity(currentLocation, c)
  const currentBadge = <span className="ss-badge">Current</span>

  return (
    <div className="ss">
      <div className="ss-bar" ref={barRef}>
        <button className="ss-back" onClick={onBack} aria-label="Close search">
          <ArrowLeft size={20} />
        </button>
        <label className="ss-field">
          <Search size={18} className="ss-field-icon" aria-hidden="true" />
          <input
            ref={inputRef}
            type="search"
            inputMode="search"
            enterKeyHint="search"
            placeholder="Search for a city"
            aria-label="Search for a city"
            value={query}
            onChange={handleChange}
            onKeyDown={onKeyDown}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
          {query && (
            <button className="ss-clear" onClick={clear} aria-label="Clear search">
              <X size={14} />
            </button>
          )}
        </label>
      </div>

      <div className="ss-body">
        {!hasQuery && (
          <>
            {/* The place on screen, with what the home and save buttons on the
                forecast used to do. They lived beside the city name; the name
                is in the header now, and these are choices you make about a
                place, which is what this page is for. */}
            {currentLocation && (
              <Section title="Showing now">
                <div className="ss-here">
                  <span className="ss-row-text">
                    <span className="ss-row-name">{currentLocation.name}</span>
                    <span className="ss-row-sub">{region(currentLocation, { full: true })}</span>
                  </span>
                  <div className="ss-here-actions">
                    {(() => {
                      const homeOn = !!isHome?.(currentLocation)
                      const savedOn = !!isSaved?.(currentLocation)
                      return (
                        <>
                          <button
                            className={`ss-chip${homeOn ? ' is-on' : ''}`}
                            aria-pressed={homeOn}
                            onClick={homeOn ? onUnsetHomeCurrent : onSetHomeCurrent}
                          >
                            <House size={15} fill={homeOn ? 'currentColor' : 'none'} aria-hidden="true" />
                            {homeOn ? 'Home' : 'Set as home'}
                          </button>
                          <button
                            className={`ss-chip${savedOn ? ' is-on' : ''}`}
                            aria-pressed={savedOn}
                            onClick={savedOn ? onUnsaveCurrent : onSaveCurrent}
                          >
                            <Bookmark size={15} fill={savedOn ? 'currentColor' : 'none'} aria-hidden="true" />
                            {savedOn ? 'Saved' : 'Save'}
                          </button>
                        </>
                      )
                    })()}
                  </div>
                </div>
              </Section>
            )}

            <button className="ss-locate" onClick={onUseLocation}>
              <span className="ss-tile ss-tile--accent"><LocateFixed size={18} aria-hidden="true" /></span>
              <span className="ss-row-text">
                <span className="ss-row-name">Use my location</span>
                <span className="ss-row-sub">Weather for where you are now</span>
              </span>
            </button>

            {places.length > 0 && (
              <Section title="Your places">
                {places.map((city) => {
                  const isHomeRow = home && sameCity(city, home)
                  return (
                    <Row
                      key={`${city.latitude},${city.longitude}`}
                      icon={isHomeRow ? House : Bookmark}
                      tone="place"
                      name={city.name}
                      sub={isHomeRow ? `Home · ${region(city)}` : region(city)}
                      badge={isCurrent(city) && currentBadge}
                      onSelect={() => onSelectPlace(city)}
                      onRemove={isHomeRow ? () => onRemoveHome() : () => onRemoveSaved(city)}
                      removeLabel={isHomeRow ? `Remove ${city.name} as home` : `Remove ${city.name} from saved`}
                    />
                  )
                })}
              </Section>
            )}

            {recentList.length > 0 && (
              <Section title="Recent">
                {recentList.map((city) => (
                  <Row
                    key={`${city.latitude},${city.longitude}`}
                    icon={Clock}
                    name={city.name}
                    sub={region(city)}
                    badge={isCurrent(city) && currentBadge}
                    onSelect={() => onSelect(city)}
                    onRemove={() => onRemoveRecent(city)}
                    removeLabel={`Remove ${city.name} from recents`}
                  />
                ))}
              </Section>
            )}

            {places.length === 0 && recentList.length === 0 && (
              <div className="ss-empty">
                <MapPin size={32} aria-hidden="true" />
                <p>Search for any city to see its weather. Places you open will show up here.</p>
              </div>
            )}
          </>
        )}

        {hasQuery && matches.length > 0 && (
          <Section title="Results">
            {matches.map((city) => {
              const homeHit = isHome?.(city)
              const savedHit = !homeHit && isSaved?.(city)
              return (
                <Row
                  key={`${city.latitude},${city.longitude}`}
                  icon={homeHit ? House : savedHit ? Bookmark : MapPin}
                  tone={homeHit || savedHit ? 'place' : undefined}
                  name={<Highlight text={city.name} query={query} />}
                  sub={region(city, { full: true })}
                  onSelect={() => onSelect(city)}
                />
              )
            })}
          </Section>
        )}

        {hasQuery && matches.length === 0 && (
          searching ? (
            <div className="ss-status" role="status">
              <span className="spinner ss-spinner" aria-hidden="true" />
              Searching…
            </div>
          ) : (
            <div className="ss-empty" role="status">
              <SearchX size={32} aria-hidden="true" />
              <p>No cities match “{query.trim()}”. Check the spelling, or try a nearby larger city.</p>
            </div>
          )
        )}
      </div>
    </div>
  )
}
