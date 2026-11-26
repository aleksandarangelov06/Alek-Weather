import { memo, useState, useSyncExternalStore } from 'react'
import { getWeatherInfo, formatHour, liveWeatherCode, nowcastHourlyCode, toTemp, tempStyle } from '../utils/weatherCodes'
import { unitText, unitSuffix, formatPrecip } from '../utils/units'
import { isoMinutes, formatMinutes } from '../utils/sunTimes'

// The next 24 hours as a timeline, top to bottom: a bar down the left paints
// every hour's conditions, and a row every STEP hours gives the time, the
// condition where it changes, and the chosen reading in a pill set along the
// row by its value (warmer, windier, wetter sits further right), so the column
// of pills draws the day's curve. The chips under it pick the reading.

const HOURS = 24
const STEP = 2
const METRIC_KEY = 'alek-weather-hourly-metric'

// What each code paints on the bar. Coarser than the labels: cloud cover in
// four steps of grey, precipitation by kind and weight.
const BAR_TONE = {
  0: 'clear', 1: 'mainly', 2: 'partly', 3: 'overcast',
  45: 'fog', 48: 'fog',
  51: 'rain-light', 53: 'rain-light', 55: 'rain',
  56: 'ice', 57: 'ice', 66: 'ice', 67: 'ice',
  61: 'rain-light', 63: 'rain', 65: 'rain-heavy',
  80: 'rain-light', 81: 'rain', 82: 'rain-heavy',
  71: 'snow-light', 73: 'snow', 75: 'snow-heavy', 77: 'snow-light',
  85: 'snow-light', 86: 'snow-heavy',
  95: 'storm', 96: 'storm', 99: 'storm',
}

// The readings the pills can show. `key` is the hourly array; `temp` marks the
// two that take the temperature colour coding.
//
// `scale` is the span a pill's place along the row is measured against, given
// the day's peak, on phone-width screens (SMALL_MQ). The temperatures have
// none: they stretch from the day's lowest to its highest, because the shape
// of the day is what they are for. The rest are fixed there, so the place
// means the same thing on every day: a 0-5% chance of rain sits at the left
// rather than swinging edge to edge, and so does a UV index that never leaves
// 1. Wind runs from calm to 25 mph, or to the day's peak if it blows harder,
// so a breezy day still has room to show. Wider screens stretch every reading
// from the day's lowest to its highest, as the temperatures do.
const METRICS = [
  { id: 'temp',     key: 'temperature_2m',            temp: true },
  { id: 'feels',    key: 'apparent_temperature',      temp: true },
  { id: 'precip',   key: 'precipitation_probability', scale: () => [0, 100] },
  { id: 'wind',     key: 'wind_speed_10m',            scale: (peak) => [0, Math.max(peak, 25)] },
  { id: 'humidity', key: 'relative_humidity_2m',      scale: () => [0, 100] },
  { id: 'uv',       key: 'uv_index',                  scale: () => [0, 11] },
]

// Phone width, where the fixed scales apply: the tablet step App.css lays out
// at. Read live, so a resize or a rotation rescales the pills.
const SMALL_MQ = '(max-width: 767px)'
function subscribeSmall(onChange) {
  const mq = window.matchMedia(SMALL_MQ)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}
const isSmall = () => window.matchMedia(SMALL_MQ).matches

// The chips' labels, short enough for all six to sit on one row across a
// phone. The units are on the values instead (°, %, and wind's own suffix in
// its pills), and the full name goes to screen readers.
const METRIC_CHIP = { temp: 'Temp', feels: 'Feels', precip: 'Precip', wind: 'Wind', humidity: 'Humidity', uv: 'UV' }

function metricName(id, unit, units) {
  switch (id) {
    case 'temp':     return `Temperature (°${unit})`
    case 'feels':    return `Feels like (°${unit})`
    case 'precip':   return 'Chance of precipitation (%)'
    case 'wind':     return `Wind (${unitSuffix('wind', units)})`
    case 'humidity': return 'Humidity (%)'
    default:         return 'UV index'
  }
}

function metricText(id, v, unit, units) {
  if (v == null || !Number.isFinite(v)) return '-'
  switch (id) {
    case 'temp':
    case 'feels':    return `${toTemp(v, unit)}°`
    case 'wind':     return unitText('wind', v, units)
    case 'uv':       return String(Math.round(v))
    default:         return `${Math.round(v)}%`
  }
}

// Minutes since the epoch for a naive local "YYYY-MM-DDTHH:MM", read as UTC.
// Only ever differenced against another one read the same way.
const naiveMinutes = (iso) => Date.UTC(
  +iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10), +iso.slice(11, 13), +iso.slice(14, 16),
) / 60000

// "45 min", "1 hour", "10¼ hours".
function untilText(mins) {
  if (mins < 53) return `${Math.max(1, Math.round(mins))} min`
  const quarters = Math.round(mins / 15)
  const whole = Math.floor(quarters / 4)
  const frac = ['', '¼', '½', '¾'][quarters % 4]
  return `${whole}${frac} ${quarters === 4 ? 'hour' : 'hours'}`
}

// The forecast location's wall clock right now, as "YYYY-MM-DDTHH:MM".
function localNow(now, timezone) {
  const parts = {}
  for (const p of new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now)) parts[p.type] = p.value
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}

// Memoised: App re-renders for every overlay, toggle and keystroke, and the
// props here are the reading and the settings, which those leave alone.
export const HourlyForecast = memo(function HourlyForecast({ hourly, daily, timezone, unit, units, colorCoding = true, glow = true, frost = true, current, minutely, radarClear = null }) {
  const small = useSyncExternalStore(subscribeSmall, isSmall, () => false)
  const [picked, setPicked] = useState(() => {
    try { return localStorage.getItem(METRIC_KEY) ?? 'temp' } catch { return 'temp' }
  })
  const pick = (id) => {
    setPicked(id)
    try { localStorage.setItem(METRIC_KEY, id) } catch { /* kept for this visit only */ }
  }

  const now = new Date()
  const currentHourStr = now.toLocaleString('en-CA', {
    hour: '2-digit', hour12: false, timeZone: timezone,
  })
  const todayStr = now.toLocaleDateString('en-CA', { timeZone: timezone })
  const startIdx = hourly.time.findIndex((t) => t.startsWith(`${todayStr}T${currentHourStr}`))
  const start = startIdx === -1 ? 0 : startIdx
  const slice = (arr) => (arr ?? []).slice(start, start + HOURS)

  const hours = slice(hourly.time)
  const codes = slice(hourly.weather_code)
  const isDay = slice(hourly.is_day)

  // Each hour's condition. Hour 0 ("Now") takes the live rate-corrected code
  // so it matches the current conditions; later hours get the minutely_15
  // nowcast check, which downgrades a precipitation code to a sky condition
  // when nothing is forecast to fall in that hour's window.
  const infos = hours.map((time, i) => {
    const code = i === 0 && current
      ? (liveWeatherCode(current, minutely, radarClear) ?? codes[i])
      : nowcastHourlyCode(codes[i], minutely, time, current)
    return { code, ...getWeatherInfo(code, isDay[i] === 0) }
  })

  // The bar: consecutive hours of the same tone merged into one run, laid out
  // as hard stops in a single gradient (no seams, one element).
  const runs = []
  infos.forEach(({ code }, i) => {
    const tone = BAR_TONE[code] ?? 'clear'
    const last = runs[runs.length - 1]
    if (last && last.tone === tone) last.end = i + 1
    else runs.push({ tone, start: i, end: i + 1 })
  })
  const n = hours.length
  // Always an image, a single run included, so it goes on as backgroundImage
  // and leaves the bar's background-colour free for the backing the connected
  // layout lays under it (see .hourly-tl-bar in App.css).
  const barBg = runs.length === 1
    ? `linear-gradient(var(--hrl-${runs[0].tone}), var(--hrl-${runs[0].tone}))`
    : `linear-gradient(to bottom, ${runs.map(r =>
      `var(--hrl-${r.tone}) ${(r.start / n) * 100}% ${(r.end / n) * 100}%`).join(', ')})`

  // The readings on offer: only those this forecast carries.
  const rowIdx = []
  for (let i = 0; i < n; i += STEP) rowIdx.push(i)
  const available = METRICS.filter(m => m.id === 'temp' || rowIdx.some(i => Number.isFinite(hourly[m.key]?.[start + i])))
  const metric = available.find(m => m.id === picked) ?? available[0]
  const values = rowIdx.map(i => hourly[metric.key]?.[start + i])
  const finite = values.filter(Number.isFinite)
  const [lo, hi] = (small && metric.scale?.(Math.max(...finite))) || [Math.min(...finite), Math.max(...finite)]
  // A relative scale with nothing to spread (a flat day) centres its pills; a
  // fixed one clamps, so UV 12 sits at the right edge with UV 11.
  const posOf = (v) => !Number.isFinite(v) || hi === lo ? 0.5 : Math.min(1, Math.max(0, (v - lo) / (hi - lo)))

  // Under the chips: today's precipitation total, and the next sunrise or sunset.
  const di = daily?.time?.indexOf(todayStr) ?? -1
  const precipToday = di >= 0 ? daily.precipitation_sum?.[di] : null
  const snowToday = di >= 0 ? daily.snowfall_sum?.[di] : null
  const precipLine = precipToday >= 0.01
    ? `${snowToday > 0 ? 'Precipitation' : 'Rain'} today: ${formatPrecip(precipToday, units)}`
    : null
  const sunLine = (() => {
    if (!daily?.time) return null
    const nowIso = localNow(now, timezone)
    for (let d = Math.max(0, di); d < daily.time.length; d++) {
      for (const [kind, iso] of [['Sunrise', daily.sunrise?.[d]], ['Sunset', daily.sunset?.[d]]]) {
        if (iso && iso > nowIso) {
          return `${kind} in ${untilText(naiveMinutes(iso) - naiveMinutes(nowIso))} (${formatMinutes(isoMinutes(iso))})`
        }
      }
    }
    return null
  })()

  return (
    <div className="card">
      <div className="section-label">HOURLY FORECAST</div>
      <div className="hourly-tl">
        <span
          className="hourly-tl-bar"
          style={{ backgroundImage: barBg, height: `${(n / (rowIdx.length * STEP)) * 100}%` }}
          aria-hidden="true"
        />
        <ol className="hourly-tl-rows">
          {rowIdx.map((i, r) => {
            const label = i === 0 ? 'Now' : formatHour(hours[i], timezone)
            const { label: cond } = infos[i]
            // The condition is written where it changes, so a run of rain reads
            // as one "Rain" at its first row rather than a column of repeats.
            const changed = r === 0 || cond !== infos[rowIdx[r - 1]].label
            const v = values[r]
            const text = metricText(metric.id, v, unit, units)
            // Wind is the one reading whose number doesn't carry its unit.
            const suffix = metric.id === 'wind' && Number.isFinite(v) ? unitSuffix('wind', units) : null
            return (
              <li key={hours[i]} className="hourly-tl-row" aria-label={`${label}, ${cond}, ${text}${suffix ? ` ${suffix}` : ''}`}>
                <span className="hourly-tl-time" aria-hidden="true">{label}</span>
                <span className="hourly-tl-track" aria-hidden="true">
                  <span className="hourly-tl-lead" style={{ '--p': posOf(v) }}>
                    {changed && <span className="hourly-tl-cond">{cond}</span>}
                    <span className="hourly-tl-line" />
                  </span>
                  <span
                    className="hourly-tl-pill"
                    style={metric.temp && Number.isFinite(v) ? tempStyle(v, colorCoding, 0.4, glow, frost) : undefined}
                  >
                    {text}
                    {suffix && <span className="hourly-tl-pill-unit">{suffix}</span>}
                  </span>
                </span>
              </li>
            )
          })}
        </ol>
      </div>
      {available.length > 1 && (
        <div className="hourly-tl-metrics" role="group" aria-label="Reading shown">
          {available.map(m => (
            <button
              key={m.id}
              type="button"
              className={`hourly-tl-chip${m.id === metric.id ? ' is-on' : ''}`}
              aria-pressed={m.id === metric.id}
              aria-label={metricName(m.id, unit, units)}
              onClick={() => pick(m.id)}
            >
              {METRIC_CHIP[m.id]}
            </button>
          ))}
        </div>
      )}
      {(precipLine || sunLine) && (
        <div className="hourly-tl-summary">
          {precipLine && <p>{precipLine}</p>}
          {sunLine && <p>{sunLine}</p>}
        </div>
      )}
    </div>
  )
})
