import { useEffect, useState } from 'react'
import { ArrowLeft, House, Navigation, X } from 'lucide-react'
import { SearchBar } from '../SearchBar'
import { WeatherIcon } from '../WeatherIcon'
import { useCityConditions, conditionKey } from '../../hooks/useCityConditions'
import { getWeatherInfo, toTemp } from '../../utils/weatherCodes'
import { sameCity } from '../../utils/location'

// One row of three: enough to get back to the places you actually use, without
// the splash turning into a list.
const MAX_CARDS = 3

// The desktop splash: a search field and the places you've already looked at,
// so opening the app on a monitor lands on something usable instead of a
// tap-anywhere hint. Home shows one row of recent places; home and every saved
// city have their own view (`showSaved`), opened from the Saved locations
// button at the foot of the splash, which scrolls in the space the search
// field and recents take up.
export function SplashHome({
  recents, savedCities, home, unit, exiting, busy, active, showSaved, onCloseSaved,
  onSelect, onRemoveRecent, onRemoveSaved, onRemoveHome,
  onSearch, searchResults, onSelectResult, onUseLocation, onClearSearch,
  isSaved, isHome, here,
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

  // Home is the recent row; the saved view is home first, then every saved
  // city. Conditions are only asked for the places on screen.
  const recentRow = recents.slice(0, MAX_CARDS)
  const saved = [
    ...(home ? [home] : []),
    ...savedCities.filter((c) => !(home && sameCity(c, home))),
  ]
  const conditions = useCityConditions(showSaved ? saved : recentRow)
  const empty = showSaved ? false : recentRow.length === 0

  const openCity = (city) => {
    setPending(conditionKey(city))
    onSelect(city)
  }

  const removeSaved = (city) => (home && sameCity(city, home) ? onRemoveHome() : onRemoveSaved(city))

  if (showSaved) return (
    <div className={`splash-home splash-home--saved${exiting ? ' splash-home--exit' : ''}${busy ? ' splash-home--busy' : ''}`}>
      <div className="splash-saved-head">
        <button className="splash-saved-back" onClick={onCloseSaved} aria-label="Back to home">
          <ArrowLeft size={18} />
        </button>
        <h2 className="splash-saved-title">Saved locations</h2>
        {saved.length > 0 && <span className="splash-saved-count">{saved.length}</span>}
      </div>
      {saved.length > 0 ? (
        <div className={`splash-places${saved.length <= 3 ? ' splash-places--few' : ''}`}>
          <div className="splash-recents">
            <div className="splash-city-grid">
              {saved.map((city) => renderCard(city, removeSaved, false))}
            </div>
          </div>
        </div>
      ) : (
        <p className="splash-home-hint splash-saved-empty">
          No saved locations yet. Open a forecast and tap the bookmark to save a place here.
        </p>
      )}
    </div>
  )

  return (
    <div className={`splash-home${exiting ? ' splash-home--exit' : ''}${busy ? ' splash-home--busy' : ''}${empty ? ' splash-home--empty' : ''}`}>
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

      {/* The place the splash's sky is showing, found from the device. Opens
          that forecast, the same way picking a recent card does. */}
      {here && (
        <button
          className="splash-here"
          onClick={() => openCity(here)}
          aria-label={`Show weather for ${here.name}`}
        >
          {busy && pending === conditionKey(here)
            ? <span className="spinner splash-here-spinner" role="status" aria-label="Loading" />
            : <Navigation size={13} aria-hidden="true" />}
          {here.name}
        </button>
      )}

      {!empty && (
        <div className="splash-places splash-places--few">
          <div className="splash-recents">
            <div className="section-label">RECENT LOCATIONS</div>
            <div className="splash-city-grid">
              {recentRow.map((city, i) => renderCard(city, onRemoveRecent, i === 0))}
            </div>
          </div>
        </div>
      )}
    </div>
  )

  function renderCard(city, onRemove, showing) {
    const key = conditionKey(city)
    const cond = conditions[key]
    const info = cond ? getWeatherInfo(cond.code, !cond.isDay, cond.severe) : null
    const atHome = isHome?.(city)
    const opening = busy && pending === key
    return (
      <div className={`splash-city${opening ? ' splash-city--opening' : ''}`} key={key}>
        <button className="splash-city-btn" onClick={() => openCity(city)}>
          <span className="splash-city-name">
            {atHome && <House size={14} className="splash-city-home" aria-label="Home" />}
            {city.name}
            {/* The most recent place is the one the splash's sky,
                icon and headline are showing (see useLocalConditions). */}
            {showing && (
              <Navigation size={14} className="splash-city-here" aria-label="Showing this weather" />
            )}
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
                  {cond ? `${toTemp(cond.temp, unit)}°` : '-'}
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
  }
}
