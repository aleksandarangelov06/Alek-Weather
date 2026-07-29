import { hashString, niceBounds, smoothPath } from './chartUtils'

// Small single-series line, used by the detail panels. Sized by the caller;
// a `width` of 0 (before the first measure) renders nothing.
export function Sparkline({ values, width, height = 56, color = 'var(--accent)', fill = true, step = 5 }) {
  // A missing hour would put a NaN in the path and blank the whole line, so
  // gaps are dropped and the remaining readings re-spaced across the width.
  const clean = values.filter((v) => v != null && Number.isFinite(v))
  if (!width || clean.length < 2) return null
  const pad = 6
  const { min, max } = niceBounds(clean, step)
  const range = max - min || 1
  const x = (i) => (i / (clean.length - 1)) * width
  const y = (v) => pad + (1 - (v - min) / range) * (height - pad * 2)
  const pts = clean.map((v, i) => [x(i), y(v)])
  const line = smoothPath(pts)
  const area = `${line} L ${width} ${height} L 0 ${height} Z`
  const gradId = `spark-${Math.abs(hashString(clean.join(',') + color))}`
  return (
    <svg className="web-spark" width={width} height={height} aria-hidden="true">
      {fill && (
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
      )}
      {fill && <path d={area} fill={`url(#${gradId})`} stroke="none" />}
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="3" fill={color} />
    </svg>
  )
}
