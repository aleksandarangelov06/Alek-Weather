import { useMemo } from 'react'
import { liveWeatherCode, precipTier, SNOW_CODES } from '../utils/weatherCodes'
import { useMeasure } from './web/chartUtils'

// Thresholds in inches/15min (precipitation_unit=inch in API params)
const MAX_P   = 0.12   // ~12mm/hr ceiling
const MED_P   = 0.08   // ~8mm/hr
const LIGHT_P = 0.02   // ~2mm/hr
const SPAN_MIN = 60    // minutes to display on X axis

// Representative in/15min rate for a weather-code intensity tier (1 light …
// 4 severe). Used to place the "now" point on the chart when it's raining but the
// model reports no measured amount — the weather code is the only signal.
const TIER_RATE = { 1: LIGHT_P, 2: MED_P, 3: MAX_P, 4: MAX_P }

// SVG layout, in two flavours.
//
// On a phone the card is one of a narrow stack, so the drawing is a fixed
// 300×90 viewBox rendered at 100% width: the height follows the ratio, and
// within the width a phone can be that lands somewhere sensible.
//
// The web card is the full page width, and there the same trick scales without
// bound — height is width × VH/VW, so a 2560px monitor turned a one-hour trace
// into a 400px poster with 30px axis labels. Everything in the viewBox grows
// with the window, which is exactly what a chart of five points must not do. So
// the wide chart is drawn in real pixels at a fixed height instead, the way the
// other web charts (HourlyChart, Sparkline) already are: only the horizontal
// span stretches, and the type, strokes and gutters stay put.
const PHONE = {
  h: 90, pl: 44, pr: 6, pt: 8, pb: 22,
  bandFont: 7, timeFont: 7.5, hair: 0.8, dash: '3 3', stroke: 1.5, gap: 4,
}
const WIDE = {
  h: 148, pl: 62, pr: 14, pt: 12, pb: 26,
  bandFont: 11, timeFont: 11, hair: 1, dash: '4 4', stroke: 2, gap: 10,
}
// Width to draw at before the ResizeObserver has first reported. The height is
// fixed either way, so guessing wrong costs a redrawn curve, not a jump in the
// page — and the plot wrapper clips, so an over-wide guess can't push a
// scrollbar onto the page for that frame.
const WIDE_FALLBACK_W = 900

// Rate → y, against a chart bottom `cb` and height `ch` that differ per flavour.
const yFor = (p, cb, ch) => cb - (Math.min(Math.max(p, 0), MAX_P) / MAX_P) * ch

function buildPath(pts, cb) {
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
    area: `${d} L${f(pts.at(-1).x)},${cb} L${f(pts[0].x)},${cb} Z`,
  }
}

export function PrecipNowcast({ minutely, currentTime, mode = 'auto', current = null, radarClear = null, wide = false }) {
  const [plotRef, measured] = useMeasure()

  const L = wide ? WIDE : PHONE
  // Phone: the viewBox is the 300-unit design box and the svg scales it. Wide:
  // one unit is one CSS pixel, so the box is however wide the card turned out.
  const VW = wide ? (measured || WIDE_FALLBACK_W) : 300
  const VH = L.h
  const CX = L.pl
  const CW = Math.max(VW - L.pl - L.pr, 1)
  const CH = VH - L.pt - L.pb
  const CB = L.pt + CH

  const Y_LIGHT = yFor(LIGHT_P, CB, CH)
  const Y_MED   = yFor(MED_P, CB, CH)
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
        y: yFor(precip[si + i] ?? 0, CB, CH),
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
      if (observedNow > pts[0].p) pts[0] = { ...pts[0], p: observedNow, y: yFor(observedNow, CB, CH) }
    }

    const allDry = pts.every(p => p.p < 0.001)
    // Meaningful rain in the next hour = the nowcast reaches at least the LIGHT
    // band. A flat trace of drizzle (below LIGHT_P) doesn't count as "it'll rain".
    const willRain = pts.some(p => p.p >= LIGHT_P)
    return { pts, allDry, willRain }
  }, [minutely, currentTime, rainingNow, liveCode, current?.precipitation, CX, CW, CB, CH])

  if (!data) return null
  if (mode === 'off') return null

  const { pts, allDry, willRain } = data

  // On auto, only surface the card when it's actually raining now or rain of at
  // least light intensity is coming within the hour — otherwise an overcast-but-
  // dry hour would still show an empty-looking chart.
  if (mode === 'auto') {
    if (!rainingNow && !willRain) return null
  }

  const { line, area } = buildPath(pts, CB)

  const xLabels = pts.slice(1).map(p => ({
    x: p.x,
    label: p.min >= 60 ? '+1hr' : `+${p.min}m`,
  }))

  // Band labels sit in the middle of their band; the nudge is the half-cap-height
  // that turns an SVG text baseline into a visual centre, so it tracks the type size.
  const nudge = L.bandFont * 0.36
  const yHeavyLabel = (L.pt + Y_MED) / 2 + nudge
  const yMedLabel   = (Y_MED + Y_LIGHT) / 2 + nudge
  const yLightLabel = (Y_LIGHT + CB) / 2 + nudge

  return (
    <div className="card nowcast-card">
      <div className="nowcast-header">
        <span className="section-label" style={{ margin: 0 }}>PRECIPITATION</span>
        {rainingNow
          ? <span className="nowcast-now">{SNOW_CODES.has(liveCode) ? 'Snowing now' : 'Raining now'}</span>
          : allDry && <span className="nowcast-dry">None expected</span>}
      </div>
      {/* The measured box. Wide, the svg is sized in pixels to match it, so one
          viewBox unit is one pixel; on a phone the viewBox ratio scales it. */}
      <div ref={plotRef} style={{ marginTop: 10, overflow: 'hidden' }}>
        <svg
          viewBox={`0 0 ${VW} ${VH}`}
          width={wide ? VW : undefined}
          height={wide ? VH : undefined}
          style={wide
            ? { display: 'block' }
            : { width: '100%', height: 'auto', display: 'block' }}
          aria-label="Next-hour precipitation forecast"
        >
          {/* Dashed zone dividers */}
          <line x1={CX} y1={Y_MED}   x2={CX + CW} y2={Y_MED}
            stroke="var(--border)" strokeWidth={L.hair} strokeDasharray={L.dash} />
          <line x1={CX} y1={Y_LIGHT} x2={CX + CW} y2={Y_LIGHT}
            stroke="var(--border)" strokeWidth={L.hair} strokeDasharray={L.dash} />

          {/* Baseline */}
          <line x1={CX} y1={CB} x2={CX + CW} y2={CB}
            stroke="var(--border)" strokeWidth={L.hair} />

          {/* Area fill */}
          <path d={area} fill="var(--accent)" fillOpacity="0.15" />
          {/* Stroke line */}
          <path d={line} fill="none" stroke="var(--accent)" strokeWidth={L.stroke}
            strokeLinecap="round" strokeLinejoin="round" />

          {/* Y-axis labels */}
          <text x={CX - L.gap} y={yHeavyLabel} textAnchor="end" fontSize={L.bandFont}
            fill="var(--text-tertiary)" fontFamily="inherit" fontWeight="600">HEAVY</text>
          <text x={CX - L.gap} y={yMedLabel}   textAnchor="end" fontSize={L.bandFont}
            fill="var(--text-tertiary)" fontFamily="inherit" fontWeight="600">MED</text>
          <text x={CX - L.gap} y={yLightLabel} textAnchor="end" fontSize={L.bandFont}
            fill="var(--text-tertiary)" fontFamily="inherit" fontWeight="600">LIGHT</text>

          {/* X-axis time labels */}
          {xLabels.map(({ x, label }) => (
            <text key={label} x={x} y={VH - L.pb / 4} textAnchor="middle" fontSize={L.timeFont}
              fill="var(--text-tertiary)" fontFamily="inherit">
              {label}
            </text>
          ))}
        </svg>
      </div>
    </div>
  )
}
