import { Bookmark, RefreshCw } from 'lucide-react'
import { getWeatherInfo, liveWeatherCode, toTemp, tempStyle } from '../utils/weatherCodes'
import { WeatherIcon } from './WeatherIcon'

function formatUpdated(date) {
  if (!date) return ''
  const seconds = Math.floor((Date.now() - date) / 1000)
  if (seconds < 60) return 'Updated just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `Updated ${minutes} min ago`
  return `Updated at ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
}

export function CurrentWeather({ current, minutely, daily, location, timezone, unit, saved, onSave, onRemove, lastUpdated, onRefresh, loading, colorCoding = true, glow = true }) {
  const tzOpts = timezone ? { timeZone: timezone } : {}
  const dateStr = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', ...tzOpts,
  })

  // Derive the condition from the live 15-min nowcast rather than the raw
  // weather_code, which lags after a brief downpour (e.g. reads "Violent Showers"
  // while only light rain is actually falling).
  const info = getWeatherInfo(liveWeatherCode(current, minutely), !current.is_day)
  const temp = toTemp(current.temperature_2m, unit)

  const currentTempStyle = tempStyle(current.temperature_2m, colorCoding, 1, glow)
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
        </div>
        <div className="current-date">{dateStr}</div>
        <button
          className={`save-btn ${saved ? 'saved' : ''}`}
          onClick={saved ? onRemove : onSave}
          aria-label={saved ? 'Remove from saved' : 'Save city'}
        >
          <Bookmark size={18} fill={saved ? 'currentColor' : 'none'} />
        </button>
      </div>
      <div className="current-icon"><WeatherIcon id={info.icon} alt={info.label} /></div>
      <div className="current-temp" style={currentTempStyle}>{temp}°{unit}</div>
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
