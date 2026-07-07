import { MapPin, House, X } from 'lucide-react'
import { sameCity } from '../utils/location'

export function SavedCities({ cities, onSelect, onRemove, currentLocation, home, onRemoveHome }) {
  if (cities.length === 0 && !home) return null

  return (
    <div className="saved-cities">
      <div className="section-label">SAVED CITIES</div>
      <div className="saved-list">
        {home && (
          <div className={`saved-row ${sameCity(currentLocation, home) ? 'active' : ''}`}>
            <button className="saved-city-btn" onClick={() => onSelect(home)}>
              <House size={13} />
              <span className="saved-name">{home.name}{home.admin1 && home.admin1 !== home.name && `, ${home.admin1}`}</span>
            </button>
            <button className="saved-remove" onClick={() => onRemoveHome?.()} aria-label="Remove home">
              <X size={13} />
            </button>
          </div>
        )}
        {cities.map((city, i) => (
          <div key={i} className={`saved-row ${sameCity(currentLocation, city) ? 'active' : ''}`}>
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
