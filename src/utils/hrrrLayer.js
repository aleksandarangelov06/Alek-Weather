// The HRRR forecast, drawn here rather than by the tile server.
//
// IEM serves HRRR's forecast reflectivity as ready-made coloured tiles, but they
// are the model's 3 km grid drawn cell by cell, nearest-neighbour twice over
// (model grid to a 0.02° raster, raster to web tiles). Up close the forecast came
// out as a quilt of hard squares beside an observed radar that is smooth. Nothing
// finer exists to fetch: 3 km is the model's own resolution, and no free, keyless
// service publishes a smoother forecast.
//
// What the tiles do carry is the value under every pixel. They are drawn with a
// 256-colour ramp in which every colour is distinct and stands for one 0.5 dBZ
// step (IEM's hrrr_ref2raster.py: index = (dBZ + 32) * 2 + 1, 0 for nothing), so
// each pixel reads back to an exact reflectivity. This layer reads it back and
// draws the field itself: blurred to about the size of a model cell so the
// squares melt into the shapes they stand for, sampled smoothly at screen
// resolution, and coloured with whichever ramp the observed half of the timeline
// uses. Colouring the field rather than blurring the colours keeps the bands in
// order: a red core fades out through orange and yellow, not through brown.
//
// It asks no more of IEM than the stock tiles did: sources are fetched at zoom 7
// (or the map's own zoom when it is further out), the level those were already
// capped at, and every screen tile that falls inside one shares it.
import L from 'leaflet'
import { T, MIN_DBZ, IEM_RGB, RV_MIN, RV_RAMP, idxToDbz, decodePixels, gaussian, renderField } from './hrrrCore'

// Moved to hrrrCore so the rain overlay's worker can use it; kept exported here
// for anything that still imports it from this module.
export { colorDbz } from './hrrrCore'

// Where source tiles stop being fetched. At zoom 7 a pixel is ~1 km at US
// latitudes, a third of a model cell, so every cell survives the server's
// resampling; past it the server would only be drawing the same cells bigger.
const SRC_MAX_ZOOM = 7

// How much the field is softened, as a Gaussian sigma in km. About two-thirds of
// a 3 km model cell: enough to round off the squares, not so much that a narrow
// line of storms smears out into a band.
const BLUR_KM = 2
// Floor for the blur in source pixels, for views zoomed out far enough that a
// pixel spans several cells and the server's downsampling has left them jagged.
const MIN_BLUR_PX = 0.6

const byte = (s, at) => parseInt(s.slice(at, at + 2), 16)
// One pixel for a Uint32Array view over ImageData, which is RGBA in memory and so
// ABGR as a little-endian word.
const pack = (r, g, b, a) => ((a << 24) | (b << 16) | (g << 8) | r) >>> 0

// Index -> drawn pixel, per ramp. 'nws' is IEM's own ramp, the one the stock
// tiles showed; 'rv' is RainViewer's.
const LUTS = { nws: new Uint32Array(256), rv: new Uint32Array(256) }
for (let i = 1; i < 256; i++) {
  const dbz = idxToDbz(i)
  if (dbz < MIN_DBZ) continue
  const c = IEM_RGB[i]
  LUTS.nws[i] = pack(c >> 16, (c >> 8) & 255, c & 255, 255)
  const k = Math.min(Math.floor(dbz), 65) - RV_MIN
  if (k >= 0) {
    const o = k * 8
    LUTS.rv[i] = pack(byte(RV_RAMP, o), byte(RV_RAMP, o + 2), byte(RV_RAMP, o + 4), byte(RV_RAMP, o + 6))
  }
}


let scratchCtx = null
function scratch() {
  if (!scratchCtx) {
    const c = document.createElement('canvas')
    c.width = c.height = T
    scratchCtx = c.getContext('2d', { willReadFrequently: true })
    scratchCtx.imageSmoothingEnabled = false
  }
  return scratchCtx
}

// A source tile as ramp indices, one byte a pixel, or null if nothing in it is
// falling (most of the map, most of the time; it keeps the cache small).
function decode(img) {
  const ctx = scratch()
  ctx.clearRect(0, 0, T, T)
  ctx.drawImage(img, 0, 0, T, T)
  return decodePixels(ctx.getImageData(0, 0, T, T).data)
}

// Decoded source tiles, shared by every layer and kept most-recently-used last.
// Keyed by model run as well as URL: IEM's URLs name a forecast step of whatever
// run is latest, so the same URL means different data once a new run lands.
// 192 entries is at most ~12 MB, and far less in practice since clear tiles
// are stored as null.
const SRC_CACHE_MAX = 192
const srcCache = new Map()
function sourceTile(key, url) {
  let p = srcCache.get(key)
  if (p) {
    srcCache.delete(key)
    srcCache.set(key, p)
    return p
  }
  p = new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try { resolve(decode(img)) } catch (err) { reject(err) }
    }
    img.onerror = () => reject(new Error('Radar source tile failed to load'))
    img.src = url
  })
  // A failure isn't remembered: the next screen tile to want it tries again.
  p.catch(() => { if (srcCache.get(key) === p) srcCache.delete(key) })
  srcCache.set(key, p)
  if (srcCache.size > SRC_CACHE_MAX) srcCache.delete(srcCache.keys().next().value)
  return p
}

// ── Drawing off the critical path ──
// Drawing a tile is several milliseconds of main-thread work (the blur, then a
// sample per pixel), and a forecast step is a dozen or more tiles. Run as they
// came in, a step's tiles went back to back in one long task the moment their
// sources were in (at once, when cached), and scrubbing the timeline set that
// off for every step the finger crossed plus the steps prefetched around it:
// the scrubber stalled while frames nobody was looking at any more were drawn.
//
// So the drawing is queued and done a slice at a time, yielding between slices
// so input and the scrubber keep moving. That is the fallback now: where a
// worker can run, the whole of it, fetching and decoding the sources included,
// happens in one (see "In a worker" below), and this queue sits idle. The step on screen (focusHrrrLayer)
// goes first; a tile that has left the map by its turn (its step was scrubbed
// past, or the view moved on) is skipped rather than drawn for nothing.
const SLICE_MS = 6
const jobs = []
let pumping = false
let channel = null
let focus = null

// The step the radar is showing (any layer; only HRRR ones queue tiles), whose
// tiles are drawn ahead of the rest.
export function focusHrrrLayer(layer) {
  focus = layer
  postFocus()
}

function pump() {
  const end = performance.now() + SLICE_MS
  do {
    let i = focus ? jobs.findIndex((j) => j.layer === focus) : -1
    if (i < 0) i = 0
    jobs.splice(i, 1)[0].run()
  } while (jobs.length && performance.now() < end)
  if (jobs.length) channel.port2.postMessage(null)
  else pumping = false
}

// Runs `work` synchronously in a later slice and resolves with its result. A
// MessageChannel rather than setTimeout, which browsers clamp to 4 ms when it
// is scheduled from inside itself.
function inSlice(layer, work) {
  return new Promise((resolve, reject) => {
    jobs.push({ layer, run: () => { try { resolve(work()) } catch (err) { reject(err) } } })
    if (pumping) return
    if (!channel) {
      channel = new MessageChannel()
      channel.port1.onmessage = pump
    }
    pumping = true
    channel.port2.postMessage(null)
  })
}

// ── In a worker ──
// Even sliced, the drawing was main-thread work, and a 6 ms slice is most of a
// 120 Hz frame. Opening the phone's full-screen radar asks for a screen of new
// tiles at once, so those slices landed on exactly the frames of the opening
// animation, on fast phones as much as slow ones. hrrrWorker.js does the
// fetching, decoding, blurring and resampling beside the page instead; the page
// only colours the result (paint, a table lookup per pixel).
//
// Where workers, OffscreenCanvas or module workers aren't available, or the
// worker dies, getWorker answers null from then on and tiles are drawn on the
// page as before.
let worker = null
let workerDead = false
let nextJob = 1
const awaiting = new Map()

function getWorker() {
  if (worker || workerDead) return worker
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') {
    workerDead = true
    return null
  }
  try {
    worker = new Worker(new URL('./hrrrWorker.js', import.meta.url), { type: 'module' })
  } catch {
    workerDead = true
    return null
  }
  worker.onmessage = ({ data: msg }) => {
    const job = awaiting.get(msg.id)
    if (!job) return
    awaiting.delete(msg.id)
    if (msg.error) job.reject(new Error(msg.error))
    else job.resolve(msg)
  }
  // Failing to load, or an uncaught error inside: give up on it for the rest of
  // the session. The tiles it had are failed, so Leaflet asks again next time
  // they are wanted, and those go to the page.
  worker.onerror = () => {
    worker?.terminate()
    worker = null
    workerDead = true
    awaiting.forEach((job) => job.reject(new Error('Radar tile worker failed')))
    awaiting.clear()
  }
  postFocus()
  return worker
}

// The layer on screen, told to the worker so its tiles go first there too.
function postFocus() {
  worker?.postMessage({ type: 'focus', layer: focus instanceof HrrrLayer ? L.stamp(focus) : null })
}

function inWorker(w, msg) {
  return new Promise((resolve, reject) => {
    awaiting.set(msg.id, { resolve, reject })
    w.postMessage(msg)
  })
}

// A tile that left the map before its answer came: the worker drops it, and
// whatever was waiting on it is let go rather than left hanging.
function cancelJob(id) {
  const job = awaiting.get(id)
  if (!job) return
  awaiting.delete(id)
  worker?.postMessage({ type: 'cancel', id })
  job.resolve({ cancelled: true })
}

// ── Finished tiles, kept ──
// A forecast step belongs to one model run and never changes, so once a tile
// has been drawn there is no reason to draw it again: not when the timeline is
// scrubbed back over it, not when its step's layer is re-attached after being
// dropped from the map's window (see WeatherRadar), and not the next time the
// app opens on the same run.
//
// What is kept is the drawn tile as ramp indices, one byte a pixel, rather than
// its colours: a quarter of the size, and good for either palette (a tile
// comes back through the palette in a fraction of a millisecond, see paint).
// Only the rows with anything in them are kept, and a tile with nothing at all
// is kept as null. Keyed by run, step and tile; the palette isn't in the key.
//
//   held    in memory, most-recently-used last, up to HELD_BYTES. Enough for
//           every step of a run across a full-screen view several times over,
//           so a scrub across the whole forecast never evicts its own start.
//   stored  on the device (IndexedDB), for the next launch: opening the radar
//           again within the same run shows the forecast without fetching or
//           drawing anything. Runs older than STORE_KEEP_SEC are cleared out
//           when the database opens; HRRR runs hourly and only the latest is
//           shown, so that keeps a few runs at most.
const HELD_BYTES = 32 * 1024 * 1024
const HELD_MAX = 4000 // entries, so clear tiles (null, no bytes) are bounded too
const held = new Map()
let heldBytes = 0
const recBytes = (rec) => (rec ? rec.data.byteLength : 0)

function heldGet(key) {
  const rec = held.get(key)
  if (rec !== undefined) {
    held.delete(key)
    held.set(key, rec)
  }
  return rec
}
function heldSet(key, rec) {
  const prev = held.get(key)
  if (prev !== undefined) {
    heldBytes -= recBytes(prev)
    held.delete(key)
  }
  held.set(key, rec)
  heldBytes += recBytes(rec)
  while (held.size > 1 && (heldBytes > HELD_BYTES || held.size > HELD_MAX)) {
    const oldest = held.keys().next().value
    heldBytes -= recBytes(held.get(oldest))
    held.delete(oldest)
  }
}

const STORE_DB = 'alek-weather-hrrr'
const STORE = 'tiles'
const STORE_KEEP_SEC = 4 * 3600
let dbPromise = null

// The database, or null wherever IndexedDB isn't available (a private window,
// storage blocked): the layer then just draws, as it would on a first visit.
function openStore() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    let req
    try { req = indexedDB.open(STORE_DB, 1) } catch { resolve(null); return }
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE).createIndex('run', 'run')
    }
    req.onsuccess = () => {
      const db = req.result
      // Clear out runs too old to be shown again. Best effort: a failure here
      // only leaves them for the next launch to try.
      try {
        const cutoff = Date.now() / 1000 - STORE_KEEP_SEC
        const tx = db.transaction(STORE, 'readwrite')
        tx.objectStore(STORE).index('run').openCursor(IDBKeyRange.upperBound(cutoff)).onsuccess = (e) => {
          const cursor = e.target.result
          if (cursor) { cursor.delete(); cursor.continue() }
        }
      } catch { /* left for next time */ }
      resolve(db)
    }
    req.onerror = () => resolve(null)
    req.onblocked = () => resolve(null)
  })
  return dbPromise
}

// The stored tile for `key`: its record (null for a clear tile), or undefined
// when there isn't one.
async function storedTile(key) {
  const db = await openStore()
  if (!db) return undefined
  return new Promise((resolve) => {
    try {
      const req = db.transaction(STORE).objectStore(STORE).get(key)
      req.onsuccess = () => resolve(req.result ? req.result.rec : undefined)
      req.onerror = () => resolve(undefined)
    } catch { resolve(undefined) }
  })
}

// Fire and forget: a tile that fails to store is only drawn again next time.
async function storeTile(key, run, rec) {
  const db = await openStore()
  if (!db) return
  try { db.transaction(STORE, 'readwrite').objectStore(STORE).put({ run, rec }, key) } catch { /* not kept */ }
}

// Colours a kept tile into its canvas with the layer's palette.
function paint(tile, rec, palette) {
  if (!rec) return
  const ctx = tile.getContext('2d')
  const img = ctx.createImageData(tile.width, rec.rows)
  const out = new Uint32Array(img.data.buffer)
  const lut = LUTS[palette] ?? LUTS.nws
  const data = rec.data
  for (let i = 0; i < data.length; i++) out[i] = lut[data[i]]
  ctx.putImageData(img, 0, rec.y0)
}

// A Leaflet layer for one HRRR forecast step. `url` is IEM's {z}/{x}/{y} tile
// template for the step; options.palette picks the ramp ('rv' or 'nws') and
// options.run is the model run's init time, for the cache key.
//
// Tiles are canvases, drawn at every zoom the map goes to, since the smoothing
// is what makes zooming in worth it. They are drawn at CSS resolution, not the
// screen's density: the field is a 3 km grid blurred over several kilometres,
// so the extra pixels of a 2x canvas held nothing a 1x one scaled up doesn't,
// at four times the work per tile. The observed layers' tiles are 256 px
// images shown the same way. RadarRain and the card's still both read canvas
// tiles as well as image ones.
//
// Not only HRRR's: any feed painted in IEM's ramp can be drawn this way. NOAA's
// MRMS mosaic is (its renders match the ramp, give or take the server's
// resampling, which the nearest-colour decode absorbs), so the radar's
// MrmsLayer extends this one, overriding _sourceUrl and setting its own
// srcMaxZoom and blurKm for its finer grid.
export const HrrrLayer = L.GridLayer.extend({
  options: { palette: 'nws', run: '', srcMaxZoom: SRC_MAX_ZOOM, blurKm: BLUR_KM },

  initialize(url, options) {
    this._url = url
    L.GridLayer.prototype.initialize.call(this, options)
    // Scrubbed past, zoomed away, or the layer taken off the map: a tile still
    // being drawn in the worker isn't wanted any more.
    this.on('tileunload', ({ tile }) => { if (tile._hrrrJob) cancelJob(tile._hrrrJob) })
  },

  // The source tile at zoom z, column x, row y (already wrapped): IEM's XYZ
  // template here.
  _sourceUrl(z, x, y) {
    return L.Util.template(this._url, { z, x, y })
  },

  createTile(coords, done) {
    const tile = L.DomUtil.create('canvas', 'leaflet-tile')
    const size = this.getTileSize()
    tile.width = size.x
    tile.height = size.y
    // Everything the tile's ramp indices depend on (see "Finished tiles, kept").
    const key = `${this.options.run}|${this._url}|${coords.z}/${coords.x}/${coords.y}|${tile.width}`
    const rec = heldGet(key)
    if (rec !== undefined) {
      paint(tile, rec, this.options.palette)
      // Leaflet only counts done() once createTile has returned.
      Promise.resolve().then(() => done(null, tile))
      return tile
    }
    this._load(tile, coords, key).then(() => done(null, tile), (err) => done(err, tile))
    return tile
  },

  // Not in memory: from the device if this run's tile was stored on an earlier
  // visit, otherwise drawn.
  async _load(tile, coords, key) {
    const rec = await storedTile(key)
    if (rec !== undefined) {
      heldSet(key, rec)
      if (tile.isConnected) paint(tile, rec, this.options.palette)
      return
    }
    await this._draw(tile, coords, key)
  },

  async _draw(tile, { x, y, z }, key) {
    // Everything below is in source pixels at zoom sz: the global pixel grid
    // that zoom's tiles tile.
    const sz = Math.min(z, this.options.srcMaxZoom)
    const n = 2 ** sz
    const span = T / 2 ** (z - sz) // this screen tile's width
    const gx = x * span
    const gy = y * span

    // The blur is set in km, so it needs the size of a source pixel here.
    const lat = Math.atan(Math.sinh(Math.PI * (1 - (2 * (gy + span / 2)) / (T * n))))
    const pxKm = (40075.017 * Math.cos(lat)) / (T * n)
    const kernel = gaussian(Math.max(MIN_BLUR_PX, this.options.blurKm / pxKm))

    // The patch of field this tile needs: its own footprint plus a margin wide
    // enough for the blur to read real neighbours, plus a pixel each side for
    // the interpolation. Near a source tile's edge that reaches into the next
    // one, which is fetched too, so no seams show along the source grid.
    const m = (kernel.length - 1) / 2 + 2
    const bx = Math.floor(gx) - m
    const by = Math.floor(gy) - m
    const bw = Math.ceil(span) + 2 * m
    const bh = bw

    const run = this.options.run
    const keep = (rec, complete) => {
      paint(tile, rec, this.options.palette)
      // One drawn short of a neighbour isn't cached, so the next time it is
      // wanted it gets another go at the whole thing.
      if (!complete) return
      heldSet(key, rec)
      // Only with a real run time, which is what clears it out later.
      if (Number.isFinite(run)) storeTile(key, run, rec)
    }

    const w = getWorker()
    if (w) {
      const id = nextJob++
      tile._hrrrJob = id
      const sources = []
      for (let ty = Math.floor(by / T); ty <= Math.floor((by + bh - 1) / T); ty++) {
        for (let tx = Math.floor(bx / T); tx <= Math.floor((bx + bw - 1) / T); tx++) {
          if (ty < 0 || ty >= n) { sources.push({ tx, ty }); continue }
          const url = this._sourceUrl(sz, ((tx % n) + n) % n, ty)
          sources.push({ tx, ty, key: `${run}|${url}`, url })
        }
      }
      try {
        const msg = await inWorker(w, {
          type: 'render', id, layer: L.stamp(this),
          geom: { gx, gy, span, bx, by, bw, bh, kernel }, want: sources,
          W: tile.width, H: tile.height,
        })
        if (msg.cancelled || !tile.isConnected) return
        keep(msg.rec, msg.complete)
        return
      } finally {
        tile._hrrrJob = 0
      }
    }

    const want = []
    for (let ty = Math.floor(by / T); ty <= Math.floor((by + bh - 1) / T); ty++) {
      for (let tx = Math.floor(bx / T); tx <= Math.floor((bx + bw - 1) / T); tx++) {
        if (ty < 0 || ty >= n) {
          want.push({ tx, ty, p: Promise.resolve(null) })
          continue
        }
        const url = this._sourceUrl(sz, ((tx % n) + n) % n, ty)
        want.push({ tx, ty, p: sourceTile(`${this.options.run}|${url}`, url) })
      }
    }
    const got = await Promise.allSettled(want.map((w) => w.p))
    // Only a total loss is an error. A missing neighbour costs a sliver of
    // margin, which is better drawn as clear than not drawn at all.
    if (got.every((g) => g.status === 'rejected')) throw new Error('Radar source tiles unavailable')

    // The drawing itself waits its turn (see inSlice). Gone from the map by
    // then, the tile is skipped, and not cached, since nothing was drawn.
    const geom = { gx, gy, span, bx, by, bw, bh, kernel, want, got }
    const complete = got.every((g) => g.status === 'fulfilled')
    return inSlice(this, () => {
      if (!tile.isConnected) return
      keep(this._render(geom, tile.width, tile.height), complete)
    })
  },

  // The page-side render (the fallback; see "In a worker"): the patch's
  // decoded sources handed to the same renderField the worker runs.
  _render({ want, got, ...geom }, W, H) {
    const sources = got.map((g, i) => ({
      tx: want[i].tx, ty: want[i].ty, data: g.status === 'fulfilled' ? g.value : null,
    }))
    return renderField(geom, sources, W, H)
  },
})
