import { useEffect, useRef } from 'react'
import { assertOpenMeteoQuota, noteOpenMeteo429 } from '../utils/openMeteoQuota'
import { createRain, classifyMask, MASK_PX, PHASE_COLS, PHASE_ROWS } from '../utils/radarRainCore'

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

//
// The drops and the mask themselves are in utils/radarRainCore.js; this
// component finds the tiles, fetches the conditions, and decides where the
// drawing runs (see "Where the work runs").

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

// How often the mask is rebuilt from the tiles. Pans between rebuilds are
// tracked exactly (see createRain), so this only has to keep up with frame
// changes and tiles arriving.
const MASK_MS = 180

// ── Where the work runs ──────────────────────────────────────────────────────
//
// In a worker wherever the browser can hand it the canvas (radarRainWorker.js):
// the mask's read-back and every frame's drawing then happen beside the page,
// not on the thread that is also moving the map and running the phone's
// full-screen opening. The page keeps only what needs the DOM: finding the
// tiles, copying them small (createImageBitmap, which the browser does off the
// main thread), and the map's position. Elsewhere it all runs on the page, as
// it always did.
const canOffload = () =>
  typeof Worker !== 'undefined' &&
  typeof OffscreenCanvas !== 'undefined' &&
  typeof createImageBitmap === 'function' &&
  typeof HTMLCanvasElement !== 'undefined' &&
  'transferControlToOffscreen' in HTMLCanvasElement.prototype

// Copies a tile at roughly mask size, nearest-pixel so each cell is still one
// of the ramp's own colours. Browsers that don't take the resize options get a
// full-size copy, which the worker scales instead.
let resizeOk = true
async function tileCopy(el, w, h) {
  if (resizeOk) {
    try {
      return await createImageBitmap(el, {
        resizeWidth: Math.max(1, Math.round(w)),
        resizeHeight: Math.max(1, Math.round(h)),
        resizeQuality: 'pixelated',
      })
    } catch {
      resizeOk = false
    }
  }
  return createImageBitmap(el)
}

// The worker behind a canvas, created once per canvas element. A canvas can
// hand its drawing over only once, so an effect that runs twice on the same
// element (React's dev double-run, a new map) reuses it rather than starting a
// second; it is shut down a tick after the last effect lets go, which is when
// the element is really gone.
function claimWorker(canvas) {
  let rec = canvas.__rainWorker
  if (rec) {
    clearTimeout(rec.closing)
    return rec
  }
  if (!canOffload()) return null
  let worker
  try {
    worker = new Worker(new URL('../utils/radarRainWorker.js', import.meta.url), { type: 'module' })
    const off = canvas.transferControlToOffscreen()
    worker.postMessage({ type: 'init', canvas: off }, [off])
  } catch {
    worker?.terminate()
    return null
  }
  rec = { worker, closing: 0 }
  canvas.__rainWorker = rec
  return rec
}
function releaseWorker(canvas) {
  const rec = canvas.__rainWorker
  if (!rec) return
  rec.worker.postMessage({ type: 'run', on: false })
  rec.closing = setTimeout(() => {
    rec.worker.terminate()
    if (canvas.__rainWorker === rec) canvas.__rainWorker = null
  }, 0)
}

// `snow` is the fallback: the user's own location's verdict, used across the
// whole map until the grid arrives, and wherever it can't be fetched at all.
//
// `paused` stops everything (the drops and the mask's read-backs) while the
// radar's window is opening or closing on the phone. Nobody needs the rain
// until the window is open, and stopping it leaves the opening the whole of
// the device. Lifted, the loop starts again from a fresh mask, and the drops
// fade in the way they do at an echo's edge.
export function RadarRain({ map, getLayer, snow = false, paused = false }) {
  const ref = useRef(null)
  const fallback = useRef(snow)
  const pausedRef = useRef(paused)
  // Set by the main effect: starts or stops the loop to match what is holding
  // it, and passes a new fallback on to wherever the drawing runs.
  const syncRef = useRef(null)
  const fallbackOut = useRef(null)
  // Synced after render: writing a ref during render is unsafe under React's
  // concurrent rendering.
  useEffect(() => {
    fallback.current = snow
    fallbackOut.current?.(snow)
  })
  useEffect(() => {
    pausedRef.current = paused
    syncRef.current?.()
  }, [paused])

  useEffect(() => {
    const canvas = ref.current
    if (!canvas || !map) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    let W = 0, H = 0, mw = 0, mh = 0
    let tainted = false
    let timer, fieldTimer, refreshTimer
    let field = null, fetching = false, alive = true
    let hasEcho = false, failedAt = 0
    let running = false

    const panOrigin = () => {
      const p = map.containerPointToLayerPoint([0, 0])
      return { x: p.x, y: p.y }
    }

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
    const onEcho = (echo) => {
      hasEcho = echo
      // Precipitation has just come on screen with no grid to place it by:
      // fetch one now rather than waiting for the next move or refresh.
      if (echo && !field) ensureField()
    }

    // ── The two places the drawing can run ──
    const rec = claimWorker(canvas)
    let backend
    if (rec) {
      const { worker } = rec
      let copying = false
      worker.onmessage = ({ data: msg }) => {
        if (!alive) return
        if (msg.type === 'echo') onEcho(msg.echo)
        else if (msg.type === 'tainted') { tainted = true; hasEcho = false }
      }
      const view = () => worker.postMessage({ type: 'view', origin: panOrigin(), zoom: map.getZoom() })
      map.on('move zoomend viewreset', view)
      view()
      backend = {
        resize: (w, h, dpr) => worker.postMessage({ type: 'resize', w, h, dpr }),
        fallback: (fb) => worker.postMessage({ type: 'fallback', fb }),
        run: (on) => { if (on) view(); worker.postMessage({ type: 'run', on }) },
        // Copies of the tiles, then the mask is built in the worker. A round
        // still copying when the next is due is simply skipped.
        mask: (parts, ramp, place, fb, origin) => {
          if (copying) return
          copying = true
          const copies = parts.map((p) =>
            tileCopy(p.el, p.w, p.h).then((bmp) => ({ x: p.x, y: p.y, w: p.w, h: p.h, bmp }), () => null))
          Promise.all(copies)
            .then((got) => {
              const ok = got.filter(Boolean)
              if (!alive) { ok.forEach((c) => c.bmp.close()); return }
              worker.postMessage(
                { type: 'tiles', parts: ok, mw, mh, ramp, origin, place, fb },
                ok.map((c) => c.bmp),
              )
            })
            .finally(() => { copying = false })
        },
        dispose: () => {
          map.off('move zoomend viewreset', view)
          worker.onmessage = null
          releaseWorker(canvas)
        },
      }
    } else {
      const ctx = canvas.getContext('2d')
      const rain = createRain(ctx)
      const mctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
      let raf = 0
      const draw = (now) => {
        raf = requestAnimationFrame(draw)
        rain.frame(now, panOrigin(), map.getZoom())
      }
      backend = {
        resize: (w, h, dpr) => rain.resize(w, h, dpr),
        fallback: (fb) => rain.setFallback(fb),
        run: (on) => {
          if (on && !raf) { rain.reset(); raf = requestAnimationFrame(draw) }
          else if (!on && raf) { cancelAnimationFrame(raf); raf = 0 }
        },
        mask: (parts, ramp, place, fb, origin) => {
          const c = mctx.canvas
          if (c.width !== mw || c.height !== mh) { c.width = mw; c.height = mh }
          mctx.clearRect(0, 0, mw, mh)
          // Nearest-pixel sampling, so each cell reads one of the ramp's own
          // colours rather than a blend of neighbouring steps. Set every time:
          // resizing the canvas resets it.
          mctx.imageSmoothingEnabled = false
          for (const p of parts) mctx.drawImage(p.el, p.x, p.y, p.w, p.h)
          let px
          try {
            px = mctx.getImageData(0, 0, mw, mh).data
          } catch {
            tainted = true // cross-origin tiles without CORS: nothing we can read
            rain.clearMask()
            return
          }
          const m = classifyMask(px, mw, mh, ramp, place, fb)
          rain.setMask({ mask: m.mask, kind: m.kind, wet: m.wet, mw, mh }, origin)
          onEcho(m.echo)
        },
        dispose: () => { cancelAnimationFrame(raf); raf = 0 },
      }
    }
    fallbackOut.current = (fb) => backend.fallback(fb)
    backend.fallback(fallback.current)

    const resize = () => {
      const box = canvas.getBoundingClientRect()
      W = Math.max(1, Math.round(box.width))
      H = Math.max(1, Math.round(box.height))
      mw = Math.ceil(W / MASK_PX)
      mh = Math.ceil(H / MASK_PX)
      backend.resize(W, H, Math.min(2, window.devicePixelRatio || 1))
    }

    // Where the radar frame on screen has tiles, in mask cells, and where each
    // mask row and column is on the globe, for the rain/snow grid.
    const buildMask = () => {
      if (tainted) return
      const layer = getLayer()
      const tiles = layer?._tiles
      const ramp = layer?.options?.rainRamp
      const parts = []
      if (tiles && layer.options.opacity > 0) {
        const base = canvas.getBoundingClientRect()
        for (const key in tiles) {
          const el = tiles[key].el
          // Image tiles count once loaded. Canvas tiles (the smoothed feeds,
          // drawn in HrrrLayer) can be read at any point: until painted they
          // are clear.
          if (!(el instanceof HTMLCanvasElement) && (!el?.complete || !el.naturalWidth)) continue
          const r = el.getBoundingClientRect()
          if (r.right < base.left || r.left > base.right || r.bottom < base.top || r.top > base.bottom) continue
          parts.push({
            el,
            x: (r.left - base.left) / MASK_PX, y: (r.top - base.top) / MASK_PX,
            w: r.width / MASK_PX, h: r.height / MASK_PX,
          })
        }
      }
      // The map is unrotated Web Mercator, so a column shares one longitude and
      // a row one latitude: mw + mh projections rather than one per cell.
      let place = null
      if (field) {
        const lngs = new Float64Array(mw), lats = new Float64Array(mh)
        for (let x = 0; x < mw; x++) lngs[x] = map.containerPointToLatLng([(x + 0.5) * MASK_PX, 0]).lng
        for (let y = 0; y < mh; y++) lats[y] = map.containerPointToLatLng([0, (y + 0.5) * MASK_PX]).lat
        place = { field, lats, lngs }
      }
      backend.mask(parts, ramp, place, fallback.current, panOrigin())
    }

    // Only while the map is on screen and the app is in front. On the phone the
    // radar is one card in the stack, often scrolled well out of view, and it
    // used to go on rebuilding the mask (a read-back of every tile) every
    // MASK_MS and animating every frame regardless. Off screen, the loop stops
    // and the timers skip their work; coming back rebuilds the mask at once.
    let onScreen = true
    const active = () => alive && onScreen && !document.hidden && !pausedRef.current
    const sync = () => {
      const on = active()
      if (on === running) return
      running = on
      if (on) buildMask()
      backend.run(on)
    }
    syncRef.current = sync
    const io = new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting
      sync()
    })
    io.observe(canvas)
    document.addEventListener('visibilitychange', sync)

    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    map.on('moveend', onMoveEnd)
    ensureField()
    refreshTimer = setInterval(() => { if (active()) ensureField() }, PHASE_MAX_AGE)
    timer = setInterval(() => { if (active()) buildMask() }, MASK_MS)
    sync()
    return () => {
      alive = false
      syncRef.current = null
      fallbackOut.current = null
      backend.run(false)
      backend.dispose()
      clearInterval(timer)
      clearInterval(refreshTimer)
      clearTimeout(fieldTimer)
      map.off('moveend', onMoveEnd)
      ro.disconnect()
      io.disconnect()
      document.removeEventListener('visibilitychange', sync)
    }
  }, [map, getLayer])

  return <canvas ref={ref} className="radar-rain" aria-hidden="true" />
}
