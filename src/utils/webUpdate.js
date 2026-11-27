import { useSyncExternalStore } from 'react'

// A new build of the web app, waiting. The service worker is registered in
// 'prompt' mode (vite.config.js), so a deploy no longer reloads an open tab out
// from under whoever is using it: main.jsx hands the waiting worker's update
// function here, WebUpdateToast offers it, and the reload happens on a tap.
let apply = null
const listeners = new Set()

export function offerWebUpdate(updateSW) {
  apply = updateSW
  listeners.forEach((l) => l())
}

export function applyWebUpdate() {
  // Activates the waiting worker, which reloads the page onto the new build.
  apply?.(true)
}

export function useWebUpdateReady() {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l) },
    () => apply != null,
  )
}
