import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.jsx'
import { ErrorBoundary } from './components/ErrorBoundary.jsx'
import { installPredictiveBack } from './utils/predictiveBack.js'

// Android app only in effect: listens for the back-gesture events MainActivity
// sends, and animates the open overlay along with the swipe.
installPredictiveBack()

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
