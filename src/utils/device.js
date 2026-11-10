import { IS_ANDROID_APP } from './version'

// Dev-only device override, for testing the phone styles in a desktop browser
// (or the VS Code preview, which has no device emulation). Add ?device=… to the
// URL: iphone, android, tablet or desktop. ?device=auto clears it. The choice is
// kept in sessionStorage so it survives reloads and the app's own URL changes,
// and ends when the tab closes. Production builds ignore it entirely.
const DEV_DEVICE_KEY = 'alek-weather-dev-device'
const DEV_DEVICES = ['iphone', 'android', 'tablet', 'desktop']

export const DEV_DEVICE = (() => {
  if (!import.meta.env.DEV || typeof window === 'undefined') return null
  try {
    const param = new URLSearchParams(window.location.search).get('device')?.toLowerCase()
    if (param === 'auto') sessionStorage.removeItem(DEV_DEVICE_KEY)
    else if (DEV_DEVICES.includes(param)) sessionStorage.setItem(DEV_DEVICE_KEY, param)
    const stored = sessionStorage.getItem(DEV_DEVICE_KEY)
    return DEV_DEVICES.includes(stored) ? stored : null
  } catch {
    return null
  }
})()

// True on a phone-sized device. Read from the screen and the pointer rather
// than the window on purpose: this describes the hardware, so it must not flip
// when a browser window is resized. Tablets (shortest edge 600px and up) are
// not phones and keep every app style.
export const IS_PHONE = (() => {
  if (IS_ANDROID_APP) return true
  if (DEV_DEVICE) return DEV_DEVICE === 'iphone' || DEV_DEVICE === 'android'
  if (typeof window === 'undefined') return false
  const coarse = window.matchMedia('(pointer: coarse)').matches
  const shortest = Math.min(window.screen?.width ?? 0, window.screen?.height ?? 0)
  return coarse && shortest > 0 && shortest < 600
})()

// True on a desktop or laptop: a mouse or trackpad as the primary pointer, and
// no mobile OS. Like IS_PHONE this describes the hardware, so a narrow browser
// window on a desktop is still a desktop. Touchscreen laptops count (their
// primary pointer is still fine); iPads, including the ones that report as
// "Macintosh", and Android tablets don't, and keep every app style.
export const IS_DESKTOP = (() => {
  if (IS_ANDROID_APP || IS_PHONE) return false
  if (DEV_DEVICE) return DEV_DEVICE === 'desktop'
  if (typeof window === 'undefined') return false
  const ua = navigator.userAgent
  if (/Android|iPhone|iPad|iPod/i.test(ua) || /Mobi/i.test(ua)) return false
  if (ua.includes('Macintosh') && navigator.maxTouchPoints > 1) return false
  return window.matchMedia('(hover: hover) and (pointer: fine)').matches
})()

// Modest phone or tablet hardware: four cores or fewer, or 2 GB of memory or
// less (navigator.deviceMemory, Chromium only). The sky effects draw at half
// rate there (see WeatherCanvas), which also halves how often every glass card
// over the sky has its backdrop blur redone. Desktops are left out, and so are
// Apple devices, since Safari reports no memory figure to go by.
export const LOW_END = (() => {
  if (IS_DESKTOP || typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  if (/iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1)) return false
  const cores = navigator.hardwareConcurrency ?? 0
  const memory = navigator.deviceMemory ?? 0
  return (cores > 0 && cores <= 4) || (memory > 0 && memory <= 2)
})()
