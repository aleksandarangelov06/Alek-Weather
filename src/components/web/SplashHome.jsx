import { useEffect, useState } from 'react'
import { House, X } from 'lucide-react'
import { SearchBar } from '../SearchBar'
import { WeatherIcon } from '../WeatherIcon'
import { useCityConditions, conditionKey } from '../../hooks/useCityConditions'
import { getWeatherInfo, toTemp } from '../../utils/weatherCodes'

// Two rows of three at the widest the grid gets, so the list never pushes the
// wordmark off a laptop screen.
const MAX_CARDS = 6

// The desktop splash: a search field and the places you've already looked at,
// so opening the app on a monitor lands on something usable instead of a
// tap-anywhere hint. Recents are the list — they're what the app fills in as
// cities are opened — and saved cities stand in only for the case where a city
// was saved but never searched (the recents list was cleared, say).
export function SplashHome({
  recents, savedCities, unit, exiting, busy, active,
  onSelect, onRemoveRecent, onRemoveSaved,
  onSearch, searchResults, onSelectResult, onUseLocation, onClearSearch,
  isSaved, isHome,
}) {
  // A printable keypress with nothing focused seeds the field and remounts it,
  // so typing on the splash starts a search the same way it does on the empty
  // state. Remounting (rather than focusing and hoping the browser delivers the
  // character) is what makes the first letter land reliably. `active` is off
  // while a panel (settings, saved cities) covers the splash, so typing there
  // isn't stolen by a search field the user can't even see.
  const [seed, setSeed] = useState(null) // { char, n }

  useEffect(() => {
    if (!active) return
    const handler = (e) => {
      if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return
      const el = document.activeElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      e.preventDefault()
      setSeed(prev => ({ char: e.key, n: (prev?.n ?? 0) + 1 }))
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [active])

  // The splash covers the loading skeleton underneath it, so the card that was
  // clicked carries the spinner — otherwise picking a city looks like nothing
  // happened until the forecast lands. Only ever read alongside `busy`, so a
  // value left over from a finished fetch marks nothing.
  const [pending, setPending] = useState(null)

  const usingRecents = recents.length > 0
  const cities = (usingRecents ? recents : savedCities).slice(0, MAX_CARDS)
  const onRemove = usingRecents ? onRemoveRecent : onRemoveSaved
  const conditions = useCityConditions(cities)

  const openCity = (city) => {
    setPending(conditionKey(city))
    onSelect(city)
  }

  return (
    <div className={`splash-home${exiting ? ' splash-home--exit' : ''}${busy ? ' splash-home--busy' : ''}`}>
      <div className="splash-search">
        <SearchBar
          key={seed?.n ?? 0}
          initialQuery={seed?.char}
          autoFocus={!!seed}
          onSearch={onSearch}
          results={searchResults}
          onSelect={onSelectResult}
          onUseLocation={onUseLocation}
          onClear={onClearSearch}
          onActivate={() => {}}
          recents={recents}
          onRemoveRecent={onRemoveRecent}
          isSaved={isSaved}
          isHome={isHome}
        />
      </div>

      {cities.length > 0 ? (
        <div className="splash-recents">
          <div className="section-label">{usingRecents ? 'RECENT LOCATIONS' : 'SAVED LOCATIONS'}</div>
          <div className="splash-city-grid">
            {cities.map((city, i) => {
              const key = conditionKey(city)
              const cond = conditions[key]
              const info = cond ? getWeatherInfo(cond.code, !cond.isDay) : null
              const home = isHome?.(city)
              const opening = busy && pending === key
              return (
                <div className={`splash-city${opening ? ' splash-city--opening' : ''}`} key={i}>
                  <button className="splash-city-btn" onClick={() => openCity(city)}>
                    <span className="splash-city-name">
                      {home && <House size={14} className="splash-city-home" aria-label="Home" />}
                      {city.name}
                    </span>
                    {/* Cities stored from a search keep the country code on
                        `country`, not `country_code` — fall back to it. */}
                    <span className="splash-city-sub">
                      {[city.admin1, city.country_code ?? city.country].filter(Boolean).join(', ') || ' '}
                    </span>
                    <span className="splash-city-now">
                      {opening ? (
                        <span className="spinner splash-city-spinner" role="status" aria-label="Loading" />
                      ) : (
                        <>
                          {info && (
                            <span className="splash-city-icon">
                              <WeatherIcon id={info.icon} alt={info.label} />
                            </span>
                          )}
                          <span className={`splash-city-temp${cond ? '' : ' splash-city-temp--unknown'}`}>
                            {cond ? `${toTemp(cond.temp, unit)}°` : '—'}
                          </span>
                        </>
                      )}
                    </span>
                    <span className="splash-city-feels">
                      {cond ? `Feels like ${toTemp(cond.feels, unit)}°` : ' '}
                    </span>
                  </button>
                  <button
                    className="splash-city-remove"
                    onClick={() => onRemove(city)}
                    aria-label={`Remove ${city.name}`}
                  >
                    <X size={14} />
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <p className="splash-home-hint">Search for a city, or just start typing</p>
      )}
    </div>
  )
}
