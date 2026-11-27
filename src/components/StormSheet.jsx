import { lazy, Suspense } from 'react'
import { ArrowLeft, ChevronRight, CloudRain, Snowflake, TriangleAlert, Zap } from 'lucide-react'
import { loadStormCenter, preloadStormCenter } from './stormCenterChunk'
import { ChunkBoundary, RetryButton } from './ChunkBoundary'
import './StormSheet.css'

// The Storm Center on the phone styles. The web layout swaps Home for it while
// something is happening; the phones keep their own card stack and show a
// banner over it instead (StormCenterBanner), which opens the same page as a
// full-screen sheet. The page itself is its own chunk (see stormCenterChunk.js).

const makeImpl = () => lazy(() => loadStormCenter().then((m) => ({ default: m.StormCenterPage })))
let StormCenterImpl = makeImpl()
// A lazy component remembers a rejection forever, so a retry needs a new one.
const freshImpl = () => { StormCenterImpl = makeImpl() }

const KIND_ICON = { extreme: TriangleAlert, storm: Zap, rain: CloudRain, snow: Snowflake }

// The way in, at the top of the forecast while something is happening.
export function StormCenterBanner({ kind, label, tint, onOpen }) {
  const Icon = KIND_ICON[kind] ?? Zap
  return (
    <button
      type="button"
      className={`card storm-banner storm-banner--${kind}`}
      style={{ '--sc-tint': tint }}
      onPointerDown={preloadStormCenter}
      onClick={onOpen}
    >
      <span className="storm-banner-icon" aria-hidden="true"><Icon size={20} strokeWidth={2.4} /></span>
      <span className="storm-banner-text">
        <span className="storm-banner-title">Storm Center</span>
        <span className="storm-banner-sub">{label}</span>
      </span>
      <ChevronRight size={20} className="storm-banner-chevron" aria-hidden="true" />
    </button>
  )
}

// The page, full screen over the app. Takes StormCenterPage's props and
// `onClose`.
export function StormSheet({ onClose, ...pageProps }) {
  const fallback = (retry, attempts) => (
    <div className="chunk-error chunk-error--page sc-sheet-error" role="alert">
      <p className="chunk-error-text">The Storm Center couldn&apos;t load.</p>
      <div className="chunk-error-actions">
        <RetryButton retry={retry} attempts={attempts} />
        <button type="button" className="chunk-error-btn chunk-error-btn--secondary" onClick={onClose}>Close</button>
      </div>
    </div>
  )
  return (
    <div className="sc-sheet" role="dialog" aria-modal="true" aria-label="Storm Center">
      <header className="sc-sheet-bar">
        <button type="button" className="sc-sheet-back" onClick={onClose} aria-label="Back">
          <ArrowLeft size={18} aria-hidden="true" />
          <span>Back</span>
        </button>
        <span className="sc-sheet-title">
          <Zap size={16} aria-hidden="true" />
          Storm Center
        </span>
      </header>
      <div className="sc-sheet-scroll">
        <ChunkBoundary fallback={fallback} onRetry={freshImpl}>
          {/* No fallback: the sheet's own dark fill is already up, and the
              page rises in when it lands. */}
          <Suspense fallback={null}>
            <StormCenterImpl {...pageProps} mobile active />
          </Suspense>
        </ChunkBoundary>
      </div>
    </div>
  )
}
