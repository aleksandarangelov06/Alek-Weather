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
