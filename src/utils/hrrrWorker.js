// HrrrLayer's tile drawing, off the main thread.
//
// Drawing a smoothed radar tile is several milliseconds of pure arithmetic per
// tile (decode the source colours, blur the field, resample it), and opening
// the phone's full-screen radar asks for a whole screen of new tiles at once.
// On the page that work was sliced into 6 ms turns, but a 6 ms slice still eats
// most of a 120 Hz frame, so it competed with the very animation it was
// trying to stay out of. Here it runs beside the page instead, and the page
// only colours the finished tile (see paint in hrrrLayer.js).
//
// Messages in:
//   { type: 'render', id, layer, geom, want, W, H }
//       want: [{ tx, ty, key, url }] source tiles the patch overlaps; a
//       missing url is a row off the map's edge, read as clear.
//   { type: 'cancel', id }    the tile left the map; drop it unanswered.
//   { type: 'focus', layer }  the layer on screen; its tiles go first.
// Messages out:
//   { id, rec, complete }  rec as renderField returns it (data transferred)
//   { id, error }          every source tile failed
import { T, decodePixels, renderField } from './hrrrCore'

// Decoded source tiles, shared by every layer, most-recently-used last. The
// same budget the page kept (see sourceTile in hrrrLayer.js).
const SRC_CACHE_MAX = 192
const srcCache = new Map()

let ctx = null
function scratch() {
  if (!ctx) {
    ctx = new OffscreenCanvas(T, T).getContext('2d', { willReadFrequently: true })
    ctx.imageSmoothingEnabled = false
  }
  return ctx
}

async function fetchSource(url) {
  const res = await fetch(url, { mode: 'cors', credentials: 'omit' })
  if (!res.ok) throw new Error(`Radar source tile ${res.status}`)
  // No colour management: the colours are data (each one is a reflectivity),
  // and any conversion would move them off the ramp.
  const bmp = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none' })
  const c = scratch()
  c.clearRect(0, 0, T, T)
  c.drawImage(bmp, 0, 0, T, T)
  bmp.close()
  return decodePixels(c.getImageData(0, 0, T, T).data)
}

function sourceTile(key, url) {
  let p = srcCache.get(key)
  if (p) {
    srcCache.delete(key)
    srcCache.set(key, p)
    return p
  }
  p = fetchSource(url)
  // A failure isn't remembered: the next tile to want it tries again.
  p.catch(() => { if (srcCache.get(key) === p) srcCache.delete(key) })
  srcCache.set(key, p)
  if (srcCache.size > SRC_CACHE_MAX) srcCache.delete(srcCache.keys().next().value)
  return p
}

// Jobs by id while their sources load, and the ones ready to draw. Drawn one
// per task, so a cancel or a change of focus that arrives meanwhile is seen
// before the next one starts.
const live = new Map()
const ready = []
let focus = null
let pumping = false
const tick = new MessageChannel()

function pump() {
  pumping = false
  let i = ready.findIndex((j) => j.layer === focus)
  if (i < 0) i = 0
  const job = ready.splice(i, 1)[0]
  if (job && live.has(job.id)) {
    live.delete(job.id)
    try {
      const rec = renderField(job.geom, job.sources, job.W, job.H)
      self.postMessage({ id: job.id, rec, complete: job.complete }, rec ? [rec.data.buffer] : [])
    } catch (err) {
      self.postMessage({ id: job.id, error: String(err?.message ?? err) })
    }
  }
  schedule()
}
tick.port1.onmessage = pump

function schedule() {
  if (pumping || ready.length === 0) return
  pumping = true
  tick.port2.postMessage(null)
}

async function render({ id, layer, geom, want, W, H }) {
  live.set(id, true)
  const got = await Promise.allSettled(
    want.map((w) => (w.url ? sourceTile(w.key, w.url) : Promise.resolve(null))),
  )
  if (!live.has(id)) return // cancelled while its sources loaded
  // Only a total loss is an error. A missing neighbour costs a sliver of
  // margin, which is better drawn as clear than not drawn at all.
  if (got.every((g) => g.status === 'rejected')) {
    live.delete(id)
    self.postMessage({ id, error: 'Radar source tiles unavailable' })
    return
  }
  const sources = got.map((g, i) => ({
    tx: want[i].tx, ty: want[i].ty, data: g.status === 'fulfilled' ? g.value : null,
  }))
  const complete = got.every((g) => g.status === 'fulfilled')
  ready.push({ id, layer, geom, sources, complete, W, H })
  schedule()
}

self.onmessage = ({ data: msg }) => {
  if (msg.type === 'render') render(msg)
  else if (msg.type === 'cancel') live.delete(msg.id)
  else if (msg.type === 'focus') focus = msg.layer
}
