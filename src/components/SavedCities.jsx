import { MapPin, X } from 'lucide-react'

export function SavedCities({ cities, onSelect, onRemove, currentLatitude }) {
  if (cities.length === 0) return null

  return (
    <div className="saved-cities">
      <div className="section-label">SAVED CITIES</div>
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
    </div>
  )
}
