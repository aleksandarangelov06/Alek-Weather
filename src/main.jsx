import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.jsx'
import { ErrorBoundary } from './components/ErrorBoundary.jsx'
import { installPredictiveBack } from './utils/predictiveBack.js'
import { IS_ANDROID_APP } from './utils/version.js'

// Android app only in effect: listens for the back-gesture events MainActivity
// sends, and animates the open overlay along with the swipe.
installPredictiveBack()

// The system bar insets, before the first render: MainActivity used to push
// them only once the page had finished loading -- which waits on the Google
// Fonts request below -- so the phone layout drew under the status bar and
// jumped down when they landed. Reading them here puts the first frame in the
// right place; MainActivity still pushes later changes (rotation, cutouts).
if (IS_ANDROID_APP) {
  try {
    const inset = JSON.parse(window.AndroidBars?.insets?.() ?? 'null')
    if (inset) {
      const s = document.documentElement.style
      for (const side of ['top', 'right', 'bottom', 'left']) s.setProperty(`--android-inset-${side}`, `${inset[side] ?? 0}px`)
    }
  } catch { /* older APK without the getter: MainActivity's push covers it */ }
}

if (IS_ANDROID_APP) {
  // The APK serves every file straight out of its own assets, so a service
  // worker has nothing to cache -- and it cost every cold launch: the worker
  // had to boot before the page could even be fetched, and after an APK update
  // it served the previous build's precached copy first, then reloaded into the
  // new one. Retire any worker an earlier build installed, once the app is up.
  // (The forecast's offline copy is the saved reading in localStorage.)
  const retire = async () => {
    try {
      const regs = await navigator.serviceWorker?.getRegistrations() ?? []
      await Promise.all(regs.map(r => r.unregister()))
      if (regs.length && 'caches' in window) {
        const keys = await caches.keys()
        await Promise.all(keys.map(k => caches.delete(k)))
      }
    } catch { /* nothing to retire */ }
  }
  setTimeout(retire, 3000)
} else {
  // With registerType 'autoUpdate', a new deploy activates the new service worker
  // and reloads the page automatically — no manual cache clearing required.
  registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      // Poll for a new version every hour so long-lived tabs/PWAs pick up deploys.
      if (registration) {
        setInterval(() => registration.update(), 60 * 60 * 1000)
      }
    },
  })
}

// Web fonts load without blocking first paint (see index.html). Text renders in
// the system fallback and swaps once they arrive (display=swap), so a slow or
// offline launch is never held up waiting on Google.
const fonts = document.createElement('link')
fonts.rel = 'stylesheet'
fonts.href = 'https://fonts.googleapis.com/css2?family=Google+Sans:wght@300;400;500;700&family=Inter:wght@300..700&display=swap'
document.head.appendChild(fonts)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
