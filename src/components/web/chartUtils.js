import { useEffect, useRef, useState } from 'react'

// Shared drawing helpers for the web app's charts. The mobile cards each draw
// their own inline SVG; the web pages are wide enough that several of them need
// the same primitives, so they live here instead of being copied per page.

// Smooth cubic-bezier path through the points (Catmull-Rom → Bézier). Same
// construction the mobile hourly graph uses, so the two look like one family.
export function smoothPath(pts) {
  if (pts.length < 2) return ''
  let d = `M ${pts[0][0]} ${pts[0][1]}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] || p2
    const c1x = p1[0] + (p2[0] - p0[0]) / 6
    const c1y = p1[1] + (p2[1] - p0[1]) / 6
    const c2x = p2[0] - (p3[0] - p1[0]) / 6
    const c2y = p2[1] - (p3[1] - p1[1]) / 6
    d += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${p2[0]} ${p2[1]}`
  }
  return d
}

// Width of an element, tracked live. The web charts are drawn in real pixels
// rather than a scaled viewBox — a viewBox that stretches to the container
// would smear the stroke widths and text along with it — so every chart needs
// to know how wide its card actually is.
export function useMeasure() {
  const ref = useRef(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.getBoundingClientRect().width)
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width]
}

// Nice round bounds around a series, so gridlines land on readable numbers
// instead of the raw min/max. `pad` keeps the curve off the top and bottom edges.
export function niceBounds(values, step = 5, pad = 1) {
  const clean = values.filter((v) => v != null && Number.isFinite(v))
  if (!clean.length) return { min: 0, max: 1 }
  const lo = Math.min(...clean)
  const hi = Math.max(...clean)
  const min = Math.floor((lo - pad) / step) * step
  const max = Math.ceil((hi + pad) / step) * step
  return { min, max: max === min ? min + step : max }
}

// Stable id for a gradient from its own content — two sparklines with identical
// data and colour can safely share one definition, and unlike useId the value
// survives a re-render without changing.
export function hashString(s) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return h
}
