import { useEffect, useRef } from 'react'

// Rain and snow falling on the radar map — only where the radar has echoes, and
// as whichever one is actually falling there.
//
// It started as a glitch: on the web Radar tab the header strip kept mirroring
// the page's background rain (see mirrorToHeader in WeatherCanvas), so rain fell
// out of the tab bar onto the map whether the radar had anything there or not.
// It looked good enough to keep, so this is the deliberate version of it.
//
// Where: a few times a second the tiles of the radar frame on screen are drawn
// into a small offscreen canvas lined up with the map, and read back as a grid
// of precipitation intensity. The tiles are fetched with crossOrigin (every feed
// here is CORS-open), which is what lets them be read back; if a browser taints
// the canvas anyway, the read throws and the overlay simply stays empty.
//
// What: radar reflectivity can't tell rain from snow, so that comes from surface
// conditions instead — the current temperature and weather code at a grid of
// points across the view (see fetchPhaseField), blended between them, so a
// rain/snow line crossing the map is drawn where it actually is.
//
// The drops are one particle field over the whole map; each samples both grids
// where it is, and is drawn as a streak or a flake — or not at all — accordingly.

// One mask cell per this many CSS pixels. Radar data is ~1 km and smoothed, so a
// coarse grid loses nothing visible and keeps the read-back tiny.
const MASK_PX = 6
// How often the mask is rebuilt from the tiles. Pans between rebuilds are
// tracked exactly (see `origin` below), so this only has to keep up with frame
// changes and tiles arriving.
const MASK_MS = 180
// One drop per this many square CSS pixels of map, capped for big monitors.
const AREA_PER_DROP = 650
const MAX_DROPS = 2600
const LEVELS = 5 // alpha steps, so a frame is a handful of stroke() calls

// RGBA → 0..1 precipitation intensity, read off the colour ramp rather than
// matched to one palette: both ramps in use (RainViewer's and the NWS one) run
// pale/neutral → blue/green → yellow → orange/red → magenta as the echo gets
// stronger, so hue and saturation sort them well enough for drawing rain.
function intensity(r, g, b, a) {
  if (a < 24) return 0
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const v = max / 255
  const s = max === 0 ? 0 : (max - min) / max
  let h = 0
  if (max !== min) {
    const d = max - min
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  let level
  if (s < 0.5 && h > 15 && h < 75) level = 0.14          // tan/beige: drizzle, virga
  else if (s < 0.2) level = 0.14                         // grey/white: very light
  else if (h >= 270 && h < 345) level = 1                // magenta/pink: extreme
  else if (h >= 345 || h < 22) level = 0.92              // red
  else if (h < 45) level = 0.85                          // orange
  else if (h < 75) level = 0.72                          // yellow
  else if (h < 165) level = 0.32                         // green (NWS light–moderate)
  else level = 0.28 + (1 - v) * 0.45                     // cyan→navy, darker is heavier
  return level * Math.min(1, a / 200)
}

// ── Strength off the legend ─────────────────────────────────────────────────
//
// The legend under the scrubber is the scale the user reads the radar by, Light
// to Heavy, so that is the scale the effect follows: each pixel is placed on the
// legend's ramp (projected onto the nearest segment between two of its stops),
// and how far along it sits is how hard it is raining there. Colours the legend
// doesn't name — the NWS ramp's pale greens below its first stop, its magentas
// past its last — are far from every segment, and fall back to the hue reading
// above, which already sorts those two ends correctly.
const PALETTE_MAX_DIST = 110 // RGB distance past which a pixel isn't "on" the legend
const hexRgb = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))

function legendRamp(palette) {
  if (!palette || palette.length < 2) return null
  const stops = palette.map(hexRgb)
  const cache = new Map()
  return (r, g, b, a) => {
    if (a < 24) return 0
    // Quantised cache: tiles are a handful of flat colours plus their blends,
    // so this turns ~10k projections per mask into a few dozen.
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
    let level = cache.get(key)
    if (level === undefined) {
      let best = Infinity, pos = 0
      for (let k = 0; k < stops.length - 1; k++) {
        const [r0, g0, b0] = stops[k], [r1, g1, b1] = stops[k + 1]
        const dr = r1 - r0, dg = g1 - g0, db = b1 - b0
        const len2 = dr * dr + dg * dg + db * db || 1
        const t = Math.max(0, Math.min(1, ((r - r0) * dr + (g - g0) * dg + (b - b0) * db) / len2))
        const er = r - (r0 + dr * t), eg = g - (g0 + dg * t), eb = b - (b0 + db * t)
        const d = er * er + eg * eg + eb * eb
        if (d < best) { best = d; pos = (k + t) / (stops.length - 1) }
      }
      // Light still reads as something falling; heavy reaches the top.
      level = Math.sqrt(best) > PALETTE_MAX_DIST
        ? intensity(r, g, b, 255)
        : 0.1 + 0.9 * pos
      cache.set(key, level)
    }
    return level * Math.min(1, a / 200)
  }
}

// How much of the field is falling at a given strength: a drizzle is a sparse
// scatter, a downpour every drop there is. Curved so the light end stays light.
const density = (I) => 0.06 + 0.94 * Math.pow(I, 1.6)

// ── Rain or snow, per place ─────────────────────────────────────────────────
//
// A coarse grid of current conditions over the view, from Open-Meteo's
// multi-location query (one request, every point). Each point becomes a single
// number, its "snow score": negative means snow, positive means rain, and the
// zero crossing of the blended field is the rain/snow line.
//
//   weather code says snow                     → snow, firmly
//   weather code says freezing rain/drizzle    → rain: it is below freezing,
//                                                but what is falling is liquid
//   otherwise                                  → the temperature against 32°F
const PHASE_URL = 'https://api.open-meteo.com/v1/forecast'
const PHASE_COLS = 8
const PHASE_ROWS = 6
const PHASE_PAD = 0.3              // fetch this much beyond each edge of the view
const PHASE_MAX_AGE = 10 * 60 * 1000
const SNOW_CODES = new Set([71, 73, 75, 77, 85, 86])
const FREEZING_RAIN_CODES = new Set([56, 57, 66, 67])

function snowScore(tempF, code) {
  if (SNOW_CODES.has(code)) return -6
  if (FREEZING_RAIN_CODES.has(code)) return 2
  if (!Number.isFinite(tempF)) return null
  return tempF - 32
}

const wrapLng = (lng) => ((((lng + 180) % 360) + 360) % 360) - 180

// The last field fetched, shared across mounts: the web Radar tab is rebuilt on
// every visit, and a field that still covers the view needn't be asked for again.
let lastField = null

// Whether `field` is still good for this view: fresh, covering it, and not so
// much wider than it that its points have become too sparse to place a line.
function fieldFits(field, b) {
  if (!field || Date.now() - field.at > PHASE_MAX_AGE) return false
  if (b.getSouth() < field.s || b.getNorth() > field.n || b.getWest() < field.w || b.getEast() > field.e) return false
  return (b.getNorth() - b.getSouth()) > (field.n - field.s) / 4
}

async function fetchPhaseField(b) {
  const latPad = (b.getNorth() - b.getSouth()) * PHASE_PAD
  const lngPad = (b.getEast() - b.getWest()) * PHASE_PAD
  const s = Math.max(-85, b.getSouth() - latPad)
  const n = Math.min(85, b.getNorth() + latPad)
  const w = b.getWest() - lngPad
  const e = b.getEast() + lngPad
  const lats = [], lngs = []
  for (let r = 0; r < PHASE_ROWS; r++) {
    for (let c = 0; c < PHASE_COLS; c++) {
      lats.push((s + ((n - s) * r) / (PHASE_ROWS - 1)).toFixed(3))
      lngs.push(wrapLng(w + ((e - w) * c) / (PHASE_COLS - 1)).toFixed(3))
    }
  }
  const q = `latitude=${lats.join(',')}&longitude=${lngs.join(',')}` +
    '&current=temperature_2m,weather_code&temperature_unit=fahrenheit'
  const data = await fetch(`${PHASE_URL}?${q}`).then(r => r.ok ? r.json() : Promise.reject(r.status))
  const list = Array.isArray(data) ? data : [data]
  if (list.length !== lats.length) throw new Error('phase grid: short response')
  const val = new Float32Array(list.length)
  for (let i = 0; i < list.length; i++) {
    const cur = list[i]?.current
    val[i] = snowScore(cur?.temperature_2m, cur?.weather_code) ?? NaN
  }
  return { s, n, w, e, val, at: Date.now() }
}

// Bilinear blend of the field at a point. A missing point (the API had nothing
// there) is skipped and the rest re-weighted; all four missing gives NaN.
function scoreAt(field, lat, lng) {
  const fx = Math.max(0, Math.min(PHASE_COLS - 1, ((lng - field.w) / (field.e - field.w)) * (PHASE_COLS - 1)))
  const fy = Math.max(0, Math.min(PHASE_ROWS - 1, ((lat - field.s) / (field.n - field.s)) * (PHASE_ROWS - 1)))
  const x0 = Math.min(PHASE_COLS - 2, fx | 0), y0 = Math.min(PHASE_ROWS - 2, fy | 0)
  const tx = fx - x0, ty = fy - y0
  let sum = 0, wsum = 0
  for (const [dx, dy, wgt] of [[0, 0, (1 - tx) * (1 - ty)], [1, 0, tx * (1 - ty)], [0, 1, (1 - tx) * ty], [1, 1, tx * ty]]) {
    const v = field.val[(y0 + dy) * PHASE_COLS + x0 + dx]
    if (Number.isNaN(v)) continue
    sum += v * wgt; wsum += wgt
  }
  return wsum > 0 ? sum / wsum : NaN
}

// Snow: slower, drifting, and drawn as flakes. Fall speed is in px per frame;
// flakes sway sideways on a slow sine of their own.
const SNOW_SPEED = [1.2, 3.0]
const SNOW_RADIUS = [1.1, 2.4]

// `snow` is the fallback: the user's own location's verdict, used across the
// whole map until the grid arrives, and wherever it can't be fetched at all.
// `palette` is the legend's colours, light to heavy, for the tiles on screen.
export function RadarRain({ map, getLayer, snow = false, palette = null }) {
  const ref = useRef(null)
  const fallback = useRef(snow)
  const paletteRef = useRef(palette)
  useEffect(() => {
    fallback.current = snow
    paletteRef.current = palette
  })

  useEffect(() => {
    const canvas = ref.current
    if (!canvas || !map) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const ctx = canvas.getContext('2d')
    const maskCanvas = document.createElement('canvas')
    const mctx = maskCanvas.getContext('2d', { willReadFrequently: true })

    let W = 0, H = 0, dpr = 1
    let mask = null, phase = null, mw = 0, mh = 0
    // The map's pan offset when the mask was built, and right now. Their
    // difference is how far the map has slid since, so drops and mask lookups
    // follow a drag instead of lagging it by up to MASK_MS.
    let maskOrigin = null
    let lastOrigin = null
    let lastZoom = map.getZoom()
    let tainted = false
    let drops = []
    let raf, timer, fieldTimer, refreshTimer
    let field = null, fetching = false, alive = true
    let ramp = null, rampFor = null

    const rand = (a, b) => a + Math.random() * (b - a)
    const seed = (d, anywhere) => {
      d.x = rand(-20, W + 20)
      d.y = anywhere ? rand(0, H) : rand(-40, -10)
      // Every drop carries both looks; which one it wears is decided per frame
      // by where it is, so one crossing the rain/snow line changes as it goes.
      d.rspd = rand(15, 21)
      d.sspd = rand(SNOW_SPEED[0], SNOW_SPEED[1])
      d.len = rand(12, 22)
      d.r = rand(SNOW_RADIUS[0], SNOW_RADIUS[1])
      d.phase = rand(0, Math.PI * 2)
      d.sway = rand(0.01, 0.03)
      // The drop's place in line: a cell at strength I shows the drops whose
      // gate is under density(I), so heavier rain is denser rain.
      d.gate = Math.random()
    }

    const resize = () => {
      const box = canvas.getBoundingClientRect()
      W = Math.max(1, Math.round(box.width))
      H = Math.max(1, Math.round(box.height))
      dpr = Math.min(2, window.devicePixelRatio || 1)
      canvas.width = Math.round(W * dpr)
      canvas.height = Math.round(H * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      mw = Math.ceil(W / MASK_PX)
      mh = Math.ceil(H / MASK_PX)
      maskCanvas.width = mw
      maskCanvas.height = mh
      const n = Math.min(MAX_DROPS, Math.round((W * H) / AREA_PER_DROP))
      while (drops.length < n) { const d = {}; seed(d, true); drops.push(d) }
      drops.length = n
    }

    const panOrigin = () => map.containerPointToLayerPoint([0, 0])

    // Fetch a new conditions grid if the current one no longer fits the view.
    const ensureField = async () => {
      const b = map.getBounds()
      if (fieldFits(field, b)) return
      if (fieldFits(lastField, b)) { field = lastField; return }
      if (fetching) return
      fetching = true
      try {
        const next = await fetchPhaseField(b)
        if (!alive) return
        field = lastField = next
      } catch {
        // Keep whatever we had; the fallback covers the gap. Retried on the
        // next move or refresh.
      } finally {
        fetching = false
      }
    }
    const onMoveEnd = () => {
      clearTimeout(fieldTimer)
      fieldTimer = setTimeout(ensureField, 500)
    }

    const buildMask = () => {
      if (tainted) return
      const layer = getLayer()
      const tiles = layer?._tiles
      mctx.clearRect(0, 0, mw, mh)
      if (tiles && layer.options.opacity > 0) {
        const base = canvas.getBoundingClientRect()
        for (const key in tiles) {
          const el = tiles[key].el
          if (!el?.complete || !el.naturalWidth) continue
          const r = el.getBoundingClientRect()
          if (r.right < base.left || r.left > base.right || r.bottom < base.top || r.top > base.bottom) continue
          mctx.drawImage(
            el,
            (r.left - base.left) / MASK_PX, (r.top - base.top) / MASK_PX,
            r.width / MASK_PX, r.height / MASK_PX,
          )
        }
      }
      let px
      try {
        px = mctx.getImageData(0, 0, mw, mh).data
      } catch {
        tainted = true // cross-origin tiles without CORS: nothing we can read
        mask = null
        return
      }
      // Rebuilt only when the legend changes (the feed switching ramps).
      if (paletteRef.current !== rampFor) {
        rampFor = paletteRef.current
        ramp = legendRamp(rampFor)
      }
      const read = ramp ?? intensity
      const next = new Float32Array(mw * mh)
      for (let i = 0, j = 0; i < next.length; i++, j += 4) {
        next[i] = read(px[j], px[j + 1], px[j + 2], px[j + 3])
      }

      // Rain or snow for each cell, on the same grid. The map is unrotated Web
      // Mercator, so a column shares one longitude and a row one latitude: that
      // is mw + mh projections rather than one per cell.
      const kind = new Uint8Array(mw * mh) // 1 = snow
      const fb = fallback.current ? 1 : 0
      if (field) {
        const lngs = new Float64Array(mw), lats = new Float64Array(mh)
        for (let x = 0; x < mw; x++) lngs[x] = map.containerPointToLatLng([(x + 0.5) * MASK_PX, 0]).lng
        for (let y = 0; y < mh; y++) lats[y] = map.containerPointToLatLng([0, (y + 0.5) * MASK_PX]).lat
        for (let y = 0; y < mh; y++) {
          for (let x = 0; x < mw; x++) {
            const i = y * mw + x
            if (next[i] <= 0) continue // no echo, nothing to decide
            const sc = scoreAt(field, lats[y], lngs[x])
            kind[i] = Number.isNaN(sc) ? fb : sc <= 0 ? 1 : 0
          }
        }
      } else if (fb) {
        kind.fill(1)
      }

      mask = next
      phase = kind
      maskOrigin = panOrigin()
    }

    const rainBuckets = Array.from({ length: LEVELS }, () => [])
    const snowBuckets = Array.from({ length: LEVELS }, () => [])
    // Per strength step: light is faint and fine, heavy bright and thick.
    const rainStyles = rainBuckets.map((_, i) =>
      `rgba(205, 225, 255, ${(0.16 + (0.7 * (i + 1)) / LEVELS).toFixed(3)})`)
    const rainWidths = rainBuckets.map((_, i) => 0.8 + (1.0 * i) / (LEVELS - 1))
    const snowStyles = snowBuckets.map((_, i) =>
      `rgba(255, 255, 255, ${(0.35 + (0.6 * (i + 1)) / LEVELS).toFixed(3)})`)

    const draw = () => {
      raf = requestAnimationFrame(draw)
      ctx.clearRect(0, 0, W, H)

      // Follow the map while it is dragged. A zoom resets Leaflet's layer
      // coordinates, so across one the drops just stay where they are and the
      // next mask catches up.
      const zoom = map.getZoom()
      const o = panOrigin()
      if (lastOrigin && zoom === lastZoom) {
        const dx = lastOrigin.x - o.x, dy = lastOrigin.y - o.y
        if (dx || dy) for (const d of drops) { d.x += dx; d.y += dy }
      }
      if (zoom !== lastZoom) maskOrigin = null
      lastOrigin = o
      lastZoom = zoom
      if (!mask || !maskOrigin) return

      const offX = o.x - maskOrigin.x, offY = o.y - maskOrigin.y
      for (const b of rainBuckets) b.length = 0
      for (const b of snowBuckets) b.length = 0
      const fb = fallback.current

      for (const d of drops) {
        const cx = ((d.x + offX) / MASK_PX) | 0
        const cy = ((d.y + offY) / MASK_PX) | 0
        const inside = cx >= 0 && cy >= 0 && cx < mw && cy < mh
        const i = inside ? cy * mw + cx : -1
        const isSnow = inside ? phase[i] === 1 : fb
        // Strength where the drop is, which sets how fast it falls as well as
        // how it looks: drizzle drifts down, a downpour comes down hard.
        const I = inside ? mask[i] : 0
        if (isSnow) {
          d.y += d.sspd * (0.6 + 1.0 * I)
          d.phase += d.sway
          d.x += Math.sin(d.phase) * (0.6 - 0.3 * I) // heavy snow sways less
        } else {
          d.y += d.rspd * (0.5 + 1.0 * I) // ~9 px/frame in drizzle, ~27 in a downpour
        }
        if (d.y - d.len > H || d.x < -40 || d.x > W + 40 || d.y < -60) { seed(d, false); continue }
        if (!inside) continue
        if (I <= 0 || d.gate > density(I)) continue
        const lvl = Math.min(LEVELS - 1, (I * LEVELS) | 0)
        if (isSnow) {
          d.drawR = d.r * (0.55 + 0.9 * I) // light snow fine, heavy snow big flakes
          snowBuckets[lvl].push(d)
        } else {
          d.drawLen = d.len * (0.45 + 1.6 * I) // streak length tracks the speed: short ticks in drizzle, long streaks in a downpour
          rainBuckets[lvl].push(d)
        }
      }

      ctx.lineCap = 'round'
      for (let i = 0; i < LEVELS; i++) {
        const b = rainBuckets[i]
        if (!b.length) continue
        ctx.lineWidth = rainWidths[i]
        ctx.beginPath()
        for (const d of b) {
          ctx.moveTo(d.x, d.y)
          ctx.lineTo(d.x, d.y - d.drawLen)
        }
        ctx.strokeStyle = rainStyles[i]
        ctx.stroke()
      }
      for (let i = 0; i < LEVELS; i++) {
        const b = snowBuckets[i]
        if (!b.length) continue
        ctx.beginPath()
        for (const d of b) {
          // moveTo first, or the path joins each flake to the previous one.
          ctx.moveTo(d.x + d.drawR, d.y)
          ctx.arc(d.x, d.y, d.drawR, 0, Math.PI * 2)
        }
        ctx.fillStyle = snowStyles[i]
        ctx.fill()
      }
    }

    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    map.on('moveend', onMoveEnd)
    ensureField()
    refreshTimer = setInterval(ensureField, PHASE_MAX_AGE / 2)
    buildMask()
    timer = setInterval(buildMask, MASK_MS)
    raf = requestAnimationFrame(draw)
    return () => {
      alive = false
      cancelAnimationFrame(raf)
      clearInterval(timer)
      clearInterval(refreshTimer)
      clearTimeout(fieldTimer)
      map.off('moveend', onMoveEnd)
      ro.disconnect()
    }
  }, [map, getLayer])

  return <canvas ref={ref} className="radar-rain" aria-hidden="true" />
}
