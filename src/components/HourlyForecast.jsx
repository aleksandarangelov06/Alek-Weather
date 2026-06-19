import { useRef, useEffect } from 'react'
import { getWeatherInfo, toTemp } from '../utils/weatherCodes'

export function HourlyForecast({ hourly, timezone, unit }) {
  const scrollRef = useRef(null)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e) => {
      e.preventDefault()
      el.scrollLeft += e.deltaY + e.deltaX
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const scroll = (dir) => {
    if (!scrollRef.current) return
    scrollRef.current.scrollBy({ left: dir * 200, behavior: 'smooth' })
  }
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
  const isDay = slice(hourly.is_day ?? [])

  return (
    <div className="card">
      <div className="section-label">HOURLY FORECAST</div>
      <div className="hourly-scroll-wrapper">
        <button className="hourly-nav hourly-nav-left" onClick={() => scroll(-1)} aria-label="Scroll left">‹</button>
        <div className="hourly-scroll" ref={scrollRef}>
        {hours.map((time, i) => {
          const label = i === 0
            ? 'Now'
            : new Date(time).toLocaleTimeString('en-US', {
                hour: 'numeric', hour12: true, timeZone: timezone,
              })
          const info = getWeatherInfo(codes[i], !isDay[i])
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
        <button className="hourly-nav hourly-nav-right" onClick={() => scroll(1)} aria-label="Scroll right">›</button>
      </div>
    </div>
  )
}
