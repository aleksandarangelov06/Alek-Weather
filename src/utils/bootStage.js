// The boot screen's weather animation (the .boot-stage in index.html), reused
// as the phone's forecast loading animation (LoadingScreen.jsx), so both are
// the one piece of artwork with one set of rules rather than two copies that
// drift apart.
//
// The boot screen is removed once the app is up, so main.jsx keeps a detached
// copy of its stage first (keepBootStage), before anything can remove it; each
// loading screen then takes a fresh clone of that copy, so its animations
// start from the top (the logo popping in) every time it appears. The stage's
// CSS lives in index.html's <style>, which stays in the page after the boot
// screen goes.
//
// A clone carries the same gradient ids as the boot screen's stage. While both
// are in the page (a forecast still loading under the boot screen), url(#…)
// finds the boot screen's copy first, and since they are identical definitions
// nothing changes on screen; once the boot screen is gone the clone's own are
// the only ones left.

let template = null

// By now public/boot-cycle.js has switched the boot screen's slides over to
// its shuffled sequence, turning off their CSS loop with an inline style. The
// copy drops that, so a clone starts out on the CSS loop and only leaves it if
// startBootCycle takes over.
export function keepBootStage() {
  const stage = document.querySelector('#boot .boot-stage')
  if (!stage) return
  template = stage.cloneNode(true)
  for (const slide of template.querySelectorAll('.boot-slide')) slide.style.removeProperty('animation')
}

// Plays a fresh shuffled scene order on a stage that is in the page (see
// public/boot-cycle.js). Without that script (it failed to load), the stage
// keeps the fixed-order CSS loop.
export function startBootCycle(stage) {
  return window.alekBootCycle?.(stage) ?? false
}

// A fresh copy of the stage, or null if there was no boot screen to keep one
// from (index.html always has one; this is only so a missing one degrades to
// an empty loading area rather than an error).
export function cloneBootStage() {
  return template ? template.cloneNode(true) : null
}
