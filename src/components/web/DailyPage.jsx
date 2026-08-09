import { useState } from 'react'
import { ChevronDown, Droplets, Sunrise, Sunset, Sun, Wind } from 'lucide-react'
import { WeatherIcon } from '../WeatherIcon'
import {
  displayPrecipChance, formatHour, formatTime, getUVLabel, getWeatherInfo, nowcastHourlyCode,
  precipTier, tempColor, tempStyle, toTemp,
} from '../../utils/weatherCodes'
import { niceBounds, smoothPath, useMeasure } from './chartUtils'
import { formatPrecip, formatWind } from '../../utils/units'
import { averageAt, daylightLength, hourIndexesForDate, shortDate, weekdayLabel } from './webData'

const CHART_H = 190
const PAD_TOP = 30
const PAD_BOTTOM = 42

// Both curves of the week at once. The band between them is the day's swing,
// which is the thing a range bar per row can't show — whether the week is
// warming, cooling, or just wobbling.
function WeekChart({ daily, timezone, unit, colorCoding }) {
  const [ref, width] = useMeasure()
  const highs = daily.temperature_2m_max
  const lows = daily.temperature_2m_min
  const { min, max } = niceBounds([...highs, ...lows], 5, 3)
  const inner = Math.max(width - 60, 0)
  const step = highs.length > 1 ? inner / (highs.length - 1) : 0
  const x = (i) => 30 + i * step
  const y = (t) => PAD_TOP + (1 - (t - min) / (max - min || 1)) * (CHART_H - PAD_TOP - PAD_BOTTOM)

  const highPts = highs.map((t, i) => [x(i), y(t)])
  const lowPts = lows.map((t, i) => [x(i), y(t)])
  const highLine = smoothPath(highPts)
  const lowLine = smoothPath(lowPts)
  // Close the band by running the high curve forward, dropping to the last low
  // point, then tracing the low curve back. The reversed curve's own "move to"
  // would lift the pen and break the fill, so it becomes a "line to" instead.
  const lowReturn = smoothPath([...lowPts].reverse()).replace(/^M/, 'L')
  const band = highPts.length ? `${highLine} ${lowReturn} Z` : ''

  return (
    <div className="web-chart" ref={ref}>
      {width > 0 && (
        <svg width={width} height={CHART_H} role="img" aria-label="Weekly high and low temperatures">
          <defs>
            <linearGradient id="web-week-band" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={colorCoding ? tempColor(max) : 'var(--graph-line)'} stopOpacity="0.22" />
              <stop offset="100%" stopColor={colorCoding ? tempColor(min) : 'var(--graph-line)'} stopOpacity="0.06" />
            </linearGradient>
          </defs>
          <path d={band} fill="url(#web-week-band)" stroke="none" />
          <path d={lowLine} fill="none" stroke="var(--graph-line)" strokeWidth="2" strokeOpacity="0.45" strokeLinecap="round" strokeDasharray="4 4" />
          <path d={highLine} fill="none" stroke="var(--graph-line)" strokeWidth="2.5" strokeLinecap="round" />
          {highPts.map(([px, py], i) => (
            <g key={`h${i}`}>
              <circle cx={px} cy={py} r="3.5" fill={colorCoding ? tempColor(highs[i]) : 'var(--graph-line)'} />
              <text className="web-chart-temp" x={px} y={py - 11}>{toTemp(highs[i], unit)}°</text>
            </g>
          ))}
          {lowPts.map(([px, py], i) => (
            <g key={`l${i}`}>
              <circle cx={px} cy={py} r="3.5" fill={colorCoding ? tempColor(lows[i]) : 'var(--graph-line)'} fillOpacity="0.7" />
              <text className="web-chart-temp web-chart-temp--low" x={px} y={py + 18}>{toTemp(lows[i], unit)}°</text>
            </g>
          ))}
          {daily.time.map((d, i) => (
            <text key={d} className="web-chart-axis" x={x(i)} y={CHART_H - 12}>
              {weekdayLabel(d, timezone)}
            </text>
          ))}
        </svg>
      )}
    </div>
  )
}

function DayStat({ icon: Icon, label, value, color }) {
  return (
    <div className="web-day-stat">
      <Icon size={15} style={color ? { color } : undefined} aria-hidden="true" />
      <span className="web-day-stat-label">{label}</span>
      <span className="web-day-stat-value" style={color ? { color } : undefined}>{value}</span>
    </div>
  )
}

export function DailyPage({ weather, unit, units, colorCoding }) {
  const [open, setOpen] = useState(0)
  const { daily, hourly, current, timezone } = weather

  const weekMin = Math.min(...daily.temperature_2m_min)
  const weekMax = Math.max(...daily.temperature_2m_max)
  const weekRange = weekMax - weekMin || 1

  return (
    <div className="web-page">
      <div className="card web-chart-card">
        <div className="web-page-head">
          <h2 className="web-page-title">7-day forecast</h2>
        </div>
        <WeekChart daily={daily} timezone={timezone} unit={unit} colorCoding={colorCoding.daily} />
      </div>

      <div className="card web-days-card">
        {daily.time.map((date, i) => {
          const info = getWeatherInfo(daily.weather_code[i], false)
          const chance = displayPrecipChance(daily.weather_code[i], daily.precipitation_probability_max?.[i])
          const uv = getUVLabel(daily.uv_index_max?.[i] ?? 0)
          const low = daily.temperature_2m_min[i]
          const high = daily.temperature_2m_max[i]
          const left = ((low - weekMin) / weekRange) * 100
          const barWidth = Math.max(((high - low) / weekRange) * 100, 4)
          const isOpen = open === i
          const idxs = hourIndexesForDate(hourly, date)
          const humidity = averageAt(hourly.relative_humidity_2m, idxs)

          return (
            <div key={date} className={`web-day${isOpen ? ' web-day--open' : ''}`}>
              <button
                className="web-day-row"
                onClick={() => setOpen(isOpen ? null : i)}
                aria-expanded={isOpen}
              >
                <span className="web-day-name">
                  <span className="web-day-weekday">{weekdayLabel(date, timezone)}</span>
                  <span className="web-day-date">{shortDate(date)}</span>
                </span>
                <span className="web-day-icon"><WeatherIcon id={info.icon} alt="" /></span>
                <span className="web-day-cond">{info.label}</span>
                <span className={`web-day-chance${chance >= 30 ? ' web-day-chance--high' : chance > 0 ? '' : ' web-day-chance--zero'}`}>
                  {chance}%
                </span>
                <span className="web-day-range">
                  <span
                    className="web-day-temp web-day-temp--low"
                    style={tempStyle(low, colorCoding.daily, 0.35, colorCoding.glow, colorCoding.frost)}
                  >
                    {toTemp(low, unit)}°
                  </span>
                  <span className="web-day-track">
                    <span
                      className="web-day-bar"
                      style={{
                        left: `${left}%`,
                        width: `${barWidth}%`,
                        background: colorCoding.daily
                          ? `linear-gradient(90deg, ${tempColor(low)}, ${tempColor(high)})`
                          : 'var(--graph-line)',
                      }}
                    />
                  </span>
                  <span
                    className="web-day-temp web-day-temp--high"
                    style={tempStyle(high, colorCoding.daily, 0.35, colorCoding.glow, colorCoding.frost)}
                  >
                    {toTemp(high, unit)}°
                  </span>
                </span>
                <ChevronDown size={18} className="web-day-chevron" aria-hidden="true" />
              </button>

              {isOpen && (
                <div className="web-day-body">
                  <div className="web-day-stats">
                    <DayStat
                      icon={Droplets}
                      label="Precipitation"
                      value={formatPrecip(daily.precipitation_sum?.[i], units)}
                    />
                    <DayStat
                      icon={Wind}
                      label="Max wind"
                      value={formatWind(daily.wind_speed_10m_max?.[i], units)}
                    />
                    <DayStat
                      icon={Sun}
                      label="Max UV"
                      value={daily.uv_index_max?.[i] != null ? `${Math.round(daily.uv_index_max[i])} · ${uv.label}` : '—'}
                      color={colorCoding.details ? uv.color : undefined}
                    />
                    <DayStat
                      icon={Droplets}
                      label="Avg humidity"
                      value={humidity != null ? `${Math.round(humidity)}%` : '—'}
                    />
                    <DayStat icon={Sunrise} label="Sunrise" value={formatTime(daily.sunrise[i], timezone)} />
                    <DayStat icon={Sunset} label="Sunset" value={formatTime(daily.sunset[i], timezone)} />
                    <DayStat icon={Sun} label="Daylight" value={daylightLength(daily.sunrise[i], daily.sunset[i]) ?? '—'} />
                  </div>

                  <div className="web-day-hours">
                    {idxs.map((hi) => {
                      const code = nowcastHourlyCode(
                        hourly.weather_code[hi], weather.minutely_15, hourly.time[hi], current,
                      )
                      const hInfo = getWeatherInfo(code, !hourly.is_day?.[hi])
                      const hChance = displayPrecipChance(code, precipTier(code) === 0 ? 0 : hourly.precipitation_probability?.[hi])
                      return (
                        <div key={hourly.time[hi]} className="web-day-hour">
                          <span className="web-day-hour-time">{formatHour(hourly.time[hi], timezone)}</span>
                          <span className="web-day-hour-icon"><WeatherIcon id={hInfo.icon} alt="" /></span>
                          <span
                            className="web-day-hour-temp"
                            style={tempStyle(hourly.temperature_2m[hi], colorCoding.hourly, 0.3, colorCoding.glow, colorCoding.frost)}
                          >
                            {toTemp(hourly.temperature_2m[hi], unit)}°
                          </span>
                          <span className={`web-day-hour-precip${hChance >= 30 ? ' web-day-hour-precip--high' : hChance > 0 ? '' : ' web-day-hour-precip--zero'}`}>
                            {hChance}%
                          </span>
                        </div>
                      )
                    })}
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
