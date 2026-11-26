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

const T = 256 // source and screen tile size, CSS px

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

// What "no echo" counts as while blurring. Under the faintest value IEM writes
// (-9 dBZ; anything weaker it drops), so an echo's edge fades out where it was
// instead of being dragged towards -32 and drawn as a wide faint halo.
const NODATA_DBZ = -20
const MIN_DBZ = -9.25 // weaker than this, a pixel is left clear

// IEM's N0Q ramp, index 0 to 255, as RRGGBB. Read off the palette of the HRRR
// rasters (data/gis/images/4326/hrrr/refd_*.png); the tiles reproduce it exactly.
const IEM_RAMP =
  '00000085718f85728f86738d87758b87768b887789897987897a878a7b858b7d848b7e848c7f828d81808d82808e837e' +
  '8f847c8f857c90877b918879918979928b77938d759691539894579b975b9d9a60a09d64a3a068a5a36da8a671aaa976' +
  'adac7ab0af7eb2b283b7b88cbabb90bdbe94bfc199c2c49dc4c7a2c7caa6cacdaaccd0afd2d4b4cfd2b4c9ccb4c6c9b4' +
  'c3c7b4c0c4b4bdc1b4b9beb4b6bbb4b3b9b4b0b6b4adb3b4aab0b4a4abb4a0a8b49da5b49aa2b497a0b4949db4919ab4' +
  '949bb59098b48c95b38892b2808cb07c89af7886ae7483ac7080ab6c7daa6779a96376a85f73a75b70a6576da44f67a2' +
  '4b64a14761a0435e9f415b9e4361a24568a6486faa4a76ae4d7db24f84b6518bbb5699c3599fc75ba6cb5eadcf60b4d4' +
  '62bbd865c2dc67c9e06ad0e46fd6e868d6d759d6b352d6a24bd69043d67e3cd66d35d65b11d51811d11710cd1710c816' +
  '10c4160fbc150fb7140eb3140eaf130eab130da6120da2120d9e110c99110c95100c91100b880f0b840e0a800e0a7c0d' +
  '0a770d09730c096f0c096b0b08660b08620a095e09327308467d085b88076f9207849d0698a806adb205c1bd05d6c704' +
  'ead204ffe200ffd800ffd300ffce00ffc900ffc400ffc000ffbb00ffb600ffb100ffac00ffa700ffa200ff9900ff9400' +
  'ff8f00ff8a00ff8500ff8000ff0000f80000f10000ea0000e30000d50000cd0000c60000bf0000b80000b10000aa0000' +
  'a300009b00009400008d00007f0000780000710000fffffffff5ffffeaffffdfffffd4ffffc9ffffbeffffb3ffff9dff' +
  'ff92ffff75fffc6bfdf960faf656f7f34bf4f040f1ed36efea2bece720e9e10be3b200ffac00fca400f79b00f49300ef' +
  '8800ea8300e87900e27200dd6900db05ecf005ebf005eaf005dde005dce005dbe005cdd005ccd004bdc004bcc004bbc0' +
  '04aeb004adb0049ea0049da0049ca0038e90038d90038c90037e80037d80036f70036e70036d70025f60025e60024f50' +
  '024e50024d50023f40023e40023d40013030012f30012020011f20011e203a67b53a66b53a65b53a64b53a63b53a62b5'

// RainViewer's "Universal Blue", the ramp its free tier draws with, as RRGGBBAA
// for each whole dBZ from RV_MIN to 65 (rainviewer_api_colors_table.csv). The
// weak end is the translucent beige it draws drizzle and haze in; anything
// stronger than 65 stays white.
const RV_MIN = -10
const RV_RAMP =
  '6361591466635a1969665c1e6c685d246f6b5f29726e612e75706234787364397c75653e7f786744827b6949857d6a4e' +
  '88806c548b826d598e856f5e928871649e93756eaa9e7978b6a97e82c2b4828ccec08796d2c48ba0d6c88faadacc93b4' +
  'ded097be88ddeeff6cd1ebff51c5e8ff36bae5ff1baee2ff00a3e0ff009ad5ff0091caff0088bfff007fb4ff0077aaff' +
  '0070a3ff00699cff006295ff005b8eff005588ff005180ff004e78ff004a70ff004768ffffee00ffffe000ffffd200ff' +
  'ffc500ffffb700ffffaa00ffff9f00ffff9500ffff8b00ffff8100ffff4400fff23600ffe62800ffd91b00ffcd0d00ff' +
  'c10000ffa80000ff8f0000ff760000ff5d0000ffffaaffffff9fffffff95ffffff8bffffff81ffffff77ffffff6cffff' +
  'ff62ffffff58ffffff4effffffffffff'

const idxToDbz = (i) => (i - 1) * 0.5 - 32
const byte = (s, at) => parseInt(s.slice(at, at + 2), 16)
// One pixel for a Uint32Array view over ImageData, which is RGBA in memory and so
// ABGR as a little-endian word.
const pack = (r, g, b, a) => ((a << 24) | (b << 16) | (g << 8) | r) >>> 0

const IEM_RGB = Array.from({ length: 256 }, (_, i) => parseInt(IEM_RAMP.slice(i * 6, i * 6 + 6), 16))
const RGB_TO_IDX = new Map(IEM_RGB.map((c, i) => [c, i]))

// Index (0.5 dBZ steps) -> dBZ, with "nothing" standing in as NODATA_DBZ.
const IDX_DBZ = new Float32Array(256)
for (let i = 0; i < 256; i++) IDX_DBZ[i] = i === 0 ? NODATA_DBZ : idxToDbz(i)

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

// For a colour that isn't in the ramp. The tiles have never had one, but a
// server that started resampling them would, and the closest step beats a hole.
function nearestIdx(c) {
  let best = 0
  let bestD = Infinity
  for (let i = 1; i < 256; i++) {
    const p = IEM_RGB[i]
    const dr = (p >> 16) - (c >> 16)
    const dg = ((p >> 8) & 255) - ((c >> 8) & 255)
    const db = (p & 255) - (c & 255)
    const d = dr * dr + dg * dg + db * db
    if (d < bestD) { bestD = d; best = i }
  }
  return best
}

// Roughly how strong an echo is, in dBZ, from the colour a radar tile paints
// it: for the rain drawn over the map (RadarRain), which falls thinner where
// the radar is light. `ramp` is the tile's: 'rv' for RainViewer's, anything
// else for the NWS-style ones (IEM's here, which NOAA's MRMS rendering tracks
// to within a step). The nearest ramp colour wins, so a pixel the browser has
// blended between two steps still lands on one of them. Answers are cached per
// colour, at 5 bits a channel, so a mask rebuild is mostly map lookups.
const RAMP_DBZ = {
  nws: IEM_RGB.flatMap((c, i) => (i > 0 && idxToDbz(i) >= MIN_DBZ ? [[c, idxToDbz(i)]] : [])),
  rv: Array.from({ length: RV_RAMP.length / 8 }, (_, k) => [
    (byte(RV_RAMP, k * 8) << 16) | (byte(RV_RAMP, k * 8 + 2) << 8) | byte(RV_RAMP, k * 8 + 4),
    RV_MIN + k,
  ]),
}
const dbzCache = { nws: new Map(), rv: new Map() }

export function colorDbz(r, g, b, ramp) {
  const key = ramp === 'rv' ? 'rv' : 'nws'
  const q = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
  const cache = dbzCache[key]
  const hit = cache.get(q)
  if (hit !== undefined) return hit
  let best = 0
  let bestD = Infinity
  for (const [c, dbz] of RAMP_DBZ[key]) {
    const dr = (c >> 16) - r
    const dg = ((c >> 8) & 255) - g
    const db = (c & 255) - b
    const d = dr * dr + dg * dg + db * db
    if (d < bestD) { bestD = d; best = dbz }
  }
  cache.set(q, best)
  return best
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
  const px = ctx.getImageData(0, 0, T, T).data
  const out = new Uint8Array(T * T)
  let lastRgb = -1
  let lastIdx = 0
  let any = false
  for (let i = 0, j = 0; i < out.length; i++, j += 4) {
    if (px[j + 3] < 128) continue
    const rgb = (px[j] << 16) | (px[j + 1] << 8) | px[j + 2]
    // Neighbouring pixels are usually the same colour, so the last answer is
    // usually this one's.
    if (rgb !== lastRgb) {
      lastRgb = rgb
      lastIdx = RGB_TO_IDX.get(rgb)
      if (lastIdx === undefined) {
        lastIdx = nearestIdx(rgb)
        RGB_TO_IDX.set(rgb, lastIdx)
      }
    }
    out[i] = lastIdx
    if (lastIdx) any = true
  }
  return any ? out : null
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
// so input and the scrubber keep moving. The step on screen (focusHrrrLayer)
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

function gaussian(sigma) {
  const r = Math.max(1, Math.ceil(sigma * 2.5))
  const k = new Float32Array(2 * r + 1)
  let sum = 0
  for (let i = -r; i <= r; i++) sum += (k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma)))
  for (let i = 0; i < k.length; i++) k[i] /= sum
  return k
}

// Separable Gaussian blur of a w×h field, in place. The edges clamp, but the
// caller pads the field so nothing it samples is near enough to one to care.
function blur(f, w, h, k) {
  const r = (k.length - 1) >> 1
  const tmp = new Float32Array(f.length)
  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let x = 0; x < w; x++) {
      let s = 0
      for (let i = -r; i <= r; i++) {
        const xx = x + i < 0 ? 0 : x + i >= w ? w - 1 : x + i
        s += f[row + xx] * k[i + r]
      }
      tmp[row + x] = s
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0
      for (let i = -r; i <= r; i++) {
        const yy = y + i < 0 ? 0 : y + i >= h ? h - 1 : y + i
        s += tmp[yy * w + x] * k[i + r]
      }
      f[y * w + x] = s
    }
  }
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
    // then, the tile is skipped, and not cached, since nothing was drawn. One
    // drawn short of a neighbour isn't cached either, so the next time it is
    // wanted it gets another go at the whole thing.
    const geom = { gx, gy, span, bx, by, bw, bh, kernel, want, got }
    const complete = got.every((g) => g.status === 'fulfilled')
    const run = this.options.run
    return inSlice(this, () => {
      if (!tile.isConnected) return
      const rec = this._render(geom, tile.width, tile.height)
      paint(tile, rec, this.options.palette)
      if (!complete) return
      heldSet(key, rec)
      // Only with a real run time, which is what clears it out later.
      if (Number.isFinite(run)) storeTile(key, run, rec)
    })
  },

  // The tile's field, as ramp indices for the rows that have anything in them:
  // { y0, rows, data }, or null when nothing is falling anywhere near.
  _render({ gx, gy, span, bx, by, bw, bh, kernel, want, got }, W, H) {
    const field = new Float32Array(bw * bh).fill(NODATA_DBZ)
    let hit = false
    got.forEach((g, i) => {
      const data = g.status === 'fulfilled' ? g.value : null
      if (!data) return
      const ox = want[i].tx * T - bx
      const oy = want[i].ty * T - by
      const x0 = Math.max(0, ox)
      const x1 = Math.min(bw, ox + T)
      for (let yy = Math.max(0, oy); yy < Math.min(bh, oy + T); yy++) {
        const s = (yy - oy) * T - ox
        const d = yy * bw
        for (let xx = x0; xx < x1; xx++) {
          const v = data[s + xx]
          if (v) { field[d + xx] = IDX_DBZ[v]; hit = true }
        }
      }
    })
    if (!hit) return null // nothing falling anywhere near: the tile stays clear

    blur(field, bw, bh, kernel)

    // Bilinear samples of the blurred field at each screen pixel's centre, as
    // ramp indices (0 for clear). Positions are in field-array units, where
    // element k sits at k + 0.5.
    const out = new Uint8Array(W * H)
    let first = -1
    let last = -1

    const sx = span / W
    const sy = span / H
    const xi = new Int32Array(W)
    const xf = new Float32Array(W)
    for (let i = 0; i < W; i++) {
      const u = gx - bx + (i + 0.5) * sx - 0.5
      xi[i] = Math.floor(u)
      xf[i] = u - xi[i]
    }
    for (let j = 0; j < H; j++) {
      const v = gy - by + (j + 0.5) * sy - 0.5
      const y0 = Math.floor(v)
      const fy = v - y0
      const r0 = y0 * bw
      const o = j * W
      let any = false
      for (let i = 0; i < W; i++) {
        const k = r0 + xi[i]
        const fx = xf[i]
        const top = field[k] + (field[k + 1] - field[k]) * fx
        const bot = field[k + bw] + (field[k + bw + 1] - field[k + bw]) * fx
        const val = top + (bot - top) * fy
        if (val < MIN_DBZ) continue
        // Back to the nearest 0.5 dBZ index: round((val + 32) * 2) + 1.
        const idx = ((val + 32) * 2 + 1.5) | 0
        out[o + i] = idx > 255 ? 255 : idx
        any = true
      }
      if (any) {
        if (first < 0) first = j
        last = j
      }
    }
    if (first < 0) return null
    // Just the rows with something in them; slice copies them out, so the
    // full-size buffer can go.
    return { y0: first, rows: last - first + 1, data: out.slice(first * W, (last + 1) * W) }
  },
})
