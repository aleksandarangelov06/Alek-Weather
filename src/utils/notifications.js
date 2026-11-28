// Notifications are APK-only. An Android WebView exposes no Web Notifications
// API, so the native shell (MainActivity) injects a `window.AndroidNotify`
// bridge instead: permission() -> 'granted' | 'denied' | 'default', it opens
// the OS prompt on requestPermission() and reports the outcome back as an
// `aleknotifpermission` CustomEvent. With no bridge (any plain browser) every
// entry point below no-ops, so the feature is simply absent off-APK.
//
// Deciding *what* to notify about happens natively, in WeatherCheckWorker: a
// notification is only worth having if it also arrives when the app is closed,
// and nothing in this file runs then. So the page's only remaining job is to
// mirror the settings and the current location over to the worker, which then
// checks the forecast on its own schedule.
function bridge() {
  return (typeof window !== 'undefined' && window.AndroidNotify) || null
}

export function getPermission() {
  const b = bridge()
  if (!b) return 'unsupported'
  try { return b.permission() } catch { return 'unsupported' }
}

export function requestPermission() {
  const b = bridge()
  if (!b) return Promise.resolve('unsupported')
  let current = 'default'
  try { current = b.permission() } catch { /* treat as default */ }
  // Already decided — nothing to prompt for.
  if (current === 'granted' || current === 'denied') return Promise.resolve(current)
  // 'default': the native request is async; the shell fires an
  // aleknotifpermission event once the user answers the system dialog.
  return new Promise((resolve) => {
    const onResult = (e) => {
      window.removeEventListener('aleknotifpermission', onResult)
      resolve(typeof e.detail === 'string' ? e.detail : getPermission())
    }
    window.addEventListener('aleknotifpermission', onResult)
    try {
      b.requestPermission()
    } catch {
      window.removeEventListener('aleknotifpermission', onResult)
      resolve('unsupported')
    }
  })
}

/**
 * The place notifications are about: Home, else the first saved place, else the
 * forecast on screen (null on the splash, which the shell treats as "keep the
 * last place"). Someone with a Home who looks up another city should still hear
 * about rain at home, not in the city they glanced at.
 */
export function notificationPlace({ home, cities, location }) {
  return home ?? cities?.[0] ?? location ?? null
}

/**
 * Hands the native worker everything it needs to check the weather without the
 * app: the master toggle, the enabled types, the notification place (see
 * notificationPlace; null keeps whatever the shell already has), and the
 * temperature unit to phrase the daily summary in.
 *
 * The home-screen widgets show the same place, so its name and the wind and
 * pressure units ride along too.
 *
 * Called on every change to any of those. Syncing also kicks an immediate
 * check, so switching a type on can produce a notification straight away rather
 * than at the top of the next hour.
 */
export function syncNotificationSettings({ enabled, types, location, unit, units }) {
  const b = bridge()
  if (!b) return
  try {
    b.syncSettings(JSON.stringify({
      enabled: Boolean(enabled),
      types: types ?? [],
      latitude: location?.latitude ?? null,
      longitude: location?.longitude ?? null,
      unit: unit ?? 'F',
      name: location?.name ?? null,
      units: units ? { wind: units.wind, pressure: units.pressure } : null,
    }))
  } catch { /* older shell without the method */ }
}
