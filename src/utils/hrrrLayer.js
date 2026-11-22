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
    img.onerror = () => reject(new Error('HRRR source tile failed to load'))
    img.src = url
  })
  // A failure isn't remembered: the next screen tile to want it tries again.
  p.catch(() => { if (srcCache.get(key) === p) srcCache.delete(key) })
  srcCache.set(key, p)
  if (srcCache.size > SRC_CACHE_MAX) srcCache.delete(srcCache.keys().next().value)
  return p
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
// Tiles are canvases, drawn at the screen's pixel density (capped at 2x) and
// at every zoom the map goes to, since the smoothing is what makes zooming in
// worth it. RadarRain and the card's still both read canvas tiles as well as
// image ones.
export const HrrrLayer = L.GridLayer.extend({
  options: { palette: 'nws', run: '' },

  initialize(url, options) {
    this._url = url
    L.GridLayer.prototype.initialize.call(this, options)
  },

  createTile(coords, done) {
    const tile = L.DomUtil.create('canvas', 'leaflet-tile')
    const size = this.getTileSize()
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    tile.width = Math.round(size.x * dpr)
    tile.height = Math.round(size.y * dpr)
    this._draw(tile, coords).then(() => done(null, tile), (err) => done(err, tile))
    return tile
  },

  async _draw(tile, { x, y, z }) {
    // Everything below is in source pixels at zoom sz: the global pixel grid
    // that zoom's tiles tile.
    const sz = Math.min(z, SRC_MAX_ZOOM)
    const n = 2 ** sz
    const span = T / 2 ** (z - sz) // this screen tile's width
    const gx = x * span
    const gy = y * span

    // The blur is set in km, so it needs the size of a source pixel here.
    const lat = Math.atan(Math.sinh(Math.PI * (1 - (2 * (gy + span / 2)) / (T * n))))
    const pxKm = (40075.017 * Math.cos(lat)) / (T * n)
    const kernel = gaussian(Math.max(MIN_BLUR_PX, BLUR_KM / pxKm))

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
        const url = L.Util.template(this._url, { z: sz, x: ((tx % n) + n) % n, y: ty })
        want.push({ tx, ty, p: sourceTile(`${this.options.run}|${url}`, url) })
      }
    }
    const got = await Promise.allSettled(want.map((w) => w.p))
    // Only a total loss is an error. A missing neighbour costs a sliver of
    // margin, which is better drawn as clear than not drawn at all.
    if (got.every((g) => g.status === 'rejected')) throw new Error('HRRR tiles unavailable')

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
    if (!hit) return // nothing falling anywhere near: the tile stays clear

    blur(field, bw, bh, kernel)

    // Bilinear samples of the blurred field at each screen pixel's centre.
    // Positions are in field-array units, where element k sits at k + 0.5.
    const W = tile.width
    const H = tile.height
    const ctx = tile.getContext('2d')
    const img = ctx.createImageData(W, H)
    const out = new Uint32Array(img.data.buffer)
    const lut = LUTS[this.options.palette] ?? LUTS.nws

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
      for (let i = 0; i < W; i++) {
        const k = r0 + xi[i]
        const fx = xf[i]
        const top = field[k] + (field[k + 1] - field[k]) * fx
        const bot = field[k + bw] + (field[k + bw + 1] - field[k + bw]) * fx
        const val = top + (bot - top) * fy
        if (val < MIN_DBZ) continue
        // Back to the nearest 0.5 dBZ index: round((val + 32) * 2) + 1.
        const idx = ((val + 32) * 2 + 1.5) | 0
        out[o + i] = lut[idx > 255 ? 255 : idx]
      }
    }
    ctx.putImageData(img, 0, 0)
  },
})
