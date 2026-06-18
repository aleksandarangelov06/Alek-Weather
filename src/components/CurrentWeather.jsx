import { Bookmark } from 'lucide-react'
import { getWeatherInfo, toTemp } from '../utils/weatherCodes'

export function CurrentWeather({ current, daily, location, unit, saved, onSave, onRemove }) {
  const info = getWeatherInfo(current.weather_code)
  const temp = toTemp(current.temperature_2m, unit)
  const todayMax = toTemp(daily.temperature_2m_max[0], unit)
  const todayMin = toTemp(daily.temperature_2m_min[0], unit)
  const locationLine = [
    location.name,
    location.admin1 && location.admin1 !== location.name ? location.admin1 : null,
  ].filter(Boolean).join(', ')

  return (
    <div className="card current-card">
      <div className="current-header">
        <div className="current-location">
          {locationLine}
          {location.country && <span className="country-tag">{location.country}</span>}
        </div>
        <button
          className={`save-btn ${saved ? 'saved' : ''}`}
          onClick={saved ? onRemove : onSave}
          aria-label={saved ? 'Remove from saved' : 'Save city'}
        >
          <Bookmark size={18} fill={saved ? 'currentColor' : 'none'} />
        </button>
      </div>
      <div className="current-icon">{info.icon}</div>
      <div className="current-temp">{temp}°{unit}</div>
      <div className="current-condition">{info.label}</div>
      <div className="current-range">H: {todayMax}°&nbsp;&nbsp;L: {todayMin}°</div>
    </div>
  )
}
