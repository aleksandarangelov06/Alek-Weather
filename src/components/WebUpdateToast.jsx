import { useState } from 'react'
import { X } from 'lucide-react'
import { applyWebUpdate, useWebUpdateReady } from '../utils/webUpdate'

/**
 * The web app's "new version" bar: a deploy has landed and is waiting (see
 * utils/webUpdate). Reload switches to it; closing the bar leaves this tab on
 * the version it has, and the new one takes over the next time the app opens.
 * Same look as the APK's UpdateToast.
 */
export function WebUpdateToast() {
  const ready = useWebUpdateReady()
  const [dismissed, setDismissed] = useState(false)
  if (!ready || dismissed) return null
  return (
    <div className="update-toast" role="status">
      <div className="update-toast-text">
        <span className="update-toast-title">Update available</span>
        <span className="update-toast-sub">A new version of Alek Weather is ready.</span>
      </div>
      <div className="update-toast-actions">
        <button className="install-btn" onClick={applyWebUpdate}>Reload</button>
        <button className="update-toast-close" onClick={() => setDismissed(true)} aria-label="Dismiss">
          <X size={18} />
        </button>
      </div>
    </div>
  )
}
