// NOAA's MRMS base-reflectivity mosaic — the radar behind radar.weather.gov,
// served straight from NWS with open CORS and no key. Shared by the radar map
// (which draws it) and the current-condition radar check (which samples one
// pixel of it), so the endpoint and its coverage live in one place.
//
// It is an ArcGIS ImageServer: `exportImage` renders a bbox, `identify` returns
// the pixel value at a point, and `query` lists the sweeps in the time window.
export const MRMS_BASE =
  'https://mapservices.weather.noaa.gov/eventdriven/rest/services/radar/radar_base_reflectivity_time/ImageServer'

// MRMS coverage, as the regions the mosaic actually contains. Outside them a
// render is blank and a point value is NoData — indistinguishable from "clear
// sky" — so those locations have to fall back to RainViewer.
const MRMS_REGIONS = [
  [21, 53, -134, -60],    // CONUS
  [50, 73, -180, -129],   // Alaska
  [17, 24, -162, -153],   // Hawaii
  [16, 20, -68, -63],     // Puerto Rico / Caribbean
  [12, 15, 143, 147],     // Guam
]

export const inMrmsDomain = (lat, lon) =>
  MRMS_REGIONS.some(([s, n, w, e]) => lat >= s && lat <= n && lon >= w && lon <= e)

// What the radar map may show while it is drawing a US feed (MRMS, NEXRAD or
// the HRRR forecast): the US region the location is in, as [[S, W], [N, E]].
// Tighter than MRMS_REGIONS, which pad out to the radars' reach over Canada,
// Mexico and the sea; these are the land itself plus a small margin.
const US_VIEW_REGIONS = [
  [[24.0, -125.5], [49.6, -66.5]],   // Lower 48
  [[51.0, -179.9], [71.6, -129.5]],  // Alaska
  [[18.6, -160.6], [22.5, -154.5]],  // Hawaii
  [[17.6, -67.5], [18.8, -65.1]],    // Puerto Rico & USVI
  [[13.1, 144.5], [13.8, 145.1]],    // Guam
]

// The region to lock the map to for a location, or null outside all of them.
// A location in the padding around a region (a border town, say) still gets
// that region, so the map never locks out the place it is centred on.
export function usViewBounds(lat, lon) {
  const contains = ([[s, w], [n, e]], pad) =>
    lat >= s - pad && lat <= n + pad && lon >= w - pad && lon <= e + pad
  return US_VIEW_REGIONS.find((r) => contains(r, 0))
    ?? US_VIEW_REGIONS.find((r) => contains(r, 3))
    ?? null
}
