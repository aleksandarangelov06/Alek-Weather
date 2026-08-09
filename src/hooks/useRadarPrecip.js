import { useState, useEffect } from 'react'

// "Radar enhanced accuracy" — cross-checks the current condition against live
// radar. RainViewer's radar tiles are transparent where there's no echo, so we
// sample the pixel(s) over the location: fully transparent means nothing is
// actually falling here, regardless of what the model-driven weather_code says.
//
// Returns: null  = unknown (disabled, loading, sampling failed, or a fringe echo
//                  too marginal to call either way → no override)
//          true  = radar shows no echo over the location (clear)
//          false = the location sits solidly inside an echo (precip present)
//
// The two verdicts are deliberately not held to the same standard, because they
// are not equally risky. Clearing a precipitation code the model invented is safe
// on weak evidence, so *any* echo in the sample box is enough to withhold a
// "clear" verdict. Asserting precipitation is not — that verdict can put
// "Thunderstorm" on the headline — so it needs the box to sit inside the echo
// rather than clip its edge, which keeps a stray clutter or fringe pixel from
// conjuring rain out of a clear sky.

const FRAMES_URL = 'https://api.rainviewer.com/public/weather-maps.json'
const SAMPLE_Z   = 7   // RainViewer's radar native max zoom — the finest detail served
const TILE_SIZE  = 256
const WINDOW     = 1   // sample a (2*WINDOW+1)^2 px box around the point for robustness
const SOLID_ALPHA = 200 // at/above this a pixel is inside an echo, not on its smoothed edge

// lon/lat → fractional slippy-map tile coordinates at zoom z (Web Mercator).
function project(lat, lon, z) {
  const n = 2 ** z
  const latRad = (lat * Math.PI) / 180
  return {
    x: ((lon + 180) / 360) * n,
    y: ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  }
}

export function useRadarPrecip(location, enabled) {
  const [radarClear, setRadarClear] = useState(null)

  useEffect(() => {
    if (!enabled || !location) { setRadarClear(null); return }
    let cancelled = false
    setRadarClear(null)

    ;(async () => {
      try {
        const data = await (await fetch(FRAMES_URL)).json()
        const past = data.radar?.past ?? []
        const frame = past[past.length - 1] // most recent observed frame
        if (!frame || !data.host) return

        const { x, y } = project(location.latitude, location.longitude, SAMPLE_Z)
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
        if (cancelled) return

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

        if (cancelled) return
        if (any === 0) setRadarClear(true)              // nothing at all overhead
        else if (solid * 2 > total) setRadarClear(false) // solidly inside an echo
        else setRadarClear(null)                         // clipping an edge — can't call it
      } catch {
        // Network error, or a SecurityError if the tile lacks CORS headers and
        // taints the canvas — either way, fall back to no override.
        if (!cancelled) setRadarClear(null)
      }
    })()

    return () => { cancelled = true }
  }, [enabled, location?.latitude, location?.longitude])

  return radarClear
}
