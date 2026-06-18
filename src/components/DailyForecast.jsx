import { getWeatherInfo, formatDay, toTemp } from '../utils/weatherCodes'

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
          const precipClass = `daily-precip${p >= 30 ? ' high' : p > 0 ? ' low' : ' zero'}`
          return (
            <div key={date} className="daily-row">
              <span className="daily-day">{formatDay(date)}</span>
              <span className="daily-icon">{info.icon}</span>
              <span className="daily-precip-cell">
                <span className={precipClass}>{p}%</span>
              </span>
              <span className="daily-low">{low}°</span>
              <div className="bar-track">
                <div className="bar-fill" style={{ left: `${barLeft}%`, width: `${Math.max(barWidth, 8)}%` }} />
              </div>
              <span className="daily-high">{high}°</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
