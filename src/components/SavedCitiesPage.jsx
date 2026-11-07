import { ArrowLeft, Bookmark, Clock, House } from 'lucide-react'
import { sameCity, placeRegion } from '../utils/location'
import { PlaceRow, PlaceSection } from './PlaceRows'

// The phone shells' saved locations page, opened from the splash's corner
// button. It keeps the page chrome (header, transition) of .settings-page, and
// its lists are the search sheet's: the same grouped panels, tiles and rows,
// in the same order — Home and saved as "Your places", then recents — so the
// two pages that list your places look like one.
export function SavedCitiesPage({ cities, onSelect, onRemove, onBack, currentLocation, closing, recents = [], onRemoveRecent, home, onRemoveHome }) {
  // Home first, then saved without it, and recents without anything already
  // listed above them, so no city shows up twice on the page.
  const saved = home ? cities.filter(c => !sameCity(c, home)) : cities
  const places = [home, ...saved].filter(Boolean)
  const recentList = recents.filter(r => !places.some(p => sameCity(p, r)))
  const isCurrent = (c) => !!currentLocation && sameCity(currentLocation, c)
  const currentBadge = <span className="ss-badge">Current</span>

  return (
    <div className={`settings-page saved-cities-page${closing ? ' closing' : ''}`}>
      <header className="settings-page-header">
        <button className="back-btn" onClick={onBack} aria-label="Back">
          <ArrowLeft size={18} />
          <span>Back</span>
        </button>
        <span className="settings-page-title">Saved Cities</span>
      </header>
      <div className="settings-body">
        <div className="ss saved-ss">
          {places.length > 0 && (
            <PlaceSection title="Your places">
              {places.map((city) => {
                const isHomeRow = home && sameCity(city, home)
                return (
                  <PlaceRow
                    key={`${city.latitude},${city.longitude}`}
                    icon={isHomeRow ? House : Bookmark}
                    tone="place"
                    name={city.name}
                    sub={isHomeRow ? `Home · ${placeRegion(city)}` : placeRegion(city)}
                    badge={isCurrent(city) && currentBadge}
                    onSelect={() => onSelect(city)}
                    onRemove={isHomeRow ? () => onRemoveHome() : () => onRemove(city)}
                    removeLabel={isHomeRow ? `Remove ${city.name} as home` : `Remove ${city.name} from saved`}
                  />
                )
              })}
            </PlaceSection>
          )}

          {recentList.length > 0 && (
            <PlaceSection title="Recent">
              {recentList.map((city) => (
                <PlaceRow
                  key={`${city.latitude},${city.longitude}`}
                  icon={Clock}
                  name={city.name}
                  sub={placeRegion(city)}
                  badge={isCurrent(city) && currentBadge}
                  onSelect={() => onSelect(city)}
                  onRemove={() => onRemoveRecent(city)}
                  removeLabel={`Remove ${city.name} from recents`}
                />
              ))}
            </PlaceSection>
          )}

          {places.length === 0 && recentList.length === 0 && (
            <div className="ss-empty">
              <Bookmark size={32} aria-hidden="true" />
              <p>No cities saved yet. Open a city, then tap Save in search to keep it here.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
