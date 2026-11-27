import { lazy, Suspense } from 'react'
import { ChunkBoundary, RetryButton } from './ChunkBoundary'

// Leaflet again — see WeatherRadarLazy for the argument. The alert map is even
// further from first paint than the radar is (it takes a tap on an alert that
// most days isn't there), so it has no business in the main chunk. Loading it
// on demand also means the two map surfaces share Leaflet: whichever is opened
// first pays for the library, and the second one finds it already there.
//
// Import this rather than ./AlertAreaMap anywhere the map is opened.
const makeImpl = () => lazy(() => import('./AlertAreaMap').then(m => ({ default: m.AlertAreaMap })))
let AlertAreaMapImpl = makeImpl()
// A lazy component remembers a rejection forever, so a retry needs a new one.
const freshImpl = () => { AlertAreaMapImpl = makeImpl() }

// The overlay's own shell, so the chunk arriving doesn't move anything: the bar
// is already the right height and the map area is already dark. No title in it
// — this is on screen for a few hundred milliseconds and a title that changes
// under the reader is worse than none.
function AlertMapSkeleton({ children }) {
  return (
    <div className="alert-map-overlay" aria-hidden={children ? undefined : 'true'}>
      <header className="alert-map-bar" />
      <div className="alert-map-wrap">
        <div className="alert-map" />
        {children ?? <p className="alert-map-note">Loading map…</p>}
      </div>
    </div>
  )
}

export function AlertAreaMap(props) {
  const fallback = (retry, attempts) => (
    <AlertMapSkeleton>
      <div className="chunk-error chunk-error--overlay" role="alert">
        <p className="chunk-error-text">The map couldn't load.</p>
        <div className="chunk-error-actions">
          <RetryButton retry={retry} attempts={attempts} />
          <button type="button" className="chunk-error-btn chunk-error-btn--secondary" onClick={props.onClose}>Close</button>
        </div>
      </div>
    </AlertMapSkeleton>
  )
  return (
    <ChunkBoundary fallback={fallback} onRetry={freshImpl}>
      <Suspense fallback={<AlertMapSkeleton />}>
        <AlertAreaMapImpl {...props} />
      </Suspense>
    </ChunkBoundary>
  )
}
