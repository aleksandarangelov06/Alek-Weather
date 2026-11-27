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
// The label fade while the map is moving: MapLibre's own default. See the note
// in addBasemap for why it is a performance setting here, not a look.
const MOVING_FADE_MS = 300

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
      // At rest only: while the map moves it is turned up (see below).
      fadeDuration: 0,
      // Rendered at no more than 2x. Phones are often 2.6-3x, and the GL canvas
      // is a screenful (plus padding) once the radar is full-screen: at 2.6x
      // that is about 70% more pixels to draw than at 2x, for roads and labels
      // that look the same either way. The radar over it is what people study,
      // and it is unaffected.
      pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
    }).addTo(map)
    const gl = layer.getMaplibreMap()
    layer.isLoading = () => !gl.loaded()
    gl.on('idle', () => layer?.fire('load'))

    // Labels: placed in full on every redraw at rest, eased while the map moves.
    //
    // MapLibre's label fade isn't only a fade. At 0 (above), every redraw
    // re-places every label from scratch, with no time budget
    // (forceFullPlacement in its style.ts). At rest that is what we want: the
    // map settles the moment its tiles are in, which is what the radar's
    // opening and closing wait on (the 'load' above). But Leaflet drives a
    // redraw on every frame of a pinch (the plugin's _pinchZoom), of a wheel or
    // button zoom's end, and of the glide home on close, and about 30 times a
    // second through a drag, so a full placement ran on the main thread on every
    // frame of every gesture. With a fade, MapLibre re-places at most once per
    // fade period, in 2 ms slices. So the fade is on while the map moves and
    // back to 0 the moment it stops, where the next redraw puts every label in
    // place at once and the map goes idle.
    //
    // MapLibre has no setter for it; _fadeDuration is the field its render loop
    // reads every frame (map.ts). Checked, so a version without it keeps 0.
    let unhookFade = null
    if (typeof gl._fadeDuration === 'number') {
      const moving = () => { gl._fadeDuration = MOVING_FADE_MS }
      const still = () => { gl._fadeDuration = 0 }
      map.on('movestart', moving)
      map.on('moveend', still)
      unhookFade = () => {
        map.off('movestart', moving)
        map.off('moveend', still)
      }
    }

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
      unhookFade?.()
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
