import { useRef, useEffect, useState, useLayoutEffect, useId } from 'react'
import { getWeatherInfo, liveWeatherCode, nowcastHourlyCode, precipTier, toTemp, tempStyle, tempColor, displayPrecipChance } from '../utils/weatherCodes'
import { WeatherIcon } from './WeatherIcon'

const GRAPH_HEIGHT = 60
const GRAPH_PAD = 12

// Smooth cubic-bezier path through the points (Catmull-Rom → Bézier).
function smoothPath(pts) {
  if (pts.length < 2) return ''
  let d = `M ${pts[0][0]} ${pts[0][1]}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] || p2
    const c1x = p1[0] + (p2[0] - p0[0]) / 6
    const c1y = p1[1] + (p2[1] - p0[1]) / 6
    const c2x = p2[0] - (p3[0] - p1[0]) / 6
    const c2y = p2[1] - (p3[1] - p1[1]) / 6
    d += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${p2[0]} ${p2[1]}`
  }
  return d
}

export function HourlyForecast({ hourly, timezone, unit, colorCoding = true, glow = true, frost = true, current, minutely, radarClear = null }) {
  const scrollRef = useRef(null)
  const rowRef = useRef(null)
  const gradId = useId()
  const [centers, setCenters] = useState([])

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

  const todayStr = now.toLocaleDateString('en-CA', { timeZone: timezone })
  const startIdx = hourly.time.findIndex((t) => t.startsWith(`${todayStr}T${currentHourStr}`))
  const start = startIdx === -1 ? 0 : startIdx
  const slice = (arr) => arr.slice(start, start + 25)

  const hours = slice(hourly.time)
  const temps = slice(hourly.temperature_2m)
  const codes = slice(hourly.weather_code)
  const precip = slice(hourly.precipitation_probability)
  const isDay = slice(hourly.is_day ?? [])

  // Measure the horizontal center of every hour column so the graph points
  // line up exactly with the items, even as widths change with the unit.
  useLayoutEffect(() => {
    const row = rowRef.current
    if (!row) return
    const measure = () => {
      setCenters(Array.from(row.children).map((el) => el.offsetLeft + el.offsetWidth / 2))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(row)
    return () => ro.disconnect()
  }, [hours.length, unit])

  // Build the temperature line graph once columns have been measured.
  const tMin = Math.min(...temps)
  const tMax = Math.max(...temps)
  const tRange = tMax - tMin || 1
  const yFor = (t) => GRAPH_PAD + (1 - (t - tMin) / tRange) * (GRAPH_HEIGHT - 2 * GRAPH_PAD)
  const points = centers.length === temps.length
    ? centers.map((x, i) => [x, yFor(temps[i])])
    : []
  const linePath = smoothPath(points)
  const areaPath = points.length
    ? `${linePath} L ${points[points.length - 1][0]} ${GRAPH_HEIGHT} L ${points[0][0]} ${GRAPH_HEIGHT} Z`
    : ''
  const xMin = points.length ? points[0][0] : 0
  const xMax = points.length ? points[points.length - 1][0] : 1
  const lineGradId = `hourly-line-${gradId}`
  const areaGradId = `hourly-area-${gradId}`
  const stroke = colorCoding ? `url(#${lineGradId})` : 'var(--accent)'

  return (
    <div className="card">
      <div className="section-label">HOURLY FORECAST</div>
      <div className="hourly-scroll-wrapper">
        <button className="hourly-nav hourly-nav-left" onClick={() => scroll(-1)} aria-label="Scroll left">‹</button>
        <div className="hourly-scroll" ref={scrollRef}>
        <div className="hourly-track">
        <div className="hourly-row" ref={rowRef}>
        {hours.map((time, i) => {
          const label = i === 0
            ? 'Now'
            : new Date(time).toLocaleTimeString('en-US', {
                hour: 'numeric', hour12: true, timeZone: timezone,
              })
          // Slot 0 ("Now"): use the live rate-corrected code so it matches the
          // current conditions card. All other slots: run the minutely_15 nowcast
          // check — if nothing is forecast to fall during that hour's window, the
          // NWS code is premature and gets downgraded to a sky condition.
          const displayCode = i === 0 && current
            ? (liveWeatherCode(current, minutely, radarClear) ?? codes[i])
            : nowcastHourlyCode(codes[i], minutely, hours[i], current?.cloud_cover)
          const info = getWeatherInfo(displayCode, !isDay[i])
          // When the corrected code carries no precipitation, zero out the chance
          // so the display is internally consistent (no "Clear Sky, 75%").
          const nowPrecip = precipTier(displayCode) === 0 ? 0 : precip[i]
          const p = displayPrecipChance(displayCode, nowPrecip)
          const precipClass = p >= 30 ? 'hourly-precip high' : p > 0 ? 'hourly-precip low' : 'hourly-precip zero'
          return (
            <div key={i} className="hourly-item">
              <span className="hourly-time">{label}</span>
              <span className="hourly-icon"><WeatherIcon id={info.icon} alt={info.label} /></span>
              <span className="hourly-temp" style={tempStyle(temps[i], colorCoding, 0.4, glow, frost)}>{toTemp(temps[i], unit)}°</span>
              <span className={precipClass}>{p}%</span>
            </div>
          )
        })}
        </div>
        {points.length > 0 && (
          <svg
            className="hourly-graph"
            height={GRAPH_HEIGHT}
            aria-hidden="true"
          >
            <defs>
              <linearGradient id={lineGradId} gradientUnits="userSpaceOnUse" x1={xMin} y1="0" x2={xMax} y2="0">
                {temps.map((t, i) => (
                  <stop
                    key={i}
                    offset={`${((points[i][0] - xMin) / (xMax - xMin || 1)) * 100}%`}
                    stopColor={tempColor(t)}
                  />
                ))}
              </linearGradient>
              <linearGradient id={areaGradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={stroke === 'var(--accent)' ? 'var(--accent)' : tempColor(tMax)} stopOpacity="0.22" />
                <stop offset="100%" stopColor={stroke === 'var(--accent)' ? 'var(--accent)' : tempColor(tMin)} stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={areaPath} fill={`url(#${areaGradId})`} stroke="none" />
            <path d={linePath} fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            {points.map(([x, y], i) => (
              <circle key={i} cx={x} cy={y} r="2.5" fill={colorCoding ? tempColor(temps[i]) : 'var(--accent)'} />
            ))}
          </svg>
        )}
        </div>
        </div>
        <button className="hourly-nav hourly-nav-right" onClick={() => scroll(1)} aria-label="Scroll right">›</button>
      </div>
    </div>
  )
}
