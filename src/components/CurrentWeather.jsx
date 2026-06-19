import { Bookmark, RefreshCw } from 'lucide-react'
import { getWeatherInfo, toTemp } from '../utils/weatherCodes'

function formatUpdated(date) {
  if (!date) return ''
  const seconds = Math.floor((Date.now() - date) / 1000)
  if (seconds < 60) return 'Updated just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `Updated ${minutes} min ago`
  return `Updated at ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
}

export function CurrentWeather({ current, daily, location, unit, saved, onSave, onRemove, lastUpdated, onRefresh, loading }) {
  const info = getWeatherInfo(current.weather_code, !current.is_day)
  const temp = toTemp(current.temperature_2m, unit)
  const feelsLike = toTemp(current.apparent_temperature, unit)
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
      <div className="current-feels">Feels like {feelsLike}°{unit}</div>
      <div className="current-updated">
        <span className="updated-text">{formatUpdated(lastUpdated)}</span>
        <button
          className={`refresh-btn ${loading ? 'spinning' : ''}`}
          onClick={onRefresh}
          aria-label="Refresh weather"
          disabled={loading}
        >
          <RefreshCw size={13} />
        </button>
      </div>
    </div>
  )
}
