// The muted grey canvas both maps draw on, and the labels that go over it.
//
// This was CARTO Positron (`basemaps.cartocdn.com/light_all`) until CARTO put
// their previously-open basemaps behind a key: the tiles still return 200 with
// real map content, so nothing errors and no fallback fires — they simply come
// back with "API KEY REQUIRED" watermarked diagonally across every one of them.
// That is what was printed over the radar.
//
// Esri's Light Gray Canvas is the closest keyless equivalent: the same
// deliberately desaturated basemap built for data overlay, cached to z23, CORS
// open, and from the same ArcGIS family as the NOAA MRMS ImageServer the radar
// already reads. Positron bakes its labels into one layer and Esri splits them
// into two, so a map wanting both asks for both — see addBasemap.
const ESRI = 'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas'

export const BASEMAP_URL        = `${ESRI}/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`
export const BASEMAP_LABELS_URL = `${ESRI}/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`

// Esri asks for this wherever the basemap is shown. Both maps currently run with
// attributionControl:false, so it is carried on the layer rather than displayed.
export const BASEMAP_ATTRIBUTION =
  'Esri, HERE, Garmin, © OpenStreetMap contributors'

// Add the canvas and its labels to `map`, and hand back both layers.
//
// Everything visual is keyed off the `map-base-tiles` class: the dark-mode and
// sky-level filters in App.css invert and dim the basemap through it, so BOTH
// layers carry it or the labels would stay black on an inverted dark map.
//
// zIndex 1 and 2 keep the pair beneath the radar (200) exactly where Positron's
// baked-in labels sat — under a semi-transparent radar that lets them read
// through, and under the alert polygons, which are in the overlay pane above
// every tile layer regardless.
export function addBasemap(L, map) {
  const opts = {
    maxZoom: 20, detectRetina: false, crossOrigin: true,
    className: 'map-base-tiles', updateWhenIdle: true, keepBuffer: 1,
    attribution: BASEMAP_ATTRIBUTION,
  }
  const base   = L.tileLayer(BASEMAP_URL,        { ...opts, zIndex: 1 }).addTo(map)
  const labels = L.tileLayer(BASEMAP_LABELS_URL, { ...opts, zIndex: 2 }).addTo(map)
  return [base, labels]
}
