// The ground an alert covers, as GeoJSON ready to draw.
//
// NWS gives this two different ways, and which one you get is a property of the
// hazard rather than of the request. Storm-based warnings — tornado, severe
// thunderstorm, flash flood — carry a polygon on the alert itself: the forecaster
// drew a box around the storm. Everything else is issued against forecast zones,
// and those alerts come back with `geometry: null` and a list of zone URLs in
// `affectedZones`. Both are common; a location with several alerts will usually
// have some of each.
//
// So this resolves the second kind by fetching the zones and collecting their
// polygons into one FeatureCollection, which is what the caller draws either way.

// NWS asks for contact info in the User-Agent (see useWeather.js, which sends
// the same string for the alert feed itself).
const NWS_HEADERS = { 'User-Agent': 'AlekWeatherApp/1.0 (angelov6+alekweather@terpmail.umd.edu)' }

// Zone polygons are full-resolution county-ish outlines — tens of kilobytes each
// — and one alert can name a hundred zones. This is what one tap is allowed to
// cost; past it the map draws what it has and says so. Ordered as NWS orders
// them, so the truncated set is still a contiguous part of the warned area
// rather than a scatter.
const MAX_ZONES = 60

// Zone geometry never changes, and alerts for one place share zones heavily —
// the same county is in the flood watch and the wind advisory. Keyed by URL and
// kept for the life of the page.
const zoneCache = new Map()

// Zone requests are the whole cost of this, so they go out together rather than
// one after another — but not all at once: a hundred parallel requests to
// api.weather.gov is a good way to be rate-limited, and the ones past the first
// few would queue in the browser anyway.
const CONCURRENCY = 6

async function fetchZone(url) {
  if (zoneCache.has(url)) return zoneCache.get(url)
  const res = await fetch(url, { headers: NWS_HEADERS })
  if (!res.ok) throw new Error(`zone ${res.status}`)
  const json = await res.json()
  const geometry = json.geometry ?? null
  zoneCache.set(url, geometry)
  return geometry
}

// Run `job` over `items` with at most CONCURRENCY in flight. Settled, not
// all-or-nothing: one zone 404ing or timing out costs that zone and no more.
async function pooled(items, job) {
  const out = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      try { out[i] = await job(items[i]) } catch { out[i] = null }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker))
  return out
}

// Returns { geo, zones, drawn, truncated } — or null when the alert names no
// ground at all, which happens for a few nationwide products.
//
//   geo        FeatureCollection to hand to L.geoJSON
//   zones      how many zones the alert names
//   drawn      how many of them are in `geo` (< zones if some failed or were cut)
//   truncated  whether MAX_ZONES was what cut them
export async function loadAlertArea(alert) {
  // The forecaster's own polygon, where there is one. No fetching, and it is a
  // tighter answer than the zones would be — the storm rather than the counties
  // it is crossing.
  if (alert.geometry) {
    return {
      geo: { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: alert.geometry, properties: {} }] },
      zones: 1, drawn: 1, truncated: false,
    }
  }

  const all = alert.properties?.affectedZones ?? []
  if (!all.length) return null

  const zones = all.slice(0, MAX_ZONES)
  const geometries = (await pooled(zones, fetchZone)).filter(Boolean)
  if (!geometries.length) throw new Error('No zone geometry could be loaded')

  return {
    geo: {
      type: 'FeatureCollection',
      features: geometries.map(geometry => ({ type: 'Feature', geometry, properties: {} })),
    },
    zones: all.length,
    drawn: geometries.length,
    truncated: all.length > MAX_ZONES,
  }
}
