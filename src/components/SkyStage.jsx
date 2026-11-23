import { useEffect, useState } from 'react'
import { WeatherCanvas } from './WeatherCanvas'
import { sceneFor } from '../utils/weatherScene'

// How long a sky that is being replaced takes to fade off the new one. Matches
// .sky-layer--leaving in App.css.
const FADE_MS = 700

// The sky behind the phone app: one gradient and one weather canvas, shared by
// the splash and the forecast. They used to draw a sky each, so opening a place
// crossfaded one sky into a second copy of itself (the rain doubled, then
// jumped) even when the weather was the same; with one sky, moving between the
// two screens leaves it alone.
//
// When the sky does change (a different place, the weather turning, effects
// switched off) the old one stays on top and fades off the new one rather than
// cutting. It is the same layer, still drawing, so its rain doesn't reseed as
// it goes. A new code that draws the same sky changes nothing on screen.
//
// `sky` is { c: sky class, code: weather code } or null. `animate` is off while
// the launch boot screen covers the app, where a fade would only be seen half
// way through. `bgRef` follows the gradient on screen (App reads it for the
// status bar colour).
export function SkyStage({ sky, gyro, hold, animate, bgRef }) {
  const key = sky ? `${sky.c}|${sceneFor(sky.code) ?? ''}` : null
  const [stage, setStage] = useState(() => ({
    current: sky ? { id: 0, key, sky } : null,
    leaving: [],
    nextId: 1,
  }))

  // Each fade clears every layer that has finished leaving. A later change
  // restarts the timer; the earlier layers have faded out by then and wait,
  // invisible, to go with it.
  const lastLeaving = stage.leaving[stage.leaving.length - 1]?.id
  useEffect(() => {
    if (lastLeaving == null) return
    const t = setTimeout(() => setStage(s => ({ ...s, leaving: [] })), FADE_MS)
    return () => clearTimeout(t)
  }, [lastLeaving])

  // Adjusted during render rather than in an effect, so the new sky and the
  // old one's fade start in the same frame.
  if ((stage.current?.key ?? null) !== key) {
    setStage(s => ({
      current: sky ? { id: s.nextId, key, sky } : null,
      leaving: animate && s.current ? [...s.leaving, s.current] : [],
      nextId: s.nextId + 1,
    }))
    // React renders again at once with the new stage and throws this pass
    // away; stop here rather than draw the old layers with the new sky.
    return null
  }

  // One keyed list, so the layer that starts leaving is the same instance (and
  // the same canvas, mid-fall) it was a moment ago.
  const layers = stage.current ? [...stage.leaving, stage.current] : stage.leaving
  return layers.map(layer => {
    const current = layer === stage.current
    return (
      <div key={layer.id} className={`sky-layer${current ? '' : ' sky-layer--leaving'}`} aria-hidden="true">
        <div ref={current ? bgRef : undefined} className={`sky-bg ${(current ? sky : layer.sky).c}`} />
        <WeatherCanvas code={(current ? sky : layer.sky).code} gyro={gyro} hold={current && hold} />
      </div>
    )
  })
}
