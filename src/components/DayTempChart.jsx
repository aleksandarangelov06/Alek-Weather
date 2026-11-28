import { useId } from 'react'
import { tempInk, toTemp } from '../utils/weatherCodes'

// The day's temperature, hour by hour, on the day cover and day page
// (DailyForecast), in two parts:
//
//   DayTempHead  the title and a line of words saying which way the day goes
//                ("Rising to 72° by 3 PM, then falling to 55°"), fixed above
//                the hour strip
//   DayTempPlot  the line itself, inside the hour strip's scrolled track, one
//                point over the middle of each hour's column, so it scrolls
//                with the icons and each point sits over its hour
//
// With color coding on, the line takes each hour's temperature colour, so a
// warm afternoon reads warm at a glance. It is drawn in a stretched SVG
// (non-scaling stroke keeps it even); the high and low labels are HTML laid
// over it by percentage, so text never stretches.

const W = 1000
const H = 100
// Room above the high and below the low for their labels.
const PAD_TOP = 36
const PAD_BOTTOM = 32

// "3 PM" from a naive local timestamp.
const hourText = (iso) => {
  const h = +iso.slice(11, 13)
  return `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`
}

// A smooth line through the points (Catmull-Rom as cubic Béziers).
function smoothPath(pts) {
  let d = `M ${pts[0][0]} ${pts[0][1]}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]
    d += ` C ${c1[0].toFixed(1)} ${c1[1].toFixed(1)}, ${c2[0].toFixed(1)} ${c2[1].toFixed(1)}, ${p2[0]} ${p2[1]}`
  }
  return d
}

// Which way the day goes, in words: from its first hour through the high and
// the low, in the order they come, to its last ("Falling to 45° by 6 AM,
// rising to 72° by 3 PM, then falling to 60°"). A change under 3° is left
// out as noise.
function trendText(pts, unit) {
  const t = (f) => `${toTemp(f, unit)}°`
  const hi = pts.reduce((a, b) => (b.temp > a.temp ? b : a))
  const lo = pts.reduce((a, b) => (b.temp < a.temp ? b : a))
  if (hi.temp - lo.temp < 3) return `Steady around ${t((hi.temp + lo.temp) / 2)} all day`
  const keys = [pts[0], ...[hi, lo].sort((a, b) => a.k - b.k), pts[pts.length - 1]]
  const kept = [keys[0]]
  for (const p of keys.slice(1)) {
    const prev = kept[kept.length - 1]
    if (p.k === prev.k || Math.abs(p.temp - prev.temp) < 3) continue
    // Still going the same way: the later point replaces the earlier one.
    const before = kept[kept.length - 2]
    if (before && (p.temp > prev.temp) === (prev.temp > before.temp)) kept[kept.length - 1] = p
    else kept.push(p)
  }
  const moves = kept.slice(1).map((p, i) => {
    const verb = p.temp > kept[i].temp ? 'rising' : 'falling'
    const last = i === kept.length - 2
    return `${verb} to ${t(p.temp)}${last && i > 0 ? '' : ` by ${hourText(p.time)}`}`
  })
  if (moves.length > 1) moves[moves.length - 1] = `then ${moves[moves.length - 1]}`
  const text = moves.join(', ')
  return text[0].toUpperCase() + text.slice(1)
}

const usable = (hours) => hours
  .map((h, k) => ({ k, time: h.time, temp: h.temp }))
  .filter((p) => Number.isFinite(p.temp))

export function DayTempHead({ hours, unit }) {
  const pts = usable(hours)
  if (pts.length < 2) return null
  return (
    <div className="day-temp-head">
      <span className="day-temp-title">Temperature</span>
      <span className="day-temp-trend">{trendText(pts, unit)}</span>
    </div>
  )
}

export function DayTempPlot({ hours, unit, colorCoding = true, timezone }) {
  // React's ids carry characters (":" or "«»") that break a url(#id) reference.
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const gradId = `dtc-line-${uid}`
  const fillId = `dtc-fill-${uid}`
  const pts = usable(hours)
  if (pts.length < 2) return null

  const n = hours.length
  const temps = pts.map((p) => p.temp)
  const min = Math.min(...temps)
  const max = Math.max(...temps)
  const range = Math.max(max - min, 4)
  const lo = (max + min) / 2 - range / 2
  // The middle of column k: the strip's columns are all one width.
  const x = (k) => ((k + 0.5) / n) * W
  const y = (f) => PAD_TOP + (1 - (f - lo) / range) * (H - PAD_TOP - PAD_BOTTOM)
  const xy = pts.map((p) => [+x(p.k).toFixed(1), +y(p.temp).toFixed(1)])
  const line = smoothPath(xy)
  const area = `${line} L ${xy[xy.length - 1][0]} ${H} L ${xy[0][0]} ${H} Z`

  const hi = pts.reduce((a, b) => (b.temp > a.temp ? b : a))
  const loPt = pts.reduce((a, b) => (b.temp < a.temp ? b : a))
  const pct = (k) => (x(k) / W) * 100
  const ypct = (f) => (y(f) / H) * 100
  const ink = (f) => (colorCoding ? tempInk(f) : 'var(--text-primary)')

  // Now, if the day on show is today at the place.
  const nowIso = new Date().toLocaleString('sv', { timeZone: timezone }).replace(' ', 'T')
  const nowK = hours.findIndex((h) => h.time.slice(0, 13) === nowIso.slice(0, 13))

  return (
    <div className="day-temp-plot" role="img" aria-label={`Temperature through the day: ${trendText(pts, unit)}`}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="0">
            {pts.map((p) => (
              <stop key={p.k} offset={`${pct(p.k)}%`} style={{ stopColor: ink(p.temp) }} />
            ))}
          </linearGradient>
          <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" style={{ stopColor: ink(max), stopOpacity: 0.22 }} />
            <stop offset="100%" style={{ stopColor: ink(min), stopOpacity: 0 }} />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${fillId})`} />
        <path d={line} className="day-temp-line" stroke={`url(#${gradId})`} vectorEffect="non-scaling-stroke" />
      </svg>
      {nowK >= 0 && <span className="day-temp-now" style={{ left: `${pct(nowK)}%` }} aria-hidden="true" />}
      {[{ p: hi, cls: 'is-high' }, { p: loPt, cls: 'is-low' }].map(({ p, cls }) => (
        <span
          key={cls}
          className={`day-temp-mark ${cls}`}
          style={{ left: `${pct(p.k)}%`, top: `${ypct(p.temp)}%`, '--ink': ink(p.temp) }}
          aria-hidden="true"
        >
          <span className="day-temp-mark-label">{toTemp(p.temp, unit)}°</span>
        </span>
      ))}
    </div>
  )
}
