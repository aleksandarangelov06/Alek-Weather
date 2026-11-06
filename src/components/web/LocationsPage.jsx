import { Bookmark, Clock, House, MapPin, X } from 'lucide-react'
import { WeatherIcon } from '../WeatherIcon'
import { useCityConditions, conditionKey } from '../../hooks/useCityConditions'
import { getWeatherInfo, toTemp } from '../../utils/weatherCodes'
import { sameCity } from '../../utils/location'

// The web app's Locations tab: every place the app knows about — home, the
// recent searches and the saved cities — as cards with their current
// conditions, one click from the forecast. The phone shells show the same
// lists as a slide-in page (SavedCitiesPage); here it is a page like any other
// tab, so it reads as part of the site rather than as a panel over it.
//
// Home is its own section, and is dropped from the other two when it also
// appears there, so no place is listed twice on the page.

function cityKey(city) {
  return conditionKey(city)
}

function CityCard({ city, condition, unit, active, onSelect, onRemove, removeLabel }) {
  const info = condition ? getWeatherInfo(condition.code, !condition.isDay, condition.severe) : null
  return (
    <div className={`web-loc-item${active ? ' web-loc-item--active' : ''}`}>
      <button className="web-loc-btn" onClick={() => onSelect(city)}>
        <span className="web-loc-name">{city.name}</span>
        {/* Cities stored from a search keep the country code on `country`. */}
        <span className="web-loc-sub">
          {[city.admin1, city.country_code ?? city.country].filter(Boolean).join(', ') || ' '}
        </span>
        <span className="web-loc-now">
          {info && (
            <span className="web-loc-icon">
              <WeatherIcon id={info.icon} alt={info.label} />
            </span>
          )}
          <span className={`web-loc-temp${condition ? '' : ' web-loc-temp--unknown'}`}>
            {condition ? `${toTemp(condition.temp, unit)}°` : '—'}
          </span>
          {active && <span className="web-loc-badge">Showing</span>}
        </span>
      </button>
      <button className="web-loc-remove" onClick={() => onRemove(city)} aria-label={`${removeLabel} ${city.name}`} title={removeLabel}>
        <X size={14} />
      </button>
    </div>
  )
}

export function LocationsPage({ home, recents, cities, currentLocation, unit, onSelect, onRemoveHome, onRemoveRecent, onRemoveSaved }) {
  const notHome = (c) => !(home && sameCity(c, home))
  const recentList = recents.filter(notHome)
  const savedList = cities.filter(notHome)

  // One conditions lookup for the whole page, de-duplicated so a city that is
  // both recent and saved is fetched once.
  const all = []
  const seen = new Set()
  for (const c of [home, ...recentList, ...savedList]) {
    if (!c) continue
    const k = cityKey(c)
    if (seen.has(k)) continue
    seen.add(k)
    all.push(c)
  }
  const conditions = useCityConditions(all)

  const sections = [
    home && { id: 'home', title: 'Home', Icon: House, list: [home], onRemove: () => onRemoveHome(), removeLabel: 'Remove home' },
    recentList.length > 0 && { id: 'recent', title: 'Recent', Icon: Clock, list: recentList, onRemove: onRemoveRecent, removeLabel: 'Remove from recents' },
    savedList.length > 0 && { id: 'saved', title: 'Saved', Icon: Bookmark, list: savedList, onRemove: onRemoveSaved, removeLabel: 'Remove from saved' },
  ].filter(Boolean)

  return (
    <div className="web-page web-locations-page">
      <div className="web-page-head">
        <h2 className="web-page-title">Locations</h2>
      </div>

      {sections.map(({ id, title, Icon, list, onRemove, removeLabel }) => (
        <section key={id} className="card web-loc-section" aria-labelledby={`web-loc-${id}`}>
          <h3 className="web-loc-heading" id={`web-loc-${id}`}>
            <Icon size={15} aria-hidden="true" />
            {title}
          </h3>
          <div className="web-loc-grid">
            {list.map((city) => (
              <CityCard
                key={cityKey(city)}
                city={city}
                condition={conditions[cityKey(city)]}
                unit={unit}
                active={!!currentLocation && sameCity(currentLocation, city)}
                onSelect={onSelect}
                onRemove={onRemove}
                removeLabel={removeLabel}
              />
            ))}
          </div>
        </section>
      ))}

      {sections.length === 0 && (
        <div className="card web-loc-empty">
          <MapPin size={40} className="web-loc-empty-icon" aria-hidden="true" />
          <p>No locations yet. Search for a city from Home, and it will show up here.</p>
        </div>
      )}
    </div>
  )
}
