import { MRMS_BASE, inMrmsDomain } from '../utils/mrms'
import { fetchWithin } from '../utils/fetchTimeout'

// loadForecast waits on this sample before showing the forecast, so each step
// gives up after this long and the verdict falls back to null (no override).
const RADAR_TIMEOUT_MS = 6000

// "Radar enhanced accuracy" — cross-checks the current condition against live
// radar: is anything actually echoing over this location right now, whatever the
// model-driven weather_code says, and how hard. Sampled by loadForecast with
// every reading and again every few minutes while the forecast is open (see
// applyRadar in useWeather); the setting decides whether it applies.
//
// sampleRadar takes the observation; radarVerdict makes the call from it:
// clear: null  = unknown (sampling failed, stale, a return too weak to call
//                either way, or a change not yet seen on two sweeps → no
//                override)
//        true  = radar shows no echo over the location (clear)
//        false = the location sits inside an echo (precip present), with its
//                strength in dBZ where the source gives one (MRMS)
//
// The two verdicts are deliberately not held to the same standard, because they
// are not equally risky. Clearing a precipitation code the model invented is safe
// on weak evidence, so *any* echo overhead is enough to withhold a "clear"
// verdict. Asserting precipitation is not — that verdict can put "Violent
// Showers" on the headline — so it takes a return strong enough to be reaching
// the ground.
//
// Source: NOAA's MRMS mosaic where it reaches, RainViewer everywhere else. This
// used to be RainViewer alone, sampled at zoom 7, and that is what put "Violent
// Showers" and a full-band nowcast on a sunny, dry Bel Air MD: its tile read nine
// solid pixels over the town while MRMS — same minute, same spot — had the cell
// already past and nothing overhead at all. A smoothed ~1 km composite spread
// thin over a 300 km tile is not a reading of what is falling on one town, and
// asserting rain from it overrides every check downstream of here.

const FRAMES_URL = 'https://api.rainviewer.com/public/weather-maps.json'
const SAMPLE_Z   = 7   // RainViewer's radar native max zoom — the finest detail served
const TILE_SIZE  = 256
const WINDOW     = 1   // sample a (2*WINDOW+1)^2 px box around the point for robustness
const SOLID_ALPHA = 200 // at/above this a pixel is inside an echo, not on its smoothed edge

// How old the newest sweep may be and still describe "now". Sweeps land every
// ~6 minutes; past this the mosaic is not reporting on the present sky and gets
// no vote either way.
const MRMS_MAX_AGE_MS = 15 * 60 * 1000

// lon/lat → fractional slippy-map tile coordinates at zoom z (Web Mercator).
function project(lat, lon, z) {
  const n = 2 ** z
  const latRad = (lat * Math.PI) / 180
  return {
    x: ((lon + 180) / 360) * n,
    y: ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  }
}

// ── MRMS reflectivity, out of the colour ──
//
// The ImageServer paints dBZ into a colour ramp before serving it and publishes
// no colormap, value band or legend (verified: /colormap, /rasterAttributeTable
// and /legend come back empty or as a bare "RGB composite"), so the dBZ has to
// come back out of the colour.
//
// The ramp below was calibrated on 2026-11-27 (03:00Z) against the Iowa
// Environmental Mesonet's N0Q composite, whose 8-bit palette index is the dBZ
// (dBZ = index * 0.5 - 32). Both mosaics were sampled on the same 0.02° grid
// across CONUS, ~430,000 echo pixels, and matched top-down by rank (the
// strongest MRMS colour against the strongest N0Q value, and so on down), which
// small misalignments between the two mosaics can't skew the way a
// pixel-by-pixel pairing does. Below 35 dBZ, where a straight pixel pairing is
// reliable, the two methods agree. That night had nothing stronger than ~62
// dBZ, so the red and magenta stops (60 and up) are the standard NWS
// reflectivity colours rather than measured ones.
//
// It runs grey-blue (weak returns, mostly aloft or not reaching the ground),
// dark blue, light blue, teal (~20 dBZ), bright green (~30), dark green (~40),
// olive, yellow (~50), orange (~55), red, magenta. The rendered image is
// interpolated between stops, so a pixel is placed by projecting it onto the
// nearest segment of this polyline in RGB, not by exact match.
//
// [dBZ, r, g, b]
export const MRMS_RAMP = [
  [0,  152, 168, 184],
  [1,  136, 136, 184],
  [3,  104, 120, 168],
  [7,   72, 104, 168],
  [14,  88, 136, 184],
  [18,  88, 168, 200],
  [20,  88, 184, 200],
  [22,  88, 200, 184],
  [24,  88, 216, 168],
  [27,  56, 216, 104],
  [30,  24, 216,  40],
  [32,   8, 200,  24],
  [36,   8, 152,  24],
  [40,   8, 120,   8],
  [43,   8,  88,   8],
  [45,  56, 120,   8],
  [46, 104, 152,   8],
  [47, 152, 168,   8],
  [48, 200, 200,   8],
  [50, 248, 232,   8],
  [55, 248, 184,   8],
  [60, 248,  56,   8],
  [65, 200,   8,   8],
  [70, 248,   8, 248],
]

// Past this far (RGB distance) from every segment, a colour is not one this
// ramp produces, and guessing a dBZ for it would be inventing one. Calibration
// pixels sat a median 4.5 and a 95th percentile 11.5 from the ramp.
const RAMP_MAX_DIST = 40

// The dBZ a rendered pixel stands for, given as the service's "R G B A" string.
// -Infinity for a transparent pixel (no echo at all), null for a value that
// isn't a pixel or a colour off the ramp, otherwise the dBZ.
export function mrmsDbz(rgba) {
  const [r, g, b, a] = String(rgba).split(/\s+/).map(Number)
  if (![r, g, b, a].every(Number.isFinite)) return null
  if (a === 0) return -Infinity
  let best = Infinity, dbz = null
  for (let i = 0; i < MRMS_RAMP.length - 1; i++) {
    const [d0, r0, g0, b0] = MRMS_RAMP[i]
    const [d1, r1, g1, b1] = MRMS_RAMP[i + 1]
    const sr = r1 - r0, sg = g1 - g0, sb = b1 - b0
    const len2 = sr * sr + sg * sg + sb * sb
    const u = Math.max(0, Math.min(1, ((r - r0) * sr + (g - g0) * sg + (b - b0) * sb) / len2))
    const dr = r - (r0 + u * sr), dg = g - (g0 + u * sg), db = b - (b0 + u * sb)
    const dist = Math.sqrt(dr * dr + dg * dg + db * db)
    if (dist < best) { best = dist; dbz = d0 + u * (d1 - d0) }
  }
  return best <= RAMP_MAX_DIST ? dbz : null
}

// ── Thresholds ──
// What counts as precipitation reaching the ground. 20 dBZ for rain is where
// the old colour rule drew the line (teal and up), about 0.6 mm/h. Snow returns
// far less power than rain for the same amount falling, so light snow sat
// mostly below that line and was never called; 15 dBZ takes in light snow
// without taking in the weakest returns, which are mostly aloft.
export const RAIN_DBZ = 20
export const SNOW_DBZ = 15
// A cell that wasn't there last sweep is believed on one sweep only when it is
// this strong: a real core, not an edge drifting over.
export const STRONG_DBZ = 35

// The point and four neighbours ~1.5 km north, south, east and west. One pixel
// on its own flips on any cell edge passing over; the neighbours say whether the
// point is inside an echo or on its rim.
const NEIGHBOUR_KM = 1.5
function samplePoints(lat, lon) {
  const dLat = NEIGHBOUR_KM / 111.32
  const dLon = NEIGHBOUR_KM / (111.32 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)))
  return [[lon, lat], [lon, lat + dLat], [lon, lat - dLat], [lon + dLon, lat], [lon - dLon, lat]]
}

// How far apart two sweeps may be and still count as consecutive. The mosaic
// lands every ~5 to 6 minutes.
const SWEEP_GAP_MAX_MS = 12 * 60 * 1000

// Groups a getSamples response into sweeps, newest first: { time, points },
// with points one dBZ per sample point (centre first, null where the service
// had no value). Only the newest and, if it is consecutive, the one before.
// Null when there is no live sweep. Exported for the tests.
export function mrmsSweeps(samples, pointCount, now = Date.now()) {
  if (!Array.isArray(samples) || !samples.length) return null
  // The service returns the sweeps unordered (verified: a 17-frame response
  // arrived with 19:54Z sitting between 20:34Z and 20:42Z).
  const byTime = new Map()
  for (const s of samples) {
    const t = s?.attributes?.idp_validtime
    const i = s?.locationId
    if (!Number.isFinite(t) || !Number.isInteger(i) || i < 0 || i >= pointCount) continue
    if (!byTime.has(t)) byTime.set(t, Array(pointCount).fill(null))
    byTime.get(t)[i] = mrmsDbz(s.value)
  }
  const times = [...byTime.keys()].sort((a, b) => b - a)
  if (!times.length) return null
  if (now - times[0] > MRMS_MAX_AGE_MS) return null  // no live sweep to speak for now
  const sweeps = [{ time: times[0], points: byTime.get(times[0]) }]
  if (times[1] != null && times[0] - times[1] <= SWEEP_GAP_MAX_MS) {
    sweeps.push({ time: times[1], points: byTime.get(times[1]) })
  }
  return sweeps
}

// One getSamples call returns every point for every sweep in the service's time
// window (~17 sweeps), each tagged with its time, so one request covers both
// the neighbourhood and the history.
async function sampleMrms(lat, lon) {
  const pts = samplePoints(lat, lon)
  const q = new URLSearchParams({
    geometry: JSON.stringify({ points: pts, spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryMultipoint',
    returnFirstValueOnly: 'false',
    outFields: 'idp_validtime',
    f: 'json',
  })
  const data = await fetchWithin(`${MRMS_BASE}/getSamples?${q}`, RADAR_TIMEOUT_MS).then(r => r.json())
  return mrmsSweeps(data?.samples, pts.length)
}

// One sweep's call over the point: { verdict, dbz }.
//   verdict true:  nothing over the point, and nothing reaching the ground
//                  next to it either.
//   verdict false: the point is inside an echo at or above `threshold`: the
//                  middle of the five readings is, so at least three are.
//   verdict null:  anything else (a weak echo, the rim of a cell, no data).
// dbz is the middle of the five readings, the strength over the point.
export function sweepVerdict(points, threshold) {
  const centre = points[0]
  if (centre == null) return { verdict: null, dbz: null }
  const known = points.filter(v => v != null)
  const sorted = [...known].sort((a, b) => a - b)
  const median = sorted.length >= 3 ? sorted[Math.floor(sorted.length / 2)] : centre
  const dbz = Number.isFinite(median) ? median : null
  const nearby = known.some(v => v >= threshold)
  if (centre === -Infinity && !nearby) return { verdict: true, dbz: null }
  if (centre !== -Infinity && dbz != null && dbz >= threshold) return { verdict: false, dbz }
  return { verdict: null, dbz }
}

// The radar's call over the point from an observation (sampleRadar's return),
// and whether precipitation there has just started or just stopped:
// { clear, dbz, trend }. `snowy` lowers the threshold (see SNOW_DBZ).
//
// The call has to hold for two sweeps in a row before it is made, so a cell
// edge crossing the point doesn't flip the headline every five minutes:
//   · both sweeps agree: that call.
//   · echo now, none last sweep: 'starting'; believed at once only from a
//     strong core (STRONG_DBZ), otherwise not called until the next sweep.
//   · none now, echo last sweep: 'ending'; not called until the next sweep.
// RainViewer has no dBZ and no history: its call stands as it is.
export function radarVerdict(obs, { snowy = false } = {}) {
  const none = { clear: null, dbz: null, trend: null }
  if (!obs) return none
  if (obs.source !== 'mrms') return { ...none, clear: obs.verdict ?? null }
  const threshold = snowy ? SNOW_DBZ : RAIN_DBZ
  const [newest, prev] = (obs.sweeps ?? []).map(s => sweepVerdict(s.points, threshold))
  if (!newest) return none
  const out = (clear, trend = null) => ({ clear, dbz: clear === false ? newest.dbz : null, trend })
  if (!prev || newest.verdict === prev.verdict) return out(newest.verdict)
  if (newest.verdict === false) {
    return out(newest.dbz >= STRONG_DBZ ? false : null, prev.verdict === true ? 'starting' : null)
  }
  if (prev.verdict === false) return out(null, 'ending')
  // Clear now after a weak or unknown sweep: nothing was falling either time.
  return out(newest.verdict)
}

// RainViewer fallback: sample the tile pixels over the location. Its radar tiles
// are transparent where there is no echo, so alpha is the signal. Used outside
// MRMS coverage and whenever MRMS doesn't answer.
async function sampleRainViewer(lat, lon, isCancelled) {
  const data = await (await fetchWithin(FRAMES_URL, RADAR_TIMEOUT_MS)).json()
  const past = data.radar?.past ?? []
  const frame = past[past.length - 1] // most recent observed frame
  if (!frame || !data.host) return null

  const { x, y } = project(lat, lon, SAMPLE_Z)
  const tileX = Math.floor(x)
  const tileY = Math.floor(y)
  const px = Math.floor((x - tileX) * TILE_SIZE)
  const py = Math.floor((y - tileY) * TILE_SIZE)

  // color 2 + smooth flag: same tile flavor the radar map draws.
  const url = `${data.host}${frame.path}/${TILE_SIZE}/${SAMPLE_Z}/${tileX}/${tileY}/2/1_0.png`
  const img = new Image()
  img.crossOrigin = 'anonymous'
  await new Promise((resolve, reject) => {
    // An <img> has no abort signal, so the same limit is a timer here.
    const timer = setTimeout(() => { img.src = ''; reject(new Error('Radar tile timed out')) }, RADAR_TIMEOUT_MS)
    img.onload = () => { clearTimeout(timer); resolve() }
    img.onerror = (e) => { clearTimeout(timer); reject(e) }
    img.src = url
  })
  if (isCancelled()) return null

  const canvas = document.createElement('canvas')
  canvas.width = TILE_SIZE
  canvas.height = TILE_SIZE
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0)

  // Clamp the sample box to the tile (a point near the edge just samples a
  // smaller box rather than reaching into the neighboring tile).
  const x0 = Math.max(0, px - WINDOW)
  const y0 = Math.max(0, py - WINDOW)
  const x1 = Math.min(TILE_SIZE - 1, px + WINDOW)
  const y1 = Math.min(TILE_SIZE - 1, py + WINDOW)
  const pixels = ctx.getImageData(x0, y0, x1 - x0 + 1, y1 - y0 + 1).data

  // Alpha here is effectively binary: 255 inside an echo, 0 outside, with a
  // thin interpolated ramp only across edge pixels (the `1_0` tile flavor is
  // smoothed). Verified against a live tile over an active storm: 77% of
  // pixels fully transparent, 19% at exactly 255, and a sparse 20–190 fringe
  // between them. So a near-max alpha means "inside the precipitation area",
  // not "heavy precipitation".
  let total = 0, any = 0, solid = 0
  for (let i = 3; i < pixels.length; i += 4) {
    total++
    if (pixels[i] > 0) any++
    if (pixels[i] >= SOLID_ALPHA) solid++
  }

  if (any === 0) return true                  // nothing at all overhead
  if (solid * 2 > total) return false          // solidly inside an echo
  return null                                  // clipping an edge — can't call it
}

// The setting's storage key, here rather than in App so that the readers outside
// React — placeConditions, which reads the splash and the location cards — can
// apply the same setting the forecast does without it being threaded to them.
export const RADAR_ENHANCED_KEY = 'alek-weather-radar-enhanced'

// On unless explicitly turned off, matching App's default.
export function radarEnhancedOn() {
  try { return localStorage.getItem(RADAR_ENHANCED_KEY) !== 'false' }
  catch { return true }
}

// One radar observation of the point, outside any component: MRMS where it
// reaches, then RainViewer. Never rejects; null when neither answered.
//   { source: 'mrms', sampledAt, sweeps }          see mrmsSweeps; radarVerdict
//                                                  makes the call
//   { source: 'rainviewer', sampledAt, verdict }   the fallback's own call
// Kept small and plain on purpose: it is stored with the reading.
export async function sampleRadar(lat, lon, isCancelled = () => false) {
  const sampledAt = Date.now()
  if (inMrmsDomain(lat, lon)) {
    let sweeps = null
    try {
      sweeps = await sampleMrms(lat, lon)
    } catch { /* service down or malformed: RainViewer below */ }
    if (isCancelled()) return null
    if (sweeps) return { source: 'mrms', sampledAt, sweeps }
  }
  try {
    const verdict = await sampleRainViewer(lat, lon, isCancelled)
    if (isCancelled()) return null
    return { source: 'rainviewer', sampledAt, verdict }
  } catch {
    // Network error, or a SecurityError if the tile lacks CORS headers and
    // taints the canvas. Either way, no observation.
    return null
  }
}
