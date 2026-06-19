import { getWeatherInfo, formatDay, toTemp, tempColor } from '../utils/weatherCodes'
import { WeatherIcon } from './WeatherIcon'

export function DailyForecast({ daily, unit }) {
  const maxTemps = daily.temperature_2m_max
  const minTemps = daily.temperature_2m_min
  const weekMin = Math.min(...minTemps)
  const weekMax = Math.max(...maxTemps)
  const range = weekMax - weekMin || 1

  return (
    <div className="card">
      <div className="section-label">7-DAY FORECAST</div>
      <div className="daily-list">
        {daily.time.map((date, i) => {
          const info = getWeatherInfo(daily.weather_code[i])
          const high = toTemp(maxTemps[i], unit)
          const low = toTemp(minTemps[i], unit)
          const precip = daily.precipitation_probability_max[i]

          const barLeft = ((minTemps[i] - weekMin) / range) * 100
          const barWidth = ((maxTemps[i] - minTemps[i]) / range) * 100

          const p = precip ?? 0
          return (
            <div key={date} className="daily-row">
              <div className="daily-day-cell">
                <span className="daily-day">{formatDay(date)}</span>
                {p > 0 && <span className="daily-precip-label">{p}%</span>}
              </div>
              <span className="daily-icon"><WeatherIcon id={info.icon} alt={info.label} /></span>
              <span className="daily-low" style={{ color: tempColor(minTemps[i]) }}>{low}°</span>
              <div className="bar-track">
                <div className="bar-fill" style={{
                  left: `${barLeft}%`,
                  width: `${Math.max(barWidth, 6)}%`,
                  background: `linear-gradient(90deg, ${tempColor(minTemps[i])}, ${tempColor(maxTemps[i])})`,
                }} />
              </div>
              <span className="daily-high" style={{ color: tempColor(maxTemps[i]) }}>{high}°</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
