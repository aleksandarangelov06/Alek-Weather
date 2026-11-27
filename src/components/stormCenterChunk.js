// The Storm Center page for the phone styles (see StormSheet), kept apart from
// StormSheet.jsx so that file exports components only (Fast Refresh). It is the
// same page the web layout shows on Home, so the two share one chunk.
export const loadStormCenter = () => import('./web/StormCenterPage')

// Warmed when a finger lands on the Storm Center banner, so the page is
// usually in by the time the tap completes.
export function preloadStormCenter() {
  loadStormCenter().catch(() => { /* the sheet retries on open */ })
}
