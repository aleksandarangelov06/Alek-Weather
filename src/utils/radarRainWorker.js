// The radar's rain and snow overlay, drawn off the main thread.
//
// On the page it was two kinds of work competing with the map: a few times a
// second, the radar tiles drawn into a small canvas and read back (a GPU round
// trip, then a colour lookup per cell), and every frame, a field of up to a few
// thousand streaks built into paths and stroked. Here the overlay canvas itself
// lives in the worker (transferControlToOffscreen), so both happen beside the
// page: it only hands over shrunken copies of the tiles and the map's position.
//
// Messages in:
//   { type: 'init', canvas }                     the transferred overlay canvas
//   { type: 'resize', w, h, dpr }
//   { type: 'tiles', parts, mw, mh, ramp, origin, place, fb }
//       parts: [{ bmp, x, y, w, h }] tile copies (ImageBitmap) and where they
//       go on the mask, in mask cells. A new mask.
//   { type: 'clear' }                            no readable radar: no mask
//   { type: 'view', origin, zoom }               the map moved
//   { type: 'fallback', fb }
//   { type: 'run', on }                          start or stop the frame loop
// Messages out:
//   { type: 'echo', echo }  whether the last mask had anything falling in it
//   { type: 'tainted' }     the tiles can't be read back; stop sending them
import { createRain, classifyMask } from './radarRainCore'

let rain = null
let mctx = null
let origin = { x: 0, y: 0 }
let zoom = null
let running = false
let handle = 0

// Worker rAF where the browser has it (it follows the display, and stops with
// the page); a 60 Hz timer elsewhere.
const raf = self.requestAnimationFrame
  ? (cb) => self.requestAnimationFrame(cb)
  : (cb) => setTimeout(() => cb(performance.now()), 16)
const caf = self.cancelAnimationFrame ? (h) => self.cancelAnimationFrame(h) : clearTimeout

function loop(now) {
  if (!running) { handle = 0; return }
  handle = raf(loop)
  rain.frame(now, origin, zoom)
}

function buildMask({ parts, mw, mh, ramp, origin: at, place, fb }) {
  if (!mctx) {
    mctx = new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true })
  }
  const c = mctx.canvas
  if (c.width !== mw || c.height !== mh) { c.width = mw; c.height = mh }
  mctx.clearRect(0, 0, mw, mh)
  // Nearest-pixel sampling, so each cell reads one of the ramp's own colours
  // rather than a blend of neighbouring steps. Set every time: resizing the
  // canvas resets it.
  mctx.imageSmoothingEnabled = false
  for (const { bmp, x, y, w, h } of parts) {
    mctx.drawImage(bmp, x, y, w, h)
    bmp.close()
  }
  let px
  try {
    px = mctx.getImageData(0, 0, mw, mh).data
  } catch {
    // Cross-origin tiles without CORS: nothing that can be read, now or later.
    rain.clearMask()
    self.postMessage({ type: 'tainted' })
    return
  }
  const m = classifyMask(px, mw, mh, ramp, place, fb)
  rain.setMask({ mask: m.mask, kind: m.kind, wet: m.wet, mw, mh }, at)
  self.postMessage({ type: 'echo', echo: m.echo })
}

self.onmessage = ({ data: msg }) => {
  switch (msg.type) {
    case 'init':
      rain = createRain(msg.canvas.getContext('2d'))
      break
    case 'resize':
      rain?.resize(msg.w, msg.h, msg.dpr)
      break
    case 'tiles':
      if (rain) buildMask(msg)
      else msg.parts.forEach((p) => p.bmp.close())
      break
    case 'clear':
      rain?.clearMask()
      break
    case 'view':
      origin = msg.origin
      zoom = msg.zoom
      break
    case 'fallback':
      rain?.setFallback(msg.fb)
      break
    case 'run':
      if (!rain) break
      if (msg.on && !running) {
        running = true
        rain.reset()
        handle = raf(loop)
      } else if (!msg.on && running) {
        running = false
        caf(handle)
        handle = 0
      }
      break
  }
}
