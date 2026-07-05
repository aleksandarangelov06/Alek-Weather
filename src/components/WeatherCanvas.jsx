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

export function WeatherCanvas({ code }) {
  const scene = sceneFor(code)
  const ref = useRef(null)

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
      const a = angleRad
      particles = Array.from({ length: cfg.count }, () => ({
        x: rand(-100 - driftX(), W() + 100), y: rand(0, H()),
        len: rand(cfg.len[0], cfg.len[1]),
        spd: rand(cfg.speed[0], cfg.speed[1]),
        vx: Math.sin(a), vy: Math.cos(a),
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
        ctx.lineWidth = 1.5
        for (const p of particles) {
          p.x += p.vx * p.spd; p.y += p.vy * p.spd
          if (p.y > H()) { p.y = -20; p.x = rand(-100 - driftX(), W() + 100) }
          ctx.beginPath()
          ctx.moveTo(p.x, p.y)
          ctx.lineTo(p.x - p.vx * p.len, p.y - p.vy * p.len)
          ctx.strokeStyle = `rgba(${r},${g},${b},${p.alpha})`
          ctx.stroke()
        }
      } else if (scene === 'snow') {
        for (const p of particles) {
          p.drift += p.ds; p.x += Math.sin(p.drift) * 0.4; p.y += p.vy
          if (p.y > H()) { p.y = -p.r; p.x = rand(0, W()) }
          ctx.beginPath()
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
          ctx.fillStyle = `rgba(${r},${g},${b},${p.alpha})`
          ctx.fill()
        }
      } else {
        for (const p of particles) {
          p.x += p.vx; p.y += p.vy
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
