// Boot screen sky (see #boot in index.html). Loaded as a plain, blocking script
// in <head>, ahead of everything else, because it has to land before the first
// paint: the boot screen is that paint. Inline script would do the same, but
// the CSP only allows script files from the app's own origin.
//
// App stores the sky gradient it draws behind the forecast, with the place it
// was for (see BOOT_SKY_KEY in App.jsx). A launch only opens on a forecast when
// there is a city to load, the home city or else the first saved one
// (INITIAL_CITY in App.jsx); otherwise it opens on the splash, which has its
// own background, and the boot screen keeps its plain one. The stored sky is
// only used when it belongs to the city the launch will open, within about a
// kilometre (readings are matched that loosely too); for any other, App fades
// the right sky in once it has worked it out, rather than this showing a
// different city's and then swapping.
//
// In the APK the launch screen is native (BootOverlay in MainActivity), drawn
// over the WebView so its animation never waits on the page. While it is up
// this marks the page with data-native-boot, which leaves #boot a blank cover
// under it, and hands it the same look: the Theme setting and this sky.
// window.alekBootLook hands it over again whenever App keeps a newer sky (see
// rememberBootLook in utils/bootStage.js), so the next launch opens on it from
// its first frame, before there is a page to ask.
(function () {
  var root = document.documentElement
  var bridge = window.AndroidBoot
  var native = false
  try { native = !!(bridge && bridge.active()) } catch { /* an older APK */ }
  if (native) root.setAttribute('data-native-boot', '')

  // The icon style (Settings → Icons): with Line chosen, the boot stage shows
  // its line glyphs in place of the colour ones (see .bli in index.html), so
  // the page is marked before the first paint. utils/iconSet.js keeps the mark
  // current from then on, for the loading screens cloned from this stage.
  try {
    if (window.localStorage.getItem('alek-weather-icon-set') === 'line') root.setAttribute('data-icon-set', 'line')
  } catch { /* storage unavailable: the colour glyphs, the default */ }

  // { theme, sky }: the Theme setting, and the kept sky when it is the city a
  // launch opens on (else null).
  function look() {
    var now = { theme: '', sky: null }
    try {
      var store = window.localStorage
      now.theme = store.getItem('alek-weather-theme') || ''
      var city = JSON.parse(store.getItem('alek-weather-home') || 'null')
      if (!city) city = (JSON.parse(store.getItem('alek-weather-saved') || 'null') || [])[0]
      if (!city) return now
      var sky = JSON.parse(store.getItem('alek-weather-boot-sky') || 'null')
      if (!sky || typeof sky.bg !== 'string' || sky.bg.indexOf('gradient(') < 0) return now
      if (!sky.at || Math.abs(sky.at[0] - city.latitude) > 0.01 || Math.abs(sky.at[1] - city.longitude) > 0.01) return now
      now.sky = sky.bg
    } catch { /* storage unavailable or unreadable: the plain background */ }
    return now
  }

  // Hands the look to the native launch screen, which keeps it for the next
  // launch and shows it now if it is still up. Outside the APK, only reads it.
  window.alekBootLook = function () {
    var now = look()
    try { if (bridge) bridge.look(now.theme, now.sky || '') } catch { /* an older APK */ }
    return now
  }

  var now = native ? window.alekBootLook() : look()
  if (now.sky) {
    root.style.setProperty('--boot-sky', now.sky)
    root.setAttribute('data-boot-sky', '')
  }
})()
