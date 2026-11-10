import { useEffect, useRef } from 'react'
import { assertOpenMeteoQuota, noteOpenMeteo429 } from '../utils/openMeteoQuota'

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
// of where precipitation is. The tiles are fetched with crossOrigin (every feed
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
// Denser than the visible field needs: light echoes show only a share of the
// drops (see density), so heavy cells have the spare drops to fill in.
const AREA_PER_DROP = 420
const MAX_DROPS = 4200
// Alpha steps, so a frame is a handful of stroke() calls. Fine enough that a
// drop fading in or out (see FADE_IN) steps through them without visible jumps.
const LEVELS = 10

// Rain falls at a slight slant, as if under a light breeze, rather than in
// ruler-straight verticals: dx per px of fall, shared by every drop so the
// field reads as one sheet of rain.
const RAIN_SLANT = 0
// A streak is drawn as head-to-tail segments at falling brightness, so it
// tapers to nothing instead of ending in a hard edge. Fractions of its length
// and the share of the head's alpha each one gets.
const STREAK_SEGMENTS = [[0, 0.3, 1], [0.3, 0.62, 0.5], [0.62, 1, 0.18]]
// How quickly a drop fades in as it enters an echo and out as it leaves one,
// per 74 Hz frame — a short ease instead of popping on and off at the radar's
// blocky edges and on every mask rebuild.
const FADE_IN = 0.14
const FADE_OUT = 0.2

// Every echo is drawn at this one strength, whatever colour the radar paints
// it: the effect only marks where something is falling, not how hard. 0 to 1,
// on the scale density() and the draw loop below read.
const RAIN_STRENGTH = 0.5
const ECHO_MIN_ALPHA = 24 // tile pixels fainter than this are blank map

// How much of the field shows at a strength: a drizzle is a scatter, a
// downpour every drop there is. With twice the old drop count, light rain lands
// about where it always did and heavy rain fills in around it.
const density = (I) => 0.12 + 0.88 * Math.pow(I, 1.2)

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
// Open-Meteo bills a multi-location request one call per point, so the grid is
// kept small: 12 points, refreshed every half hour, and asked for only while
// the radar actually shows something falling (see ensureField). It used to be
// 48 points every five minutes, which on its own could use up the free tier's
// daily allowance. A rain/snow line moves slowly, and the blend between points
// still places it smoothly.
const PHASE_COLS = 4
const PHASE_ROWS = 3
const PHASE_PAD = 0.5              // fetch this much beyond each edge of the view, so a pan rarely leaves it
const PHASE_MAX_AGE = 30 * 60 * 1000
const PHASE_RETRY_MS = 2 * 60 * 1000 // after a failed fetch, wait this long before the next
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
  assertOpenMeteoQuota()
  const res = await fetch(`${PHASE_URL}?${q}`)
  if (res.status === 429) await noteOpenMeteo429(res)
  if (!res.ok) throw new Error(`phase grid: ${res.status}`)
  const data = await res.json()
  const list = Array.isArray(data) ? data : [data]
  if (list.length !== lats.length) throw new Error('phase grid: short response')
  const val = new Float32Array(list.length)
  const temp = new Float32Array(list.length)
  for (let i = 0; i < list.length; i++) {
    const cur = list[i]?.current
    val[i] = snowScore(cur?.temperature_2m, cur?.weather_code) ?? NaN
    temp[i] = Number.isFinite(cur?.temperature_2m) ? cur.temperature_2m : NaN
  }
  return { s, n, w, e, val, temp, at: Date.now() }
}

// Bilinear blend of the field at a point. A missing point (the API had nothing
// there) is skipped and the rest re-weighted; all four missing gives NaN.
function blendAt(field, grid, lat, lng) {
  const fx = Math.max(0, Math.min(PHASE_COLS - 1, ((lng - field.w) / (field.e - field.w)) * (PHASE_COLS - 1)))
  const fy = Math.max(0, Math.min(PHASE_ROWS - 1, ((lat - field.s) / (field.n - field.s)) * (PHASE_ROWS - 1)))
  const x0 = Math.min(PHASE_COLS - 2, fx | 0), y0 = Math.min(PHASE_ROWS - 2, fy | 0)
  const tx = fx - x0, ty = fy - y0
  let sum = 0, wsum = 0
  for (const [dx, dy, wgt] of [[0, 0, (1 - tx) * (1 - ty)], [1, 0, tx * (1 - ty)], [0, 1, (1 - tx) * ty], [1, 1, tx * ty]]) {
    const v = grid[(y0 + dy) * PHASE_COLS + x0 + dx]
    if (Number.isNaN(v)) continue
    sum += v * wgt; wsum += wgt
  }
  return wsum > 0 ? sum / wsum : NaN
}
const scoreAt = (field, lat, lng) => blendAt(field, field.val, lat, lng)
const tempAt = (field, lat, lng) => (field.temp ? blendAt(field, field.temp, lat, lng) : NaN)

// How wet the snow is, 0 to 1, from the surface temperature. Near freezing it
// falls as big, wet clumps that come down fairly quickly; well below it, as
// fine dry powder that drifts. Unknown temperature reads as ordinary snow.
const POWDER_F = 15
const WET_F = 32
function snowWetness(tempF) {
  if (!Number.isFinite(tempF)) return 0.5
  return Math.max(0, Math.min(1, (tempF - POWDER_F) / (WET_F - POWDER_F)))
}

// Speeds below are px per frame on the 74 Hz screen they were tuned on. Each
// frame moves by the time it actually took, so a 60, 120 or 144 Hz screen shows
// the same fall speed instead of one scaled by its refresh rate. Capped so the
// first frame after the tab was hidden doesn't teleport every drop.
const FRAME_MS = 1000 / 74
const MAX_STEP = 3

// Snow: slower, drifting, and drawn as flakes. Fall speed is in px per frame;
// flakes sway sideways on a slow sine of their own.
const SNOW_SPEED = [0.8, 2.2]
const SNOW_RADIUS = [1.1, 2.4]

// `snow` is the fallback: the user's own location's verdict, used across the
// whole map until the grid arrives, and wherever it can't be fetched at all.
export function RadarRain({ map, getLayer, snow = false }) {
  const ref = useRef(null)
  const fallback = useRef(snow)
  // Synced after render: writing a ref during render is unsafe under React's
  // concurrent rendering.
  useEffect(() => {
    fallback.current = snow
  })

  useEffect(() => {
    const canvas = ref.current
    if (!canvas || !map) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const ctx = canvas.getContext('2d')
    const maskCanvas = document.createElement('canvas')
    const mctx = maskCanvas.getContext('2d', { willReadFrequently: true })

    let W = 0, H = 0, dpr = 1
    let mask = null, phase = null, wet = null, mw = 0, mh = 0
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
    let hasEcho = false, failedAt = 0

    const rand = (a, b) => a + Math.random() * (b - a)
    const seed = (d, anywhere) => {
      // Starting further left by the slant's drift over the screen's height,
      // so the left edge isn't left thin as the rain slides right.
      d.x = rand(-20 - H * RAIN_SLANT, W + 20)
      d.y = anywhere ? rand(0, H) : rand(-40, -10)
      // Every drop carries both looks; which one it wears is decided per frame
      // by where it is, so one crossing the rain/snow line changes as it goes.
      // Depth, 0 far to 1 near: nearer drops fall faster, streak longer and
      // show brighter and thicker, so the field has parallax instead of every
      // streak being the same line.
      d.z = Math.pow(Math.random(), 1.4) // most drops sit back, a few up close
      d.rspd = 6.5 + 7 * d.z + rand(-0.6, 0.6)
      d.sspd = rand(SNOW_SPEED[0], SNOW_SPEED[1]) * (0.7 + 0.6 * d.z)
      d.len = 8 + 16 * d.z + rand(-1.5, 1.5)
      d.r = rand(SNOW_RADIUS[0], SNOW_RADIUS[1]) * (0.75 + 0.5 * d.z)
      d.vis = 0 // current fade, eased toward 1 inside an echo and 0 outside
      d.phase = rand(0, Math.PI * 2)
      d.sway = rand(0.01, 0.03)
      // The drop's place in line: a cell at intensity I shows the drops whose
      // gate is under sqrt(I), so heavier rain is denser rain.
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
    // Only while something is falling on screen: with no echo there is nothing
    // to call rain or snow, and the request would be spent for nothing.
    const ensureField = async () => {
      if (!hasEcho) return
      const b = map.getBounds()
      if (fieldFits(field, b)) return
      if (fieldFits(lastField, b)) { field = lastField; return }
      if (fetching || Date.now() - failedAt < PHASE_RETRY_MS) return
      fetching = true
      try {
        const next = await fetchPhaseField(b)
        if (!alive) return
        field = lastField = next
      } catch {
        // Keep whatever we had; the fallback covers the gap. Retried on the
        // next move or refresh, once PHASE_RETRY_MS has passed.
        failedAt = Date.now()
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
      const next = new Float32Array(mw * mh)
      let echo = false
      for (let i = 0, j = 3; i < next.length; i++, j += 4) {
        if (px[j] >= ECHO_MIN_ALPHA) { next[i] = RAIN_STRENGTH; echo = true }
      }
      hasEcho = echo
      // Precipitation has just come on screen with no grid to place it by:
      // fetch one now rather than waiting for the next move or refresh.
      if (echo && !field) ensureField()

      // Rain or snow for each cell, on the same grid. The map is unrotated Web
      // Mercator, so a column shares one longitude and a row one latitude: that
      // is mw + mh projections rather than one per cell.
      const kind = new Uint8Array(mw * mh) // 1 = snow
      const wetness = new Float32Array(mw * mh).fill(0.5) // snow only: see snowWetness
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
            if (kind[i]) wetness[i] = snowWetness(tempAt(field, lats[y], lngs[x]))
          }
        }
      } else if (fb) {
        kind.fill(1)
      }

      mask = next
      phase = kind
      wet = wetness
      maskOrigin = panOrigin()
    }

    // Buckets by drawn alpha. Rain buckets hold flat segment coordinates
    // (x1, y1, x2, y2, ...), since one streak spans several of them.
    const rainBuckets = Array.from({ length: LEVELS }, () => [])
    const snowBuckets = Array.from({ length: LEVELS }, () => [])
    const MAX_RAIN_ALPHA = 0.72
    const MAX_SNOW_ALPHA = 0.9
    const rainStyles = rainBuckets.map((_, i) =>
      `rgba(214, 230, 255, ${((MAX_RAIN_ALPHA * (i + 1)) / LEVELS).toFixed(3)})`)
    // Fainter segments are thinner too: the far drops and the tails of the
    // near ones, which is what gives a streak its taper.
    const rainWidths = rainBuckets.map((_, i) => 0.6 + (1.0 * i) / (LEVELS - 1))
    const snowStyles = snowBuckets.map((_, i) =>
      `rgba(255, 255, 255, ${((MAX_SNOW_ALPHA * (i + 1)) / LEVELS).toFixed(3)})`)
    const snowGlows = snowBuckets.map((_, i) =>
      `rgba(255, 255, 255, ${((0.16 * (i + 1)) / LEVELS).toFixed(3)})`)
    const bucketOf = (a) => Math.min(LEVELS - 1, Math.round(a * LEVELS) - 1)
    const slantLen = Math.hypot(1, RAIN_SLANT)
    const ux = RAIN_SLANT / slantLen, uy = 1 / slantLen // fall direction

    // Only while the map is on screen and the app is in front. On the phone the
    // radar is one card in the stack, often scrolled well out of view, and it
    // used to go on rebuilding the mask (a read-back of every tile) every
    // MASK_MS and animating every frame regardless. Off screen, the loop stops
    // and the timers skip their work; coming back rebuilds the mask at once.
    let onScreen = true
    const active = () => onScreen && !document.hidden

    let lastFrame = 0
    const draw = (now) => {
      if (!active()) { raf = 0; return }
      raf = requestAnimationFrame(draw)
      const step = lastFrame ? Math.min(MAX_STEP, (now - lastFrame) / FRAME_MS) : 1
      lastFrame = now
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
        // Strength where the drop is. It sets density, size and brightness in
        // full, but speed only gently: about 0.9x the old speed in drizzle and
        // 1.25x in a downpour, so heavy rain reads as harder without racing.
        const I = inside ? mask[i] : 0
        // Snow wetness where it is (0 powder, 1 wet near freezing).
        const w = inside ? wet[i] : 0.5
        if (isSnow) {
          d.y += d.sspd * (0.75 + 0.3 * I) * (0.8 + 0.5 * w) * step  // wet clumps fall faster
          d.phase += d.sway * step
          d.x += Math.sin(d.phase) * (0.75 - 0.4 * w) * (1 - 0.3 * I) * step // powder drifts most
        } else {
          const dy = d.rspd * (0.85 + 0.4 * I) * step
          d.y += dy
          d.x += dy * RAIN_SLANT
        }
        if (d.y - d.len > H || d.x < -40 - H * RAIN_SLANT || d.x > W + 40 || d.y < -60) { seed(d, false); continue }

        // Ease toward shown or hidden rather than switching, so drops fade in
        // and out at the edge of an echo instead of popping.
        const show = inside && I > 0 && d.gate <= density(I)
        d.vis += ((show ? 1 : 0) - d.vis) * (1 - Math.pow(1 - (show ? FADE_IN : FADE_OUT), step))
        if (d.vis < 0.02) continue

        // Near drops bright, far ones faint; heavier echoes a little brighter.
        const a = d.vis * (0.28 + 0.72 * d.z) * (0.75 + 0.5 * I)
        if (isSnow) {
          const lvl = bucketOf(a)
          if (lvl < 0) continue
          // Heavier snow, bigger flakes; wet snow clumps, powder is fine.
          d.drawR = d.r * (0.6 + 0.7 * I) * (0.7 + 0.6 * w)
          snowBuckets[lvl].push(d)
        } else {
          const len = d.len * (0.5 + 1.0 * I) // short ticks in drizzle, long streaks in a downpour
          for (const [from, to, share] of STREAK_SEGMENTS) {
            const lvl = bucketOf(a * share)
            if (lvl < 0) continue
            rainBuckets[lvl].push(
              d.x - ux * len * from, d.y - uy * len * from,
              d.x - ux * len * to, d.y - uy * len * to,
            )
          }
        }
      }

      // Butt caps: round ones overlap where a streak's segments meet and
      // leave brighter beads along it.
      ctx.lineCap = 'butt'
      for (let i = 0; i < LEVELS; i++) {
        const b = rainBuckets[i]
        if (!b.length) continue
        ctx.lineWidth = rainWidths[i]
        ctx.beginPath()
        for (let k = 0; k < b.length; k += 4) {
          ctx.moveTo(b[k], b[k + 1])
          ctx.lineTo(b[k + 2], b[k + 3])
        }
        ctx.strokeStyle = rainStyles[i]
        ctx.stroke()
      }
      // Flakes get a faint halo under a solid core, so they read as soft
      // snow rather than hard dots.
      for (let i = 0; i < LEVELS; i++) {
        const b = snowBuckets[i]
        if (!b.length) continue
        ctx.beginPath()
        for (const d of b) {
          const g = d.drawR * 2.2
          // moveTo first, or the path joins each flake to the previous one.
          ctx.moveTo(d.x + g, d.y)
          ctx.arc(d.x, d.y, g, 0, Math.PI * 2)
        }
        ctx.fillStyle = snowGlows[i]
        ctx.fill()
        ctx.beginPath()
        for (const d of b) {
          ctx.moveTo(d.x + d.drawR, d.y)
          ctx.arc(d.x, d.y, d.drawR, 0, Math.PI * 2)
        }
        ctx.fillStyle = snowStyles[i]
        ctx.fill()
      }
    }

    // Restarts the loop after a pause, from a fresh mask and without a catch-up
    // step for the time it was stopped.
    const wake = () => {
      if (!alive || !active() || raf) return
      lastFrame = 0
      buildMask()
      raf = requestAnimationFrame(draw)
    }
    const io = new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting
      wake()
    })
    io.observe(canvas)
    document.addEventListener('visibilitychange', wake)

    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    map.on('moveend', onMoveEnd)
    ensureField()
    refreshTimer = setInterval(() => { if (active()) ensureField() }, PHASE_MAX_AGE)
    buildMask()
    timer = setInterval(() => { if (active()) buildMask() }, MASK_MS)
    raf = requestAnimationFrame(draw)
    return () => {
      alive = false
      cancelAnimationFrame(raf)
      clearInterval(timer)
      clearInterval(refreshTimer)
      clearTimeout(fieldTimer)
      map.off('moveend', onMoveEnd)
      ro.disconnect()
      io.disconnect()
      document.removeEventListener('visibilitychange', wake)
    }
  }, [map, getLayer])

  return <canvas ref={ref} className="radar-rain" aria-hidden="true" />
}
