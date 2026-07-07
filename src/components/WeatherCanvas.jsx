import { useEffect, useRef } from 'react'

function sceneFor(code) {
  if (code == null) return null
  if (code === 95 || code === 96 || code === 99) return 'storm'
  if ((code >= 51 && code <= 65) || (code >= 80 && code <= 82)) return 'rain'
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow'
  if (code === 45 || code === 48) return 'fog'
  return null
}

const CFG = {
  // Counts include headroom for drops that sit off-screen left in the widened
  // spawn range (see driftX below), so on-screen density matches the old look.
  rain:  { count: 140, color: [90, 130, 190],  alpha: 0.55, speed: [5, 10],  angle: 12, len: [12, 22] },
  storm: { count: 325, color: [70, 110, 175],  alpha: 0.70, speed: [15, 24], angle: 20, len: [16, 32] },
  snow:  { count: 70,  color: [180, 210, 240], alpha: 0.75, speed: [0.5, 1.6] },
  fog:   { count: 16,  color: [140, 160, 180], alpha: 0.18, speed: 0.4, size: [70, 140] },
}

// How far (deg) we let the gyroscope lean the weather, and how strongly. The
// clamp keeps a hard tilt from throwing every particle off-screen sideways.
const TILT_CLAMP = 35
const TILT_GAIN  = 0.8

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
    tilt.current.target = 0
    if (!scene || !gyro || typeof window.DeviceOrientationEvent === 'undefined') return

    const onOrient = (e) => {
      // gamma is left-right tilt in portrait; in landscape that axis becomes
      // beta, and the sign flips depending on which way the phone was turned.
      const landscape = Math.abs(window.orientation ?? 0) === 90
      let deg = landscape ? (e.beta ?? 0) : (e.gamma ?? 0)
      if (landscape && window.orientation === -90) deg = -deg
      if (deg == null || Number.isNaN(deg)) return
      const clamped = Math.max(-TILT_CLAMP, Math.min(TILT_CLAMP, deg))
      tilt.current.target = clamped * Math.PI / 180 * TILT_GAIN
    }
    window.addEventListener('deviceorientation', onOrient)
    return () => {
      window.removeEventListener('deviceorientation', onOrient)
      tilt.current.target = 0
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

    // Angled rain drifts sideways by height·tan(angle) as it falls, so drops
    // spawned across just [-100, W+100] all shift right on the way down and
    // leave the bottom-left corner dry. Extend the spawn range left by the
    // full-fall drift so coverage stays uniform at every height.
    const angleRad = (cfg.angle ?? 0) * Math.PI / 180
    const driftX = () => (H() + 20) * Math.tan(angleRad)

    let particles
    if (scene === 'rain' || scene === 'storm') {
      // Direction (vx/vy) is derived per-frame from the base angle + live tilt,
      // so it isn't stored on the particle — only its speed and length are.
      particles = Array.from({ length: cfg.count }, () => ({
        x: rand(-100 - driftX(), W() + 100), y: rand(0, H()),
        len: rand(cfg.len[0], cfg.len[1]),
        spd: rand(cfg.speed[0], cfg.speed[1]),
        alpha: rand(0.4, 1) * cfg.alpha,
      }))
    } else if (scene === 'snow') {
      particles = Array.from({ length: cfg.count }, () => ({
        x: rand(0, W()), y: rand(0, H()),
        r: rand(2, 5), vy: rand(cfg.speed[0], cfg.speed[1]),
        drift: rand(0, Math.PI * 2), ds: rand(0.004, 0.012),
        alpha: rand(0.4, 1) * cfg.alpha,
      }))
    } else {
      particles = Array.from({ length: cfg.count }, () => ({
        x: rand(0, W()), y: rand(0, H()),
        r: rand(cfg.size[0], cfg.size[1]),
        vx: rand(-1, 1) * cfg.speed, vy: rand(-0.3, 0.3) * cfg.speed,
        alpha: rand(0.4, 1) * cfg.alpha,
      }))
    }

    const [r, g, b] = cfg.color

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

      if (scene === 'rain' || scene === 'storm') {
        // Whole sheet leans with the phone: one shared direction from the base
        // fall angle plus the live tilt.
        const a = angleRad + t.cur
        const vx = Math.sin(a), vy = Math.cos(a)
        ctx.lineWidth = 1.5
        for (const p of particles) {
          p.x += vx * p.spd; p.y += vy * p.spd
          // Respawn off the top once a drop exits the bottom or, under a strong
          // lean, slides past either side — keeps coverage gap-free.
          if (p.y > H() || p.x < -200 - driftX() || p.x > W() + 200) {
            p.y = -20; p.x = rand(-100 - driftX(), W() + 100)
          }
          ctx.beginPath()
          ctx.moveTo(p.x, p.y)
          ctx.lineTo(p.x - vx * p.len, p.y - vy * p.len)
          ctx.strokeStyle = `rgba(${r},${g},${b},${p.alpha})`
          ctx.stroke()
        }
      } else if (scene === 'snow') {
        for (const p of particles) {
          p.drift += p.ds
          // Faster-falling flakes get carried further by the tilt, like real wind.
          p.x += Math.sin(p.drift) * 0.4 + windX * (p.vy + 1) * 1.5
          p.y += p.vy
          if (p.y > H()) { p.y = -p.r; p.x = rand(0, W()) }
          if (p.x < -p.r) p.x = W() + p.r
          if (p.x > W() + p.r) p.x = -p.r
          ctx.beginPath()
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
          ctx.fillStyle = `rgba(${r},${g},${b},${p.alpha})`
          ctx.fill()
        }
      } else {
        for (const p of particles) {
          p.x += p.vx + windX * 0.6; p.y += p.vy
          if (p.x < -p.r) p.x = W() + p.r
          if (p.x > W() + p.r) p.x = -p.r
          if (p.y < -p.r) p.y = H() + p.r
          if (p.y > H() + p.r) p.y = -p.r
          ctx.beginPath()
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
          ctx.fillStyle = `rgba(${r},${g},${b},${p.alpha})`
          ctx.fill()
        }
      }

      raf = requestAnimationFrame(draw)
    }

    raf = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize) }
  }, [scene])

  if (!scene) return null
  return <canvas ref={ref} className="weather-canvas" />
}
