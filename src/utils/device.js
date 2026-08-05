import { IS_ANDROID_APP } from './version'

// True on a phone-sized device. Read from the screen and the pointer rather
// than the window on purpose: this describes the hardware, so it must not flip
// when a browser window is resized. Tablets (shortest edge 600px and up) are
// not phones and keep every app style.
export const IS_PHONE = (() => {
  if (IS_ANDROID_APP) return true
  if (typeof window === 'undefined') return false
  const coarse = window.matchMedia('(pointer: coarse)').matches
  const shortest = Math.min(window.screen?.width ?? 0, window.screen?.height ?? 0)
  return coarse && shortest > 0 && shortest < 600
})()
