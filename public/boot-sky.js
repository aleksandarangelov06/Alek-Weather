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
(function () {
  try {
    var store = window.localStorage
    var city = JSON.parse(store.getItem('alek-weather-home') || 'null')
    if (!city) city = (JSON.parse(store.getItem('alek-weather-saved') || 'null') || [])[0]
    if (!city) return
    var sky = JSON.parse(store.getItem('alek-weather-boot-sky') || 'null')
    if (!sky || typeof sky.bg !== 'string' || sky.bg.indexOf('gradient(') < 0) return
    if (!sky.at || Math.abs(sky.at[0] - city.latitude) > 0.01 || Math.abs(sky.at[1] - city.longitude) > 0.01) return
    var root = document.documentElement
    root.style.setProperty('--boot-sky', sky.bg)
    root.setAttribute('data-boot-sky', '')
  } catch { /* storage unavailable or unreadable: the plain background */ }
})()
