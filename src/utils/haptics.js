import { IS_ANDROID_APP } from './version'

// Haptics in the Android app. They go through the native bridge
// (window.AndroidHaptics, MainActivity.HapticBridge) rather than
// navigator.vibrate: the bridge uses the system's own haptic clicks
// (View.performHapticFeedback), which are the short, crisp ticks the rest of
// Android uses, follow the phone's own Touch feedback setting, and need no
// VIBRATE permission. navigator.vibrate needs that permission, which the APK
// doesn't ask for, so it never did anything there. An APK built before the
// bridge has no window.AndroidHaptics, and these calls do nothing on it.
//
// Settings > Haptics turns them off (HAPTICS_KEY, on by default). Kept in
// this module as well as in App's state, so a press can check it without
// reading localStorage on every touch.

export const HAPTICS_KEY = 'alek-weather-haptics'

let enabled = (() => {
  try { return localStorage.getItem(HAPTICS_KEY) !== 'false' } catch { return true }
})()

export const HAS_HAPTICS = IS_ANDROID_APP

export function setHapticsEnabled(on) {
  enabled = on
  try { localStorage.setItem(HAPTICS_KEY, String(on)) } catch { /* private mode */ }
}

// 'tap': a press landing (the light tick of a key). 'heavy': a hold that
// completed, or anything that should feel like more than a tap.
export function haptic(kind = 'tap') {
  if (!enabled || !IS_ANDROID_APP) return
  const bridge = window.AndroidHaptics
  if (!bridge) return
  try {
    if (kind === 'heavy') bridge.heavy()
    else bridge.tap()
  } catch { /* bridge gone mid-reload */ }
}
