import { memo, useEffect, useState } from 'react'
import { loadWeatherRadar } from '../radarChunk'
import { TodayPage } from './TodayPage'
import { DailyPage } from './DailyPage'
import { DetailsPage } from './DetailsPage'
import { RadarPage } from './RadarPage'
import { AirQualityPage } from './AirQualityPage'

// The page area of the web app. The tab bar itself lives in the header (see
// App.jsx), so the selection is passed in rather than owned here.
//
// A page is built the first time its tab is opened and then kept, hidden, when
// you move on: rebuilding Today's few hundred nodes and twenty-odd weather icons
// on every switch was a visible stall on a laptop, where showing a page that
// already exists is just a style change. A hidden panel is display: none, so its
// icon animations stop rather than running unseen, and showing it again
// restarts the .web-page entrance, so a switch still reads as a page change.
//
// Radar is the exception. Its map measures its container when it is created,
// and a map that was hidden comes back sized for nothing, so it is built fresh
// each visit as before.

// The tab lives in App, so every switch re-renders the whole tree. A panel that
// stays hidden through a render skips it, and catches up in the render that
// shows it again, with whatever the props are by then.
//
// While the page fades in, its weather icons hold still. Their parts are SVG,
// which the browser can't hand to the compositor, so a moving icon makes it
// repaint the whole fading page every frame — on Today, twenty-odd icons turned
// a cheap opacity fade into a stutter. Held for the 0.28s of the fade, nobody
// sees them wait.
const Panel = memo(function Panel({ id, active, render }) {
  const [entering, setEntering] = useState(active)
  const [wasActive, setWasActive] = useState(active)
  if (active !== wasActive) {
    setWasActive(active)
    if (active) setEntering(true)
  }

  return (
    <div
      className={`web-panel${entering ? ' web-panel--entering' : ''}`}
      id={`web-panel-${id}`}
      role="tabpanel"
      aria-labelledby={`web-tab-${id}`}
      hidden={!active}
      onAnimationEnd={(e) => { if (e.target.classList.contains('web-page')) setEntering(false) }}
    >
      {render()}
    </div>
  )
}, (prev, next) => !prev.active && !next.active)

export function WebLayout(props) {
  // Only what the explicitly-wired pages below read. Today takes the whole of
  // props, so anything it alone needs — radarClear, weatherAnimations — travels
  // in the spread and is deliberately not pulled out here.
  const {
    weather, location, airQuality, radarMode, radarSource, unit, units, colorCoding, tab, onNavigate,
  } = props

  // Adjusted during render rather than in an effect, so a newly opened tab is
  // built in the same pass that shows it.
  // Fetch the radar's chunk (the map library is most of it) once the browser is
  // idle, so opening the tab draws the map at once instead of sitting on an
  // empty page for the download and then snapping in whole.
  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((cb) => setTimeout(cb, 1500))
    const cancel = window.cancelIdleCallback ?? clearTimeout
    const id = idle(() => { loadWeatherRadar().catch(() => { /* the tab retries on open */ }) })
    return () => cancel(id)
  }, [])

  const [visited, setVisited] = useState(() => new Set([tab]))
  if (tab !== 'radar' && !visited.has(tab)) setVisited(new Set(visited).add(tab))

  const panel = (id, render) => (id === tab || (id !== 'radar' && visited.has(id))) && (
    <Panel key={id} id={id} active={id === tab} render={render} />
  )

  return (
    <div className="web-shell">
      {panel('today', () => <TodayPage {...props} />)}
      {panel('daily', () => <DailyPage weather={weather} unit={unit} units={units} colorCoding={colorCoding} />)}
      {panel('details', () => (
        <DetailsPage
          weather={weather}
          unit={unit}
          units={units}
          airQuality={airQuality}
          colorCoding={colorCoding}
          onNavigate={onNavigate}
        />
      ))}
      {panel('radar', () => (
        <RadarPage location={location} timezone={weather.timezone} radarMode={radarMode} radarSource={radarSource} />
      ))}
      {panel('air', () => <AirQualityPage airQuality={airQuality} timezone={weather.timezone} />)}
    </div>
  )
}
