import { memo, useState, useRef, useEffect } from 'react'
import { Droplets, Eye, Gauge, Sun, Sunrise, Sunset, Leaf, AlertTriangle, ShieldAlert, ChevronDown, ChevronUp, Navigation2, CloudRain, CloudLightning, CloudMoon, CloudSnow, CloudSun, Wind } from 'lucide-react'
import { WindTurbine } from './WindTurbine'
import { getWindDirection, getUVLabel, formatTime, formatHour, toTemp, sunColor, SUN_ORANGE } from '../utils/weatherCodes'
import {
  getAQIInfo, getAQINote, getHumidityInfo, getHumidityNote, getPrecipInfo, getPressureInfo, getPressureTrend,
  getStormInfo,
  getUVNote, getVisibilityInfo, getVisibilityNote, getWindInfo, getWindNote,
} from '../utils/conditions'
import { formatPrecip, formatUnitDelta, unitSuffix, unitText, unitValue } from '../utils/units'
import { coverFrom, markCoverSettled, useCoverHistory } from '../utils/detailCover'
import { POLLENS, POLLUTANTS, aqiDriver, pollenLevel } from '../utils/airQuality'
import { STORM_KIND_NAME, stormHours, stormNote, stormPeak } from '../utils/stormRisk'
import { Sparkline } from './web/Sparkline'
import { smoothPath, useMeasure } from './web/chartUtils'
import { formatMinutes, formatSpan, isoMinutes, sunTimes } from '../utils/sunTimes'

// Metres per mile, for the miles the visibility thresholds in
// utils/conditions.js are written in. That is deliberately separate from the
// visibility *display* unit: the bands are fixed physical distances, so they
// keep comparing against miles whatever the tile is showing.
const METERS_PER_MILE = 1609.34

// Hours in the hourly timeline at the foot of the precipitation, humidity,
// wind, pressure and visibility covers: two rows of four, laid out as a grid
// that fills the cover's spare height (see .hour-grid in App.css). Each cover
// is clipped to the Details card and must fit it without scrolling on any
// phone; twelve hours made three rows on a phone, which is what pushed every
// one of them past the card. The 24-hour chart above still shows the rest of
// the day.
const TIMELINE_HOURS = 8

// Shared hero block at the top of an expanded detail: the current reading, its
// condition label, and a note explaining it.
function DetailSummary({ value, unit, label, note, color }) {
  return (
    <div className="detail-summary">
      <div className="detail-summary-val" style={color ? { color } : undefined}>
        {value}
        {unit && <span className="detail-summary-unit">{unit}</span>}
      </div>
      <div className="detail-summary-text">
        {label && <div className="detail-summary-label" style={color ? { color } : undefined}>{label}</div>}
        <div className="detail-summary-note">{note}</div>
      </div>
    </div>
  )
}

// Row of secondary facts under the hero (dew point, gusts, pressure trend…).
function DetailStats({ items }) {
  const shown = items.filter(it => it && it.value != null)
  if (!shown.length) return null
  return (
    <div className="detail-stats">
      {shown.map(it => (
        <div key={it.label} className="detail-stat">
          <span className="detail-stat-label">{it.label}</span>
          <span className="detail-stat-value" style={it.color ? { color: it.color } : undefined}>{it.value}</span>
        </div>
      ))}
    </div>
  )
}

// The next 24 hours of a reading as a sparkline, with "Now", the range and the
// last hour along the bottom: the same chart the desktop Details panels carry.
function DetailChart({ values, times, timezone, color, step, format }) {
  const [ref, width] = useMeasure()
  const clean = values.filter(v => v != null && Number.isFinite(v))
  // A dead-flat day (0 J/kg storm energy, 0% rain) would draw a bare line over
  // "0 – 0", which says nothing the reading above hasn't. Leave it out.
  if (clean.length < 2 || Math.min(...clean) === Math.max(...clean)) return null
  return (
    <div className="detail-chart" ref={ref}>
      <Sparkline values={values} width={width} height={52} color={color} step={step} />
      <div className="detail-chart-axis">
        <span>Now</span>
        <span className="detail-chart-range">{format(Math.min(...clean))} – {format(Math.max(...clean))}</span>
        <span>{times.length ? formatHour(times[times.length - 1], timezone) : ''}</span>
      </div>
    </div>
  )
}

// What is behind a storm reading (utils/stormRisk), as an icon. A quiet hour
// gets a plain sky rather than a storm glyph.
function StormIcon({ kind, quiet, isDay = true, size }) {
  if (quiet) return isDay ? <CloudSun size={size} /> : <CloudMoon size={size} />
  if (kind === 'rain') return <CloudRain size={size} />
  if (kind === 'snow') return <CloudSnow size={size} />
  if (kind === 'wind') return <Wind size={size} />
  return <CloudLightning size={size} />
}

// Storm risk hour by hour for the next 24 hours: one bar per hour, its height
// the 0–100 risk score and its colour the level, over faint lines at each
// level's edge, so a quiet day reads as low on a fixed scale rather than as a
// broken chart. A bolt marks any hour with thunder in the forecast itself.
function StormHourlyChart({ hours, timezone, ink }) {
  if (hours.length < 2) return null
  return (
    <div className="storm-chart" role="img" aria-label="Storm risk over the next 24 hours">
      <div className="storm-chart-bars">
        {hours.map((h, i) => (
          <div
            key={h.time}
            className="storm-chart-col"
            title={`${i === 0 ? 'Now' : formatHour(h.time, timezone)}: ${h.level.label}${h.level.index > 0 ? `, ${STORM_KIND_NAME[h.kind].toLowerCase()}` : ''}`}
          >
            {h.thunderCode && <CloudLightning size={11} className="storm-chart-bolt" style={{ color: ink('var(--cond-orange)') }} />}
            <span className="storm-chart-bar" style={{ height: `${Math.max(h.score, 3)}%`, background: ink(h.level.color) }} />
          </div>
        ))}
      </div>
      <div className="storm-chart-axis">
        {hours.map((h, i) => (
          <span key={h.time}>{i % 6 === 0 ? (i === 0 ? 'Now' : formatHour(h.time, timezone)) : ''}</span>
        ))}
      </div>
    </div>
  )
}

// The US AQI category boundaries. Colours come from getAQIInfo, so the outlook
// chart and the reading above it can never disagree.
const AQI_BOUNDS = [50, 100, 150, 200, 300]

// AQI over the whole air-quality forecast (from now to five days out), as on
// the desktop Details page. The line takes the colour of the band it is in at
// each height and the category boundaries are drawn behind it, so a bad day
// reads without a legend. Day names sit along the bottom at each midnight.
// Drawn in real pixels from the measured width, like the desktop charts, so
// the strokes and text keep their size at any card width.
function AqiOutlookChart({ series, dayName, ink }) {
  const [ref, width] = useMeasure()
  const H = 92
  const TOP = 12   // room for the top boundary's label
  const BASE = 72
  const PAD = 4    // keeps the "now" dot inside the card
  const peak = Math.max(...series.map(([, v]) => v))
  const ceiling = Math.max(150, Math.ceil(peak / 50) * 50)
  const x = (i) => PAD + (i / (series.length - 1)) * (width - PAD * 2)
  const y = (v) => TOP + (1 - v / ceiling) * (BASE - TOP)

  const pts = series.map(([, v], i) => [x(i), y(v)])
  const line = smoothPath(pts)
  const area = `${line} L ${pts[pts.length - 1][0]} ${BASE} L ${pts[0][0]} ${BASE} Z`

  // Hard colour stops at each boundary below the ceiling, bottom to top.
  const stops = [[0, getAQIInfo(0).color]]
  AQI_BOUNDS.filter(b => b < ceiling).forEach(b => {
    stops.push([b / ceiling, getAQIInfo(b).color], [b / ceiling, getAQIInfo(b + 1).color])
  })
  stops.push([1, getAQIInfo(ceiling).color])

  // Boundary labels at the right edge, skipping any that would crowd the one
  // below it when a very bad week stretches the scale.
  const grid = []
  for (const b of AQI_BOUNDS.filter(b => b <= ceiling)) {
    const prev = grid[grid.length - 1]
    grid.push({ b, labelled: !prev || !prev.labelled || prev.y - y(b) >= 12, y: y(b) })
  }

  // "Now" under the first reading, then each new day under its midnight
  // divider, dropping a name that would run into the one before it.
  const LABEL_W = 30
  const days = []
  let lastEnd = PAD + LABEL_W
  for (let i = 1; i < series.length; i++) {
    const date = series[i][0].slice(0, 10)
    if (date === series[i - 1][0].slice(0, 10)) continue
    const lx = x(i) + 4
    days.push({ i, label: lx >= lastEnd ? dayName(date) : null })
    if (lx >= lastEnd) lastEnd = lx + LABEL_W
  }

  return (
    <div className="aqi-outlook" ref={ref}>
      {width > 0 && (
        <svg width={width} height={H} role="img" aria-label={`Air quality index forecast, peaking at ${Math.round(peak)}`}>
          <defs>
            <linearGradient id="aqi-outlook-ink" gradientUnits="userSpaceOnUse" x1="0" y1={BASE} x2="0" y2={TOP}>
              {stops.map(([offset, color], i) => <stop key={i} offset={offset} stopColor={ink(color)} />)}
            </linearGradient>
          </defs>

          {grid.map(g => (
            <g key={g.b}>
              <line className="aqi-outlook-grid" x1={PAD} y1={g.y} x2={width - PAD} y2={g.y} stroke={ink(getAQIInfo(g.b).color)} />
              {g.labelled && <text className="aqi-outlook-text aqi-outlook-text--grid" x={width - PAD} y={g.y - 3}>{g.b}</text>}
            </g>
          ))}

          {days.map(d => (
            <g key={d.i}>
              <line className="aqi-outlook-divider" x1={x(d.i)} y1={TOP} x2={x(d.i)} y2={BASE} />
              {d.label && <text className="aqi-outlook-text" x={x(d.i) + 4} y={H - 4}>{d.label}</text>}
            </g>
          ))}

          <path d={area} fill="url(#aqi-outlook-ink)" fillOpacity="0.16" stroke="none" />
          <path d={line} fill="none" stroke="url(#aqi-outlook-ink)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx={pts[0][0]} cy={pts[0][1]} r="4" fill={ink(getAQIInfo(series[0][1]).color)} />
          <text className="aqi-outlook-text" x={PAD - 4} y={H - 4}>Now</text>
        </svg>
      )}
    </div>
  )
}

// Arc tracing the sun's path, with a dot at its current position between sunrise
// and sunset. The dot rides the arc itself, so its coordinates come from
// evaluating that same quadratic Bezier at `progress` rather than a circular
// angle. Each size carries its own geometry in user units that land ~1:1 on CSS
// pixels, so the stroke and dot keep their weight instead of scaling up with the
// viewBox when the wide variant is drawn.
export function SunDial({ progress, wide = false, sunFill }) {
  const t = Math.min(1, Math.max(0, progress))
  const g = wide
    ? { w: 480, h: 92, pad: 12, base: 84, peak: -16, r: 8 }
    : { w: 64,  h: 27, pad: 3,  base: 22, peak: -6,  r: 3.5 }
  const x = (1 - t) ** 2 * g.pad  + 2 * (1 - t) * t * (g.w / 2) + t ** 2 * (g.w - g.pad)
  const y = (1 - t) ** 2 * g.base + 2 * (1 - t) * t * g.peak    + t ** 2 * g.base
  const isUp = progress >= 0 && progress <= 1
  return (
    <svg
      className={`sun-dial${wide ? ' sun-dial--wide' : ''}`}
      viewBox={`0 0 ${g.w} ${g.h}`}
      aria-hidden="true"
    >
      <line className="sun-dial-horizon" x1="0" y1={g.base + 0.5} x2={g.w} y2={g.base + 0.5} />
      <path className="sun-dial-arc" d={`M${g.pad} ${g.base} Q${g.w / 2} ${g.peak} ${g.w - g.pad} ${g.base}`} />
      <circle className={`sun-dial-sun${isUp ? '' : ' sun-dial-sun--down'}`} cx={x} cy={y} r={g.r} style={sunFill ? { fill: sunFill } : undefined} />
    </svg>
  )
}

// `content` replaces the standard icon/label/value/sub body for tiles that need
// their own layout (the Sun tile, which packs two times and a UV reading in).
function DetailCard({ icon, label, value, sub, color, onClick, isExpanded, content }) {
  const expandable = Boolean(onClick)
  return (
    <div
      className={`detail-card${expandable ? ' detail-expand-tile' : ''}${isExpanded ? ' detail-expand-tile--active' : ''}`}
      onClick={onClick}
      role={expandable ? 'button' : undefined}
      aria-expanded={expandable ? isExpanded : undefined}
      style={expandable ? { cursor: 'pointer' } : undefined}
    >
      {content ?? (
        <>
          <div className="detail-icon" style={color ? { color } : undefined}>{icon}</div>
          <div className="detail-label">{label}</div>
          <div className="detail-value" style={color ? { color } : undefined}>{value}</div>
          {(sub != null || expandable) && (
            <div className={`detail-sub${expandable ? ' detail-sub--expand' : ''}`}>
              {sub}
              {expandable && (isExpanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />)}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// The tiles, in a fixed order. They used to be draggable at any time, which
// moved them on a stray drag and never kept the new order past a reload; the
// cards themselves now move only in reorder mode (App.jsx).
const TILE_ORDER = ['precip', 'storm', 'humidity', 'wind', 'pressure', 'visibility', 'sun', 'aqi']

// How long the cover stays mounted on the way out: the content fading, then the
// rectangle shrinking back into the tile. Keep in step with --cover-content-out
// + --cover-out in App.css.
const COVER_OUT_MS = 400

// Memoised: App re-renders for every overlay, toggle and keystroke, and the
// props here are the reading and the settings, which those leave alone.
export const WeatherDetails = memo(function WeatherDetails({ latitude, current, daily, hourly, timezone, unit, units, airQuality, colorCoding = true }) {
  const [expanded, setExpanded] = useState(null)
  const [closing, setClosing] = useState(false)
  // The tapped tile's box, which the cover grows out of (see coverFrom).
  const [from, setFrom] = useState(() => coverFrom(null))
  const cardRef = useRef(null)
  const closeTimer = useRef(null)

  const closeDetail = () => {
    setClosing(true)
    clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => { setExpanded(null); setClosing(false) }, COVER_OUT_MS)
  }

  // The cover grows out of the tile that was tapped, as a rectangle, to fill
  // the card. Every way out (the header, Esc, a second tap on the open tile,
  // the back gesture) goes through history; see useCoverHistory.
  const dismissDetail = useCoverHistory(expanded !== null && !closing, closeDetail)

  const openDetail = (key, e) => {
    if (expanded === key) { dismissDetail(); return }
    setFrom(coverFrom(e?.currentTarget, '.card--details'))
    clearTimeout(closeTimer.current)
    setClosing(false)
    setExpanded(key)
  }

  useEffect(() => () => clearTimeout(closeTimer.current), [])

  useEffect(() => {
    if (!expanded) return
    const onKey = (e) => { if (e.key === 'Escape') dismissDetail() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expanded]) // eslint-disable-line react-hooks/exhaustive-deps

  const windDir = getWindDirection(current.wind_direction_10m)
  // Miles, for the condition bands only — the tile and panel below render
  // current.visibility through the chosen display unit instead.
  const visMi   = current.visibility / METERS_PER_MILE
  const sunrise = formatTime(daily.sunrise[0], timezone)
  const sunset  = formatTime(daily.sunset[0], timezone)

  // How far the sun has travelled from sunrise to sunset, 0 to 1 (outside that
  // range it's night). The API returns naive local times ("2026-07-16T05:51"),
  // so this compares wall-clock minutes in the location's own timezone rather
  // than Date objects, which would be parsed against the browser's zone.
  const sunProgress = (() => {
    const toMinutes = (iso) => +iso.slice(11, 13) * 60 + +iso.slice(14, 16)
    const localNow = new Date().toLocaleString('sv', { timeZone: timezone })
    const nowMinutes = +localNow.slice(11, 13) * 60 + +localNow.slice(14, 16)
    const rise = toMinutes(daily.sunrise[0])
    const set  = toMinutes(daily.sunset[0])
    if (set <= rise) return 0 // polar day/night — no meaningful arc
    return (nowMinutes - rise) / (set - rise)
  })()

  const aqiInfo   = airQuality ? getAQIInfo(airQuality.us_aqi) : null
  const markerPct = airQuality ? Math.min((airQuality.us_aqi / 300) * 100, 100) : 0
  // AQI > 150 is "Unhealthy" or worse — swap the leaf for a warning symbol.
  // AQI > 200 is "Very Unhealthy"/"Hazardous" — advise wearing a mask outdoors.
  const aqiBad       = airQuality ? airQuality.us_aqi > 150 : false
  const aqiHazardous = airQuality ? airQuality.us_aqi > 200 : false
  const aqiMain = airQuality ? aqiDriver(airQuality) : null

  // The AQI forecast from now to the end of the feed (it starts at midnight
  // today and runs five days), for the outlook chart, and its highest hour.
  const aqiSeries = (() => {
    const times = airQuality?.hourly?.time ?? []
    const vals = airQuality?.hourly?.us_aqi ?? []
    const nowKey = new Date().toLocaleString('sv', { timeZone: timezone }).slice(0, 13).replace(' ', 'T')
    const from = times.findIndex(t => t.slice(0, 13) >= nowKey)
    if (from === -1) return []
    return times.slice(from).map((t, i) => [t, vals[from + i]]).filter(([, v]) => v != null)
  })()
  const aqiPeak = aqiSeries.reduce((best, p) => (!best || p[1] > best[1] ? p : best), null)

  // Every pollutant the feed reports, with how far each is toward its own
  // concern level (the same scale as the desktop panel's bars).
  const pollutants = POLLUTANTS
    .map(p => ({ ...p, value: airQuality?.[p.key] }))
    .filter(p => p.value != null)
    .map(p => ({ ...p, ratio: Math.min(p.value / p.full, 1) }))

  // Pollen, only where it's published (Europe), highest first, top three.
  const pollen = POLLENS
    .map(p => ({ ...p, value: airQuality?.[p.key] }))
    .filter(p => p.value != null && p.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 3)

  const humInfo  = getHumidityInfo(current.relative_humidity_2m)
  const presInfo = getPressureInfo(current.surface_pressure)
  const visInfo  = getVisibilityInfo(visMi)
  const windInfo = getWindInfo(current.wind_speed_10m)

  // Hourly window
  const now = new Date()
  const currentHourStr = now.toLocaleString('en-CA', { hour: '2-digit', hour12: false, timeZone: timezone })
  const todayStr = now.toLocaleDateString('en-CA', { timeZone: timezone })
  const startIdx = hourly ? hourly.time.findIndex(t => t.startsWith(`${todayStr}T${currentHourStr}`)) : -1
  const hStart = startIdx === -1 ? 0 : startIdx

  const sliceNext = (arr, n) => (arr ?? []).slice(hStart, hStart + n)
  const hourlyTimes = hourly ? sliceNext(hourly.time, 24) : []

  const fmt = (time, i) => i === 0 ? 'Now' : formatHour(time, timezone)

  // UV — daytime only
  const uvValues = hourly ? sliceNext(hourly.uv_index, 24) : []
  const uvIsDay  = hourly ? sliceNext(hourly.is_day, 24) : []
  const isCurrentDaytime = uvIsDay[0] === 1
  const uvDaytimeItems = hourlyTimes
    .map((time, i) => ({ time, uv: uvValues[i] ?? 0 }))
    .filter((_, i) => uvIsDay[i] === 1)
    .slice(0, 6)
  const uvCurrent = uvValues.length > 0 ? (uvValues[0] ?? current.uv_index) : current.uv_index
  const uv = getUVLabel(uvCurrent)
  // UV > 7 is "Very High"/"Extreme" — swap the sun for a warning symbol.
  const uvHigh = uvCurrent > 7

  // The sun tile paints with raw golden-hour colours that the --cond-* mono
  // override in App.css can't reach, so neutralise them here when detail
  // colour-coding is off. Everything else on the card already goes mono via CSS.
  const sunTint = (p) => colorCoding ? sunColor(p) : 'var(--text-primary)'
  const sunBase = colorCoding ? SUN_ORANGE : 'var(--text-primary)'

  // Wind
  const windSpeeds = hourly?.wind_speed_10m ? sliceNext(hourly.wind_speed_10m, TIMELINE_HOURS) : []
  const windDirs   = hourly?.wind_direction_10m ? sliceNext(hourly.wind_direction_10m, TIMELINE_HOURS) : []
  const windTimes  = windSpeeds.length > 0 ? sliceNext(hourly.time, TIMELINE_HOURS) : []

  // Humidity
  const humValues = hourly?.relative_humidity_2m ? sliceNext(hourly.relative_humidity_2m, TIMELINE_HOURS) : []
  const humTimes  = humValues.length > 0 ? sliceNext(hourly.time, TIMELINE_HOURS) : []

  // Pressure — trend reads backwards from the current hour, so it needs the raw
  // hourly series and hStart rather than the forward-only sliceNext window.
  const presValues = hourly?.surface_pressure ? sliceNext(hourly.surface_pressure, TIMELINE_HOURS) : []
  const presTimes  = presValues.length > 0 ? sliceNext(hourly.time, TIMELINE_HOURS) : []
  const presTrend  = getPressureTrend(hourly, hStart)

  // Visibility
  const visValues = hourly?.visibility ? sliceNext(hourly.visibility, TIMELINE_HOURS) : []
  const visTimes  = visValues.length > 0 ? sliceNext(hourly.time, TIMELINE_HOURS) : []

  // The 24-hour window behind each cover's chart, and the extremes in it.
  const day = (arr) => sliceNext(arr, 24)
  const at = (time) => time === hourlyTimes[0] ? 'now' : `at ${formatHour(time, timezone)}`
  const extreme = (arr, pick) => day(arr).reduce((best, v, i) => {
    if (v == null || !Number.isFinite(v)) return best
    return !best || pick(v, best.v) ? { v, time: hourlyTimes[i] } : best
  }, null)
  const gustPeak = extreme(hourly?.wind_gusts_10m, (a, b) => a > b)
  const visLow   = extreme(hourly?.visibility, (a, b) => a < b)
  // The chart colour follows colour coding like the rest of the card.
  const ink = (c) => colorCoding ? c : 'var(--text-primary)'

  // Sun detail: what's next and how long until it, twilight and golden hour.
  // All in minutes after the location's midnight, like the arc.
  const sun = sunTimes(daily.sunrise[0], daily.sunset[0], latitude ?? 0)
  const nowMin = (() => {
    const t = new Date().toLocaleString('sv', { timeZone: timezone })
    return +t.slice(11, 13) * 60 + +t.slice(14, 16)
  })()
  const riseTomorrow = daily.sunrise[1] ? isoMinutes(daily.sunrise[1]) : sun.rise
  const sunNext = nowMin < sun.rise ? { mins: sun.rise - nowMin, label: 'until sunrise' }
    : nowMin < sun.set ? { mins: sun.set - nowMin, label: 'until sunset' }
    : { mins: 1440 - nowMin + riseTomorrow, label: 'until sunrise' }
  const dayLen = sun.set - sun.rise
  const sunNote = sun.goldenEvening != null && nowMin >= sun.goldenEvening && nowMin < sun.set
    ? 'Golden hour: the low, warm light lasts until sunset.'
    : sun.goldenMorning != null && nowMin >= sun.rise && nowMin < sun.goldenMorning
      ? `Morning golden hour, until ${formatMinutes(sun.goldenMorning)}.`
      : sun.dawn != null && nowMin >= sun.dawn && nowMin < sun.rise
        ? 'Dawn twilight: the sky is getting light.'
        : sun.dusk != null && nowMin >= sun.set && nowMin < sun.dusk
          ? `Dusk twilight; dark by ${formatMinutes(sun.dusk)}.`
          : nowMin >= sun.rise && nowMin < sun.noon
            ? `The sun is highest at ${formatMinutes(sun.noon)}.`
            : nowMin >= sun.noon && nowMin < sun.set && sun.goldenEvening != null
              ? `Golden hour starts at ${formatMinutes(sun.goldenEvening)}.`
              : sun.dawn != null
                ? `First light around ${formatMinutes(sun.dawn)}.`
                : 'The sun is below the horizon.'
  // UV over the next 24 hours, and its peak (at night, tomorrow's midday).
  const uvPeak = extreme(hourly?.uv_index, (a, b) => a > b)

  // Precipitation chance (the desktop Details "Precipitation" panel): the
  // chance this hour, when rain turns likely, and the day's totals.
  const popSeries = day(hourly?.precipitation_probability)
  const popNow    = popSeries[0] ?? 0
  const popInfo   = getPrecipInfo(popNow)
  const popPeak   = Math.max(0, ...popSeries.filter(v => v != null))
  const rainAt    = popSeries.findIndex(v => v != null && v >= 50)
  const precipNote = rainAt === 0 ? 'Rain is likely right now.'
    : rainAt > 0 ? `Rain likely from around ${formatHour(hourlyTimes[rainAt], timezone)}.`
    : popPeak >= 20 ? `A slight chance of showers; up to ${popPeak}% later.`
    : 'No rain expected in the next 24 hours.'
  const popTimes  = sliceNext(hourly?.time, TIMELINE_HOURS)
  const popNext   = sliceNext(hourly?.precipitation_probability, TIMELINE_HOURS)

  // Storm risk (utils/stormRisk): thunder potential, rain or snow, and gusts
  // together, so a wet, windy day reads as stormy and not only a thundery
  // one. Every hour from now to the end of the forecast; the first 24 feed the
  // chart, and the rest the week.
  const stormAll  = hourly ? stormHours(hourly, hStart, Infinity, current.severe_storm) : []
  const stormDay  = stormAll.slice(0, 24)
  const stormNow  = stormAll[0] ?? null
  const stormNext = stormPeak(stormDay)
  // The week ahead: each day's worst hour (today's from now on), and whether
  // thunder is in the forecast that day.
  const stormWeek = (() => {
    const out = []
    for (const h of stormAll) {
      const date = h.time.slice(0, 10)
      let d = out[out.length - 1]
      if (!d || d.date !== date) { d = { date, peak: h, thunder: false }; out.push(d) }
      else if (h.score > d.peak.score) d.peak = h
      if (h.thunderCode) d.thunder = true
    }
    return out.filter(d => d.date >= todayStr).slice(0, 7)
  })()
  const weekDay = (date) => date === todayStr ? 'Today'
    : new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short' })
  const thunderDays = stormWeek.filter(d => d.thunder)
  const stormiestDay = stormWeek.reduce((best, d) => (!best || d.peak.score > best.peak.score ? d : best), null)
  const stormGust = current.wind_gusts_10m ?? hourly?.wind_gusts_10m?.[hStart] ?? null
  const aqiPeakDay = aqiPeak ? weekDay(aqiPeak[0].slice(0, 10)) : null

  const cardDefs = {
    precip: {
      icon: <CloudRain size={19} />, label: 'Precipitation',
      value: `${Math.round(popNow)}%`,
      sub: <span style={{ color: popInfo.color, fontWeight: 600 }}>{popInfo.label}</span>,
      color: popInfo.color,
    },
    // The risk level, and what is behind it. High or worse swaps the cloud
    // for a warning symbol, as the UV and air-quality tiles do.
    storm: stormNow ? {
      icon: stormNow.level.index >= 3 ? <AlertTriangle size={19} /> : <CloudLightning size={19} />, label: 'Storms',
      value: stormNow.level.label,
      sub: stormNow.level.index > 0 ? STORM_KIND_NAME[stormNow.kind] : 'Quiet',
      color: stormNow.level.color,
    } : null,
    humidity:   {
      icon: <Droplets size={19} />, label: 'Humidity',
      value: `${current.relative_humidity_2m}%`,
      sub: <span style={{ color: humInfo.color, fontWeight: 600 }}>{humInfo.label}</span>,
      color: humInfo.color,
    },
    wind: {
      icon: <WindTurbine size={19} />, label: 'Wind',
      value: `${unitText('wind', current.wind_speed_10m, units)} ${unitSuffix('wind', units)}`,
      sub: windDir,
      color: windInfo.color,
    },
    pressure: {
      icon: <Gauge size={19} />, label: 'Pressure',
      // "29.92 inHg" is too wide for the tile at full size — shrink just the unit.
      value: <>{unitText('pressure', current.surface_pressure, units)}<span className="detail-value-unit"> {unitSuffix('pressure', units)}</span></>,
      sub: <span style={{ color: presInfo.color, fontWeight: 600 }}>{presInfo.label}</span>,
      color: presInfo.color,
    },
    visibility: {
      icon: <Eye size={19} />, label: 'Visibility',
      value: `${unitText('visibility', current.visibility, units)} ${unitSuffix('visibility', units)}`,
      sub: <span style={{ color: visInfo.color, fontWeight: 600 }}>{visInfo.label}</span>,
      color: visInfo.color,
    },
    // Sunrise, sunset, and UV share one standard-size tile: all three describe
    // the sun's arc through the day. The two times stand in for the usual big
    // .detail-value, and the UV index rides the sub row as a small number.
    sun: {
      icon: uvHigh ? <AlertTriangle size={19} /> : <Sun size={19} />, label: 'Sun & UV',
      color: uv.color,
      content: (
        <div className="sun-body">
          {/* Same icon/label/value/sub run as every other tile, so the UV reading
              and its rating line up with their values and subs. */}
          <div className="sun-main">
            {/* The sun tracks its live altitude colour — yellow high, orange near
                the horizon — matching the dial's dot. Only the UV-warning triangle
                keeps the severity colour. */}
            <div className="detail-icon" style={{ color: uvHigh ? uv.color : sunTint(sunProgress) }}>
              {uvHigh ? <AlertTriangle size={19} /> : <Sun size={19} />}
            </div>
            <div className="detail-label">Sun</div>
            <div className="detail-value" style={{ color: uv.color }}>UV {Math.round(uvCurrent)}</div>
            <div className="detail-sub detail-sub--expand">
              <span style={{ color: uv.color, fontWeight: 600 }}>{uv.label}</span>
              {expanded === 'sun' ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
            </div>
          </div>
          {/* Orange on the wrapper tints both rise/set icons and their times
              (golden-hour colour); the dial's dot overrides to the sun's live
              altitude colour — yellow high, orange near the horizon. */}
          <div className="sun-times" style={{ color: sunBase }}>
            <span className="sun-time">
              <Sunrise size={13} className="sun-time-icon" />{sunrise}
            </span>
            <SunDial progress={sunProgress} sunFill={sunTint(sunProgress)} />
            <span className="sun-time">
              <Sunset size={13} className="sun-time-icon" />{sunset}
            </span>
          </div>
        </div>
      ),
    },
    aqi: airQuality ? {
      icon: aqiBad ? <AlertTriangle size={19} /> : <Leaf size={19} />, label: 'Air Quality',
      value: airQuality.us_aqi,
      sub: aqiInfo?.label,
      color: aqiInfo?.color,
    } : null,
  }

  // Body of the expanded detail, rendered inside the cover that grows over the
  // card. Returns bare content — .detail-cover-body supplies the column layout.
  const detailBody = (key) => {
    switch (key) {
      case 'precip':
        return (
          <>
            <DetailSummary
              value={Math.round(popNow)} unit="%"
              label={popInfo.label} color={popInfo.color}
              note={precipNote}
            />
            <DetailChart
              values={popSeries} times={hourlyTimes} timezone={timezone}
              color={ink(popInfo.color)} step={10} format={v => `${Math.round(v)}%`}
            />
            <DetailStats items={[
              { label: 'Today’s total', value: daily.precipitation_sum?.[0] != null ? formatPrecip(daily.precipitation_sum[0], units) : null },
              { label: 'Peak next 24h', value: `${popPeak}%`, color: getPrecipInfo(popPeak).color },
            ]} />
            {popTimes.length > 0 && (
              <div className="detail-section hour-section">
                <div className="detail-section-label">Next {TIMELINE_HOURS} hours</div>
                <div className="uv-timeline hour-grid">
                {popTimes.map((time, i) => {
                  const val  = popNext[i] ?? 0
                  const info = getPrecipInfo(val)
                  return (
                    <div key={i} className="uv-timeline-item">
                      <span className="uv-tl-time">{fmt(time, i)}</span>
                      <span className="uv-tl-val" style={{ color: info.color }}>{Math.round(val)}%</span>
                      <span className="uv-tl-lbl" style={{ color: info.color }}>{info.label}</span>
                    </div>
                  )
                })}
                </div>
              </div>
            )}
          </>
        )

      case 'storm':
        return stormNow ? (
          <>
            {/* The level leads, with an icon for what is driving it (thunder,
                rain, snow or wind) in place of a number: the score behind it
                is a blend, and only its band means anything. */}
            <div className="detail-summary">
              <div className="storm-badge" style={{ color: stormNow.level.color }}>
                <StormIcon
                  kind={stormNow.kind} quiet={stormNow.level.index === 0}
                  isDay={hourly?.is_day?.[hStart] !== 0} size={30}
                />
              </div>
              <div className="detail-summary-text">
                <div className="detail-summary-label" style={{ color: stormNow.level.color }}>{stormNow.level.label} risk</div>
                <div className="detail-summary-note">
                  {stormNote(stormNow, stormNext, stormNext ? formatHour(stormNext.time, timezone) : '')}
                </div>
              </div>
            </div>
            {/* The three things the level is made of, as they stand now. */}
            <DetailStats items={[
              { label: 'Rain', value: `${Math.round(popNow)}%`, color: popInfo.color },
              {
                label: 'Gusts',
                value: stormGust != null
                  ? <>{unitText('wind', stormGust, units)}<span className="detail-stat-unit"> {unitSuffix('wind', units)}</span></>
                  : null,
                color: stormGust != null ? getWindInfo(stormGust).color : undefined,
              },
              {
                label: 'Energy',
                value: stormNow.cape != null
                  ? <>{Math.round(stormNow.cape).toLocaleString('en-US')}<span className="detail-stat-unit"> J/kg</span></>
                  : null,
                color: stormNow.cape != null ? getStormInfo(stormNow.cape).color : undefined,
              },
            ]} />
            {stormDay.length > 1 && (
              <div className="detail-section">
                <div className="detail-section-label">
                  Next 24 hours
                  <span className="detail-section-aside">
                    {stormNext && stormNext.level.index > 0
                      ? <>Peak <span style={{ color: stormNext.level.color, fontWeight: 600 }}>{stormNext.level.label}</span> {at(stormNext.time)}</>
                      : 'All quiet'}
                  </span>
                </div>
                <StormHourlyChart hours={stormDay} timezone={timezone} ink={ink} />
              </div>
            )}
            {stormWeek.length > 1 && (
              <div className="detail-section">
                <div className="detail-section-label">
                  This week
                  <span className="detail-section-aside">
                    {thunderDays.length ? `Thunder ${thunderDays.map(d => weekDay(d.date)).join(', ')}`
                      : stormiestDay.peak.level.index > 0 ? `Stormiest ${weekDay(stormiestDay.date)}`
                      : 'A quiet week'}
                  </span>
                </div>
                <div className="storm-week">
                  {stormWeek.map(d => {
                    const { level, kind } = d.peak
                    return (
                      <div key={d.date} className="storm-week-row">
                        <span className="storm-week-day">{weekDay(d.date)}</span>
                        <span className="storm-week-icon" style={{ color: ink(level.color) }}>
                          {(level.index > 0 || d.thunder) && (
                            <StormIcon kind={d.thunder ? 'thunder' : kind} size={15} />
                          )}
                        </span>
                        <span className="storm-week-track">
                          <span className="storm-week-fill" style={{ width: `${Math.max(d.peak.score, 3)}%`, background: ink(level.color) }} />
                        </span>
                        <span className="storm-week-lbl">{level.label}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </>
        ) : null

      case 'humidity':
        return (
          <>
            <DetailSummary
              value={current.relative_humidity_2m} unit="%"
              label={humInfo.label} color={humInfo.color}
              note={getHumidityNote(current.relative_humidity_2m)}
            />
            <DetailChart
              values={day(hourly?.relative_humidity_2m)} times={hourlyTimes} timezone={timezone}
              color={ink(humInfo.color)} step={10} format={v => `${Math.round(v)}%`}
            />
            {/* Feels-like is left to the current-weather card, which leads with it. */}
            <DetailStats items={[
              { label: 'Dew point', value: current.dew_point_2m != null ? `${toTemp(current.dew_point_2m, unit)}°` : null },
            ]} />
            {humTimes.length > 0 && (
              <div className="detail-section hour-section">
                <div className="detail-section-label">Next {TIMELINE_HOURS} hours</div>
                <div className="uv-timeline hour-grid">
                {humTimes.map((time, i) => {
                  const val  = humValues[i] ?? 0
                  const info = getHumidityInfo(val)
                  return (
                    <div key={i} className="uv-timeline-item">
                      <span className="uv-tl-time">{fmt(time, i)}</span>
                      <span className="uv-tl-val" style={{ color: info.color }}>{Math.round(val)}%</span>
                      <span className="uv-tl-lbl" style={{ color: info.color }}>{info.label}</span>
                    </div>
                  )
                })}
                </div>
              </div>
            )}
          </>
        )

      case 'wind':
        return (
          <>
            <DetailSummary
              value={unitText('wind', current.wind_speed_10m, units)} unit={` ${unitSuffix('wind', units)}`}
              label={`From the ${windDir}`} color={windInfo.color}
              note={getWindNote(current.wind_speed_10m)}
            />
            <DetailChart
              values={day(hourly?.wind_speed_10m)} times={hourlyTimes} timezone={timezone}
              color={ink(windInfo.color)} step={5} format={v => `${unitText('wind', v, units)} ${unitSuffix('wind', units)}`}
            />
            {/* No separate direction: the heading says it, and the hours show it. */}
            <DetailStats items={[
              { label: 'Gusts', value: current.wind_gusts_10m != null ? `${unitText('wind', current.wind_gusts_10m, units)} ${unitSuffix('wind', units)}` : null },
              {
                label: 'Strongest gust',
                value: gustPeak ? `${unitText('wind', gustPeak.v, units)} ${unitSuffix('wind', units)} ${at(gustPeak.time)}` : null,
                color: gustPeak ? getWindInfo(gustPeak.v).color : undefined,
              },
            ]} />
            {windTimes.length > 0 && (
              <div className="detail-section hour-section">
                <div className="detail-section-label">Next {TIMELINE_HOURS} hours</div>
                <div className="uv-timeline hour-grid">
                {windTimes.map((time, i) => {
                  const speed   = windSpeeds[i] ?? 0
                  const degrees = windDirs[i] ?? 0
                  const wInfo   = getWindInfo(speed)
                  return (
                    <div key={i} className="uv-timeline-item">
                      <span className="uv-tl-time">{fmt(time, i)}</span>
                      <Navigation2
                        size={wInfo.size}
                        style={{ color: wInfo.color, transform: `rotate(${degrees}deg)`, flexShrink: 0 }}
                      />
                      <span className="uv-tl-val" style={{ color: wInfo.color }}>{unitValue('wind', speed, units)}</span>
                      <span className="uv-tl-lbl" style={{ color: 'var(--text-secondary)' }}>{getWindDirection(degrees)}</span>
                    </div>
                  )
                })}
                </div>
              </div>
            )}
          </>
        )

      case 'pressure':
        return (
          <>
            <DetailSummary
              value={unitText('pressure', current.surface_pressure, units)} unit={` ${unitSuffix('pressure', units)}`}
              label={presInfo.label} color={presInfo.color}
              note={presTrend?.note ?? 'Pressure is near the seasonal average.'}
            />
            <DetailChart
              values={day(hourly?.surface_pressure)} times={hourlyTimes} timezone={timezone}
              color={ink(presInfo.color)} step={2} format={v => unitText('pressure', v, units)}
            />
            <DetailStats items={[
              { label: 'Trend', value: presTrend?.label },
              {
                label: '3 hr change',
                value: presTrend ? formatUnitDelta('pressure', presTrend.delta, units) : null,
              },
            ]} />
            {presTimes.length > 0 && (
              <div className="detail-section hour-section">
                <div className="detail-section-label">Next {TIMELINE_HOURS} hours</div>
                <div className="uv-timeline hour-grid">
                {presTimes.map((time, i) => {
                  const val  = presValues[i] ?? 0
                  const info = getPressureInfo(val)
                  return (
                    <div key={i} className="uv-timeline-item">
                      <span className="uv-tl-time">{fmt(time, i)}</span>
                      <span className="uv-tl-val uv-tl-val--sm" style={{ color: info.color }}>{unitText('pressure', val, units)}</span>
                      <span className="uv-tl-lbl" style={{ color: info.color }}>{info.label}</span>
                    </div>
                  )
                })}
                </div>
              </div>
            )}
          </>
        )

      case 'visibility':
        return (
          <>
            <DetailSummary
              value={unitText('visibility', current.visibility, units)} unit={` ${unitSuffix('visibility', units)}`}
              label={visInfo.label} color={visInfo.color}
              note={getVisibilityNote(visMi)}
            />
            <DetailChart
              values={day(hourly?.visibility)} times={hourlyTimes} timezone={timezone}
              color={ink(visInfo.color)} step={METERS_PER_MILE}
              format={v => `${unitText('visibility', v, units)} ${unitSuffix('visibility', units)}`}
            />
            <DetailStats items={[
              {
                label: 'Lowest',
                value: visLow ? `${unitText('visibility', visLow.v, units)} ${unitSuffix('visibility', units)} ${at(visLow.time)}` : null,
                color: visLow ? getVisibilityInfo(visLow.v / METERS_PER_MILE).color : undefined,
              },
            ]} />
            {visTimes.length > 0 && (
              <div className="detail-section hour-section">
                <div className="detail-section-label">Next {TIMELINE_HOURS} hours</div>
                <div className="uv-timeline hour-grid">
                {visTimes.map((time, i) => {
                  const val  = visValues[i] ?? 0
                  const info = getVisibilityInfo(val / METERS_PER_MILE)
                  return (
                    <div key={i} className="uv-timeline-item">
                      <span className="uv-tl-time">{fmt(time, i)}</span>
                      <span className="uv-tl-val uv-tl-val--sm" style={{ color: info.color }}>{unitText('visibility', val, units)}</span>
                      <span className="uv-tl-lbl" style={{ color: info.color }}>{info.label}</span>
                    </div>
                  )
                })}
                </div>
              </div>
            )}
          </>
        )

      case 'sun':
        return (
          <>
            <div className="detail-section">
              <div className="detail-section-label">Sun</div>
              <DetailSummary
                value={formatSpan(sunNext.mins)}
                label={sunNext.label} color={sunBase}
                note={sunNote}
              />
              {/* Arc in golden-hour orange; the dot tracks the sun's live
                  altitude. Sunrise and sunset sit under its ends, with the
                  day's length between them. */}
              <div className="sun-dial-wrap" style={{ color: sunBase }}>
                <SunDial progress={sunProgress} sunFill={sunTint(sunProgress)} wide />
              </div>
              <div className="sun-cover-times">
                <span className="sun-cover-time"><Sunrise size={14} style={{ color: sunBase }} aria-hidden="true" />{sunrise}</span>
                <span className="sun-cover-daylight">{formatSpan(dayLen)} of daylight</span>
                <span className="sun-cover-time"><Sunset size={14} style={{ color: sunBase }} aria-hidden="true" />{sunset}</span>
              </div>
              {/* One row: the times that bound the usable light. Solar noon and
                  tomorrow's change in daylight are left to the desktop panel. */}
              <DetailStats items={[
                { label: 'First light', value: sun.dawn != null ? formatMinutes(sun.dawn) : null },
                { label: 'Golden hour', value: sun.goldenEvening != null ? formatMinutes(sun.goldenEvening) : null, color: sunBase },
                { label: 'Last light', value: sun.dusk != null ? formatMinutes(sun.dusk) : null },
              ]} />
            </div>

            <div className="detail-section">
              <div className="detail-section-label">UV index</div>
              <DetailSummary
                value={Math.round(uvCurrent)}
                label={uv.label} color={uv.color}
                note={getUVNote(uvCurrent)}
              />
              <DetailChart
                values={day(hourly?.uv_index)} times={hourlyTimes} timezone={timezone}
                color={ink(uv.color)} step={2} format={v => Math.round(v)}
              />
              <DetailStats items={[
                {
                  label: 'Peak next 24h',
                  value: uvPeak ? `${Math.round(uvPeak.v)} ${at(uvPeak.time)}` : null,
                  color: uvPeak ? getUVLabel(uvPeak.v).color : undefined,
                },
              ]} />
              {uvDaytimeItems.length > 0 ? (
                <div className="uv-timeline">
                  {uvDaytimeItems.map((item, i) => {
                    const uvInfo = getUVLabel(item.uv)
                    return (
                      <div key={i} className="uv-timeline-item">
                        <span className="uv-tl-time">{i === 0 && isCurrentDaytime ? 'Now' : formatHour(item.time, timezone)}</span>
                        <span className="uv-tl-val" style={{ color: uvInfo.color }}>{Math.round(item.uv)}</span>
                        <span className="uv-tl-lbl" style={{ color: uvInfo.color }}>{uvInfo.label}</span>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="uv-no-exposure">No UV exposure right now</div>
              )}
            </div>
          </>
        )

      case 'aqi':
        return airQuality ? (
          <>
            <div className="aqi-main">
              <div className="aqi-number" style={{ color: aqiInfo.color }}>{airQuality.us_aqi}</div>
              <div className="aqi-info">
                <div className="aqi-status" style={{ color: aqiInfo.color }}>{aqiInfo.label}</div>
                <div className="aqi-sublabel">US AQI</div>
              </div>
              {aqiHazardous && (
                <ShieldAlert className="aqi-mask-icon" size={26} style={{ color: aqiInfo.color }} aria-label="Wear a mask outdoors">
                  <title>Wear a mask outdoors</title>
                </ShieldAlert>
              )}
            </div>
            <div className="aqi-scale">
              <div className="aqi-gradient-bar">
                <div className="aqi-marker" style={{ left: `${markerPct}%`, background: aqiInfo.color }} />
              </div>
            </div>
            <div className="detail-summary-note">{getAQINote(airQuality.us_aqi)}</div>
            {aqiMain && (
              <div className="aqi-driver">
                Driven mainly by <strong>{aqiMain.name}</strong>, {aqiMain.desc.toLowerCase()}.
              </div>
            )}
            {/* All six readings share one unit, so it is given once in the
                heading rather than after every value. */}
            {pollutants.length > 0 && (
              <div className="detail-section">
                <div className="detail-section-label">
                  Pollutants
                  <span className="detail-section-aside">µg/m³</span>
                </div>
                <div className="aqi-polls">
                  {pollutants.map(p => (
                    <div key={p.key} className="aqi-poll">
                      <div className="aqi-poll-top">
                        <span className="aqi-poll-name">{p.name}</span>
                        <span className="aqi-poll-val">{p.value >= 1000 ? Math.round(p.value) : p.value.toFixed(1)}</span>
                      </div>
                      <span className="aqi-poll-track">
                        <span
                          className="aqi-poll-fill"
                          style={{ width: `${Math.max(p.ratio * 100, 2)}%`, background: ink(getAQIInfo(p.ratio * 150).color) }}
                        />
                      </span>
                      <span className="aqi-poll-desc">{p.desc}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {aqiSeries.length > 1 && (
              <div className="detail-section">
                <div className="detail-section-label">
                  AQI outlook
                  <span className="detail-section-aside">
                    Peak <span style={{ color: getAQIInfo(aqiPeak[1]).color, fontWeight: 600 }}>{Math.round(aqiPeak[1])}</span>
                    {aqiPeakDay === 'Today' ? ' today' : ` ${aqiPeakDay}`}
                  </span>
                </div>
                <AqiOutlookChart series={aqiSeries} dayName={weekDay} ink={ink} />
              </div>
            )}
            {pollen.length > 0 && (
              <DetailStats items={pollen.map(p => {
                const lvl = pollenLevel(p.value)
                return { label: `${p.name} pollen`, value: lvl.label, color: lvl.color }
              })} />
            )}
          </>
        ) : null

      default:
        return null
    }
  }

  const openDef = expanded ? cardDefs[expanded] : null

  return (
    <div className={`card card--details${colorCoding ? '' : ' card--details--mono'}`} ref={cardRef}>
      <div className="section-label">DETAILS</div>
      <div className="details-grid">
        {TILE_ORDER
          .filter(key => cardDefs[key] != null)
          .map(key => (
            <DetailCard
              key={key}
              {...cardDefs[key]}
              onClick={(e) => openDetail(key, e)}
              isExpanded={expanded === key}
            />
          ))
        }
      </div>

      {expanded && (
        <div
          className={`detail-cover${closing ? ' detail-cover--closing' : ''}`}
          style={from}
          role="dialog"
          aria-label={openDef?.label}
          onAnimationEnd={markCoverSettled}
        >
          <div className="detail-cover-fill" />
          {/* The header is the close control: tap the title to fold the tile
              back, the way it was tapped open. */}
          <button className="detail-cover-head" onClick={dismissDetail} aria-label={`Close ${openDef?.label ?? 'details'}`}>
            <span className="detail-cover-title">
              <span className="detail-cover-icon" style={openDef?.color ? { color: openDef.color } : undefined}>
                {openDef?.icon}
              </span>
              {openDef?.label}
            </span>
            <ChevronUp size={20} className="detail-cover-chevron" aria-hidden="true" />
          </button>
          <div className={`detail-cover-body detail-cover-body--${expanded}`}>
            {detailBody(expanded)}
          </div>
        </div>
      )}
    </div>
  )
})
