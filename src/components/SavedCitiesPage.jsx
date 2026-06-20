import { ArrowLeft, Bookmark, MapPin, X } from 'lucide-react'

export function SavedCitiesPage({ cities, onSelect, onRemove, onBack, currentLatitude, closing }) {
  return (
    <div className={`settings-page${closing ? ' closing' : ''}`}>
      <header className="settings-page-header">
        <button className="back-btn" onClick={onBack} aria-label="Back">
          <ArrowLeft size={18} />
          <span>Back</span>
        </button>
        <span className="settings-page-title">Saved Cities</span>
      </header>
      <div className="settings-body">
        {cities.length === 0 ? (
          <div className="saved-empty">
            <Bookmark size={56} className="saved-empty-icon" />
            <p className="saved-empty-text">
              No cities saved. Use the bookmark icon on a city to save it.
            </p>
          </div>
        ) : (
          <div className="saved-list">
            {cities.map((city, i) => (
              <div key={i} className={`saved-row ${currentLatitude === city.latitude ? 'active' : ''}`}>
                <button className="saved-city-btn" onClick={() => onSelect(city)}>
                  <MapPin size={13} />
                  <span className="saved-name">{city.name}{city.admin1 && city.admin1 !== city.name && `, ${city.admin1}`}</span>
                </button>
                <button className="saved-remove" onClick={() => onRemove(city)} aria-label="Remove">
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
