import { useMemo } from 'react'

// Thresholds in inches/15min (precipitation_unit=inch in API params)
const MAX_P   = 0.12   // ~12mm/hr ceiling
const MED_P   = 0.08   // ~8mm/hr
const LIGHT_P = 0.02   // ~2mm/hr
const SPAN_MIN = 60    // minutes to display on X axis

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

export function PrecipNowcast({ minutely, currentTime, mode = 'auto' }) {
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

    const allDry = pts.every(p => p.p < 0.001)
    return { pts, allDry }
  }, [minutely, currentTime])

  if (!data) return null
  if (mode === 'off') return null

  const { pts, allDry } = data
  if (mode === 'auto' && allDry) return null
  const { line, area } = buildPath(pts)

  const xLabels = pts.slice(1).map(p => ({
    x: p.x,
    label: p.min >= 60 ? '+1hr' : `+${p.min}m`,
  }))

  const yHeavyLabel = (PT + Y_MED) / 2 + 3
  const yMedLabel   = (Y_MED + Y_LIGHT) / 2 + 3
  const yLightLabel = (Y_LIGHT + CB) / 2 + 3

  return (
    <div className="card">
      <div className="nowcast-header">
        <span className="section-label" style={{ margin: 0 }}>PRECIPITATION</span>
        {allDry && <span className="nowcast-dry">None expected</span>}
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
