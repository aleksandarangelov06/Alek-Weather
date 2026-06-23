import { useState, useRef, useCallback } from 'react'
import { getWeatherInfo, formatDay, toTemp, tempColor, tempStyle, displayPrecipChance } from '../utils/weatherCodes'
import { WeatherIcon } from './WeatherIcon'

export function DailyForecast({ daily, hourly, timezone, unit, colorCoding = true, glow = true }) {
  const [expanded, setExpanded] = useState(null)
  const toggle = (date) => setExpanded(v => v === date ? null : date)

  const scrollRef = useRef(null)
  const cleanupRef = useRef(null)

  // Callback ref: bind the wheel listener the moment the strip mounts so vertical
  // wheel scrolling moves the strip horizontally — same as the hourly forecast.
  const setScrollEl = useCallback((el) => {
    if (cleanupRef.current) { cleanupRef.current(); cleanupRef.current = null }
    scrollRef.current = el
    if (!el) return
    const onWheel = (e) => {
      e.preventDefault()
      el.scrollLeft += e.deltaY + e.deltaX
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    cleanupRef.current = () => el.removeEventListener('wheel', onWheel)
  }, [])

  const scroll = (dir) => {
    if (!scrollRef.current) return
    scrollRef.current.scrollBy({ left: dir * 200, behavior: 'smooth' })
  }

  const maxTemps = daily.temperature_2m_max
  const minTemps = daily.temperature_2m_min
  const weekMin = Math.min(...minTemps)
  const weekMax = Math.max(...maxTemps)
  const range = weekMax - weekMin || 1

  // Build the hourly entries that fall on a given day (date is "YYYY-MM-DD").
  const hoursForDay = (date) => {
    if (!hourly?.time) return []
    const out = []
    for (let i = 0; i < hourly.time.length; i++) {
      if (!hourly.time[i].startsWith(date)) continue
      out.push({
        time: hourly.time[i],
        temp: hourly.temperature_2m[i],
        code: hourly.weather_code[i],
        // Trust the condition: floor the chance so a rain icon never reads 0%.
        precip: displayPrecipChance(hourly.weather_code[i], hourly.precipitation_probability?.[i]),
        isDay: hourly.is_day?.[i],
      })
    }
    return out
  }

  return (
    <div className="card">
      <div className="section-label">7-DAY FORECAST</div>
      <div className="daily-list">
        {daily.time.map((date, i) => {
          const info = getWeatherInfo(daily.weather_code[i])
          const high = toTemp(maxTemps[i], unit)
          const low = toTemp(minTemps[i], unit)
          // Floor against the day's condition so the row's % never undercuts its
          // own rain icon. This is the day's peak chance, not "right now".
          const precip = displayPrecipChance(daily.weather_code[i], daily.precipitation_probability_max[i])

          // Map this day's low→high onto the week's overall range so pill
          // position and width carry the actual temperature magnitudes. The
          // low/high numbers ride the pill's ends (see .daily-range CSS), so the
          // whole cluster shifts and scales together — quick to compare at a glance.
          const barLeft = ((minTemps[i] - weekMin) / range) * 100
          const barWidth = ((maxTemps[i] - minTemps[i]) / range) * 100
          const pillWidth = Math.max(barWidth, 8) // keep a capsule even for flat days
          const pillLeft = Math.min(barLeft, 100 - pillWidth)
          const pillRight = pillLeft + pillWidth

          const p = precip ?? 0
          const isExpanded = expanded === date
          const hours = isExpanded ? hoursForDay(date) : []
          return (
            <div key={date}>
              <div
                className={`daily-row daily-row--expand${isExpanded ? ' daily-row--active' : ''}`}
                onClick={() => toggle(date)}
                role="button"
                aria-expanded={isExpanded}
              >
                <span className="daily-icon"><WeatherIcon id={info.icon} alt={info.label} /></span>
                <div className="daily-day-cell">
                  <span className="daily-day">{formatDay(date)}</span>
                  {p > 0 && <span className="daily-precip-label">{p}%</span>}
                </div>
                <div className="daily-range">
                  <div className="daily-range-inner">
                    <span className="daily-low" style={{ ...tempStyle(minTemps[i], colorCoding, 0.4, glow), left: `${pillLeft}%` }}>{low}°</span>
                    <div className="bar-fill" style={{
                      left: `${pillLeft}%`,
                      width: `${pillWidth}%`,
                      background: colorCoding
                        ? `linear-gradient(90deg, ${tempColor(minTemps[i])}, ${tempColor(maxTemps[i])})`
                        : 'var(--bar-track-bg)',
                    }} />
                    <span className="daily-high" style={{ ...tempStyle(maxTemps[i], colorCoding, 0.4, glow), left: `${pillRight}%` }}>{high}°</span>
                  </div>
                </div>
              </div>

              {isExpanded && hours.length > 0 && (
                <div className="detail-expansion">
                  <div className="hourly-scroll-wrapper">
                  <button className="hourly-nav hourly-nav-left" onClick={() => scroll(-1)} aria-label="Scroll left">‹</button>
                  <div className="hourly-scroll" ref={setScrollEl}>
                    {/* .hourly-track composites the scrolled content (will-change:
                        transform) so horizontal scroll is a cheap GPU translate —
                        same fix as the main hourly forecast strip. */}
                    <div className="hourly-track">
                    <div className="hourly-row">
                    {hours.map((h, hi) => {
                      const hInfo = getWeatherInfo(h.code, !h.isDay)
                      const label = new Date(h.time).toLocaleTimeString('en-US', {
                        hour: 'numeric', hour12: true, timeZone: timezone,
                      })
                      const precipClass = h.precip >= 30 ? 'hourly-precip high' : h.precip > 0 ? 'hourly-precip low' : 'hourly-precip zero'
                      return (
                        <div key={hi} className="hourly-item">
                          <span className="hourly-time">{label}</span>
                          <span className="hourly-icon"><WeatherIcon id={hInfo.icon} alt={hInfo.label} /></span>
                          <span className="hourly-temp" style={tempStyle(h.temp, colorCoding, 0.4, glow)}>{toTemp(h.temp, unit)}°</span>
                          <span className={precipClass}>{h.precip}%</span>
                        </div>
                      )
                    })}
                    </div>
                    </div>
                  </div>
                  <button className="hourly-nav hourly-nav-right" onClick={() => scroll(1)} aria-label="Scroll right">›</button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
