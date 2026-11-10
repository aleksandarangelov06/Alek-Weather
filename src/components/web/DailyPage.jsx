import { useRef, useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, Droplets, Sunrise, Sunset, Sun, Umbrella, Wind } from 'lucide-react'
import { WeatherIcon } from '../WeatherIcon'
import {
  formatHour, formatTime, getUVLabel, getWeatherInfo, nowcastHourlyCode,
  tempInk, tempStyle, toTemp,
} from '../../utils/weatherCodes'
import { niceBounds, smoothPath, useMeasure } from './chartUtils'
import { formatPrecip, formatWind } from '../../utils/units'
import { averageAt, daylightLength, hourIndexesForDate, shortDate, weekdayLabel } from './webData'
import { useMediaQuery } from './todayLayout'

// The width where the This week page switches from the stacked accordion to the
// week board. Matches the 1099px fold in WebApp.css.
export const BOARD_MQ = '(min-width: 1100px)'

const CHART_H = 190
const PAD_TOP = 30
const PAD_BOTTOM = 42

// Board plot: no axis row (the column headers above name the days), so the
// curve gets the whole height bar room for the labels above and below it.
const BOARD_PLOT_H = 170
const BOARD_PAD_TOP = 26
const BOARD_PAD_BOTTOM = 26

const chanceClass = (base, chance) =>
  `${base}${chance >= 30 ? ` ${base}--high` : chance > 0 ? '' : ` ${base}--zero`}`

function longDate(dateStr) {
  return new Date(`${dateStr}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

// Builds the high/low curves and the band between them for a set of x
// positions. Shared by the stacked chart and the board so both draw the same
// shape.
function weekCurves(daily, x, top, height) {
  const highs = daily.temperature_2m_max
  const lows = daily.temperature_2m_min
  const { min, max } = niceBounds([...highs, ...lows], 5, 3)
  const y = (t) => top + (1 - (t - min) / (max - min || 1)) * height
  const highPts = highs.map((t, i) => [x(i), y(t)])
  const lowPts = lows.map((t, i) => [x(i), y(t)])
  const highLine = smoothPath(highPts)
  const lowLine = smoothPath(lowPts)
  // Close the band by running the high curve forward, dropping to the last low
  // point, then tracing the low curve back. The reversed curve's own "move to"
  // would lift the pen and break the fill, so it becomes a "line to" instead.
  const lowReturn = smoothPath([...lowPts].reverse()).replace(/^M/, 'L')
  const band = highPts.length ? `${highLine} ${lowReturn} Z` : ''
  return { highs, lows, min, max, highPts, lowPts, highLine, lowLine, band }
}

function BandGradient({ id, min, max, colorCoding }) {
  return (
    <defs>
      <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" style={{ stopColor: colorCoding ? tempInk(max) : 'var(--graph-line)' }} stopOpacity="0.22" />
        <stop offset="100%" style={{ stopColor: colorCoding ? tempInk(min) : 'var(--graph-line)' }} stopOpacity="0.06" />
      </linearGradient>
    </defs>
  )
}

// Both curves of the week at once. The band between them is the day's swing,
// which is the thing a range bar per row can't show — whether the week is
// warming, cooling, or just wobbling. Used by the stacked (narrow) layout.
function WeekChart({ daily, timezone, unit, colorCoding }) {
  const [ref, width] = useMeasure()
  const n = daily.time.length
  const inner = Math.max(width - 60, 0)
  const step = n > 1 ? inner / (n - 1) : 0
  const x = (i) => 30 + i * step
  const c = weekCurves(daily, x, PAD_TOP, CHART_H - PAD_TOP - PAD_BOTTOM)

  return (
    <div className="web-chart" ref={ref}>
      {width > 0 && (
        <svg width={width} height={CHART_H} role="img" aria-label="Weekly high and low temperatures">
          <BandGradient id="web-week-band" min={c.min} max={c.max} colorCoding={colorCoding} />
          <path d={c.band} fill="url(#web-week-band)" stroke="none" />
          <path d={c.lowLine} fill="none" stroke="var(--graph-line)" strokeWidth="2" strokeOpacity="0.45" strokeLinecap="round" strokeDasharray="4 4" />
          <path d={c.highLine} fill="none" stroke="var(--graph-line)" strokeWidth="2.5" strokeLinecap="round" />
          {c.highPts.map(([px, py], i) => (
            <g key={`h${i}`}>
              <circle cx={px} cy={py} r="3.5" style={{ fill: colorCoding ? tempInk(c.highs[i]) : 'var(--graph-line)' }} />
              <text className="web-chart-temp" x={px} y={py - 11}>{toTemp(c.highs[i], unit)}°</text>
            </g>
          ))}
          {c.lowPts.map(([px, py], i) => (
            <g key={`l${i}`}>
              <circle cx={px} cy={py} r="3.5" style={{ fill: colorCoding ? tempInk(c.lows[i]) : 'var(--graph-line)' }} fillOpacity="0.7" />
              <text className="web-chart-temp web-chart-temp--low" x={px} y={py + 18}>{toTemp(c.lows[i], unit)}°</text>
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

// Desktop: the week as one board. Each day is a column — its header (day,
// icon, rain chance) and its slice of the temperature curve stacked in the
// same clickable strip — so the chart and the days can't be read against the
// wrong one, and picking a day is a single click on whatever part of it caught
// the eye. The selected column stays lit; the panel below shows that day.
function WeekBoard({ daily, timezone, unit, colorCoding, selected, onSelect }) {
  const [ref, width] = useMeasure()
  const tabs = useRef([])
  const n = daily.time.length
  const col = n ? width / n : 0
  const x = (i) => (i + 0.5) * col
  const c = weekCurves(daily, x, BOARD_PAD_TOP, BOARD_PLOT_H - BOARD_PAD_TOP - BOARD_PAD_BOTTOM)

  const onKeyDown = (e) => {
    let next = null
    if (e.key === 'ArrowRight') next = Math.min(selected + 1, n - 1)
    else if (e.key === 'ArrowLeft') next = Math.max(selected - 1, 0)
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = n - 1
    if (next == null) return
    e.preventDefault()
    onSelect(next)
    tabs.current[next]?.focus()
  }

  return (
    <div className="web-board" ref={ref} style={{ '--board-n': n, '--board-plot-h': `${BOARD_PLOT_H}px` }}>
      <div className="web-board-cols" role="tablist" aria-label="Day" onKeyDown={onKeyDown}>
        {daily.time.map((date, i) => {
          const info = getWeatherInfo(daily.weather_code[i], false)
          const chance = daily.precipitation_probability_max?.[i] ?? 0
          const isSel = selected === i
          return (
            <button
              key={date}
              ref={(el) => { tabs.current[i] = el }}
              type="button"
              role="tab"
              id={`web-board-tab-${i}`}
              aria-selected={isSel}
              aria-controls="web-dayview"
              tabIndex={isSel ? 0 : -1}
              className={`web-board-day${isSel ? ' web-board-day--sel' : ''}`}
              onClick={() => onSelect(i)}
              title={`${longDate(date)} · ${info.label}`}
            >
              <span className="web-board-weekday">{weekdayLabel(date, timezone)}</span>
              <span className="web-board-date">{shortDate(date)}</span>
              <span className="web-day-icon web-board-icon"><WeatherIcon id={info.icon} alt="" /></span>
              <span className={chanceClass('web-board-chance', chance)}>
                <Droplets size={12} aria-hidden="true" />
                {chance}%
              </span>
              <span className="web-board-plot-space" aria-hidden="true" />
              <span className="web-sr-only">
                {`, ${info.label}, high ${toTemp(c.highs[i], unit)}°, low ${toTemp(c.lows[i], unit)}°`}
              </span>
            </button>
          )
        })}
      </div>

      {width > 0 && (
        <svg
          className="web-board-plot"
          width={width}
          height={BOARD_PLOT_H}
          aria-hidden="true"
        >
          <BandGradient id="web-board-band" min={c.min} max={c.max} colorCoding={colorCoding} />
          <path d={c.band} fill="url(#web-board-band)" stroke="none" />
          <path d={c.lowLine} fill="none" stroke="var(--graph-line)" strokeWidth="2" strokeOpacity="0.45" strokeLinecap="round" strokeDasharray="4 4" />
          <path d={c.highLine} fill="none" stroke="var(--graph-line)" strokeWidth="2.5" strokeLinecap="round" />
          {c.highPts.map(([px, py], i) => (
            <g key={`h${i}`}>
              <circle cx={px} cy={py} r={selected === i ? 5 : 3.5} style={{ fill: colorCoding ? tempInk(c.highs[i]) : 'var(--graph-line)' }} />
              <text className={`web-chart-temp${selected === i ? ' web-board-temp--sel' : ''}`} x={px} y={py - 11}>{toTemp(c.highs[i], unit)}°</text>
            </g>
          ))}
          {c.lowPts.map(([px, py], i) => (
            <g key={`l${i}`}>
              <circle cx={px} cy={py} r={selected === i ? 4.5 : 3.5} style={{ fill: colorCoding ? tempInk(c.lows[i]) : 'var(--graph-line)' }} fillOpacity="0.7" />
              <text className={`web-chart-temp web-chart-temp--low${selected === i ? ' web-board-temp--sel' : ''}`} x={px} y={py + 18}>{toTemp(c.lows[i], unit)}°</text>
            </g>
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

function DayStats({ weather, i, units, colorCoding, withChance, list }) {
  const { daily, hourly, timezone } = weather
  const uv = getUVLabel(daily.uv_index_max?.[i] ?? 0)
  const humidity = averageAt(hourly.relative_humidity_2m, hourIndexesForDate(hourly, daily.time[i]))
  return (
    <div className={`web-day-stats${list ? ' web-day-stats--list' : ''}`}>
      {withChance && (
        <DayStat icon={Umbrella} label="Chance of rain" value={`${daily.precipitation_probability_max?.[i] ?? 0}%`} />
      )}
      <DayStat icon={Droplets} label="Precipitation" value={formatPrecip(daily.precipitation_sum?.[i], units)} />
      <DayStat icon={Wind} label="Max wind" value={formatWind(daily.wind_speed_10m_max?.[i], units)} />
      <DayStat
        icon={Sun}
        label="Max UV"
        value={daily.uv_index_max?.[i] != null ? `${Math.round(daily.uv_index_max[i])} · ${uv.label}` : '-'}
        color={colorCoding.details ? uv.color : undefined}
      />
      <DayStat icon={Droplets} label="Avg humidity" value={humidity != null ? `${Math.round(humidity)}%` : '-'} />
      <DayStat icon={Sunrise} label="Sunrise" value={formatTime(daily.sunrise[i], timezone)} />
      <DayStat icon={Sunset} label="Sunset" value={formatTime(daily.sunset[i], timezone)} />
      <DayStat icon={Sun} label="Daylight" value={daylightLength(daily.sunrise[i], daily.sunset[i]) ?? '-'} />
    </div>
  )
}

function DayHours({ weather, date, unit, colorCoding }) {
  const { hourly, current, timezone } = weather
  return (
    <div className="web-day-hours">
      {hourIndexesForDate(hourly, date).map((hi) => {
        const code = nowcastHourlyCode(hourly.weather_code[hi], weather.minutely_15, hourly.time[hi], current)
        const hInfo = getWeatherInfo(code, !hourly.is_day?.[hi])
        const hChance = hourly.precipitation_probability?.[hi] ?? 0
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
            <span className={chanceClass('web-day-hour-precip', hChance)}>{hChance}%</span>
          </div>
        )
      })}
    </div>
  )
}

// Hourly chart geometry: the temperature curve on top, rain-chance bars under
// it (only when the day has any rain to show), hour labels along the bottom.
const HC_TEMP_TOP = 24
const HC_TEMP_SPAN = 118
const HC_BAR_GAP = 14
const HC_BAR_H = 40
const HC_LABEL_GAP = 22

// The selected day's hours as one chart that fills the panel instead of a strip
// that scrolls. Every hour is a column; icons, temperature and rain chance
// line up in it, and hovering a column reads the hour out in full above.
function HourChart({ weather, date, unit, colorCoding }) {
  const [ref, width] = useMeasure()
  const [hover, setHover] = useState(null)
  const { hourly, current, timezone } = weather
  const idxs = hourIndexesForDate(hourly, date)
  const n = idxs.length
  if (!n) return <p className="web-hc-empty">No hourly forecast for this day yet.</p>

  const colW = width / n
  // Thin out labels and icons when the columns get narrow, always keeping
  // the same hours so icon, temperature and time stay stacked together.
  const every = colW >= 46 ? 1 : colW >= 23 ? 2 : 3
  const x = (k) => (k + 0.5) * colW

  const temps = idxs.map((hi) => hourly.temperature_2m[hi])
  // The day's own range, not rounded out to nice numbers: there are no
  // gridlines to land on here, and rounding left a band of empty chart above
  // or below the curve. A floor on the span keeps a flat day from looking wild.
  const lo = Math.min(...temps)
  const hi = Math.max(...temps)
  const mid = (lo + hi) / 2
  const half = Math.max((hi - lo) / 2, 2)
  const min = mid - half
  const max = mid + half

  const hasRain = idxs.some((j) => (hourly.precipitation_probability?.[j] ?? 0) >= 5)
  const HC_TEMP_BOTTOM = HC_TEMP_TOP + HC_TEMP_SPAN
  const HC_BAR_BOTTOM = hasRain ? HC_TEMP_BOTTOM + HC_BAR_GAP + HC_BAR_H : HC_TEMP_BOTTOM + 8
  const HC_BAR_TOP = HC_BAR_BOTTOM - HC_BAR_H
  const HC_LABEL_Y = HC_BAR_BOTTOM + HC_LABEL_GAP
  const HC_H = HC_LABEL_Y + 6
  const y =(t) => HC_TEMP_TOP + (1 - (t - min) / (max - min || 1)) * (HC_TEMP_BOTTOM - HC_TEMP_TOP)
  const pts = temps.map((t, k) => [x(k), y(t)])
  const line = smoothPath(pts)
  const area = pts.length ? `${line} L${x(n - 1)},${HC_TEMP_BOTTOM} L${x(0)},${HC_TEMP_BOTTOM} Z` : ''

  const hours = idxs.map((hi) => {
    const code = nowcastHourlyCode(hourly.weather_code[hi], weather.minutely_15, hourly.time[hi], current)
    return {
      time: hourly.time[hi],
      label: formatHour(hourly.time[hi], timezone),
      info: getWeatherInfo(code, !hourly.is_day?.[hi]),
      temp: hourly.temperature_2m[hi],
      chance: hourly.precipitation_probability?.[hi] ?? 0,
    }
  })
  const nowKey = current?.time?.slice(0, 13)
  const nowK = nowKey ? hours.findIndex((h) => h.time.slice(0, 13) === nowKey) : -1
  const h = hover != null ? hours[hover] : null
  const ink = (t) => (colorCoding.hourly ? tempInk(t) : 'var(--graph-line)')

  return (
    <div className="web-hc-wrap">
      <div className="web-hc-head">
        <div className="section-label">HOUR BY HOUR</div>
        <div className="web-hc-readout" aria-live="polite">
          {h ? (
            <>
              <strong>{h.label}</strong>
              <span>{h.info.label}</span>
              <strong style={tempStyle(h.temp, colorCoding.hourly, 0.3, colorCoding.glow, colorCoding.frost)}>{toTemp(h.temp, unit)}°</strong>
              <span className="web-hc-readout-rain"><Droplets size={12} aria-hidden="true" />{h.chance}%</span>
            </>
          ) : (
            <span className="web-hc-hint">{hasRain ? 'Point at an hour for details' : 'No rain expected · point at an hour for details'}</span>
          )}
        </div>
      </div>

      <div className="web-hc" ref={ref} style={{ '--hc-n': n }} onMouseLeave={() => setHover(null)}>
        <div className="web-hc-icons" aria-hidden="true">
          {hours.map((hr, k) => (
            <span key={hr.time} className="web-hc-icon">
              {k % every === 0 && <WeatherIcon id={hr.info.icon} alt="" />}
            </span>
          ))}
        </div>

        {width > 0 && (
          <svg width={width} height={HC_H} role="img" aria-label="Hourly temperature and chance of rain">
            <defs>
              <linearGradient id="web-hc-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" style={{ stopColor: ink(max) }} stopOpacity="0.24" />
                <stop offset="100%" style={{ stopColor: ink(min) }} stopOpacity="0.02" />
              </linearGradient>
            </defs>

            {hover != null && (
              <rect className="web-hc-hover" x={hover * colW + 1} y={0} width={colW - 2} height={HC_H} rx="8" />
            )}
            {nowK >= 0 && (
              <g>
                <line className="web-hc-now" x1={x(nowK)} x2={x(nowK)} y1={6} y2={HC_BAR_BOTTOM} />
                <text className="web-hc-now-label" x={x(nowK)} y={4}>Now</text>
              </g>
            )}

            <path d={area} fill="url(#web-hc-fill)" stroke="none" />
            <path d={line} fill="none" stroke="var(--graph-line)" strokeWidth="2.5" strokeLinecap="round" />
            {pts.map(([px, py], k) => (k % every === 0 || k === hover) && (
              <g key={hours[k].time}>
                <circle cx={px} cy={py} r={k === hover ? 5 : 3.5} style={{ fill: ink(temps[k]) }} />
                <text className={`web-chart-temp${k === hover ? ' web-board-temp--sel' : ''}`} x={px} y={py - 11}>
                  {toTemp(temps[k], unit)}°
                </text>
              </g>
            ))}

            <line className="web-chart-baseline" x1={0} x2={width} y1={HC_BAR_BOTTOM} y2={HC_BAR_BOTTOM} />
            {hasRain && hours.map((hr, k) => {
              const bh = (hr.chance / 100) * (HC_BAR_BOTTOM - HC_BAR_TOP)
              const bw = Math.max(Math.min(colW * 0.62, 22), 3)
              return bh > 0 && (
                <rect
                  key={hr.time}
                  className={`web-chart-bar${hr.chance >= 30 ? ' web-chart-bar--high' : ''}`}
                  x={x(k) - bw / 2}
                  y={HC_BAR_BOTTOM - bh}
                  width={bw}
                  height={bh}
                  rx={Math.min(3, bw / 2)}
                />
              )
            })}

            {hours.map((hr, k) => (k % every === 0 || k === hover) && (
              <text key={hr.time} className={`web-chart-axis${k === hover ? ' web-hc-axis--sel' : ''}`} x={x(k)} y={HC_LABEL_Y}>
                {hr.label}
              </text>
            ))}
          </svg>
        )}

        <div className="web-hc-hits" aria-hidden="true">
          {hours.map((hr, k) => (
            <span key={hr.time} onMouseEnter={() => setHover(k)} />
          ))}
        </div>
      </div>
    </div>
  )
}

// The selected day in full. The header carries the at-a-glance summary (icon,
// day, conditions, high/low) in one line; under it the hours are charted
// across most of the width with the day's numbers listed beside them.
// Prev/next name the day they go to, so stepping through the week doesn't
// mean going back up to the board.
function DayView({ weather, i, onSelect, unit, units, colorCoding }) {
  const { daily, timezone } = weather
  const date = daily.time[i]
  const n = daily.time.length
  const info = getWeatherInfo(daily.weather_code[i], false)
  const low = daily.temperature_2m_min[i]
  const high = daily.temperature_2m_max[i]
  const rel = weekdayLabel(date, timezone)
  const full = longDate(date)
  const title = rel === 'Today' ? 'Today' : full.split(',')[0]
  const sub = rel === 'Today' ? full : full.split(', ').slice(1).join(', ')

  return (
    <section
      className="card web-dayview"
      id="web-dayview"
      role="tabpanel"
      aria-labelledby={`web-board-tab-${i}`}
    >
      <div className="web-dayview-head">
        <span className="web-day-icon web-dayview-icon"><WeatherIcon id={info.icon} alt="" /></span>
        <div className="web-dayview-title">
          <h3>{title}</h3>
          <span className="web-dayview-sub">{sub} · {info.label}</span>
        </div>

        <div className="web-dayview-temps">
          <span className="web-dayview-temp">
            <span className="web-dayview-temp-label">High</span>
            <span style={tempStyle(high, colorCoding.daily, 0.35, colorCoding.glow, colorCoding.frost)}>{toTemp(high, unit)}°</span>
          </span>
          <span className="web-dayview-temp web-dayview-temp--low">
            <span className="web-dayview-temp-label">Low</span>
            <span style={tempStyle(low, colorCoding.daily, 0.35, colorCoding.glow, colorCoding.frost)}>{toTemp(low, unit)}°</span>
          </span>
        </div>

        <div className="web-dayview-nav">
          <button
            type="button"
            className="web-dayview-step"
            onClick={() => onSelect(i - 1)}
            disabled={i === 0}
            aria-label="Previous day"
          >
            <ChevronLeft size={16} aria-hidden="true" />
            {i > 0 ? weekdayLabel(daily.time[i - 1], timezone) : 'Prev'}
          </button>
          <button
            type="button"
            className="web-dayview-step"
            onClick={() => onSelect(i + 1)}
            disabled={i === n - 1}
            aria-label="Next day"
          >
            {i < n - 1 ? weekdayLabel(daily.time[i + 1], timezone) : 'Next'}
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="web-dayview-grid">
        <div className="web-dayview-hours">
          <HourChart key={date} weather={weather} date={date} unit={unit} colorCoding={colorCoding} />
        </div>

        <aside className="web-dayview-summary">
          <DayStats weather={weather} i={i} units={units} colorCoding={colorCoding} withChance list />
        </aside>
      </div>
    </section>
  )
}

function ChartKey() {
  return (
    <div className="web-chart-key web-board-key" aria-hidden="true">
      <span className="web-chart-key-item"><span className="web-chart-key-line" />High</span>
      <span className="web-chart-key-item"><span className="web-chart-key-line web-chart-key-line--dashed" />Low</span>
      <span className="web-chart-key-item"><Droplets size={12} className="web-board-key-drop" />Chance of rain</span>
    </div>
  )
}

export function DailyPage({ weather, unit, units, colorCoding }) {
  const board = useMediaQuery(BOARD_MQ)
  const [open, setOpen] = useState(0)
  const [selected, setSelected] = useState(0)
  const { daily, timezone } = weather
  const n = daily.time.length
  const sel = Math.min(selected, n - 1)
  const select = (i) => setSelected(Math.max(0, Math.min(i, n - 1)))

  if (board) {
    return (
      <div className="web-page">
        <div className="card web-chart-card web-board-card">
          <div className="web-page-head">
            <h2 className="web-page-title">Outlook</h2>
            <ChartKey />
          </div>
          <WeekBoard
            daily={daily}
            timezone={timezone}
            unit={unit}
            colorCoding={colorCoding.daily}
            selected={sel}
            onSelect={select}
          />
        </div>

        <DayView weather={weather} i={sel} onSelect={select} unit={unit} units={units} colorCoding={colorCoding} />
      </div>
    )
  }

  const weekMin = Math.min(...daily.temperature_2m_min)
  const weekMax = Math.max(...daily.temperature_2m_max)
  const weekRange = weekMax - weekMin || 1

  return (
    <div className="web-page">
      <div className="card web-chart-card">
        <div className="web-page-head">
          <h2 className="web-page-title">Outlook</h2>
        </div>
        <WeekChart daily={daily} timezone={timezone} unit={unit} colorCoding={colorCoding.daily} />
      </div>

      <div className="card web-days-card">
        {daily.time.map((date, i) => {
          const info = getWeatherInfo(daily.weather_code[i], false)
          const chance = daily.precipitation_probability_max?.[i] ?? 0
          const low = daily.temperature_2m_min[i]
          const high = daily.temperature_2m_max[i]
          const left = ((low - weekMin) / weekRange) * 100
          const barWidth = Math.max(((high - low) / weekRange) * 100, 4)
          const isOpen = open === i

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
                <span className={chanceClass('web-day-chance', chance)}>
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
                          ? `linear-gradient(90deg, ${tempInk(low)}, ${tempInk(high)})`
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
                  <DayStats weather={weather} i={i} units={units} colorCoding={colorCoding} />
                  <DayHours weather={weather} date={date} unit={unit} colorCoding={colorCoding} />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
