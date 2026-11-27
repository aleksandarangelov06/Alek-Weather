import { lazy, memo, Suspense, useState } from 'react'
import { loadWeatherRadar, loadedWeatherRadar } from './radarChunk'
import { RadarSweep } from './RadarSweep'
import { ChunkBoundary, RetryButton } from './ChunkBoundary'

// Leaflet plus the map that drives it is ~160 KB — a quarter of the whole
// bundle — for a card that sits last in the default block order and behind its
// own tab in the web layout. Neither is on screen at first paint, so loading it
// with everything else means every reader pays for a map most of them never
// scroll to. Split out, the chunk is fetched on the first mount instead.
//
// Import this rather than ./WeatherRadar anywhere the radar is rendered; the
// eager module is the implementation and pulling it in directly puts Leaflet
// back in the main chunk.
const makeImpl = () => lazy(() => loadWeatherRadar().then(C => ({ default: C })))
let WeatherRadarImpl = makeImpl()
// A lazy component remembers a rejection forever, so a retry needs a new one.
const freshImpl = () => { WeatherRadarImpl = makeImpl() }

// The chunk lands in a few hundred milliseconds at worst, but the stack must
// not shorten under the reader while it does — the radar is something you
// scroll to, and a card that pops in moves everything below it. This is the
// compact card's own markup with an empty map inside, so the slot it holds is
// the exact box the real card fills. .radar-map already paints var(--bg).
function RadarSkeleton({ fill, children }) {
  return (
    <div className={`card radar-card${fill ? ' radar-fill' : ''}`} aria-hidden={children ? undefined : 'true'}>
      {!fill && (
        <div className="radar-header">
          <span className="section-label" style={{ margin: 0 }}>RADAR</span>
        </div>
      )}
      <div className="radar-map-wrap">
        <div className="radar-map" />
        {children ?? <RadarSweep />}
      </div>
    </div>
  )
}

// Memoised: its props are the place and a few settings, and the map below is the
// most expensive thing on the page to re-render for an unrelated change in App.
export const WeatherRadar = memo(function WeatherRadar(props) {
  // Already fetched (the web layout preloads it): render it straight away rather
  // than through a suspend that would put the skeleton up for a frame. Read
  // once, at mount — switching between the two paths later would change the
  // element type and remount the map under the reader.
  const [Loaded] = useState(loadedWeatherRadar)
  // The same box as the skeleton, so a failure doesn't move the stack either.
  const fallback = (retry, attempts) => (
    <RadarSkeleton fill={props.fill}>
      <div className="chunk-error chunk-error--overlay" role="alert">
        <p className="chunk-error-text">The radar couldn't load.</p>
        <RetryButton retry={retry} attempts={attempts} />
      </div>
    </RadarSkeleton>
  )
  return (
    <ChunkBoundary fallback={fallback} onRetry={freshImpl}>
      {Loaded ? <Loaded {...props} /> : (
        <Suspense fallback={<RadarSkeleton fill={props.fill} />}>
          <WeatherRadarImpl {...props} />
        </Suspense>
      )}
    </ChunkBoundary>
  )
})
