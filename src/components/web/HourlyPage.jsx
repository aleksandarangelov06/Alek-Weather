import { useState } from 'react'
import { Navigation2 } from 'lucide-react'
import { WeatherIcon } from '../WeatherIcon'
import {
  displayPrecipChance, formatHour, getUVLabel, getWeatherInfo, getWindDirection, liveWeatherCode,
  nowcastHourlyCode, precipTier, tempStyle, toTemp,
} from '../../utils/weatherCodes'
import { HourlyChart, COL_W } from './HourlyChart'
import { currentHourIndex, shortDate, sliceHourly, weekdayLabel } from './webData'

const RANGES = [24, 48, 72]

// Sunrise and sunset falling inside the charted window, placed on the same
// x-scale as the hours. The daily times are naive local strings, so the hour
// they belong to is a prefix match and the minutes are a fraction of a column —
// no Date parsing, which would reinterpret them in the browser's timezone.
function sunEventsFor(hours, daily) {
  const out = []
  const slot = (iso) => {
    const i = hours.findIndex((h) => h.slice(0, 13) === iso.slice(0, 13))
    return i === -1 ? null : i + (+iso.slice(14, 16)) / 60
  }
  for (const type of ['sunrise', 'sunset']) {
    for (const iso of daily[type] ?? []) {
      const at = slot(iso)
      if (at != null) out.push({ type, iso, x: at * COL_W + COL_W / 2 })
    }
  }
  return out
}

export function HourlyPage({ weather, unit, radarClear, colorCoding, weatherAnimations = true }) {
  const [range, setRange] = useState(48)
  const [showFeels, setShowFeels] = useState(false)
  const { current, hourly, daily, timezone } = weather
  const start = currentHourIndex(hourly, timezone)
  const available = hourly.time.length - start
  const count = Math.min(range, available)
  const h = sliceHourly(hourly, start, count)

  // Every hour's code, corrected the same way the mobile strip corrects it, so
  // the chart, the table and the current conditions card never disagree.
  const codes = h.time.map((t, i) => (
    i === 0
      ? (liveWeatherCode(current, weather.minutely_15, radarClear) ?? h.code[i])
      : nowcastHourlyCode(h.code[i], weather.minutely_15, t, current.cloud_cover)
  ))

  const hasFeels = h.feels.some((v) => v != null)

  // Table rows, split into one group per calendar day.
  const groups = []
  h.time.forEach((t, i) => {
    const date = t.slice(0, 10)
    if (!groups.length || groups[groups.length - 1].date !== date) groups.push({ date, rows: [] })
    groups[groups.length - 1].rows.push(i)
  })

  return (
    <div className="web-page">
      <div className="card web-chart-card">
        <div className="web-page-head">
          <div>
            <h2 className="web-page-title">Hourly forecast</h2>
            <p className="web-page-sub">Temperature and chance of precipitation, hour by hour.</p>
          </div>
          <div className="web-head-controls">
            {hasFeels && (
              <button
                className={`web-switch${showFeels ? ' web-switch--on' : ''}`}
                onClick={() => setShowFeels((v) => !v)}
                role="switch"
                aria-checked={showFeels}
              >
                <span className="web-switch-track"><span className="web-switch-knob" /></span>
                Feels like
              </button>
            )}
            <div className="web-seg" role="group" aria-label="Forecast range">
              {RANGES.map((r) => (
                <button
                  key={r}
                  className={`web-seg-btn${range === r ? ' web-seg-btn--active' : ''}`}
                  onClick={() => setRange(r)}
                  aria-pressed={range === r}
                >
                  {r}h
                </button>
              ))}
            </div>
          </div>
        </div>

        <HourlyChart
          hours={h.time}
          codes={codes}
          tempsF={h.temp}
          feelsF={h.feels}
          precip={h.precip}
          isDay={h.isDay}
          sunEvents={sunEventsFor(h.time, daily)}
          unit={unit}
          colorCoding={colorCoding.hourly}
          animate={weatherAnimations}
          showFeels={showFeels && hasFeels}
        />
      </div>

      <div className="card web-table-card">
        <div className="web-table-head">
          <span>Time</span>
          <span>Conditions</span>
          <span className="web-num">Temp</span>
          <span className="web-num">Precip</span>
          <span className="web-num">Wind</span>
          <span className="web-num">Humidity</span>
          <span className="web-num">UV</span>
        </div>
        {groups.map((g) => (
          <div key={g.date} className="web-table-group">
            <div className="web-table-day">
              <span className="web-table-dayname">{weekdayLabel(g.date, timezone)}</span>
              <span className="web-table-daydate">{shortDate(g.date)}</span>
            </div>
            {g.rows.map((i) => {
              const info = getWeatherInfo(codes[i], !h.isDay[i])
              const chance = displayPrecipChance(codes[i], precipTier(codes[i]) === 0 ? 0 : h.precip[i])
              const uv = getUVLabel(h.uv[i] ?? 0)
              return (
                <div key={h.time[i]} className={`web-table-row${i === 0 ? ' web-table-row--now' : ''}`}>
                  <span className="web-table-time">{i === 0 ? 'Now' : formatHour(h.time[i], timezone)}</span>
                  <span className="web-table-cond">
                    <span className="web-table-icon"><WeatherIcon id={info.icon} alt="" /></span>
                    {info.label}
                  </span>
                  <span
                    className="web-num web-table-temp"
                    style={tempStyle(h.temp[i], colorCoding.hourly, 0.35, colorCoding.glow, colorCoding.frost)}
                  >
                    {toTemp(h.temp[i], unit)}°
                  </span>
                  <span className={`web-num web-table-precip${chance >= 30 ? ' web-table-precip--high' : chance > 0 ? '' : ' web-table-precip--zero'}`}>
                    {chance}%
                  </span>
                  <span className="web-num web-table-wind">
                    {h.windDir[i] != null && (
                      <Navigation2
                        size={12}
                        className="web-wind-arrow"
                        style={{ transform: `rotate(${h.windDir[i] + 180}deg)` }}
                        aria-hidden="true"
                      />
                    )}
                    {h.wind[i] != null ? `${Math.round(h.wind[i])}` : '—'}
                    <span className="web-unit"> mph {h.windDir[i] != null ? getWindDirection(h.windDir[i]) : ''}</span>
                  </span>
                  <span className="web-num">{h.humidity[i] != null ? `${Math.round(h.humidity[i])}%` : '—'}</span>
                  <span className="web-num" style={colorCoding.details && h.uv[i] != null ? { color: uv.color } : undefined}>
                    {h.uv[i] != null ? Math.round(h.uv[i]) : '—'}
                  </span>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
