// The pixel work behind HrrrLayer, with no DOM in it, so it runs the same on
// the page and in the tile worker (hrrrWorker.js): reading a source tile's
// colours back to ramp indices, and turning a patch of those into a screen
// tile's smoothed field. The why of all of it is in hrrrLayer.js.

export const T = 256 // source and screen tile size, CSS px

// What "no echo" counts as while blurring. Under the faintest value IEM writes
// (-9 dBZ; anything weaker it drops), so an echo's edge fades out where it was
// instead of being dragged towards -32 and drawn as a wide faint halo.
export const NODATA_DBZ = -20
export const MIN_DBZ = -9.25 // weaker than this, a pixel is left clear

// IEM's N0Q ramp, index 0 to 255, as RRGGBB. Read off the palette of the HRRR
// rasters (data/gis/images/4326/hrrr/refd_*.png); the tiles reproduce it exactly.
export const IEM_RAMP =
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

export const idxToDbz = (i) => (i - 1) * 0.5 - 32

// RainViewer's "Universal Blue", the ramp its free tier draws with, as RRGGBBAA
// for each whole dBZ from RV_MIN to 65 (rainviewer_api_colors_table.csv). The
// weak end is the translucent beige it draws drizzle and haze in; anything
// stronger than 65 stays white.
export const RV_MIN = -10
export const RV_RAMP =
  '6361591466635a1969665c1e6c685d246f6b5f29726e612e75706234787364397c75653e7f786744827b6949857d6a4e' +
  '88806c548b826d598e856f5e928871649e93756eaa9e7978b6a97e82c2b4828ccec08796d2c48ba0d6c88faadacc93b4' +
  'ded097be88ddeeff6cd1ebff51c5e8ff36bae5ff1baee2ff00a3e0ff009ad5ff0091caff0088bfff007fb4ff0077aaff' +
  '0070a3ff00699cff006295ff005b8eff005588ff005180ff004e78ff004a70ff004768ffffee00ffffe000ffffd200ff' +
  'ffc500ffffb700ffffaa00ffff9f00ffff9500ffff8b00ffff8100ffff4400fff23600ffe62800ffd91b00ffcd0d00ff' +
  'c10000ffa80000ff8f0000ff760000ff5d0000ffffaaffffff9fffffff95ffffff8bffffff81ffffff77ffffff6cffff' +
  'ff62ffffff58ffffff4effffffffffff'

const byte = (s, at) => parseInt(s.slice(at, at + 2), 16)

export const IEM_RGB = Array.from({ length: 256 }, (_, i) => parseInt(IEM_RAMP.slice(i * 6, i * 6 + 6), 16))
const RGB_TO_IDX = new Map(IEM_RGB.map((c, i) => [c, i]))

// Index (0.5 dBZ steps) -> dBZ, with "nothing" standing in as NODATA_DBZ.
const IDX_DBZ = new Float32Array(256)
for (let i = 0; i < 256; i++) IDX_DBZ[i] = i === 0 ? NODATA_DBZ : idxToDbz(i)

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

// A source tile's RGBA pixels (T x T) as ramp indices, one byte a pixel, or
// null if nothing in it is falling (most of the map, most of the time; it keeps
// the cache small).
export function decodePixels(px) {
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

export function gaussian(sigma) {
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

// The tile's field, as ramp indices for the rows that have anything in them:
// { y0, rows, data }, or null when nothing is falling anywhere near.
// `sources` are the decoded source tiles the patch overlaps, as { tx, ty, data }
// (data null for a clear or missing one).
export function renderField({ gx, gy, span, bx, by, bw, bh, kernel }, sources, W, H) {
  const field = new Float32Array(bw * bh).fill(NODATA_DBZ)
  let hit = false
  for (const { tx, ty, data } of sources) {
    if (!data) continue
    const ox = tx * T - bx
    const oy = ty * T - by
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
  }
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
