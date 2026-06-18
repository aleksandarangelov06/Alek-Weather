import { getWeatherInfo } from '../utils/weatherCodes'

export function CurrentWeather({ current, daily, location }) {
  const info = getWeatherInfo(current.weather_code)
  const todayMax = Math.round(daily.temperature_2m_max[0])
  const todayMin = Math.round(daily.temperature_2m_min[0])
  const locationLine = [location.name, location.admin1 && location.admin1 !== location.name ? location.admin1 : null]
    .filter(Boolean).join(', ')

  return (
    <div className="card current-card">
      <div className="current-location">
        {locationLine}
        {location.country && <span className="country-tag">{location.country}</span>}
      </div>
      <div className="current-icon">{info.icon}</div>
      <div className="current-temp">{Math.round(current.temperature_2m)}°</div>
      <div className="current-condition">{info.label}</div>
      <div className="current-range">
        H: {todayMax}°&nbsp;&nbsp;L: {todayMin}°
      </div>
    </div>
  )
}
