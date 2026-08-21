import { lazy, Suspense } from 'react'
import { loadSettingsPage } from './settingsChunk'

// The settings screen is ~25 KB of controls that only exist once the reader
// opens them, so it loads as its own chunk rather than riding along with the
// first paint. Constants App needs at mount live in utils/appearance instead —
// importing one from the screen itself would undo the split.
//
// Import this rather than ./SettingsPage anywhere settings is rendered, and
// preloadSettings from ./settingsChunk to warm it ahead of the open.
const SettingsPageImpl = lazy(() =>
  loadSettingsPage().then(m => ({ default: m.SettingsPage })),
)

export function SettingsPage(props) {
  // No fallback: the screen animates in from nothing anyway, so an empty frame
  // reads as the animation not having started rather than as something missing.
  return (
    <Suspense fallback={null}>
      <SettingsPageImpl {...props} />
    </Suspense>
  )
}
