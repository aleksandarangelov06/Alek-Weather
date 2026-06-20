import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.jsx'

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

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
