// The web layout's one loader. Everything App renders only when the app style is
// Web (the tab pages, the tab bar, the web splash and skeleton) and WebApp.css
// with it are their own chunk, because the phone shells never use any of it:
// they used to download, parse and match ~180 KB of desktop CSS and a dozen
// page components on every launch.
//
// The web layout is never put on screen before this has landed: main.jsx waits
// for it before the first render when the app opens in the Web style, and App
// waits for it before switching to that style. So App can read the components
// synchronously (loadedWebShell) instead of suspending — the same arrangement
// as radarChunk.js.
let promise = null
let shell = null

export function loadWebShell() {
  // A failed fetch (offline) is forgotten, so the next caller tries again
  // instead of inheriting the failure.
  promise ??= import('./WebShell')
    .then((m) => (shell = m))
    .catch((e) => { promise = null; throw e })
  return promise
}

export function loadedWebShell() {
  return shell
}
