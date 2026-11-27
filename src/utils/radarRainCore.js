// The rain and snow drawn over the radar map (RadarRain), with no DOM in it, so
// it runs the same in the overlay's worker (radarRainWorker.js) and, where a
// worker can't draw, on the page. What it is and why are in RadarRain.jsx; this
// is the two halves of the work:
//
//   classifyMask  a small read-back of the radar tiles, lined up with the map,
//                 turned into a grid of how hard it is falling and whether as
//                 rain or snow.
//   createRain    the drops: one particle field over the map, stepped and drawn
//                 each frame against that grid.
import { colorDbz } from './hrrrCore'

// One mask cell per this many CSS pixels. Radar data is ~1 km and smoothed, so a
// coarse grid loses nothing visible and keeps the read-back tiny.
export const MASK_PX = 6
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
// per 74 Hz frame: a short ease instead of popping on and off at the radar's
// blocky edges and on every mask rebuild.
const FADE_IN = 0.14
const FADE_OUT = 0.2

const ECHO_MIN_ALPHA = 24 // tile pixels fainter than this are blank map

// How hard it is falling, 0 to 1, from the echo's reflectivity (read off its
// colour, see colorDbz). Haze and the faintest drizzle (10 dBZ and under) sit
// at the floor, light rain (20) about a quarter, moderate (30) a little under
// half, heavy (50) most of the way. Capped short of 1 so the strongest cores
// stay rain rather than a white sheet.
const strengthOf = (dbz) => Math.max(0.02, Math.min(0.95, (dbz - 8) / 50))

// How much of the field shows at a strength: a drizzle is a sparse scatter, a
// downpour nearly every drop there is.
const density = (I) => 0.05 + 0.95 * Math.pow(I, 1.2)

// The conditions grid's shape (see fetchPhaseField in RadarRain).
export const PHASE_COLS = 4
export const PHASE_ROWS = 3

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

// The mask from a read-back of the tiles (`px`, RGBA, mw x mh cells). `ramp`
// is the tiles' colour ramp ('rv' or NWS-style). `place`, when the conditions
// grid is in, is { field, lats, lngs }: the grid and each mask row's latitude
// and column's longitude. `fb` is the fallback verdict (snow, or not) for
// anywhere the grid can't say.
export function classifyMask(px, mw, mh, ramp, place, fb) {
  const mask = new Float32Array(mw * mh)
  let echo = false
  for (let i = 0, j = 0; i < mask.length; i++, j += 4) {
    if (px[j + 3] < ECHO_MIN_ALPHA) continue
    mask[i] = strengthOf(colorDbz(px[j], px[j + 1], px[j + 2], ramp))
    echo = true
  }
  // Rain or snow for each cell, on the same grid. The map is unrotated Web
  // Mercator, so a column shares one longitude and a row one latitude: the
  // caller projects mw + mh points rather than one per cell.
  const kind = new Uint8Array(mw * mh) // 1 = snow
  const wet = new Float32Array(mw * mh).fill(0.5) // snow only: see snowWetness
  if (place?.field) {
    const { field, lats, lngs } = place
    for (let y = 0; y < mh; y++) {
      for (let x = 0; x < mw; x++) {
        const i = y * mw + x
        if (mask[i] <= 0) continue // no echo, nothing to decide
        const sc = scoreAt(field, lats[y], lngs[x])
        kind[i] = Number.isNaN(sc) ? (fb ? 1 : 0) : sc <= 0 ? 1 : 0
        if (kind[i]) wet[i] = snowWetness(tempAt(field, lats[y], lngs[x]))
      }
    }
  } else if (fb) {
    kind.fill(1)
  }
  return { mask, kind, wet, echo }
}

// Speeds below are px per frame on the 74 Hz screen they were tuned on. Each
// frame moves by the time it actually took, so a 60, 120 or 144 Hz screen shows
// the same fall speed instead of one scaled by its refresh rate. Capped so the
// first frame after a pause doesn't teleport every drop.
const FRAME_MS = 1000 / 74
const MAX_STEP = 3

// Snow: slower, drifting, and drawn as flakes. Fall speed is in px per frame;
// flakes sway sideways on a slow sine of their own.
const SNOW_SPEED = [0.8, 2.2]
const SNOW_RADIUS = [1.1, 2.4]

const MAX_RAIN_ALPHA = 0.72
const MAX_SNOW_ALPHA = 0.9
const rainStyles = Array.from({ length: LEVELS }, (_, i) =>
  `rgba(214, 230, 255, ${((MAX_RAIN_ALPHA * (i + 1)) / LEVELS).toFixed(3)})`)
// Fainter segments are thinner too: the far drops and the tails of the near
// ones, which is what gives a streak its taper.
const rainWidths = Array.from({ length: LEVELS }, (_, i) => 0.6 + (1.0 * i) / (LEVELS - 1))
const snowStyles = Array.from({ length: LEVELS }, (_, i) =>
  `rgba(255, 255, 255, ${((MAX_SNOW_ALPHA * (i + 1)) / LEVELS).toFixed(3)})`)
const snowGlows = Array.from({ length: LEVELS }, (_, i) =>
  `rgba(255, 255, 255, ${((0.16 * (i + 1)) / LEVELS).toFixed(3)})`)
const bucketOf = (a) => Math.min(LEVELS - 1, Math.round(a * LEVELS) - 1)
const slantLen = Math.hypot(1, RAIN_SLANT)
const ux = RAIN_SLANT / slantLen, uy = 1 / slantLen // fall direction

const rand = (a, b) => a + Math.random() * (b - a)

// The particle field, drawing into `ctx` (a 2D context, on a canvas or an
// OffscreenCanvas). The owner sizes it, hands it masks, and calls frame() once
// per display frame with the map's pan offset and zoom.
export function createRain(ctx) {
  let W = 0, H = 0
  let drops = []
  let mask = null, kind = null, wet = null, mw = 0, mh = 0
  // The map's pan offset when the mask was built, and the last one seen. Their
  // difference is how far the map has slid since, so drops and mask lookups
  // follow a drag instead of lagging it by a mask rebuild.
  let maskOrigin = null
  let lastOrigin = null
  let lastZoom = null
  let lastFrame = 0
  let fb = false

  const seed = (d, anywhere) => {
    // Starting further left by the slant's drift over the screen's height, so
    // the left edge isn't left thin as the rain slides right.
    d.x = rand(-20 - H * RAIN_SLANT, W + 20)
    d.y = anywhere ? rand(0, H) : rand(-40, -10)
    // Every drop carries both looks; which one it wears is decided per frame by
    // where it is, so one crossing the rain/snow line changes as it goes.
    // Depth, 0 far to 1 near: nearer drops fall faster, streak longer and show
    // brighter and thicker, so the field has parallax instead of every streak
    // being the same line.
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

  // Buckets by drawn alpha. Rain buckets hold flat segment coordinates
  // (x1, y1, x2, y2, ...), since one streak spans several of them.
  const rainBuckets = Array.from({ length: LEVELS }, () => [])
  const snowBuckets = Array.from({ length: LEVELS }, () => [])

  return {
    // The canvas's size in CSS px and its density. Sets the backing store,
    // which also clears it.
    resize(w, h, dpr) {
      W = Math.max(1, w)
      H = Math.max(1, h)
      ctx.canvas.width = Math.round(W * dpr)
      ctx.canvas.height = Math.round(H * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const n = Math.min(MAX_DROPS, Math.round((W * H) / AREA_PER_DROP))
      while (drops.length < n) { const d = {}; seed(d, true); drops.push(d) }
      drops.length = n
    },
    setFallback(v) { fb = !!v },
    // A fresh mask (see classifyMask), and the pan offset it was taken at.
    setMask(m, origin) {
      mask = m.mask; kind = m.kind; wet = m.wet; mw = m.mw; mh = m.mh
      maskOrigin = origin
    },
    clearMask() { mask = null },
    // After a pause: no catch-up step for the time it was stopped.
    reset() { lastFrame = 0 },
    frame(now, o, zoom) {
      const step = lastFrame ? Math.min(MAX_STEP, (now - lastFrame) / FRAME_MS) : 1
      lastFrame = now
      ctx.clearRect(0, 0, W, H)

      // Follow the map while it is dragged. A zoom resets Leaflet's layer
      // coordinates, so across one the drops just stay where they are and the
      // next mask catches up.
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

      for (const d of drops) {
        const cx = ((d.x + offX) / MASK_PX) | 0
        const cy = ((d.y + offY) / MASK_PX) | 0
        const inside = cx >= 0 && cy >= 0 && cx < mw && cy < mh
        const i = inside ? cy * mw + cx : -1
        const isSnow = inside ? kind[i] === 1 : fb
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

        // Near drops bright, far ones faint; light echoes faint, heavy ones bright.
        const a = d.vis * (0.28 + 0.72 * d.z) * (0.5 + 1.0 * I)
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

      // Butt caps: round ones overlap where a streak's segments meet and leave
      // brighter beads along it.
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
      // Flakes get a faint halo under a solid core, so they read as soft snow
      // rather than hard dots.
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
    },
  }
}
