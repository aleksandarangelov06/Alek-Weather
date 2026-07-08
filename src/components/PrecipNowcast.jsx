import { useMemo } from 'react'
import { liveWeatherCode, precipTier, SNOW_CODES } from '../utils/weatherCodes'

// Thresholds in inches/15min (precipitation_unit=inch in API params)
const MAX_P   = 0.12   // ~12mm/hr ceiling
const MED_P   = 0.08   // ~8mm/hr
const LIGHT_P = 0.02   // ~2mm/hr
const SPAN_MIN = 60    // minutes to display on X axis

// Representative in/15min rate for a weather-code intensity tier (1 light …
// 4 severe). Used to place the "now" point on the chart when it's raining but the
// model reports no measured amount — the weather code is the only signal.
const TIER_RATE = { 1: LIGHT_P, 2: MED_P, 3: MAX_P, 4: MAX_P }

// SVG layout
const VW = 300, VH = 90
const PL = 44, PR = 6, PT = 8, PB = 22
const CX = PL
const CW = VW - PL - PR   // 250
const CH = VH - PT - PB   // 60
const CB = PT + CH         // 68 — chart bottom y

const toY = (p) => CB - (Math.min(Math.max(p, 0), MAX_P) / MAX_P) * CH

const Y_LIGHT = toY(LIGHT_P)  // 58
const Y_MED   = toY(MED_P)    // 28

function buildPath(pts) {
  if (pts.length < 2) return { line: '', area: '' }
  const f = (n) => n.toFixed(2)
  let d = `M${f(pts[0].x)},${f(pts[0].y)}`
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1], c = pts[i]
    const cx = (p.x + c.x) / 2
    d += ` C${f(cx)},${f(p.y)} ${f(cx)},${f(c.y)} ${f(c.x)},${f(c.y)}`
  }
  return {
    line: d,
    area: `${d} L${f(pts.at(-1).x)},${CB} L${f(pts[0].x)},${CB} Z`,
  }
}

export function PrecipNowcast({ minutely, currentTime, mode = 'auto', current = null, radarClear = null }) {
  // Live, observation-corrected current condition. The minutely_15 trace can read
  // flat/zero at onset while a station already observes rain (the nowcast lag
  // handled in liveWeatherCode), so this — not the forward trace — is the source
  // of truth for whether it's precipitating right now.
  const liveCode = liveWeatherCode(current, minutely, radarClear)
  const rainingNow = precipTier(liveCode) > 0

  const data = useMemo(() => {
    const times = minutely?.time
    const precip = minutely?.precipitation
    if (!times?.length || !precip?.length || !currentTime) return null

    // String comparison is timezone-safe since both are from the same API response
    let si = times.findIndex(t => t >= currentTime)
    if (si < 0) si = Math.max(0, times.length - 5)

    const N = Math.min(5, times.length - si)
    if (N < 2) return null

    const pts = Array.from({ length: N }, (_, i) => {
      const minFromStart = i * 15
      return {
        x: CX + (minFromStart / SPAN_MIN) * CW,
        y: toY(precip[si + i] ?? 0),
        p: precip[si + i] ?? 0,
        min: minFromStart,
      }
    })

    // Seed the "now" point so the chart reflects rain that's actually falling
    // instead of the lagging flat trace. Take the stronger of two observed
    // signals: the measured preceding-hour total (current.precipitation, inch;
    // ÷4 → in/15min), and the intensity implied by the live weather code when the
    // model reports no amount at all — this location's case, where the code says
    // Heavy Rain while every precip figure reads 0. Gated on rainingNow so a
    // just-ended shower's lingering hourly total doesn't fabricate a spike.
    if (rainingNow) {
      const measured = (current?.precipitation ?? 0) / 4
      const fromCode = TIER_RATE[precipTier(liveCode)] ?? 0
      const observedNow = Math.max(measured, fromCode)
      if (observedNow > pts[0].p) pts[0] = { ...pts[0], p: observedNow, y: toY(observedNow) }
    }

    const allDry = pts.every(p => p.p < 0.001)
    // Meaningful rain in the next hour = the nowcast reaches at least the LIGHT
    // band. A flat trace of drizzle (below LIGHT_P) doesn't count as "it'll rain".
    const willRain = pts.some(p => p.p >= LIGHT_P)
    return { pts, allDry, willRain }
  }, [minutely, currentTime, rainingNow, liveCode, current?.precipitation])

  if (!data) return null
  if (mode === 'off') return null

  const { pts, allDry, willRain } = data

  // On auto, only surface the card when it's actually raining now or rain of at
  // least light intensity is coming within the hour — otherwise an overcast-but-
  // dry hour would still show an empty-looking chart.
  if (mode === 'auto') {
    if (!rainingNow && !willRain) return null
  }

  const { line, area } = buildPath(pts)

  const xLabels = pts.slice(1).map(p => ({
    x: p.x,
    label: p.min >= 60 ? '+1hr' : `+${p.min}m`,
  }))

  const yHeavyLabel = (PT + Y_MED) / 2 + 3
  const yMedLabel   = (Y_MED + Y_LIGHT) / 2 + 3
  const yLightLabel = (Y_LIGHT + CB) / 2 + 3

  return (
    <div className="card nowcast-card">
      <div className="nowcast-header">
        <span className="section-label" style={{ margin: 0 }}>PRECIPITATION</span>
        {rainingNow
          ? <span className="nowcast-now">{SNOW_CODES.has(liveCode) ? 'Snowing now' : 'Raining now'}</span>
          : allDry && <span className="nowcast-dry">None expected</span>}
      </div>
      <svg
        viewBox={`0 0 ${VW} ${VH}`}
        style={{ width: '100%', height: 'auto', display: 'block', marginTop: 10 }}
        aria-label="Next-hour precipitation forecast"
      >
        {/* Dashed zone dividers */}
        <line x1={CX} y1={Y_MED}   x2={CX + CW} y2={Y_MED}
          stroke="var(--border)" strokeWidth="0.8" strokeDasharray="3 3" />
        <line x1={CX} y1={Y_LIGHT} x2={CX + CW} y2={Y_LIGHT}
          stroke="var(--border)" strokeWidth="0.8" strokeDasharray="3 3" />

        {/* Baseline */}
        <line x1={CX} y1={CB} x2={CX + CW} y2={CB}
          stroke="var(--border)" strokeWidth="0.8" />

        {/* Area fill */}
        <path d={area} fill="var(--accent)" fillOpacity="0.15" />
        {/* Stroke line */}
        <path d={line} fill="none" stroke="var(--accent)" strokeWidth="1.5"
          strokeLinecap="round" strokeLinejoin="round" />

        {/* Y-axis labels */}
        <text x={CX - 4} y={yHeavyLabel} textAnchor="end" fontSize="7"
          fill="var(--text-tertiary)" fontFamily="inherit" fontWeight="600">HEAVY</text>
        <text x={CX - 4} y={yMedLabel}   textAnchor="end" fontSize="7"
          fill="var(--text-tertiary)" fontFamily="inherit" fontWeight="600">MED</text>
        <text x={CX - 4} y={yLightLabel} textAnchor="end" fontSize="7"
          fill="var(--text-tertiary)" fontFamily="inherit" fontWeight="600">LIGHT</text>

        {/* X-axis time labels */}
        {xLabels.map(({ x, label }) => (
          <text key={label} x={x} y={VH - 5} textAnchor="middle" fontSize="7.5"
            fill="var(--text-tertiary)" fontFamily="inherit">
            {label}
          </text>
        ))}
      </svg>
    </div>
  )
}
