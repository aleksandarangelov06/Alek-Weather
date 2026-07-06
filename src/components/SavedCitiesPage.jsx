import { ArrowLeft, Bookmark, Clock, MapPin, House, X } from 'lucide-react'
import { sameCity } from '../utils/location'

function cityLabel(city) {
  return `${city.name}${city.admin1 && city.admin1 !== city.name ? `, ${city.admin1}` : ''}`
}

export function SavedCitiesPage({ cities, onSelect, onRemove, onBack, currentLocation, closing, recents, onRemoveRecent, home, onRemoveHome }) {
  const hasRecents = recents?.length > 0
  const hasCities = cities.length > 0
  const hasPlaces = !!home

  const places = [
    home && { key: 'home', label: 'Home', Icon: House, city: home, onRemove: onRemoveHome },
  ].filter(Boolean)

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
        {hasPlaces && (
          <div className="saved-section">
            <div className="recent-header" style={{ borderTop: 'none' }}>Places</div>
            <div className="saved-list">
              {places.map(({ key, label, Icon, city, onRemove: removePlace }) => (
                <div key={key} className={`saved-row ${sameCity(currentLocation, city) ? 'active' : ''}`}>
                  <button className="saved-city-btn" onClick={() => onSelect(city)}>
                    <Icon size={13} />
                    <span className="place-tag">{label}</span>
                    <span className="saved-name">{cityLabel(city)}</span>
                  </button>
                  <button className="saved-remove" onClick={removePlace} aria-label={`Remove ${label.toLowerCase()}`}>
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {hasRecents && (
          <div className="saved-section">
            <div className="recent-header" style={hasPlaces ? undefined : { borderTop: 'none' }}>Recent</div>
            {recents.map((city, i) => (
              <div key={i} className="recent-item">
                <button className="recent-item-btn" onClick={() => onSelect(city)}>
                  <Clock size={13} className="recent-icon" />
                  <span className="city-name">{city.name}</span>
                  <span className="city-sub">{[city.admin1, city.country_code].filter(Boolean).join(', ')}</span>
                </button>
                <button
                  className="recent-remove-btn"
                  onClick={(e) => { e.stopPropagation(); onRemoveRecent(city) }}
                  aria-label="Remove"
                >
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
        )}

        {hasCities && (
          <div className="saved-section">
            {(hasRecents || hasPlaces) && <div className="recent-header">Saved</div>}
            <div className="saved-list">
              {cities.map((city, i) => (
                <div key={i} className={`saved-row ${sameCity(currentLocation, city) ? 'active' : ''}`}>
                  <button className="saved-city-btn" onClick={() => onSelect(city)}>
                    <MapPin size={13} />
                    <span className="saved-name">{cityLabel(city)}</span>
                  </button>
                  <button className="saved-remove" onClick={() => onRemove(city)} aria-label="Remove">
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {!hasCities && !hasRecents && !hasPlaces && (
          <div className="saved-empty">
            <Bookmark size={56} className="saved-empty-icon" />
            <p className="saved-empty-text">
              No cities saved. Use the bookmark icon on a city to save it.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
