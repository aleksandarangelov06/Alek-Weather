// The muted canvas both maps draw on, labels included.
//
// This was CARTO Positron (`basemaps.cartocdn.com/light_all`) until CARTO put
// their previously-open basemaps behind a key, then Esri's Light Gray Canvas.
// Both were raster: 256px pictures of the map, labels baked in. On a scaled
// display (125–150% on most Windows laptops) the browser stretched every one of
// them, and the radar's fractional zoom stretched them again, so the place
// names were always a little soft. Dark mode was that same light picture run
// through invert(), which muddied the label edges further.
//
// OpenFreeMap serves OpenStreetMap as vector tiles: open source, no key, no
// usage limits. MapLibre GL draws them on the device, at the device's pixel
// ratio and at whatever zoom Leaflet is sitting on, so text is sharp everywhere.
// It also has a real dark style, which replaces the invert.
//
// MapLibre rides inside Leaflet as a single layer (maplibre-gl-leaflet), so the
// radar frames, alert polygons and the "here" dot are untouched.
const OFM = 'https://tiles.openfreemap.org/styles'

export const BASEMAP_STYLE_LIGHT = `${OFM}/positron`
export const BASEMAP_STYLE_DARK  = `${OFM}/dark`

// OpenFreeMap and OpenStreetMap ask for this wherever the basemap is shown. Both
// maps currently run with attributionControl:false, so it is carried on the
// layer rather than displayed.
export const BASEMAP_ATTRIBUTION =
  'OpenFreeMap © OpenMapTiles Data from OpenStreetMap'

// MapLibre is ~1 MB of script, so it loads behind the first paint instead of in
// the main bundle — the card's own background holds the space for the moment
// it takes. One promise for the app's life: both maps share the load.
//
// The worker is pointed at explicitly because MapLibre otherwise looks for it
// next to its own module, and once Vite has bundled that module there is
// nothing next to it.
let libPromise = null
function loadMapLibre() {
  libPromise ??= Promise.all([
    import('maplibre-gl'),
    import('maplibre-gl/dist/maplibre-gl-worker.mjs?url'),
    import('@maplibre/maplibre-gl-leaflet'),
    import('maplibre-gl/dist/maplibre-gl.css'),
  ]).then(([gl, worker, plugin]) => {
    gl.setWorkerUrl(worker.default)
    return plugin.maplibreGL
  }).catch((err) => {
    libPromise = null  // a failed chunk load (offline) gets retried by the next map
    throw err
  })
  return libPromise
}

// Which style the map wants, read from CSS rather than worked out here. The
// rules in App.css that decide whether the app is dark — the theme setting, the
// OS preference when it is on auto, and the night/storm sky levels — set
// --map-scheme on .map-base-tiles, so this follows them without restating them.
function wantedStyle(el) {
  const scheme = getComputedStyle(el).getPropertyValue('--map-scheme').trim()
  return scheme === 'dark' ? BASEMAP_STYLE_DARK : BASEMAP_STYLE_LIGHT
}

// Add the basemap to `map`. MapLibre arrives asynchronously, so the layer is
// handed to `onLayer` once it is on the map; what comes back is the teardown,
// safe to call before or after that.
//
// The layer looks like a tile layer to the one caller that cares (the radar's
// reveal, which waits on the base grid): isLoading() and a 'load' event when
// every visible tile has drawn.
//
// The `map-base-tiles` class goes on the GL canvas — the mid-tone sky dim in
// App.css still filters through it, and --map-scheme is read off it.
export function addBasemap(L, map, onLayer) {
  let layer = null
  let gone = false
  let stopWatching = null

  loadMapLibre().then((maplibreGL) => {
    if (gone) return
    const probe = L.DomUtil.create('div', 'map-base-tiles')
    probe.hidden = true
    map.getContainer().appendChild(probe)

    let style = wantedStyle(probe)
    layer = maplibreGL({
      style,
      className: 'map-base-tiles',
      attribution: BASEMAP_ATTRIBUTION,
      // Leaflet owns every gesture; the GL map only draws.
      interactive: false,
      // The basemap is static and the radar repaints over it every frame of
      // playback — skip the GL fade-ins so labels don't flicker on a swap.
      fadeDuration: 0,
    }).addTo(map)
    const gl = layer.getMaplibreMap()
    layer.isLoading = () => !gl.loaded()
    gl.on('idle', () => layer?.fire('load'))

    // Restyle when the app's darkness changes. Three things can change it: the
    // theme setting (data-theme on <html>), the OS preference, and the sky level
    // class on .app. Watching those three exactly — not the whole tree — because
    // Leaflet rewrites tile classes on every frame of radar playback.
    const restyle = () => {
      const next = wantedStyle(probe)
      if (next !== style) { style = next; gl.setStyle(next) }
    }
    const observer = new MutationObserver(restyle)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    const app = map.getContainer().closest('.app')
    if (app) observer.observe(app, { attributes: true, attributeFilter: ['class'] })
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener('change', restyle)
    stopWatching = () => {
      observer.disconnect()
      media.removeEventListener('change', restyle)
      probe.remove()
    }

    onLayer?.(layer)
  // No basemap is survivable: the radar still draws on the card's background.
  }).catch(err => console.warn('Basemap unavailable:', err))

  return () => {
    gone = true
    stopWatching?.()
    if (layer) map.removeLayer(layer)
    layer = null
  }
}
