import { useEffect, useLayoutEffect, useRef } from 'react'

// The radar's loading state: a beam sweeping round the location over the whole
// map, the way a real radar's does, with the fading trail a radar display
// leaves behind it, until the first frame is on screen.
//
// Its own module, outside the radar chunk, because the lazy loader's skeleton
// (WeatherRadarLazy) shows it too, before that chunk has arrived.
//
// `done` fades it out rather than unmounting it, so the beam doesn't vanish in
// one frame. `dot` draws the location at the centre; the live map has its own
// dot there already (.radar-here), so it passes false. `enter` is the fade-in,
// held back a beat so a placeholder that is gone at once never flashes; the
// live map's sweep passes false and is there from its first frame, since it
// takes over from a placeholder's beam mid-turn (every beam turns on the page
// clock, so it carries on from the same angle).
//
// The beam turns about the middle of its box unless told otherwise: the live
// map moves it onto the location, wherever the location is on screen, by
// setting --sweep-dx / --sweep-dy on the element `anchorRef` is given (see
// WeatherRadar), so it pivots on the dot through pans and zooms.

const SWEEP_PERIOD_MS = 2400
// The fade once the radar is in (.radar-sweep--done).
const FADE_MS = 450

// The beam's trail is a soft glow, so it is drawn once into a small canvas and
// scaled up by the compositor, rather than as a CSS gradient the size of the
// screen's diagonal: rotating one of those has the GPU raster the whole
// circle, ~28 MB on a full-screen phone, for a blur. The sharp leading edge is
// a separate line (.radar-sweep-rotor::after), so it stays crisp.
const BEAM_PX = 512
const BEAM_RGB = '59, 130, 246'

function drawBeam(canvas) {
  const ctx = canvas?.getContext('2d')
  if (!ctx) return
  const c = BEAM_PX / 2
  // Canvas angles start at 3 o'clock and run clockwise; the leading edge is at
  // 12 o'clock and the trail runs back from it, anticlockwise, over 110°.
  const TOP = -Math.PI / 2
  ctx.clearRect(0, 0, BEAM_PX, BEAM_PX)
  if (ctx.createConicGradient) {
    const g = ctx.createConicGradient(TOP, c, c)
    g.addColorStop(0, `rgba(${BEAM_RGB}, 0)`)
    g.addColorStop(250 / 360, `rgba(${BEAM_RGB}, 0)`)
    g.addColorStop(280 / 360, `rgba(${BEAM_RGB}, 0.04)`)
    g.addColorStop(320 / 360, `rgba(${BEAM_RGB}, 0.16)`)
    g.addColorStop(352 / 360, `rgba(${BEAM_RGB}, 0.42)`)
    g.addColorStop(1, `rgba(${BEAM_RGB}, 0.6)`)
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(c, c, c, 0, Math.PI * 2)
    ctx.fill()
    return
  }
  // No conic gradients: stacked wedges, each running up to the edge, so the
  // glow builds towards it. Faint enough each that their seams don't show.
  const TAIL = (110 / 180) * Math.PI
  const steps = 48
  ctx.fillStyle = `rgba(${BEAM_RGB}, 0.02)`
  for (let i = 0; i < steps; i++) {
    ctx.beginPath()
    ctx.moveTo(c, c)
    ctx.arc(c, c, c, TOP - TAIL * (1 - i / steps), TOP)
    ctx.closePath()
    ctx.fill()
  }
}

export function RadarSweep({ done = false, dot = true, enter = true, anchorRef = null }) {
  const rotorRef = useRef(null)
  const beamRef = useRef(null)
  const turn = useRef(null)

  // The beam turns on the compositor, on the page clock (startTime 0), so a
  // placeholder's beam and the live map's agree on the angle when one replaces
  // the other. Before the first paint, so it never shows at rest. Not under
  // reduced motion: the beam just holds still at the top.
  useLayoutEffect(() => {
    const rotor = rotorRef.current
    if (!rotor?.animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const a = rotor.animate(
      [{ transform: 'rotate(0turn)' }, { transform: 'rotate(1turn)' }],
      { duration: SWEEP_PERIOD_MS, iterations: Infinity },
    )
    a.startTime = 0
    turn.current = a
    return () => { a.cancel(); turn.current = null }
  }, [])

  useEffect(() => { drawBeam(beamRef.current) }, [])

  // Stop turning once faded out; back on the page clock if it comes back (the
  // map was rebuilt for a new place).
  useEffect(() => {
    if (!done) {
      if (turn.current) turn.current.startTime = 0
      return
    }
    const t = setTimeout(() => turn.current?.pause(), FADE_MS + 50)
    return () => clearTimeout(t)
  }, [done])

  return (
    <div
      ref={anchorRef}
      className={`radar-sweep${enter ? '' : ' radar-sweep--now'}${done ? ' radar-sweep--done' : ''}`}
      aria-hidden="true"
    >
      <div className="radar-sweep-rotor" ref={rotorRef}>
        <canvas ref={beamRef} className="radar-sweep-beam" width={BEAM_PX} height={BEAM_PX} />
      </div>
      {dot && <span className="radar-sweep-dot" />}
    </div>
  )
}
