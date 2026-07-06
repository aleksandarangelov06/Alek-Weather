import { Bookmark, RefreshCw, House } from 'lucide-react'
import { getWeatherInfo, liveWeatherCode, toTemp, tempStyle } from '../utils/weatherCodes'
import { WeatherIcon } from './WeatherIcon'

// Filled version of lucide's House: a solid house silhouette with the door cut
// out as a hole (fill-rule: evenodd) so only the inside is marked. No stroke —
// stroking the narrow door left an odd thin slit; fill-only reads cleanly.
function HouseFilled({ size = 17 }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24"
      fill="currentColor" fillRule="evenodd" clipRule="evenodd" stroke="none"
    >
      <path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8Z" />
    </svg>
  )
}

function formatUpdated(date) {
  if (!date) return ''
  const seconds = Math.floor((Date.now() - date) / 1000)
  if (seconds < 60) return 'Updated just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `Updated ${minutes} min ago`
  return `Updated at ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
}

export function CurrentWeather({ current, minutely, radarClear = null, location, timezone, unit, saved, onSave, onRemove, isHome, onToggleHome, lastUpdated, onRefresh, loading, colorCoding = true, glow = true }) {
  const tzOpts = timezone ? { timeZone: timezone } : {}
  const dateStr = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', ...tzOpts,
  })

  const info = getWeatherInfo(liveWeatherCode(current, minutely, radarClear), !current.is_day)
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
        <div className="current-fav-group">
          <button
            className={`fav-btn ${isHome ? 'active' : ''}`}
            onClick={onToggleHome}
            aria-label={isHome ? 'Remove home location' : 'Set as home'}
            title={isHome ? 'Remove home' : 'Set as home'}
          >
            {isHome ? <HouseFilled size={17} /> : <House size={17} />}
          </button>
        </div>
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
