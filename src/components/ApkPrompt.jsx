import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { IS_ANDROID_APP } from '../utils/version'

// GitHub serves the newest release's asset under this path, so the link never
// needs bumping: the release script always uploads it as AlekWeather.apk.
export const APK_URL =
  'https://github.com/aleksandarangelov06/Alek-Weather/releases/latest/download/AlekWeather.apk'

// An Android phone or tablet in a browser, not the APK's own WebView. The APK
// is Android-only, so iPhones and desktops never see the offer.
export const isAndroidWeb = () =>
  !IS_ANDROID_APP &&
  typeof navigator !== 'undefined' &&
  /Android/i.test(navigator.userAgent)

const DISMISSED_KEY = 'alek-weather-apk-prompt-dismissed'
// Same reasoning as the update bar: let the weather land first, so the bar
// doesn't read as part of the loading screen.
const DELAY_MS = 4000

function wasDismissed() {
  try { return localStorage.getItem(DISMISSED_KEY) === '1' } catch { return false }
}

/**
 * "Get the Android app" bar for the web version on an Android phone. Shown
 * once; closing it (or tapping Download) puts it away for good. Settings keeps
 * a permanent Download row for anyone who wants it later.
 */
export function ApkPrompt() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (!isAndroidWeb() || wasDismissed()) return
    const t = setTimeout(() => setShow(true), DELAY_MS)
    return () => clearTimeout(t)
  }, [])

  const dismiss = () => {
    try { localStorage.setItem(DISMISSED_KEY, '1') } catch { /* private mode */ }
    setShow(false)
  }

  if (!show) return null

  return (
    <div className="update-toast" role="status">
      <div className="update-toast-text">
        <span className="update-toast-title">Get the Android app</span>
        <span className="update-toast-sub">Rain and weather-alert notifications, right on your phone.</span>
      </div>
      <div className="update-toast-actions">
        <a className="install-btn apk-download-btn" href={APK_URL} onClick={dismiss}>Download</a>
        <button className="update-toast-close" onClick={dismiss} aria-label="Dismiss">
          <X size={18} />
        </button>
      </div>
    </div>
  )
}
