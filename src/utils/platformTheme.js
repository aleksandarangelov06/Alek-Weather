import { IS_ANDROID_APP } from './version'
import { IS_PHONE, IS_DESKTOP, DEV_DEVICE } from './device'

// The app style a launch opens in, worked out the same way by App (its initial
// state) and main.jsx, which has to know before the first render whether to wait
// for the web layout's chunk (see components/web/webShellChunk).

export const PLATFORM_THEME_KEY = 'alek-weather-platform-theme' // 'ios' | 'android' | 'web'

// Viewport width at which the desktop layout takes over. Shared with App's
// isDesktop media query so the first-run default and the layout agree on what
// counts as a desktop.
export const DESKTOP_MQ = '(min-width: 1100px)'

// First-run app style, from the device. The order matters: the APK is always
// the phone app no matter how large the tablet it runs on, so it is settled
// first; then Apple touch devices take the iOS look (modern iPads report as
// "Macintosh", so touch support is the tell that separates them from actual
// Macs); then anything on a desktop-sized screen opens in the web app rather
// than a phone design stretched across a monitor. Everything left is a
// non-Apple phone, which gets Android. The setting can override the default,
// within limits: phones can't pick Web, and desktops (IS_DESKTOP) are always
// Web.
export function defaultPlatformTheme() {
  if (IS_ANDROID_APP) return 'android'
  if (IS_DESKTOP) return 'web'
  // Dev override (see device.js): a pretend phone takes its pretend OS's look.
  if (DEV_DEVICE === 'iphone') return 'ios'
  if (DEV_DEVICE === 'android') return 'android'
  const isApple = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1)
  if (isApple) return 'ios'
  return window.matchMedia(DESKTOP_MQ).matches ? 'web' : 'android'
}

// The web app needs a desktop-sized viewport: on a phone its header controls
// run off screen, settings among them, and with settings out of reach the
// choice can't be undone. So a phone never keeps 'web' — the Web option is
// hidden there (see SettingsPage), and anything already stored, from an older
// build or another device, falls back to the phone look on the next launch. A
// desktop is the reverse: it is always Web, so a stored iOS or Android choice
// is ignored there.
export function initialPlatformTheme() {
  if (IS_DESKTOP) return 'web'
  let saved = null
  try { saved = localStorage.getItem(PLATFORM_THEME_KEY) } catch { /* storage unavailable */ }
  if (!saved || (saved === 'web' && IS_PHONE)) return defaultPlatformTheme()
  return saved
}
