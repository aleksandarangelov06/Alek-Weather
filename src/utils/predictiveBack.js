// Predictive back for the Android app.
//
// MainActivity streams the system back gesture to the page as `alekback`
// CustomEvents — start / progress / cancel / commit — while the WebView has
// history to go back to (i.e. while an overlay is open). This module animates
// the overlay that back would close, following Material 3's predictive-back
// spec for full-screen surfaces: as the finger travels the surface shrinks
// toward 90%, drifts away from the edge being swiped, and rounds its corners,
// so the screen underneath shows around it before the user commits.
//
//   cancel → the surface springs back to full size.
//   commit → native calls WebView.goBack() right after, so the popstate that
//            closes the overlay is already on its way. What the surface does
//            next depends on the overlay (see TARGETS).
//
// Nothing here runs on iOS, the web build or Android < 14: those never receive
// a `start`, and a `commit` without one is ignored, so the overlays' own close
// animations run exactly as before.

const MIN_SCALE = 0.9
const MAX_SHIFT = 24      // px the surface drifts away from the swiped edge
const MAX_RADIUS = 28     // px corner radius at full progress (M3 extra-large)
const SETTLE_MS = 200

// Which element is "the overlay back will close", keyed by the history entry
// the overlay pushed. Read from history.state at gesture start, because that
// entry is exactly the one goBack() is about to pop.
//
// commit modes:
//   exit    — the overlay is going away. Its own .closing keyframes would start
//             from full size and undo the gesture, so they are suppressed
//             (.pb-exit) and the surface fades out from where the finger left
//             it until the overlay's close timer unmounts it.
//   release — back pops a level *inside* the surface (a settings sub-page back
//             to the list), so the surface stays and grows back to full size
//             as its content changes.
//   hold    — the radar collapses with its own iris; the frame keeps its
//             shrunk transform while the circle closes, then is reset once the
//             card is back in the page.
const TARGETS = {
  alertMap: { sel: ['.alert-map-overlay'], commit: 'exit' },
  settings: { sel: ['.settings-page:not(.saved-cities-page)'], commit: 'exit' },
  subview:  { sel: ['.settings-page:not(.saved-cities-page)'], commit: 'release' },
  saved:    { sel: ['.saved-cities-page'], commit: 'exit' },
  search:   { sel: ['.search-overlay'], commit: 'exit' },
  radar:    { sel: ['.radar-iris--framed', '.radar-card.radar-expanded'], commit: 'hold', holdMs: 600 },
}

let active = null   // { el, cfg } for the gesture in progress

function findTarget() {
  const cfg = TARGETS[history.state?.overlay]
  if (!cfg) return null
  for (const sel of cfg.sel) {
    const el = document.querySelector(sel)
    if (el) return { el, cfg }
  }
  return null
}

// M3 eases the raw touch progress so the first part of the swipe does most of
// the shrinking and the surface doesn't keep crawling right up to the release.
const ease = (p) => 1 - Math.pow(1 - Math.min(Math.max(p, 0), 1), 2)

function apply(el, progress, edge) {
  const p = ease(progress)
  const scale = 1 - (1 - MIN_SCALE) * p
  const dir = edge === 'left' ? 1 : -1
  el.style.transform = `translateX(${dir * MAX_SHIFT * p}px) scale(${scale})`
  el.style.borderRadius = `${MAX_RADIUS * p}px`
}

function clear(el) {
  el.classList.remove('pb-active', 'pb-settle', 'pb-exit')
  el.style.transform = ''
  el.style.borderRadius = ''
  el.style.opacity = ''
}

function settleBack(el) {
  el.classList.add('pb-settle')
  el.style.transform = ''
  el.style.borderRadius = ''
  setTimeout(() => { if (!el.classList.contains('pb-active')) clear(el) }, SETTLE_MS + 50)
}

function onBack(e) {
  const d = e.detail || {}
  switch (d.type) {
    case 'start': {
      if (active) clear(active.el)
      active = findTarget()
      if (!active) return
      active.el.classList.remove('pb-settle', 'pb-exit')
      active.el.classList.add('pb-active')
      apply(active.el, 0, d.edge)
      break
    }
    case 'progress':
      if (active) apply(active.el, d.progress, d.edge)
      break
    case 'cancel': {
      if (!active) return
      const { el } = active
      active = null
      el.classList.remove('pb-active')
      settleBack(el)
      break
    }
    case 'commit': {
      if (!active) return
      const { el, cfg } = active
      active = null
      el.classList.remove('pb-active')
      if (cfg.commit === 'exit') {
        el.classList.add('pb-exit')
        el.style.opacity = '0'
        // Normally unmounted by the overlay's close timer well before this;
        // the reset only matters if something kept it on screen.
        setTimeout(() => { if (el.isConnected) clear(el) }, 700)
      } else if (cfg.commit === 'release') {
        settleBack(el)
      } else {
        setTimeout(() => clear(el), cfg.holdMs ?? 600)
      }
      break
    }
  }
}

export function installPredictiveBack() {
  window.addEventListener('alekback', onBack)
}
