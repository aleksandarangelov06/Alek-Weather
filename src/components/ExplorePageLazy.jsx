import { lazy, Suspense } from 'react'
import { ChunkBoundary, RetryButton } from './ChunkBoundary'

// The Explore page is an easter egg (three taps on "Alek Studios" in
// Settings), so it is its own chunk and costs nothing until someone finds it.
const makeImpl = () => lazy(() => import('./ExplorePage').then((m) => ({ default: m.ExplorePage })))
let ExplorePageImpl = makeImpl()
// A lazy component remembers a rejection forever, so a retry needs a new one.
const freshImpl = () => { ExplorePageImpl = makeImpl() }

export function ExplorePage(props) {
  const fallback = (retry, attempts) => (
    // Inline styles: the page's own stylesheet is in the chunk that failed.
    <div
      className="chunk-error chunk-error--page"
      role="alert"
      style={{ position: 'fixed', inset: 0, zIndex: 850, display: 'grid', placeContent: 'center', background: 'var(--bg)' }}
    >
      <p className="chunk-error-text">Explore couldn&apos;t load.</p>
      <div className="chunk-error-actions">
        <RetryButton retry={retry} attempts={attempts} />
        <button type="button" className="chunk-error-btn chunk-error-btn--secondary" onClick={props.onClose}>Close</button>
      </div>
    </div>
  )
  return (
    <ChunkBoundary fallback={fallback} onRetry={freshImpl}>
      <Suspense fallback={null}>
        <ExplorePageImpl {...props} />
      </Suspense>
    </ChunkBoundary>
  )
}
