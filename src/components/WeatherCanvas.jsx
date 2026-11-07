import { useEffect, useRef } from 'react'

function sceneFor(code) {
  if (code == null) return null
  if (code === 95 || code === 96 || code === 99) return 'storm'
  if (code === 65 || code === 82) return 'downpour'
  if ((code >= 51 && code <= 63) || code === 80 || code === 81) return 'rain'
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow'
  if (code === 45 || code === 48) return 'fog'
  if (code === 3) return 'overcast'
  if (code === 2) return 'partly'
  return null
}

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
  fog:   { count: 16,  color: [140, 160, 180], alpha: 0.18, speed: 0.4, size: [70, 140] },
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

export function WeatherCanvas({ code, gyro = true }) {
  const scene = sceneFor(code)
  const ref = useRef(null)
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

    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight }
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
      particles = Array.from({ length: cfg.count }, () => ({
        x: rand(0, W()), y: rand(0, H()),
        r: rand(cfg.size[0], cfg.size[1]),
        vx: rand(-1, 1) * cfg.speed, vy: rand(-0.3, 0.3) * cfg.speed,
        alpha: quantFactor(rand(0.4, 1)) * cfg.alpha,
      }))
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

    function draw() {
      ctx.clearRect(0, 0, W(), H())

      // Ease the tilt toward its target once per frame; every scene reads this.
      const t = tilt.current
      t.cur += (t.target - t.cur) * 0.08
      const windX = Math.sin(t.cur) // sideways push from the current lean

      if (scene === 'storm') {
        if (flash > 0) {
          ctx.fillStyle = `rgba(255,255,255,${flash * 0.12})`
          ctx.fillRect(0, 0, W(), H())
          flash -= 0.05
        } else if (Math.random() < 0.003) {
          flash = 1
        }
      }

      if (isCloudScene(scene)) {
        // Drift left to right; the tilt nudges them, gently. A cloud that has
        // fully left the right edge comes back in from the left at a new height.
        for (const p of particles) {
          p.x += p.spd + (still ? 0 : windX * 0.4)
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
            p.x += vx * p.spd; p.y += vy * p.spd
            // Refill once a drop leaves the bottom or slides off the downwind side.
            if (p.y > H() + 20 || p.x < -40 || p.x > W() + 40) respawn(p)
            ctx.moveTo(p.x, p.y)
            ctx.lineTo(p.x - vx * p.len, p.y - vy * p.len)
          }
          ctx.strokeStyle = style
          ctx.stroke()
        }
      } else if (scene === 'snow') {
        for (const { style, ps } of buckets) {
          ctx.beginPath()
          for (const p of ps) {
            p.drift += p.ds
            // Faster-falling flakes get carried further by the tilt, like real wind.
            p.x += Math.sin(p.drift) * 0.4 + windX * (p.vy + 1) * 1.5
            p.y += p.vy
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
      } else {
        for (const { style, ps } of buckets) {
          ctx.beginPath()
          for (const p of ps) {
            p.x += p.vx + windX * 0.6; p.y += p.vy
            if (p.x < -p.r) p.x = W() + p.r
            if (p.x > W() + p.r) p.x = -p.r
            if (p.y < -p.r) p.y = H() + p.r
            if (p.y > H() + p.r) p.y = -p.r
            ctx.moveTo(p.x + p.r, p.y)
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
          }
          ctx.fillStyle = style
          ctx.fill()
        }
      }

      mirrorToHeader()
      raf = requestAnimationFrame(draw)
    }

    // The desktop tab bar is sticky and has to hide the page scrolling under it,
    // so its backdrop repaints the sky opaquely (.header-sky) — which hid this
    // canvas too, leaving a band with no weather in it. The canvas can't simply
    // go above the header, because then it would also be above the cards. So the
    // header carries a canvas of its own (.header-fx) over its sky, and each frame
    // the slice of this one it covers is copied into it: one drawImage. The phone shells
    // have no such element; the lookup is retried twice a second, not per frame.
    // The copy is mapped through this canvas's on-screen scale (see below).
    let mirror = null, lookupIn = 0
    function mirrorToHeader() {
      if (!mirror?.isConnected) {
        mirror = null
        if (lookupIn-- > 0) return
        lookupIn = 30
        mirror = document.querySelector('.header-fx')
        if (!mirror) return
      }
      const box = mirror.getBoundingClientRect()
      const w = Math.round(box.width), h = Math.round(box.height)
      if (mirror.width !== w || mirror.height !== h) { mirror.width = w; mirror.height = h }
      // This canvas is drawn at window.innerWidth, which counts the scrollbar,
      // but displayed across the page, which doesn't — so on screen it is
      // squeezed a little. Read the slice through that same squeeze, or the copy
      // drifts out of line with the canvas below it, worst at the right edge.
      const sx = canvas.width / (canvas.clientWidth || canvas.width)
      const sy = canvas.height / (canvas.clientHeight || canvas.height)
      const mctx = mirror.getContext('2d')
      mctx.clearRect(0, 0, w, h)
      if (w > 0 && h > 0) {
        mctx.drawImage(canvas, box.left * sx, box.top * sy, box.width * sx, box.height * sy, 0, 0, w, h)
      }
    }

    raf = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      // Leave the header's copy empty rather than frozen on the last frame.
      if (mirror?.isConnected) mirror.getContext('2d').clearRect(0, 0, mirror.width, mirror.height)
    }
  }, [scene])

  if (!scene) return null
  return <canvas ref={ref} className="weather-canvas" />
}
