// The web app's press, on the phone shells: whatever you tap gives under the
// finger and springs back with a small overshoot when you let go (see
// .web-tab:active and .web-tabs.card:active in WebApp.css). The round icon
// buttons already do this through data-pressed (PRESS_DIP_SELECTOR in App);
// this covers everything else you can tap that had no answer of its own: the
// rows and tiles that open things, and the small chips and buttons.
//
// Driven from script rather than :active, for three reasons:
//  · Timing. A quick tap can raise and drop :active inside one frame, so the
//    dip never paints. Here a press is held for at least PRESS_MIN_MS.
//  · Scrolling. Rows and tiles are most of what a finger lands on to scroll,
//    and :active lights them on every scroll start. A surface waits
//    SURFACE_DELAY_MS before it dips, and a scroll (pointercancel) or a drag
//    past MOVE_SLOP_PX in that time means it never does. A tap shorter than
//    the wait still gets its dip, from the release.
//  · Ownership. These elements each have their own `transition` lists in
//    App.css, per platform, and a press rule would have to restate every one
//    of them. A Web Animation on the `scale` property sits beside all of that:
//    it touches nothing else, composes with any `transform` the element
//    already has (.hourly-nav's centring, .md-swatch's hover), and is
//    composited, so a press never costs layout or paint.
//
// The timing is the web's: down in 60ms on an even curve, because a press
// should feel like contact rather than an animation; back up in 350ms on an
// overshooting one, which is what reads as a spring rather than a fade.
//
// In the Android app each tap also ticks (utils/haptics.js), when the finger
// lifts: only a press that ends as a tap (no scroll, no drag past the slop)
// ever ticks. Ticking with the dip buzzed whenever a finger rested on a row or
// a control on its way into a scroll. Presses with no dip of their own here
// get the tick alone (TICK_ONLY).

import { haptic, HAS_HAPTICS } from './haptics'

const PRESS_MIN_MS = 110
const SURFACE_DELAY_MS = 60
const MOVE_SLOP_PX = 10
const DOWN = { duration: 60, easing: 'cubic-bezier(0.4, 0, 0.6, 1)', fill: 'forwards' }
const UP = { duration: 350, easing: 'cubic-bezier(0.34, 1.5, 0.64, 1)' }

// Big things that open something: a small give, as the web's splash cards
// (0.985). Their finger-down waits out the scroll check.
const SURFACES = [
  '.daily-row--expand',
  '.detail-expand-tile',
  '.alert-row',
  'button.settings-row',
  '.settings-pill-bar',
  '.saved-city-btn',
  '.recent-item-btn',
  '.ss-row-main',
  '.dropdown-item',
].join(',')

// Small controls: a deeper dip that also drops a pixel, as a web tab does.
// Left out on purpose, because each already has a press of its own that this
// would stack on: .glance-nav, .ss-chip, the radar's floating buttons and play
// circle, and iOS's Back pill (Android's Back only tints, so it is in).
const CONTROLS = [
  '.hourly-tl-chip',
  '.setting-opt',
  '.md-swatch',
  '.install-btn',
  '.ws-btn',
  '.alert-map-btn',
  '.alert-close-btn',
  '.theme-chevron-btn',
  '.settings-info-btn',
  '.about-help-btn',
  '.hourly-nav',
  '.refresh-btn',
  '.radar-expand-btn:not(.radar-expand-btn--floating)',
  '.ss-back',
  '.ss-locate',
  '.update-toast-close',
  ':root[data-platform="android"] .back-btn',
].join(',')

// Things whose tap target is a layer over them rather than the thing itself:
// the press goes to what you see. The radar's map is an invisible overlay
// (.radar-map-tap), and it is the map's window that gives, not the card
// around it: the window is what grows into the full-screen radar, so it is
// the part that answers the finger. It gives a little further than a row,
// since what it opens is the whole screen; WeatherRadar carries this press on
// into the opening (see releasePress).
const PROXIES = [
  { tap: '.radar-map-tap', target: '.radar-map-wrap', pressed: { scale: '0.97' } },
]

const SURFACE_PRESS = { scale: '0.985' }
const CONTROL_PRESS = { scale: '0.94', translate: '0 1px' }
const REST = { scale: '1', translate: '0 0' }

// The press on each element still dipped or springing, so releasePress can
// find it after the finger is up (click lands after pointerup).
const live = new Map()

// Takes a press off `el` at once, for something about to measure it or
// replace it with a copy: the radar measures the card and clones it as it
// opens, and a card caught mid-dip would give it a wrong size and a still
// that jumps. Returns the scale the press had reached, so the caller can
// spring its own stand-in back from there (1 when nothing was pressed).
export function releasePress(el) {
  const p = el && live.get(el)
  if (!p) return 1
  // Still held down: the full depth of the press, not how far the dip has got.
  // A quick tap only dips on release, and its click comes straight after, so
  // the dip has painted nothing yet; the stand-in shows it instead.
  const held = p.anims[0] === p.anim
  const s = held ? parseFloat(p.pressed.scale) : parseFloat(getComputedStyle(el).scale)
  p.released = true
  live.delete(el)
  for (const a of p.anims) a.cancel()
  return Number.isFinite(s) ? s : 1
}

// The spring back up, for a stand-in to finish a press that releasePress took
// off its original. Returns the animation (null when there is none to run).
export function springFrom(el, scale) {
  if (!el || !(scale < 1)) return null
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return null
  const up = el.animate([{ scale: String(scale) }, { scale: '1' }], UP)
  up.onfinish = () => up.cancel()
  return up
}

// Everything else you can press, for the haptic tick alone (the Android app;
// utils/haptics.js): buttons with a press of their own already (the round
// icon buttons, the radar's, the glance arrows), switches, links. Like every
// press, it ticks on release, so a scroll that starts on one never does.
const TICK_ONLY = [
  'button',
  '[role="button"]',
  'a[href]',
  'label.toggle-switch',
  'summary',
].join(',')

export function installTactilePress() {
  const root = document.documentElement
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)')

  // One press at a time: a second finger down ends the first.
  let cur = null

  // The press landing: the dip, if this press has one.
  const dip = (p) => {
    if (p.dipped || p.released) return
    p.dipped = true
    p.downAt = performance.now()
    if (!p.pressed) return
    // A new press on something still springing back from the last one.
    live.get(p.el)?.anims.forEach(a => a.cancel())
    live.set(p.el, p)
    p.anim = p.el.animate([REST, p.pressed], DOWN)
    p.anims.push(p.anim)
  }

  const springBack = (p) => {
    const down = p.anim
    if (!down || p.released) return
    // From wherever the dip got to, so a press cut short doesn't jump.
    const from = {}
    const cs = getComputedStyle(p.el)
    from.scale = cs.scale === 'none' ? '1' : cs.scale
    from.translate = cs.translate === 'none' ? '0 0' : cs.translate
    const up = p.el.animate([from, REST], UP)
    down.cancel()
    p.anims = [up]
    up.onfinish = () => {
      up.cancel()
      if (live.get(p.el) === p) live.delete(p.el)
    }
  }

  const end = (p, { hold }) => {
    clearTimeout(p.delay)
    if (cur === p) cur = null
    if (!hold) { springBack(p); return }
    // A tap: the finger lifted without scrolling. Now it ticks.
    if (!p.released) haptic('tap')
    // A tap released before a surface's wait ran out dips now, from the release.
    dip(p)
    const wait = Math.max(0, PRESS_MIN_MS - (performance.now() - p.downAt))
    setTimeout(() => springBack(p), wait)
  }

  // What a touch on `target` presses, and how: { el, pressed, immediate }, or
  // null for nothing. `pressed` is null for a tick with no dip.
  const resolve = (target) => {
    // The dip is the phone shells' (the web layout has its own presses), and
    // stays out of reduced motion; the tick goes wherever the app runs.
    const visual = root.dataset.shell === 'mobile' && !reduce.matches
    if (visual) {
      const control = target.closest(CONTROLS)
      if (control) return { el: control, pressed: CONTROL_PRESS, immediate: true }
      const surface = target.closest(SURFACES)
      if (surface) return { el: surface, pressed: SURFACE_PRESS, immediate: false }
      for (const proxy of PROXIES) {
        const tap = target.closest(proxy.tap)
        const el = tap?.closest(proxy.target)
        if (el) return { el, pressed: proxy.pressed, immediate: false }
      }
    }
    if (!HAS_HAPTICS) return null
    const el = target.closest(TICK_ONLY)
    return el ? { el, pressed: null, immediate: false } : null
  }

  const onDown = (e) => {
    if (!e.isPrimary || e.button !== 0) return
    const target = e.target
    if (!(target instanceof Element)) return
    const hit = resolve(target)
    if (!hit) return
    const { el, pressed, immediate } = hit
    if (el.matches(':disabled, [aria-disabled="true"]')) return
    // A control inside a surface (a row's own button) is pressed on its own.
    if (cur) end(cur, { hold: false })
    const p = {
      el,
      pressed,
      x: e.clientX,
      y: e.clientY,
      dipped: false,
      anim: null,
      anims: [],
      released: false,
      downAt: 0,
      delay: 0,
    }
    cur = p
    if (immediate || e.pointerType === 'mouse') dip(p)
    else p.delay = setTimeout(() => dip(p), SURFACE_DELAY_MS)
  }

  const onMove = (e) => {
    if (!cur || !e.isPrimary) return
    if (Math.hypot(e.clientX - cur.x, e.clientY - cur.y) > MOVE_SLOP_PX) end(cur, { hold: false })
  }
  const onUp = (e) => { if (cur && e.isPrimary) end(cur, { hold: true }) }
  const onCancel = () => { if (cur) end(cur, { hold: false }) }

  const opts = { passive: true, capture: true }
  document.addEventListener('pointerdown', onDown, opts)
  document.addEventListener('pointermove', onMove, opts)
  document.addEventListener('pointerup', onUp, opts)
  document.addEventListener('pointercancel', onCancel, opts)
  return () => {
    document.removeEventListener('pointerdown', onDown, opts)
    document.removeEventListener('pointermove', onMove, opts)
    document.removeEventListener('pointerup', onUp, opts)
    document.removeEventListener('pointercancel', onCancel, opts)
    if (cur) end(cur, { hold: false })
  }
}
