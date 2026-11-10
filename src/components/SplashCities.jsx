import { useState } from 'react'
import { House, Navigation, Search } from 'lucide-react'
import { WeatherIcon } from './WeatherIcon'
import { useCityConditions, conditionKey } from '../hooks/useCityConditions'
import { getWeatherInfo, toTemp } from '../utils/weatherCodes'

// Two, where the desktop splash shows six: the phone splash is a poster with a
// centred wordmark, and these sit in the strip left between it and the version
// line. A second row would either crowd the wordmark or need scrolling, and the
// point of them is to be a glance, not a list.
const MAX_CARDS = 2

// The phone splash is one big tap-anywhere-to-search target; this is the one
// thing on it you tap *at*. It gives the phone the same shortcut the desktop
// splash has — the last places you opened, with their current conditions, one
// tap from the forecast — without taking the poster apart. Recents are the
// list; saved cities stand in only when a city was saved but never searched
// (the recents list was cleared, say), matching SplashHome.
//
// With no place saved (and so nothing that opens on launch), the poster also
// carries a search pill above the cards: on a first run it is the obvious way
// in, where otherwise the only route to search was the corner button.
export function SplashCities({ recents, savedCities, unit, exiting, busy, onSelect, isHome, onSearch }) {
  // The splash covers the loading skeleton underneath it, so the card that was
  // tapped carries the spinner — otherwise picking a city looks like nothing
  // happened until the forecast lands. Only ever read alongside `busy`, so a
  // value left over from a finished fetch marks nothing.
  const [pending, setPending] = useState(null)

  const cities = (recents.length > 0 ? recents : savedCities).slice(0, MAX_CARDS)
  const conditions = useCityConditions(cities)

  if (!cities.length && !onSearch) return null

  const openCity = (city) => {
    setPending(conditionKey(city))
    onSelect(city)
  }

  return (
    <div className={`splash-mini${exiting ? ' splash-mini--exit' : ''}${busy ? ' splash-mini--busy' : ''}`}>
      {onSearch && (
        <button className="splash-mini-card splash-mini-search" onClick={onSearch}>
          <Search size={18} aria-hidden="true" />
          <span>Search for a city</span>
        </button>
      )}
      {cities.length > 0 && (
      <div className="splash-mini-row">
      {cities.map((city, i) => {
        const key = conditionKey(city)
        const cond = conditions[key]
        const info = cond ? getWeatherInfo(cond.code, !cond.isDay, cond.severe) : null
        const home = isHome?.(city)
        const opening = busy && pending === key
        return (
          <button
            className={`splash-mini-card${opening ? ' splash-mini-card--opening' : ''}`}
            key={i}
            onClick={() => openCity(city)}
          >
            <span className="splash-mini-name">
              {home && <House size={13} className="splash-mini-home" aria-label="Home" />}
              <span className="splash-mini-name-text">{city.name}</span>
              {/* The most recent place is the one the splash's sky, icon and
                  headline are showing (see useLocalConditions) — the same mark
                  the desktop splash puts on its card. */}
              {recents.length > 0 && i === 0 && (
                <Navigation size={13} className="splash-mini-here" aria-label="Showing this weather" />
              )}
            </span>
            {/* Cities stored from a search keep the country code on `country`,
                not `country_code` — fall back to it. */}
            <span className="splash-mini-sub">
              {[city.admin1, city.country_code ?? city.country].filter(Boolean).join(', ') || ' '}
            </span>
            <span className="splash-mini-now">
              {opening ? (
                <span className="spinner splash-mini-spinner" role="status" aria-label="Loading" />
              ) : (
                <>
                  {info && (
                    <span className="splash-mini-icon">
                      <WeatherIcon id={info.icon} alt={info.label} />
                    </span>
                  )}
                  <span className={`splash-mini-temp${cond ? '' : ' splash-mini-temp--unknown'}`}>
                    {cond ? `${toTemp(cond.temp, unit)}°` : '-'}
                  </span>
                </>
              )}
            </span>
          </button>
        )
      })}
      </div>
      )}
    </div>
  )
}
