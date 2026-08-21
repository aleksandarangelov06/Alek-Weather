import { useState, useEffect } from 'react'
import { MRMS_BASE, inMrmsDomain } from '../utils/mrms'

// "Radar enhanced accuracy" — cross-checks the current condition against live
// radar: is anything actually echoing over this location right now, whatever the
// model-driven weather_code says.
//
// Returns: null  = unknown (disabled, loading, sampling failed, stale, or a
//                  return too weak to call either way → no override)
//          true  = radar shows no echo over the location (clear)
//          false = the location sits inside an echo (precip present)
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

// Classify one rendered MRMS pixel, given as the service's "R G B A" string.
//
// The ImageServer paints dBZ into the NWS reflectivity ramp before serving it and
// publishes no colormap or value band (verified: /colormap and
// /rasterAttributeTable both come back empty), so intensity has to come back out
// of the colour. Sampled across a live squall line, the ramp runs dark blue →
// light blue → teal → green → yellow → orange → red → magenta, and the whole
// sub-teal stretch — the part that is aloft, virga, or drizzle rather than rain
// on the ground — is exactly the part where blue leads green with red trailing
// both. Above it green or red always leads, magenta included.
function classifyMrmsPixel(rgba) {
  const [r, g, b, a] = String(rgba).split(/\s+/).map(Number)
  if (![r, g, b, a].every(Number.isFinite)) return null
  if (a === 0) return true          // nothing echoing here at all
  if (b > g && r < g) return null    // bottom of the ramp — real, but too weak to call
  return false                       // teal and up: something is falling
}

// One `identify` call returns the pixel over the point for every sweep in the
// service's time window, so the newest sweep is one sort away and no separate
// "what time is it" request is needed. Values line up with catalogItems by index.
//
// Wraps its answer in an object so that "MRMS looked and won't call it" (a weak
// return: { verdict: null }) stays distinct from "MRMS didn't answer" (null) —
// only the second is a reason to go ask a coarser source.
async function sampleMrms(lat, lon) {
  const q = new URLSearchParams({
    geometry: JSON.stringify({ x: lon, y: lat, spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryPoint',
    returnGeometry: 'false',
    f: 'json',
  })
  const data = await fetch(`${MRMS_BASE}/identify?${q}`).then(r => r.json())

  const values = data?.properties?.Values
  const items  = data?.catalogItems?.features
  if (!Array.isArray(values) || !Array.isArray(items) || !values.length) return null

  // The service returns the sweeps unordered (verified: a 17-frame response
  // arrived with 19:54Z sitting between 20:34Z and 20:42Z), so the newest has to
  // be found rather than read off either end.
  let best = -1, bestTime = 0
  for (let i = 0; i < items.length && i < values.length; i++) {
    const t = items[i]?.attributes?.idp_validtime
    if (Number.isFinite(t) && t > bestTime) { bestTime = t; best = i }
  }
  if (best === -1) return null
  if (Date.now() - bestTime > MRMS_MAX_AGE_MS) return null  // no live sweep to speak for now

  return { verdict: classifyMrmsPixel(values[best]) }
}

// RainViewer fallback: sample the tile pixels over the location. Its radar tiles
// are transparent where there is no echo, so alpha is the signal. Used outside
// MRMS coverage and whenever MRMS doesn't answer.
async function sampleRainViewer(lat, lon, isCancelled) {
  const data = await (await fetch(FRAMES_URL)).json()
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
    img.onload = resolve
    img.onerror = reject
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

// `token` is the reading this verdict belongs to — App passes `lastUpdated`, so a
// sample is taken once per successful weather fetch and re-taken on every silent
// refresh. Sampling only on a location change was its own staleness bug: the
// verdict outlived the sweep it came from, and an echo seen on arrival went on
// asserting rain over a location the storm had long since left.
export function useRadarPrecip(location, enabled, token = null) {
  const [radarClear, setRadarClear] = useState(null)

  useEffect(() => {
    if (!enabled || !location || !token) { setRadarClear(null); return }
    let cancelled = false
    const isCancelled = () => cancelled
    setRadarClear(null)

    ;(async () => {
      const { latitude: lat, longitude: lon } = location

      if (inMrmsDomain(lat, lon)) {
        let answer = null
        try {
          answer = await sampleMrms(lat, lon)
        } catch { /* service down or malformed — RainViewer below */ }
        if (cancelled) return
        if (answer) { setRadarClear(answer.verdict); return }
      }

      let verdict
      try {
        verdict = await sampleRainViewer(lat, lon, isCancelled)
      } catch {
        // Network error, or a SecurityError if the tile lacks CORS headers and
        // taints the canvas — either way, fall back to no override.
        verdict = null
      }
      if (!cancelled) setRadarClear(verdict)
    })()

    return () => { cancelled = true }
  }, [enabled, location?.latitude, location?.longitude, token])

  return radarClear
}
