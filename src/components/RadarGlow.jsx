import { useLayoutEffect, useRef } from 'react'

// The glow ring around the compact radar map (.radar-map-glow in App.css).
//
// Its shape (a cut-out the size of the map, faded out towards the card's
// edges) used to be three CSS mask layers combined with mask-composite and a
// content-box clip. Desktop Chrome draws that correctly, but the Android WebView
// drew the ring as a hard-edged box around the map. This builds the same shape
// as a single SVG mask image, sized to the ring in pixels. A single mask layer
// needs no compositing and no clipping, so every engine draws it the same way.
// The geometry still comes from the CSS custom properties, so App.css is the
// only place where the numbers are set.

// Eased fades, the same stops the CSS gradients used: [distance in from the
// edge as a fraction of the fade depth, opacity].
const FADE_SIDE = [[0, 0], [0.35, 0.08], [0.65, 0.35], [0.88, 0.75], [1, 1]]
const FADE_BOTTOM = [[0, 0], [0.2, 0.06], [0.45, 0.25], [0.75, 0.6], [1, 1]]

const HOLE_RADIUS = 14

function stops(near, far, size, depthNear, depthFar) {
  const out = []
  for (const [t, a] of near) out.push([(t * depthNear) / size, a])
  for (const [t, a] of [...far].reverse()) out.push([1 - (t * depthFar) / size, a])
  return out
    .map(([o, a]) => `<stop offset='${Math.min(1, Math.max(0, o)).toFixed(4)}' stop-color='white' stop-opacity='${a}'/>`)
    .join('')
}

function px(style, name, fallback) {
  const v = parseFloat(style.getPropertyValue(name))
  return Number.isFinite(v) ? v : fallback
}

function buildMask(w, h, gx, gt, gb) {
  const holeW = w - 2 * gx
  const holeH = h - gt - gb
  if (holeW <= 0 || holeH <= 0) return null
  const fx = stops(FADE_SIDE, FADE_SIDE, w, gx, gx)
  const fy = stops(FADE_SIDE, FADE_BOTTOM, h, gt, gb)
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'>` +
    `<defs>` +
    `<linearGradient id='x' gradientUnits='userSpaceOnUse' x1='0' y1='0' x2='${w}' y2='0'>${fx}</linearGradient>` +
    `<linearGradient id='y' gradientUnits='userSpaceOnUse' x1='0' y1='0' x2='0' y2='${h}'>${fy}</linearGradient>` +
    `<mask id='m' maskUnits='userSpaceOnUse' x='0' y='0' width='${w}' height='${h}'>` +
    `<rect width='${w}' height='${h}' fill='url(#x)'/>` +
    `<rect x='${gx}' y='${gt}' width='${holeW}' height='${holeH}' rx='${HOLE_RADIUS}' ry='${HOLE_RADIUS}' fill='black'/>` +
    `</mask>` +
    `</defs>` +
    `<rect width='${w}' height='${h}' fill='url(#y)' mask='url(#m)'/>` +
    `</svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

export function RadarGlow() {
  const ref = useRef(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    let last = ''
    const apply = () => {
      const w = Math.round(el.offsetWidth)
      const h = Math.round(el.offsetHeight)
      if (!w || !h) return
      const cs = getComputedStyle(el)
      const key = `${w}x${h}`
      if (key === last) return
      const mask = buildMask(w, h, px(cs, '--glow-x', 12), px(cs, '--glow-top', 16), px(cs, '--glow-bottom', 30))
      if (!mask) return
      last = key
      el.style.webkitMaskImage = mask
      el.style.maskImage = mask
    }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return <div ref={ref} className="radar-map-glow" aria-hidden="true" />
}
