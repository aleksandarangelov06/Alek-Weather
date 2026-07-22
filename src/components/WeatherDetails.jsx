import { useState, useRef, useEffect } from 'react'
import { Droplets, Eye, Gauge, Sun, Sunrise, Sunset, Leaf, AlertTriangle, ShieldAlert, ChevronDown, ChevronUp, Navigation2, X } from 'lucide-react'
import { WindTurbine } from './WindTurbine'
import { getWindDirection, getUVLabel, formatTime, formatHour, toTemp, sunColor, SUN_ORANGE } from '../utils/weatherCodes'

// The API reports surface pressure in hPa; US convention displays inHg.
// Thresholds below stay in hPa so they keep comparing against the raw values.
const HPA_PER_INHG = 33.8639
const toInHg = (hpa) => (hpa / HPA_PER_INHG).toFixed(2)

// Condition colors are the --cond-* variables from App.css, which swap to
// lighter tones on dark and sky-tinted card surfaces so the readings stay
// legible there (e.g. red on a slate-blue card).
function getAQIInfo(aqi) {
  if (aqi <= 50)  return { label: 'Good',                          color: 'var(--cond-green)' }
  if (aqi <= 100) return { label: 'Moderate',                      color: 'var(--cond-yellow)' }
  if (aqi <= 150) return { label: 'Unhealthy for Sensitive Groups', color: 'var(--cond-orange)' }
  if (aqi <= 200) return { label: 'Unhealthy',                     color: 'var(--cond-red)' }
  if (aqi <= 300) return { label: 'Very Unhealthy',                color: 'var(--cond-purple)' }
  return                 { label: 'Hazardous',                     color: 'var(--cond-violet)' }
}

function getWindInfo(speed) {
  if (speed < 5)  return { color: 'var(--cond-green)',  size: 13 }
  if (speed < 15) return { color: 'var(--cond-lime)',   size: 15 }
  if (speed < 25) return { color: 'var(--cond-yellow)', size: 17 }
  if (speed < 35) return { color: 'var(--cond-orange)', size: 19 }
  if (speed < 45) return { color: 'var(--cond-red)',    size: 21 }
  return               { color: 'var(--cond-purple)',   size: 23 }
}

function getHumidityInfo(pct) {
  if (pct < 25) return { color: 'var(--cond-blue)',   label: 'Dry'       }
  if (pct < 50) return { color: 'var(--cond-green)',  label: 'Good'      }
  if (pct < 65) return { color: 'var(--cond-yellow)', label: 'Fair'      }
  if (pct < 80) return { color: 'var(--cond-orange)', label: 'High'      }
  return              { color: 'var(--cond-red)',     label: 'Very High' }
}

function getPressureInfo(hpa) {
  if (hpa < 980)  return { color: 'var(--cond-red)',    label: 'Stormy'   }
  if (hpa < 1000) return { color: 'var(--cond-orange)', label: 'Low'      }
  if (hpa < 1020) return { color: 'var(--cond-green)',  label: 'Normal'   }
  if (hpa < 1030) return { color: 'var(--cond-blue)',   label: 'High'     }
  return               { color: 'var(--cond-purple)',   label: 'Very High' }
}

function getVisibilityInfo(miles) {
  if (miles < 0.5) return { color: 'var(--cond-red)',    label: 'Dense Fog' }
  if (miles < 2)   return { color: 'var(--cond-orange)', label: 'Fog'       }
  if (miles < 5)   return { color: 'var(--cond-yellow)', label: 'Haze'      }
  if (miles < 10)  return { color: 'var(--cond-lime)',   label: 'Fair'      }
  return                { color: 'var(--cond-green)',    label: 'Clear'     }
}

// Plain-language notes explaining what each current reading actually means.
function getHumidityNote(pct) {
  if (pct < 25) return 'Very dry air; expect static and dry skin.'
  if (pct < 50) return 'Comfortable; sweat evaporates easily.'
  if (pct < 65) return 'Slightly humid but still manageable.'
  if (pct < 80) return 'Humid; it will feel muggy outside.'
  return 'Very humid; sweat barely evaporates.'
}

function getWindNote(speed) {
  if (speed < 5)  return 'Calm; smoke rises almost straight up.'
  if (speed < 15) return 'A light breeze you can feel on your face.'
  if (speed < 25) return 'Breezy; small branches sway.'
  if (speed < 35) return 'Windy; walking into it takes effort.'
  if (speed < 45) return 'Very windy; secure loose objects outside.'
  return 'Damaging winds are possible; stay indoors.'
}

function getVisibilityNote(miles) {
  if (miles < 0.5) return 'Dense fog; driving is dangerous.'
  if (miles < 2)   return 'Fog; use low beams and slow down.'
  if (miles < 5)   return 'Haze is noticeably limiting distance.'
  if (miles < 10)  return 'Slight haze; mostly clear.'
  return 'Clear; distant objects look sharp.'
}

function getUVNote(uv) {
  if (uv < 3)  return 'Low risk; no protection needed.'
  if (uv < 6)  return 'Moderate; sunscreen is recommended.'
  if (uv < 8)  return 'High; wear sunscreen and a hat.'
  if (uv < 11) return 'Very high; limit midday sun exposure.'
  return 'Extreme; avoid the sun around midday.'
}

function getAQINote(aqi) {
  if (aqi <= 50)  return 'Air quality is good; no precautions needed.'
  if (aqi <= 100) return 'Acceptable; very sensitive people may want to ease up outdoors.'
  if (aqi <= 150) return 'Sensitive groups should limit prolonged outdoor exertion.'
  if (aqi <= 200) return 'Everyone should limit prolonged outdoor exertion.'
  if (aqi <= 300) return 'Avoid prolonged outdoor exertion.'
  return 'Avoid all outdoor exertion.'
}

// Pressure trend over the last 3 hours — the part that actually forecasts
// anything. A ±1 hPa deadband keeps normal noise from reading as a trend.
function getPressureTrend(hourly, hStart) {
  const series = hourly?.surface_pressure
  if (!series || hStart < 3) return null
  const now  = series[hStart]
  const past = series[hStart - 3]
  if (now == null || past == null) return null
  const delta = now - past
  if (delta > 1)  return { label: 'Rising',  delta, note: 'Pressure is rising; conditions are improving.' }
  if (delta < -1) return { label: 'Falling', delta, note: 'Pressure is falling; conditions may deteriorate.' }
  return { label: 'Steady', delta, note: 'Pressure is steady; little change expected.' }
}

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

// Arc tracing the sun's path, with a dot at its current position between sunrise
// and sunset. The dot rides the arc itself, so its coordinates come from
// evaluating that same quadratic Bezier at `progress` rather than a circular
// angle. Each size carries its own geometry in user units that land ~1:1 on CSS
// pixels, so the stroke and dot keep their weight instead of scaling up with the
// viewBox when the wide variant is drawn.
function SunDial({ progress, wide = false, sunFill }) {
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

function Pollutant({ name, value, unit }) {
  if (value == null) return null
  return (
    <div className="aqi-pollutant">
      <span className="aqi-poll-name">{name}</span>
      <span className="aqi-poll-val">{value.toFixed(1)}</span>
      <span className="aqi-poll-unit">{unit}</span>
    </div>
  )
}

// `content` replaces the standard icon/label/value/sub body for tiles that need
// their own layout (the Sun tile, which packs two times and a UV reading in).
function DetailCard({ icon, label, value, sub, color, onClick, isExpanded, content, onDragStart, onDragEnter, onDragEnd, onDragOver, isDragging, isDragOver }) {
  const expandable = Boolean(onClick)
  return (
    <div
      className={`detail-card${expandable ? ' detail-expand-tile' : ''}${isExpanded ? ' detail-expand-tile--active' : ''}${isDragOver ? ' detail-card--drag-over' : ''}`}
      onClick={onClick}
      role={expandable ? 'button' : undefined}
      aria-expanded={expandable ? isExpanded : undefined}
      draggable
      onDragStart={onDragStart}
      onDragEnter={onDragEnter}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      style={{ opacity: isDragging ? 0.35 : 1, cursor: isDragging ? 'grabbing' : 'grab' }}
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

// Keep in sync with the detail-cover animation duration in App.css — the cover
// stays mounted this long while the circle shrinks back into the tapped tile.
const REVEAL_MS = 380

// Fixed backing size of the reveal circle, scaled up to cover; keeps the GPU
// texture small regardless of card size. Must match the 360px .detail-cover-fill
// width/height in App.css.
const FILL_BASE = 360

export function WeatherDetails({ current, daily, hourly, timezone, unit, airQuality, colorCoding = true }) {
  const [expanded, setExpanded] = useState(null)
  const [closing, setClosing] = useState(false)
  // Origin + radius of the circular reveal, in px relative to the details card.
  const [reveal, setReveal] = useState({ x: 0, y: 0, r: 0 })
  const cardRef = useRef(null)
  const closeTimer = useRef(null)

  const closeDetail = () => {
    setClosing(true)
    clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => { setExpanded(null); setClosing(false) }, REVEAL_MS)
  }

  // Grow the cover from wherever the tile was tapped. The radius is the distance
  // to the card's farthest corner, so the circle always finishes fully covering.
  const openDetail = (key, e) => {
    if (expanded === key) { closeDetail(); return }
    const rect = cardRef.current?.getBoundingClientRect()
    if (rect) {
      // Keyboard activation reports 0,0 — fall back to the card's center.
      const fromPointer = e && (e.clientX || e.clientY)
      const x = fromPointer ? e.clientX - rect.left : rect.width / 2
      const y = fromPointer ? e.clientY - rect.top  : rect.height / 2
      setReveal({ x, y, r: Math.hypot(Math.max(x, rect.width - x), Math.max(y, rect.height - y)) })
    }
    clearTimeout(closeTimer.current)
    setClosing(false)
    setExpanded(key)
  }

  useEffect(() => () => clearTimeout(closeTimer.current), [])

  useEffect(() => {
    if (!expanded) return
    const onKey = (e) => { if (e.key === 'Escape') closeDetail() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expanded]) // eslint-disable-line react-hooks/exhaustive-deps

  const [cardOrder, setCardOrder] = useState(['humidity', 'wind', 'pressure', 'visibility', 'sun', 'aqi'])
  const [draggingKey, setDraggingKey] = useState(null)
  const [dragOverKey, setDragOverKey] = useState(null)
  const dragSrc = useRef(null)
  const dragTarget = useRef(null)

  const handleDragStart = (key) => { dragSrc.current = key; setDraggingKey(key) }
  const handleDragEnter = (key) => { dragTarget.current = key; setDragOverKey(key) }
  const handleDragOver  = (e)   => e.preventDefault()
  const handleDragEnd   = ()    => {
    const src = dragSrc.current
    const tgt = dragTarget.current
    if (src && tgt && src !== tgt) {
      setCardOrder(prev => {
        const next = [...prev]
        const from = next.indexOf(src)
        const to   = next.indexOf(tgt)
        next.splice(from, 1)
        next.splice(to, 0, src)
        return next
      })
    }
    dragSrc.current = null
    dragTarget.current = null
    setDraggingKey(null)
    setDragOverKey(null)
  }

  const windDir = getWindDirection(current.wind_direction_10m)
  const visMi   = (current.visibility / 1609.34).toFixed(1)
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

  const humInfo  = getHumidityInfo(current.relative_humidity_2m)
  const presInfo = getPressureInfo(current.surface_pressure)
  const visInfo  = getVisibilityInfo(parseFloat(visMi))
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
  const windSpeeds = hourly?.wind_speed_10m ? sliceNext(hourly.wind_speed_10m, 6) : []
  const windDirs   = hourly?.wind_direction_10m ? sliceNext(hourly.wind_direction_10m, 6) : []
  const windTimes  = windSpeeds.length > 0 ? sliceNext(hourly.time, 6) : []

  // Humidity
  const humValues = hourly?.relative_humidity_2m ? sliceNext(hourly.relative_humidity_2m, 6) : []
  const humTimes  = humValues.length > 0 ? sliceNext(hourly.time, 6) : []

  // Pressure — trend reads backwards from the current hour, so it needs the raw
  // hourly series and hStart rather than the forward-only sliceNext window.
  const presValues = hourly?.surface_pressure ? sliceNext(hourly.surface_pressure, 6) : []
  const presTimes  = presValues.length > 0 ? sliceNext(hourly.time, 6) : []
  const presTrend  = getPressureTrend(hourly, hStart)

  // Visibility
  const visValues = hourly?.visibility ? sliceNext(hourly.visibility, 6).map(v => v / 1609.34) : []
  const visTimes  = visValues.length > 0 ? sliceNext(hourly.time, 6) : []

  const cardDefs = {
    humidity:   {
      icon: <Droplets size={19} />, label: 'Humidity',
      value: `${current.relative_humidity_2m}%`,
      sub: <span style={{ color: humInfo.color, fontWeight: 600 }}>{humInfo.label}</span>,
      color: humInfo.color,
      onClick: (e) => openDetail('humidity', e), isExpanded: expanded === 'humidity',
    },
    wind: {
      icon: <WindTurbine size={19} />, label: 'Wind',
      value: `${Math.round(current.wind_speed_10m)} mph`,
      sub: windDir,
      color: windInfo.color,
      onClick: (e) => openDetail('wind', e), isExpanded: expanded === 'wind',
    },
    pressure: {
      icon: <Gauge size={19} />, label: 'Pressure',
      // "29.92 inHg" is too wide for the tile at full size — shrink just the unit.
      value: <>{toInHg(current.surface_pressure)}<span className="detail-value-unit"> inHg</span></>,
      sub: <span style={{ color: presInfo.color, fontWeight: 600 }}>{presInfo.label}</span>,
      color: presInfo.color,
      onClick: (e) => openDetail('pressure', e), isExpanded: expanded === 'pressure',
    },
    visibility: {
      icon: <Eye size={19} />, label: 'Visibility',
      value: `${visMi} mi`,
      sub: <span style={{ color: visInfo.color, fontWeight: 600 }}>{visInfo.label}</span>,
      color: visInfo.color,
      onClick: (e) => openDetail('visibility', e), isExpanded: expanded === 'visibility',
    },
    // Sunrise, sunset, and UV share one standard-size tile: all three describe
    // the sun's arc through the day. The two times stand in for the usual big
    // .detail-value, and the UV index rides the sub row as a small number.
    sun: {
      icon: uvHigh ? <AlertTriangle size={19} /> : <Sun size={19} />, label: 'Sun & UV',
      color: uv.color,
      onClick: (e) => openDetail('sun', e), isExpanded: expanded === 'sun',
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
      onClick: (e) => openDetail('aqi', e), isExpanded: expanded === 'aqi',
    } : null,
  }

  // Body of the expanded detail, rendered inside the cover that grows over the
  // card. Returns bare content — .detail-cover-body supplies the column layout.
  const detailBody = (key) => {
    switch (key) {
      case 'humidity':
        return (
          <>
            <DetailSummary
              value={current.relative_humidity_2m} unit="%"
              label={humInfo.label} color={humInfo.color}
              note={getHumidityNote(current.relative_humidity_2m)}
            />
            <DetailStats items={[
              { label: 'Dew point', value: current.dew_point_2m != null ? `${toTemp(current.dew_point_2m, unit)}°` : null },
              { label: 'Feels like', value: `${toTemp(current.apparent_temperature, unit)}°` },
            ]} />
            {humTimes.length > 0 && (
              <div className="uv-timeline">
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
            )}
          </>
        )

      case 'wind':
        return (
          <>
            <DetailSummary
              value={Math.round(current.wind_speed_10m)} unit=" mph"
              label={`From the ${windDir}`} color={windInfo.color}
              note={getWindNote(current.wind_speed_10m)}
            />
            <DetailStats items={[
              { label: 'Gusts', value: current.wind_gusts_10m != null ? `${Math.round(current.wind_gusts_10m)} mph` : null },
              { label: 'Direction', value: `${windDir} (${Math.round(current.wind_direction_10m)}°)` },
            ]} />
            {windTimes.length > 0 && (
              <div className="uv-timeline">
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
                      <span className="uv-tl-val" style={{ color: wInfo.color }}>{Math.round(speed)}</span>
                      <span className="uv-tl-lbl" style={{ color: 'var(--text-secondary)' }}>{getWindDirection(degrees)}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )

      case 'pressure':
        return (
          <>
            <DetailSummary
              value={toInHg(current.surface_pressure)} unit=" inHg"
              label={presInfo.label} color={presInfo.color}
              note={presTrend?.note ?? 'Pressure is near the seasonal average.'}
            />
            <DetailStats items={[
              { label: 'Trend', value: presTrend?.label },
              {
                label: '3 hr change',
                value: presTrend ? `${presTrend.delta > 0 ? '+' : '−'}${Math.abs(presTrend.delta / HPA_PER_INHG).toFixed(2)} inHg` : null,
              },
            ]} />
            {presTimes.length > 0 && (
              <div className="uv-timeline">
                {presTimes.map((time, i) => {
                  const val  = presValues[i] ?? 0
                  const info = getPressureInfo(val)
                  return (
                    <div key={i} className="uv-timeline-item">
                      <span className="uv-tl-time">{fmt(time, i)}</span>
                      <span className="uv-tl-val uv-tl-val--sm" style={{ color: info.color }}>{toInHg(val)}</span>
                      <span className="uv-tl-lbl" style={{ color: info.color }}>{info.label}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )

      case 'visibility':
        return (
          <>
            <DetailSummary
              value={visMi} unit=" mi"
              label={visInfo.label} color={visInfo.color}
              note={getVisibilityNote(parseFloat(visMi))}
            />
            {visTimes.length > 0 && (
              <div className="uv-timeline">
                {visTimes.map((time, i) => {
                  const val  = visValues[i] ?? 0
                  const info = getVisibilityInfo(val)
                  return (
                    <div key={i} className="uv-timeline-item">
                      <span className="uv-tl-time">{fmt(time, i)}</span>
                      <span className="uv-tl-val uv-tl-val--sm" style={{ color: info.color }}>{val.toFixed(1)}</span>
                      <span className="uv-tl-lbl" style={{ color: info.color }}>{info.label}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )

      case 'sun':
        return (
          <>
            <DetailSummary
              value={Math.round(uvCurrent)}
              label={uv.label} color={uv.color}
              note={getUVNote(uvCurrent)}
            />
            {/* Sits directly above the sunrise/sunset stats it illustrates. Arc
                in golden-hour orange; the dot tracks the sun's live altitude. */}
            <div className="sun-dial-wrap" style={{ color: sunBase }}>
              <SunDial progress={sunProgress} sunFill={sunTint(sunProgress)} wide />
            </div>
            <DetailStats items={[
              { label: 'Sunrise', value: sunrise, color: sunBase },
              { label: 'Sunset', value: sunset, color: sunBase },
              { label: 'Peak UV', value: daily.uv_index_max?.[0] != null ? Math.round(daily.uv_index_max[0]) : null },
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
            <div className="aqi-pollutants">
              <Pollutant name="PM2.5" value={airQuality.pm2_5}            unit="µg/m³" />
              <Pollutant name="PM10"  value={airQuality.pm10}             unit="µg/m³" />
              <Pollutant name="O₃"   value={airQuality.ozone}            unit="µg/m³" />
              <Pollutant name="NO₂"  value={airQuality.nitrogen_dioxide} unit="µg/m³" />
            </div>
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
        {cardOrder
          .filter(key => cardDefs[key] != null)
          .map(key => (
            <DetailCard
              key={key}
              {...cardDefs[key]}
              onDragStart={() => handleDragStart(key)}
              onDragEnter={() => handleDragEnter(key)}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEnd}
              isDragging={draggingKey === key}
              isDragOver={dragOverKey === key && draggingKey !== key}
            />
          ))
        }
      </div>

      {expanded && (
        <div
          className={`detail-cover${closing ? ' detail-cover--closing' : ''}`}
          style={{
            '--reveal-x': `${reveal.x}px`,
            '--reveal-y': `${reveal.y}px`,
            '--fill-scale': (reveal.r * 2) / FILL_BASE,
          }}
          role="dialog"
          aria-label={openDef?.label}
        >
          <div className="detail-cover-fill" />
          <div className="detail-cover-head">
            <span className="detail-cover-title">
              <span className="detail-cover-icon" style={openDef?.color ? { color: openDef.color } : undefined}>
                {openDef?.icon}
              </span>
              {openDef?.label}
            </span>
            <button className="detail-cover-close" onClick={closeDetail} aria-label="Close details">
              <X size={20} />
            </button>
          </div>
          <div className="detail-cover-body">
            {detailBody(expanded)}
          </div>
        </div>
      )}
    </div>
  )
}
