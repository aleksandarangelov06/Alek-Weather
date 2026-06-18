import { getWeatherInfo, toTemp } from '../utils/weatherCodes'

export function HourlyForecast({ hourly, timezone, unit }) {
  const now = new Date()
  const currentHourStr = now.toLocaleString('en-CA', {
    hour: '2-digit', hour12: false, timeZone: timezone,
  })

  const startIdx = hourly.time.findIndex((t) => t.includes(`T${currentHourStr}:`))
  const start = startIdx === -1 ? 0 : startIdx
  const slice = (arr) => arr.slice(start, start + 25)

  const hours = slice(hourly.time)
  const temps = slice(hourly.temperature_2m)
  const codes = slice(hourly.weather_code)
  const precip = slice(hourly.precipitation_probability)

  return (
    <div className="card">
      <div className="section-label">HOURLY FORECAST</div>
      <div className="hourly-scroll">
        {hours.map((time, i) => {
          const label = i === 0
            ? 'Now'
            : new Date(time).toLocaleTimeString('en-US', {
                hour: 'numeric', hour12: true, timeZone: timezone,
              })
          const info = getWeatherInfo(codes[i])
          const p = precip[i] ?? 0
          const precipClass = p >= 30 ? 'hourly-precip high' : p > 0 ? 'hourly-precip low' : 'hourly-precip zero'
          return (
            <div key={i} className="hourly-item">
              <span className="hourly-time">{label}</span>
              <span className="hourly-icon">{info.icon}</span>
              <span className="hourly-temp">{toTemp(temps[i], unit)}°</span>
              <span className={precipClass}>{p}%</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
