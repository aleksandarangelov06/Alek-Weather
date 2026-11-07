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
// State is written as a data-pb attribute (see App.css), never a class: React
// owns the overlays' className and rewrites it when they re-render — exactly
// what happens on commit, when .closing is added — which would drop a class
// mid-animation and snap the surface back to full size.
//
// Nothing here runs on iOS, the web build or Android < 14: those never receive
// a `start`, and a `commit` without one is ignored, so the overlays' own close
// animations run exactly as before.

const MIN_SCALE = 0.9
const MAX_SHIFT = 24      // px the surface drifts away from the swiped edge
const MAX_RADIUS = 28     // px corner radius at full progress (M3 extra-large)
const SETTLE_MS = 250
// On commit the surface keeps going the way the gesture was taking it: a little
// smaller again while it fades, matching the pages' own close (pageShrinkOut).
const EXIT_SCALE = 0.94
const EXIT_MS = 200

// Which elements are "the overlay back will close", keyed by the history entry
// the overlay pushed. Read from history.state at gesture start, because that
// entry is exactly the one goBack() is about to pop.
//
// sel  — the surface; the first selector that matches wins.
// with — layers that must move as one with it. The settings page's glass sits
//        on an opaque sky layer; left full-screen, the sky would hide the
//        weather page the gesture is meant to preview.
//
// commit modes:
//   exit    — the overlay is going away. Its own .closing keyframes would start
//             from full size and undo the gesture, so they are suppressed and
//             the surface carries on shrinking and fades from where the finger
//             left it, until the overlay's close timer unmounts it.
//   release — back pops a level *inside* the surface (a settings sub-page back
//             to the list), so the surface stays and grows back to full size
//             as its content changes.
//             With keep: false the surface is left with no trace afterwards
//             (the radar frame has animations of its own to run next time).
//             The radar uses this: its close morphs the full-screen radar back
//             into its card, measured against the frame at full size, so the
//             frame eases back out of the gesture while the card shrinks home.
const SETTINGS_PAGE = '.settings-page:not(.saved-cities-page)'
const TARGETS = {
  alertMap: { sel: ['.alert-map-overlay'], commit: 'exit' },
  settings: { sel: [SETTINGS_PAGE], with: ['.settings-sky'], commit: 'exit' },
  subview:  { sel: [SETTINGS_PAGE], with: ['.settings-sky'], commit: 'release' },
  saved:    { sel: ['.saved-cities-page'], commit: 'exit' },
  search:   { sel: ['.search-overlay'], commit: 'exit' },
  radar:    { sel: ['.radar-iris--framed', '.radar-card.radar-expanded'], commit: 'release', keep: false },
}

// The gesture in progress: { els, cfg, p, edge }.
let active = null

function findTarget() {
  const cfg = TARGETS[history.state?.overlay]
  if (!cfg) return null
  for (const sel of cfg.sel) {
    const el = document.querySelector(sel)
    if (!el) continue
    const extra = (cfg.with ?? []).map((s) => document.querySelector(s)).filter(Boolean)
    return { els: [el, ...extra], cfg, p: 0, edge: 'left' }
  }
  return null
}

// M3 eases the raw touch progress so the first part of the swipe does most of
// the shrinking and the surface doesn't keep crawling right up to the release.
const ease = (p) => 1 - Math.pow(1 - Math.min(Math.max(p, 0), 1), 2)

function transformFor(progress, edge, extraScale = 1) {
  const p = ease(progress)
  const scale = (1 - (1 - MIN_SCALE) * p) * extraScale
  const dir = edge === 'left' ? 1 : -1
  return { p, transform: `translateX(${dir * MAX_SHIFT * p}px) scale(${scale})` }
}

function apply(els, progress, edge) {
  const { p, transform } = transformFor(progress, edge)
  for (const el of els) {
    el.style.transform = transform
    el.style.borderRadius = `${MAX_RADIUS * p}px`
  }
}

// `keep` leaves data-pb-done behind, which holds the page's opening animation
// off (App.css). Without it, lifting `animation: none` would start the opening
// keyframes over again and the page would replay its zoom-in after a cancel.
function clear(el, keep) {
  delete el.dataset.pb
  if (keep) el.dataset.pbDone = ''
  el.style.transform = ''
  el.style.borderRadius = ''
  el.style.opacity = ''
}

function settleBack(els, keep) {
  for (const el of els) {
    el.dataset.pb = 'settle'
    el.style.transform = ''
    el.style.borderRadius = ''
  }
  setTimeout(() => {
    for (const el of els) if (el.dataset.pb === 'settle') clear(el, keep)
  }, SETTLE_MS + 50)
}

function onBack(e) {
  const d = e.detail || {}
  switch (d.type) {
    case 'start': {
      if (active) active.els.forEach((el) => clear(el, active.cfg.keep !== false))
      active = findTarget()
      if (!active) return
      active.edge = d.edge
      for (const el of active.els) el.dataset.pb = 'active'
      apply(active.els, 0, d.edge)
      break
    }
    case 'progress':
      if (!active) return
      active.p = d.progress
      active.edge = d.edge ?? active.edge
      apply(active.els, active.p, active.edge)
      break
    case 'cancel': {
      if (!active) return
      const { els, cfg } = active
      active = null
      settleBack(els, cfg.keep !== false)
      break
    }
    case 'commit': {
      if (!active) return
      const { els, cfg, p, edge } = active
      active = null
      if (cfg.commit === 'exit') {
        const { transform } = transformFor(p, edge, EXIT_SCALE)
        for (const el of els) {
          el.dataset.pb = 'exit'
          el.style.transform = transform
          el.style.opacity = '0'
        }
        // Normally unmounted by the overlay's close timer well before this;
        // the reset only matters if something kept it on screen.
        setTimeout(() => els.forEach((el) => { if (el.isConnected) clear(el, true) }), EXIT_MS + 500)
      } else {
        settleBack(els, cfg.keep !== false)
      }
      break
    }
  }
}

export function installPredictiveBack() {
  window.addEventListener('alekback', onBack)
}
