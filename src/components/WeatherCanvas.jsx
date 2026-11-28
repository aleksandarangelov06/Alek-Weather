import { memo, useEffect, useRef } from 'react'
import { LOW_END } from '../utils/device'
import { sceneFor } from '../utils/weatherScene'

// Speeds in CFG are px per frame at this frame length: 74 Hz, the screen the
// radar's rain (RadarRain) was tuned on, so the two rain layers on the web Radar
// tab fall at the same rate. Each drawn frame moves by the time it actually
// took, so the motion is the same at any refresh rate; it used to be per
// display frame, which ran the weather twice as fast on a 120 Hz phone.
const REF_FRAME_MS = 1000 / 74
// Capped so the first frame after a pause doesn't teleport every particle.
const MAX_STEP = 3
// How often a frame is drawn, at most: every display frame up to this rate, and
// on faster screens every second (or third…) one, which keeps the cadence even.
// Drawing more often shows nothing new, and each frame also has the browser
// redo the backdrop blur of every glass card over the sky. Low-end hardware
// gets half (see LOW_END).
const TARGET_FPS = LOW_END ? 30 : 60

const isCloudScene = (scene) => scene === 'overcast' || scene === 'partly'

const CFG = {
  // `angle` is the rest fall angle (deg from vertical). Rain falls straight down
  // when the phone is level; the gyroscope tilt is what leans it. Storms keep a
  // slight wind-driven lean at rest.
  rain:     { count: 140, color: [90, 130, 190],  alpha: 0.55, speed: [5, 10],  angle: 0,  len: [12, 22] },
  // Heavy rain / violent showers: storm-level density and speed, but no
  // lightning and only a modest rest lean — it's a downpour, not a tempest.
  downpour: { count: 340, color: [80, 120, 185],  alpha: 0.65, speed: [14, 22], angle: 6,  len: [16, 30] },
  storm:    { count: 325, color: [70, 110, 175],  alpha: 0.70, speed: [15, 24], angle: 12, len: [16, 32] },
  snow:  { count: 70,  color: [180, 210, 240], alpha: 0.75, speed: [0.5, 1.6] },
  // Fog: long, low banks of mist at three depths, drifting slowly sideways and
  // thickening and thinning as they go. Drawn the way the clouds are (soft
  // sprites built once, then moved) so the two read as the same sky, but
  // flatter, wider and greyer, and weighted toward the ground, where fog sits:
  // the far banks are thin and high, the near ones thick and low. `y` is where
  // a bank's middle can sit, as a fraction of the height; `width` is a
  // multiple of the screen's, capped at `maxWidth`; `breathe` is how long
  // (ms) one thicken-and-thin takes.
  fog: {
    color: [232, 236, 240],
    layers: [
      { count: 4, y: [0.18, 0.55], height: [70, 120],  alpha: [0.10, 0.16], speed: [0.05, 0.11] },
      { count: 4, y: [0.42, 0.82], height: [110, 170], alpha: [0.14, 0.22], speed: [0.09, 0.18] },
      { count: 3, y: [0.68, 1.02], height: [150, 240], alpha: [0.18, 0.28], speed: [0.16, 0.30] },
    ],
    width: [1.0, 1.9],
    maxWidth: 1600,
    breathe: [14000, 26000],
  },
  // Cloudy skies: a few soft white clouds drifting slowly across, kept faint so
  // they read as depth in the sky rather than as objects on it. Overcast gets a
  // few more and a touch more presence than partly cloudy.
  overcast: { count: 7, alpha: [0.10, 0.20], speed: [0.12, 0.32], width: [320, 620] },
  partly:   { count: 4, alpha: [0.10, 0.18], speed: [0.10, 0.26], width: [260, 480] },
}

// One cloud, drawn once into its own canvas and then just moved each frame:
// a row of overlapping soft puffs (radial gradients that fade to nothing at the
// edge), biggest in the middle, with a flatter base. No outlines, so overlapping
// clouds blend rather than stack edges.
function makeCloudSprite(width, rand, alpha) {
  // Lay the puffs out first, then size the canvas to fit every one of them.
  // A fixed-size canvas cut off any puff that reached past it, and a soft
  // gradient sliced by the canvas edge is a hard straight line — the rough
  // edges the clouds sometimes had.
  const n = Math.round(rand(5, 8))
  const puffs = []
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1)
    // Taller in the middle, lower at the ends, with a little irregularity.
    const hump = Math.sin(t * Math.PI)
    puffs.push({
      r: width * (0.13 + 0.12 * hump) * rand(0.85, 1.15),
      x: width * (0.14 + 0.72 * t) + rand(-0.03, 0.03) * width,
      y: -hump * width * 0.08 + rand(-0.02, 0.02) * width,
    })
  }
  const pad = 2
  const minX = Math.min(...puffs.map(p => p.x - p.r)) - pad
  const maxX = Math.max(...puffs.map(p => p.x + p.r)) + pad
  const minY = Math.min(...puffs.map(p => p.y - p.r)) - pad
  const maxY = Math.max(...puffs.map(p => p.y + p.r)) + pad

  const c = document.createElement('canvas')
  c.width = Math.ceil(maxX - minX)
  c.height = Math.ceil(maxY - minY)
  const g = c.getContext('2d')
  for (const { x, y, r } of puffs) {
    const cx = x - minX, cy = y - minY
    // Eased falloff: dense in the middle, then a long, gentle fade to nothing,
    // so no ring shows where one stop hands over to the next.
    const grad = g.createRadialGradient(cx, cy, 0, cx, cy, r)
    grad.addColorStop(0, 'rgba(255,255,255,0.85)')
    grad.addColorStop(0.35, 'rgba(255,255,255,0.65)')
    grad.addColorStop(0.65, 'rgba(255,255,255,0.28)')
    grad.addColorStop(0.85, 'rgba(255,255,255,0.08)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grad
    g.fillRect(cx - r, cy - r, r * 2, r * 2)
  }

  // Bake the cloud's faintness in here, dithered, instead of applying it with
  // globalAlpha on every frame. At 10–20% opacity a fade from white to nothing
  // only has ~30 of the canvas's 256 alpha levels to cover a few hundred
  // pixels, so it came out as visible stripes with hard edges between them —
  // banding. Rounding each pixel up or down at random, weighted by how close it
  // is to the next level, turns those steps into an even fine grain the eye
  // averages back into a smooth fade.
  const img = g.getImageData(0, 0, c.width, c.height)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3]
    if (a === 0) continue
    d[i] = d[i + 1] = d[i + 2] = 255
    d[i + 3] = Math.floor(a * alpha + Math.random())
  }
  g.putImageData(img, 0, 0)
  return c
}

// Fog banks are built at this fraction of their size and drawn scaled back up.
// They are nothing but soft falloff, so the lost detail doesn't show, and it
// quarters the pixels the dither pass below has to walk when the scene starts.
const FOG_SCALE = 2

// One fog bank, drawn once into its own canvas: soft elliptical puffs strung
// along a line, each two or three times wider than it is tall, so the bank is
// long and flat rather than heaped like a cloud. Thickest in the middle and
// thinning toward both ends, which trail off into nothing instead of stopping.
// Puffs overlap four or five deep, so the body is an even veil with a little
// lumpiness, not a row of blobs.
function makeFogSprite(width, height, rand, alpha, [r, g, b]) {
  const n = Math.max(6, Math.round(width / (height * 0.45)))
  const puffs = []
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1)
    const body = Math.pow(Math.sin(t * Math.PI), 0.6) // 0 at the ends, 1 mid-bank
    const ry = height * (0.28 + 0.24 * body) * rand(0.8, 1.2)
    puffs.push({
      x: width * t + rand(-0.02, 0.02) * width,
      y: rand(-0.1, 0.1) * height,
      rx: ry * rand(1.8, 2.6),
      ry,
      weight: 0.35 + 0.65 * body,
    })
  }
  const pad = 2
  const minX = Math.min(...puffs.map(p => p.x - p.rx)) - pad
  const maxX = Math.max(...puffs.map(p => p.x + p.rx)) + pad
  const minY = Math.min(...puffs.map(p => p.y - p.ry)) - pad
  const maxY = Math.max(...puffs.map(p => p.y + p.ry)) + pad

  const c = document.createElement('canvas')
  c.width = Math.ceil(maxX - minX)
  c.height = Math.ceil(maxY - minY)
  const ctx = c.getContext('2d')
  for (const { x, y, rx, ry, weight } of puffs) {
    // A round gradient squashed flat: drawn in a space scaled down vertically,
    // so its circle lands as an ellipse rx wide and ry tall.
    ctx.save()
    ctx.translate(x - minX, y - minY)
    ctx.scale(1, ry / rx)
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, rx)
    grad.addColorStop(0, `rgba(255,255,255,${0.3 * weight})`)
    grad.addColorStop(0.45, `rgba(255,255,255,${0.18 * weight})`)
    grad.addColorStop(0.75, `rgba(255,255,255,${0.06 * weight})`)
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = grad
    ctx.fillRect(-rx, -rx, rx * 2, rx * 2)
    ctx.restore()
  }

  // The same dithered bake as the clouds (see makeCloudSprite): the bank's
  // faintness goes into the pixels with each one rounded up or down at random,
  // so the long fade at these low opacities comes out as fine grain rather
  // than bands. Recoloured to the fog's grey on the way.
  const img = ctx.getImageData(0, 0, c.width, c.height)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3]
    if (a === 0) continue
    d[i] = r; d[i + 1] = g; d[i + 2] = b
    d[i + 3] = Math.floor(a * alpha + Math.random())
  }
  ctx.putImageData(img, 0, 0)
  return c
}

// How far (deg) we let the gyroscope lean the weather, and how strongly. The
// clamp keeps a hard tilt from throwing every particle off-screen sideways.
const TILT_CLAMP = 35
const TILT_GAIN  = 0.8

// How many distinct opacity steps a scene's particles are drawn at.
//
// Every particle used to carry its own random alpha, which meant its own
// fillStyle/strokeStyle, which meant its own beginPath and its own draw — 325
// canvas draw calls per frame in a storm, ~19,500 a second, each one a state
// change the compositor cannot batch. Rounding to a few steps is invisible (the
// values were random inside one narrow band to begin with) and lets a whole step
// be drawn as a single path.
//
// The rounding is applied to the 0.4–1 *variation factor* rather than to the
// finished alpha, so every scene gets the same number of steps no matter how
// faint it is. Quantising the product instead would have flattened fog — whose
// alphas all sit between 0.07 and 0.18 — onto one step, erasing the depth that
// makes it read as layered cloud rather than a flat grey wash.
const ALPHA_STEPS = 6
const quantFactor = (v) => Math.round(v * ALPHA_STEPS) / ALPHA_STEPS

// Memoised: App re-renders for every overlay, toggle and keystroke, and none of
// that concerns the sky unless the code or the gyro setting changes.
//
// `hold` stops the drawing and fades the canvas out, leaving the plain sky,
// while a forecast loads on the phone (App passes `loading`). The loading
// animation plays over the sky then, and every frame drawn here was main-thread
// work during the fetch and a full recomposite behind that animation, which is
// what made it stutter. Read through a ref so holding and releasing never
// rebuilds the particle field: the weather picks up where it left off.
export const WeatherCanvas = memo(function WeatherCanvas({ code, gyro = true, hold = false }) {
  const scene = sceneFor(code)
  const ref = useRef(null)
  const holdRef = useRef(hold)
  useEffect(() => { holdRef.current = hold }, [hold])
  // Tilt in radians: `target` is set by the gyroscope listener, `cur` eases
  // toward it each frame so the lean glides instead of snapping. A ref (not
  // state) so updates never re-render or rebuild the particle field.
  const tilt = useRef({ target: 0, cur: 0 })

  // Gyroscope listener lives in its own effect so toggling it — or losing the
  // sensor — doesn't tear down and re-seed the animation. When off, target
  // returns to 0 and the draw loop eases the weather back to its rest angle.
  useEffect(() => {
    // The tilt object itself never changes (only its fields do), so one read is
    // the same object the cleanup below has to reset.
    const t = tilt.current
    t.target = 0
    if (!scene || !gyro || typeof window.DeviceOrientationEvent === 'undefined') return

    const onOrient = (e) => {
      // gamma is left-right tilt in portrait; in landscape that axis becomes
      // beta, and the sign flips depending on which way the phone was turned.
      const landscape = Math.abs(window.orientation ?? 0) === 90
      let deg = landscape ? (e.beta ?? 0) : (e.gamma ?? 0)
      if (landscape && window.orientation === -90) deg = -deg
      if (deg == null || Number.isNaN(deg)) return
      const clamped = Math.max(-TILT_CLAMP, Math.min(TILT_CLAMP, deg))
      t.target = clamped * Math.PI / 180 * TILT_GAIN
    }
    window.addEventListener('deviceorientation', onOrient)
    return () => {
      window.removeEventListener('deviceorientation', onOrient)
      t.target = 0
    }
  }, [scene, gyro])

  useEffect(() => {
    if (!scene) return
    const canvas = ref.current
    const ctx = canvas.getContext('2d')
    const cfg = CFG[scene]
    let raf, flash = 0
    // Drawn time (ms) for the fog's breathing; advances with the frames drawn,
    // so it pauses with them.
    let fogClock = 0
    // Frames until the header's position is read again (see mirrorToHeader).
    let measureIn = 0

    const resize = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
      measureIn = 0
    }
    resize()
    window.addEventListener('resize', resize)

    const rand = (a, b) => a + Math.random() * (b - a)
    const W = () => canvas.width
    const H = () => canvas.height

    const angleRad = (cfg.angle ?? 0) * Math.PI / 180

    // Reduced motion: the clouds are still drawn, they just hold still.
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let particles
    if (isCloudScene(scene)) {
      // Spread across the width with a little jitter so they don't arrive in a
      // clump, and kept to the upper two thirds of the screen, where a sky is.
      particles = Array.from({ length: cfg.count }, (_, i) => {
        const w = rand(cfg.width[0], cfg.width[1])
        // Bigger clouds read as nearer: a little faster and a little brighter.
        const near = (w - cfg.width[0]) / (cfg.width[1] - cfg.width[0])
        const alpha = cfg.alpha[0] + (cfg.alpha[1] - cfg.alpha[0]) * (0.5 * Math.random() + 0.5 * near)
        return {
          // The opacity is baked into the sprite (dithered — see makeCloudSprite).
          sprite: makeCloudSprite(Math.round(w), rand, alpha),
          x: ((i + rand(0, 0.8)) / cfg.count) * (W() + w) - w,
          y: rand(-0.12, 0.6) * H(),
          spd: still ? 0 : cfg.speed[0] + (cfg.speed[1] - cfg.speed[0]) * (0.4 * Math.random() + 0.6 * near),
          alpha,
        }
      })
      // Far clouds first, so nearer ones pass over them.
      particles.sort((a, b) => a.sprite.width - b.sprite.width)
    } else if (scene === 'rain' || scene === 'downpour' || scene === 'storm') {
      // Direction (vx/vy) is derived per-frame from the base angle + live tilt,
      // so it isn't stored on the particle — only its speed and length are.
      // Seeded across the whole screen; the draw loop refills from the correct
      // inflow edges so coverage stays gap-free at any lean (see respawn below).
      particles = Array.from({ length: cfg.count }, () => ({
        x: rand(0, W()), y: rand(0, H()),
        len: rand(cfg.len[0], cfg.len[1]),
        spd: rand(cfg.speed[0], cfg.speed[1]),
        alpha: quantFactor(rand(0.4, 1)) * cfg.alpha,
      }))
    } else if (scene === 'snow') {
      particles = Array.from({ length: cfg.count }, () => ({
        x: rand(0, W()), y: rand(0, H()),
        r: rand(2, 5), vy: rand(cfg.speed[0], cfg.speed[1]),
        drift: rand(0, Math.PI * 2), ds: rand(0.004, 0.012),
        alpha: quantFactor(rand(0.4, 1)) * cfg.alpha,
      }))
    } else {
      // Fog. Built far to near, so nearer banks are drawn over the far ones,
      // and spread across the width so the screen starts covered rather than
      // waiting for banks to drift in. Low-end hardware gets a bank fewer per
      // depth.
      particles = []
      cfg.layers.forEach((layer) => {
        const count = Math.max(2, layer.count - (LOW_END ? 1 : 0))
        for (let i = 0; i < count; i++) {
          const w = Math.min(cfg.maxWidth, W() * rand(cfg.width[0], cfg.width[1]))
          const h = rand(layer.height[0], layer.height[1])
          const sprite = makeFogSprite(w / FOG_SCALE, h / FOG_SCALE, rand, rand(layer.alpha[0], layer.alpha[1]), cfg.color)
          const dw = sprite.width * FOG_SCALE
          const dh = sprite.height * FOG_SCALE
          particles.push({
            sprite, dw, dh, layer,
            x: ((i + rand(0, 0.8)) / count) * (W() + dw) - dw,
            cy: rand(layer.y[0], layer.y[1]),
            spd: still ? 0 : rand(layer.speed[0], layer.speed[1]),
            // Each bank thickens and thins on its own slow cycle, out of step
            // with the others, so the fog shifts without anything pulsing.
            phase: rand(0, Math.PI * 2),
            period: rand(cfg.breathe[0], cfg.breathe[1]),
          })
        }
      })
    }

    const [r, g, b] = cfg.color ?? [255, 255, 255]

    // Particles grouped by their quantised alpha, so a frame walks each bucket
    // once and issues a single draw for it. Built once — alpha never changes, and
    // the entries hold the same particle objects, so the draw loop still moves the
    // originals.
    const byAlpha = new Map()
    for (const p of particles) {
      const bucket = byAlpha.get(p.alpha)
      if (bucket) bucket.push(p)
      else byAlpha.set(p.alpha, [p])
    }
    const buckets = [...byAlpha].map(([alpha, ps]) => ({
      style: `rgba(${r},${g},${b},${alpha})`, ps,
    }))

    // Paused while something opaque covers the whole screen: the settled
    // settings page on a phone (not while its transparency thumb is held, which
    // clears the page to show the sky), or the radar once it has finished going
    // full-screen. Drawing under those was pure cost — and worse than its own
    // draw calls, because every frame of moving sky also made the browser redo
    // each glass card's backdrop blur. Checked every few frames rather than per
    // frame; the loop keeps ticking so it resumes on its own.
    //
    // Also held while the radar's window is opening or closing (.radar-iris--on,
    // from the tap through to the window landing, and again on the way out).
    // The sky is only seen around the window then, under a scrim fading in, so
    // holding it still for those few hundred ms doesn't show; drawing it made
    // every glass card behind the window re-blur on each frame of exactly the
    // animation that has to be smooth. The check runs every few frames so the
    // hold lands while the tap is still being armed (see ARM_TILE_WAIT_MS in
    // WeatherRadar), before the window starts to move.
    let covered = false, coverCheckIn = 0
    const COVER_SEL =
      ':root[data-shell="mobile"] .settings-page.settled:not(.peeking):not(.settings-page--modal),' +
      ' .radar-iris:not(.radar-iris--on) > .radar-iris-circle .radar-expanded,' +
      ' .radar-iris--on'

    // Frame pacing (see TARGET_FPS): the display's frame length is measured off
    // the callbacks themselves, smoothed, and a frame drawn every `stride` of
    // them. `k` is how many REF_FRAME_MS the drawn frame covers, and scales
    // every per-frame step below.
    let displayMs = 1000 / 60
    let lastTick = 0, lastDraw = 0, ticks = 0

    // A clearing in the falling rain and snow around the big weather icon: the
    // home screen's (the splash's icon, in place of the logo) or the
    // forecast's (the current-weather card's). The sky is drawn under the app,
    // so it never covers the icon, but its flakes and drops drifting right up
    // to and past the icon read as falling in front of it. Erased with a
    // soft-edged circle after each frame's precipitation is drawn (one
    // gradient fill), so they thin out and vanish as they near it. The boxes
    // are measured a few times a second and after a scroll or resize (see
    // remeasure), not per frame.
    // In order of preference: the splash, while it is up, before the forecast
    // kept under it (which may only be faded out, and so still have a box).
    const ICON_SELS = [
      '.splash-logo-icon :is(.weather-icon, .weather-icon-line)',
      '.current-card .current-icon :is(.weather-icon, .weather-icon-line)',
    ]
    let iconIn = 0, iconBox = null, canvasBox = null
    function clearAroundIcon() {
      if (iconIn-- <= 0) {
        iconIn = 15
        iconBox = null
        for (const sel of ICON_SELS) {
          const b = document.querySelector(sel)?.getBoundingClientRect()
          if (b && b.width > 0 && b.height > 0 && b.bottom > 0 && b.top < window.innerHeight) { iconBox = b; break }
        }
        // Where this canvas actually is on screen, rather than assumed to be
        // the window's top-left: the splash's canvas sits inside the splash
        // layer, and anything that offsets it (or the page's zoom) would put
        // the clearing beside the icon instead of on it.
        canvasBox = canvas.getBoundingClientRect()
      }
      if (!iconBox || !canvasBox?.width || !canvasBox?.height) return
      // From screen pixels into this canvas's own pixels.
      const sx = canvas.width / canvasBox.width
      const sy = canvas.height / canvasBox.height
      const cx = (iconBox.left + iconBox.width / 2 - canvasBox.left) * sx
      const cy = (iconBox.top + iconBox.height / 2 - canvasBox.top) * sy
      const rad = Math.max(iconBox.width * sx, iconBox.height * sy) * 0.75
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad)
      g.addColorStop(0, 'rgba(0,0,0,1)')
      g.addColorStop(0.7, 'rgba(0,0,0,1)')
      g.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.globalCompositeOperation = 'destination-out'
      ctx.fillStyle = g
      ctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2)
      ctx.globalCompositeOperation = 'source-over'
    }

    function draw(now) {
      raf = requestAnimationFrame(draw)
      if (lastTick) {
        const dt = now - lastTick
        if (dt > 0 && dt < 50) displayMs += (dt - displayMs) * 0.1
      }
      lastTick = now
      const stride = Math.max(1, Math.floor(1000 / displayMs / TARGET_FPS + 0.1))
      if (++ticks % stride) return

      if (coverCheckIn-- <= 0) {
        coverCheckIn = 4
        covered = !!document.querySelector(COVER_SEL)
      }
      // Also held while the launch boot screen is up or fading out (data-boot,
      // see main.jsx / App.jsx): nothing drawn under it shows, and the fade
      // stays smoother with a still sky beneath it, since every frame of
      // moving sky has each glass card redo its backdrop blur. The canvas then
      // fades in as it starts (see .weather-canvas in App.css).
      // Restarting from k = 1 once uncovered, rather than catching up the
      // time spent paused.
      if (covered || holdRef.current || document.documentElement.dataset.boot) { lastDraw = 0; return }
      const k = lastDraw ? Math.min(MAX_STEP, (now - lastDraw) / REF_FRAME_MS) : 1
      lastDraw = now
      ctx.clearRect(0, 0, W(), H())

      // Ease the tilt toward its target once per frame; every scene reads this.
      const t = tilt.current
      t.cur += (t.target - t.cur) * (1 - Math.pow(1 - 0.08, k))
      const windX = Math.sin(t.cur) // sideways push from the current lean

      if (scene === 'storm') {
        if (flash > 0) {
          ctx.fillStyle = `rgba(255,255,255,${flash * 0.12})`
          ctx.fillRect(0, 0, W(), H())
          flash -= 0.05 * k
        } else if (Math.random() < 0.003 * k) {
          flash = 1
        }
      }

      if (isCloudScene(scene)) {
        // Drift left to right; the tilt nudges them, gently. A cloud that has
        // fully left the right edge comes back in from the left at a new height.
        for (const p of particles) {
          p.x += (p.spd + (still ? 0 : windX * 0.4)) * k
          const w = p.sprite.width
          if (p.x > W() + 20) { p.x = -w - rand(0, 120); p.y = rand(-0.12, 0.6) * H() }
          else if (p.x < -w - 140) p.x = W()
          // Whole pixels only: a fractional position resamples the sprite, which
          // smears the dither grain back into the bands it is there to hide.
          ctx.drawImage(p.sprite, Math.round(p.x), Math.round(p.y))
        }
      } else if (scene === 'rain' || scene === 'downpour' || scene === 'storm') {
        // Whole sheet leans with the phone: one shared direction from the base
        // fall angle plus the live tilt.
        const a = angleRad + t.cur
        const vx = Math.sin(a), vy = Math.cos(a)
        // A leaning sheet is fed by two edges: the top and the upwind side. Refill
        // exited drops across both in proportion to each edge's inflow width (its
        // flux), so density stays uniform and no corner goes dry at any lean. With
        // no lean (vx≈0) the side flux vanishes and it's plain top-down rain.
        const topFlux = W() * vy
        const sideFlux = H() * Math.abs(vx)
        const respawn = (p) => {
          if (Math.random() * (topFlux + sideFlux) < topFlux) {
            p.y = -20; p.x = rand(0, W())          // enter from the top
          } else {
            p.y = rand(-20, H()); p.x = vx >= 0 ? -20 : W() + 20  // from the upwind side
          }
        }
        ctx.lineWidth = 1.5
        for (const { style, ps } of buckets) {
          ctx.beginPath()
          for (const p of ps) {
            p.x += vx * p.spd * k; p.y += vy * p.spd * k
            // Refill once a drop leaves the bottom or slides off the downwind side.
            if (p.y > H() + 20 || p.x < -40 || p.x > W() + 40) respawn(p)
            ctx.moveTo(p.x, p.y)
            ctx.lineTo(p.x - vx * p.len, p.y - vy * p.len)
          }
          ctx.strokeStyle = style
          ctx.stroke()
        }
        clearAroundIcon()
      } else if (scene === 'snow') {
        for (const { style, ps } of buckets) {
          ctx.beginPath()
          for (const p of ps) {
            p.drift += p.ds * k
            // Faster-falling flakes get carried further by the tilt, like real wind.
            p.x += (Math.sin(p.drift) * 0.4 + windX * (p.vy + 1) * 1.5) * k
            p.y += p.vy * k
            if (p.y > H()) { p.y = -p.r; p.x = rand(0, W()) }
            if (p.x < -p.r) p.x = W() + p.r
            if (p.x > W() + p.r) p.x = -p.r
            // moveTo before arc: without it the path carries a line from wherever
            // the previous flake's arc ended into the start of this one.
            ctx.moveTo(p.x + p.r, p.y)
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
          }
          ctx.fillStyle = style
          ctx.fill()
        }
        clearAroundIcon()
      } else {
        // Fog: the banks drift left to right like the clouds, the tilt nudging
        // them gently, and one that has fully left the right edge comes back
        // in from the left at a new height within its depth. The breathing is
        // a narrow swing of the bank's own baked opacity (72–100%), so the
        // dither grain in it survives.
        fogClock += k * REF_FRAME_MS
        for (const p of particles) {
          p.x += (p.spd + (still ? 0 : windX * 0.3)) * k
          if (p.x > W() + 20) {
            p.x = -p.dw - rand(0, 160)
            p.cy = rand(p.layer.y[0], p.layer.y[1])
          } else if (p.x < -p.dw - 180) p.x = W()
          ctx.globalAlpha = still ? 1 : 0.72 + 0.28 * Math.sin(p.phase + fogClock * 2 * Math.PI / p.period)
          // Whole pixels, as for the clouds.
          ctx.drawImage(p.sprite, Math.round(p.x), Math.round(p.cy * H() - p.dh / 2), p.dw, p.dh)
        }
        ctx.globalAlpha = 1
      }

      mirrorToHeader()
    }

    // The desktop tab bar is sticky and has to hide the page scrolling under it,
    // so its backdrop repaints the sky opaquely (.header-sky) — which hid this
    // canvas too, leaving a band with no weather in it. The canvas can't simply
    // go above the header, because then it would also be above the cards. So the
    // header carries a canvas of its own (.header-fx) over its sky, and each frame
    // the slice of this one it covers is copied into it: one drawImage. The phone shells
    // have no such element; the lookup is retried twice a second, not per frame.
    // The copy is mapped through this canvas's on-screen scale (see below).
    //
    // Where the header sits is measured rather than read on every frame, where a
    // layout read forced a synchronous layout whenever anything on the page had
    // changed since the last one. It is read again after a scroll or a resize
    // (of the window, this canvas or the header), and a few times a second
    // regardless, which covers the header moving without any of those.
    let mirror = null, lookupIn = 0
    let box = null, sx = 1, sy = 1
    const remeasure = () => { measureIn = 0; iconIn = 0 }
    const ro = new ResizeObserver(remeasure)
    ro.observe(canvas)
    window.addEventListener('scroll', remeasure, { passive: true })
    function mirrorToHeader() {
      if (!mirror?.isConnected) {
        if (mirror) ro.unobserve(mirror)
        mirror = null
        if (lookupIn-- > 0) return
        lookupIn = 30
        mirror = document.querySelector('.header-fx')
        if (!mirror) return
        ro.observe(mirror)
        measureIn = 0
      }
      if (measureIn-- <= 0) {
        measureIn = 15
        box = mirror.getBoundingClientRect()
        const w = Math.round(box.width), h = Math.round(box.height)
        if (mirror.width !== w || mirror.height !== h) { mirror.width = w; mirror.height = h }
        // This canvas is drawn at window.innerWidth, which counts the scrollbar,
        // but displayed across the page, which doesn't — so on screen it is
        // squeezed a little. Read the slice through that same squeeze, or the copy
        // drifts out of line with the canvas below it, worst at the right edge.
        sx = canvas.width / (canvas.clientWidth || canvas.width)
        sy = canvas.height / (canvas.clientHeight || canvas.height)
      }
      const w = mirror.width, h = mirror.height
      const mctx = mirror.getContext('2d')
      mctx.clearRect(0, 0, w, h)
      if (w > 0 && h > 0) {
        mctx.drawImage(canvas, box.left * sx, box.top * sy, box.width * sx, box.height * sy, 0, 0, w, h)
      }
    }

    raf = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      window.removeEventListener('scroll', remeasure)
      window.removeEventListener('resize', resize)
      // Leave the header's copy empty rather than frozen on the last frame.
      if (mirror?.isConnected) mirror.getContext('2d').clearRect(0, 0, mirror.width, mirror.height)
    }
  }, [scene])

  if (!scene) return null
  return <canvas ref={ref} className={`weather-canvas${hold ? ' weather-canvas--held' : ''}`} />
})
