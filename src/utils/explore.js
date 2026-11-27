// The data behind the Explore page (ExplorePage.jsx), the easter egg behind a
// triple tap on "Alek Studios" in Settings: what the sky is doing around the
// world right now, and the National Weather Service's notable alerts in force.
//
// Two requests, both made only when the page opens:
//   - one Open-Meteo request for current conditions at every place in PLACES
//     (the API takes comma-separated coordinates and answers with an array),
//     cached and rationed: see sweep() below;
//   - one NWS /alerts/active call, filtered to the events worth exploring.

import { assertOpenMeteoQuota } from './openMeteoQuota'
import { dedupeAlerts } from '../hooks/useWeather'
import { THUNDER_CODES, SNOW_CODES } from './weatherCodes'

// [name, admin1, country code, latitude, longitude]. Spread over every
// continent and weighted toward places where something tends to be going on:
// storm alley, the snow belts, the monsoon coasts, the deserts and the poles.
const PLACE_ROWS = [
  ['Anchorage', 'Alaska', 'US', 61.22, -149.9],
  ['Seattle', 'Washington', 'US', 47.61, -122.33],
  ['Los Angeles', 'California', 'US', 34.05, -118.24],
  ['Phoenix', 'Arizona', 'US', 33.45, -112.07],
  ['Denver', 'Colorado', 'US', 39.74, -104.99],
  ['Oklahoma City', 'Oklahoma', 'US', 35.47, -97.52],
  ['Houston', 'Texas', 'US', 29.76, -95.37],
  ['Minneapolis', 'Minnesota', 'US', 44.98, -93.27],
  ['Chicago', 'Illinois', 'US', 41.88, -87.63],
  ['Buffalo', 'New York', 'US', 42.89, -78.88],
  ['New Orleans', 'Louisiana', 'US', 29.95, -90.07],
  ['Miami', 'Florida', 'US', 25.76, -80.19],
  ['New York', 'New York', 'US', 40.71, -74.01],
  ['Boston', 'Massachusetts', 'US', 42.36, -71.06],
  ['Honolulu', 'Hawaii', 'US', 21.31, -157.86],
  ['Calgary', 'Alberta', 'CA', 51.05, -114.07],
  ['Winnipeg', 'Manitoba', 'CA', 49.9, -97.14],
  ['Montreal', 'Quebec', 'CA', 45.5, -73.57],
  ['Mexico City', 'Mexico City', 'MX', 19.43, -99.13],
  ['Manaus', 'Amazonas', 'BR', -3.12, -60.02],
  ['Buenos Aires', 'Buenos Aires', 'AR', -34.6, -58.38],
  ['Reykjavik', 'Capital Region', 'IS', 64.15, -21.94],
  ['Tromso', 'Troms', 'NO', 69.65, 18.96],
  ['London', 'England', 'GB', 51.51, -0.13],
  ['Madrid', 'Madrid', 'ES', 40.42, -3.7],
  ['Moscow', 'Moscow', 'RU', 55.76, 37.62],
  ['Yakutsk', 'Sakha', 'RU', 62.03, 129.73],
  ['Cairo', 'Cairo', 'EG', 30.04, 31.24],
  ['Lagos', 'Lagos', 'NG', 6.52, 3.38],
  ['Dubai', 'Dubai', 'AE', 25.2, 55.27],
  ['Delhi', 'Delhi', 'IN', 28.61, 77.21],
  ['Mumbai', 'Maharashtra', 'IN', 19.08, 72.88],
  ['Bangkok', 'Bangkok', 'TH', 13.76, 100.5],
  ['Singapore', 'Singapore', 'SG', 1.35, 103.82],
  ['Manila', 'Metro Manila', 'PH', 14.6, 120.98],
  ['Beijing', 'Beijing', 'CN', 39.9, 116.41],
  ['Tokyo', 'Tokyo', 'JP', 35.68, 139.69],
  ['Sapporo', 'Hokkaido', 'JP', 43.06, 141.35],
  ['Darwin', 'Northern Territory', 'AU', -12.46, 130.84],
  ['Sydney', 'New South Wales', 'AU', -33.87, 151.21],
  ['McMurdo Station', 'Antarctica', 'AQ', -77.85, 166.67],
]

export const PLACES = PLACE_ROWS.map(([name, admin1, country_code, latitude, longitude]) => ({
  name, admin1, country_code, latitude, longitude,
}))

// The kinds of thing the page looks for. Each live condition and each alert
// lands in one; the chips across the top of the page filter by them.
export const CATEGORIES = [
  { id: 'severe', label: 'Storms', tint: '#ffb020' },
  { id: 'winter', label: 'Snow & ice', tint: '#8fd3ff' },
  { id: 'flood', label: 'Rain & flood', tint: '#3b9cff' },
  { id: 'tropical', label: 'Tropical', tint: '#c26bff' },
  { id: 'heat', label: 'Heat & fire', tint: '#ff6a3d' },
  { id: 'wind', label: 'Wind', tint: '#5fd4b0' },
  { id: 'fog', label: 'Fog', tint: '#a8b3c4' },
]

// ── Live conditions ─────────────────────────────────────────────────────────

const FREEZING_RAIN = new Set([56, 57, 66, 67])
const HEAVY_RAIN = new Set([63, 65, 81, 82])
const FOG = new Set([45, 48])
const WINDY_MPH = 35

// What, if anything, is notable at one place right now. Most dramatic first,
// so a thunderstorm with strong gusts reads as a thunderstorm.
function liveEvent(c) {
  const code = c.weather_code
  if (THUNDER_CODES.has(code)) return { category: 'severe', label: 'Thunderstorm', rank: 0 }
  if (FREEZING_RAIN.has(code)) return { category: 'winter', label: 'Freezing rain', rank: 1 }
  if (SNOW_CODES.has(code)) {
    const heavy = code === 75 || code === 86
    return { category: 'winter', label: heavy ? 'Heavy snow' : 'Snowing', rank: heavy ? 1 : 2 }
  }
  if (HEAVY_RAIN.has(code)) return { category: 'flood', label: 'Heavy rain', rank: 2 }
  if ((c.wind_gusts_10m ?? 0) >= WINDY_MPH) return { category: 'wind', label: 'Strong gusts', rank: 3 }
  if (FOG.has(code)) return { category: 'fog', label: 'Fog', rank: 4 }
  return null
}

// The sweep is by far the app's most expensive request: Open-Meteo bills every
// place in it as a call of its own, out of the same per-IP allowance the
// forecast itself runs on. So it is kept to a few dozen places, made at most
// once per LIVE_TTL_MS (the result is kept in storage, so reopening the page or
// reloading the app reuses it), and never twice at once (StrictMode mounts the
// page twice in development).
//
// It also stays out of the app's own stand-down (noteOpenMeteo429): a 429 here
// only rests Explore, for EXPLORE_REST_MS, and the forecast carries on. It
// does respect that stand-down, though: while the app is resting, so is this.
const LIVE_KEY = 'alek-weather-explore-live'
const REST_KEY = 'alek-weather-explore-rest-until'
const LIVE_TTL_MS = 20 * 60 * 1000
const EXPLORE_REST_MS = 30 * 60 * 1000

export class ExploreLimitError extends Error {
  constructor() {
    super('Open-Meteo request limit reached')
    this.name = 'ExploreLimitError'
  }
}

const readStore = (key) => {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null') } catch { return null }
}
const writeStore = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* storage off */ }
}

let inflight = null

async function sweep() {
  const cached = readStore(LIVE_KEY)
  if (cached?.rows && Date.now() - cached.at < LIVE_TTL_MS && cached.rows.length === PLACES.length) {
    return cached.rows
  }
  if (Date.now() < (readStore(REST_KEY) ?? 0)) throw new ExploreLimitError()
  try {
    assertOpenMeteoQuota()
  } catch {
    throw new ExploreLimitError()
  }
  const q = new URLSearchParams({
    latitude: PLACES.map((p) => p.latitude).join(','),
    longitude: PLACES.map((p) => p.longitude).join(','),
    current: 'temperature_2m,weather_code,wind_gusts_10m,is_day',
    temperature_unit: 'fahrenheit',
    wind_speed_unit: 'mph',
  })
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`)
  if (res.status === 429) {
    writeStore(REST_KEY, Date.now() + EXPLORE_REST_MS)
    throw new ExploreLimitError()
  }
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`)
  const body = await res.json()
  const rows = (Array.isArray(body) ? body : [body]).map((r) => r?.current ?? null)
  writeStore(LIVE_KEY, { at: Date.now(), rows })
  return rows
}

export async function fetchLiveConditions() {
  inflight ??= sweep().finally(() => { inflight = null })
  const rows = await inflight
  const readings = rows
    .map((current, i) => (current ? { place: PLACES[i], current } : null))
    .filter(Boolean)

  const events = readings
    .map((r) => ({ ...r, event: liveEvent(r.current) }))
    .filter((r) => r.event)
    .sort((a, b) => a.event.rank - b.event.rank || (b.current.wind_gusts_10m ?? 0) - (a.current.wind_gusts_10m ?? 0))

  const by = (key, dir) => readings
    .filter((r) => Number.isFinite(r.current[key]))
    .sort((a, b) => dir * (a.current[key] - b.current[key]))[0] ?? null
  const extremes = {
    hottest: by('temperature_2m', -1),
    coldest: by('temperature_2m', 1),
    windiest: by('wind_gusts_10m', -1),
  }
  return { events, extremes, checked: readings.length }
}

// ── NWS alerts ──────────────────────────────────────────────────────────────

// The events worth exploring, by category. Everyday advisories (frost, small
// craft, beach hazards) are left out: the page is for the remarkable.
const ALERT_EVENTS = {
  severe: ['Tornado Warning', 'Tornado Watch', 'Severe Thunderstorm Warning', 'Severe Thunderstorm Watch', 'Extreme Wind Warning'],
  winter: ['Blizzard Warning', 'Winter Storm Warning', 'Winter Storm Watch', 'Ice Storm Warning', 'Lake Effect Snow Warning', 'Winter Weather Advisory', 'Extreme Cold Warning', 'Wind Chill Warning', 'Cold Weather Advisory'],
  flood: ['Flash Flood Warning', 'Flash Flood Watch', 'Flood Warning', 'Coastal Flood Warning'],
  tropical: ['Hurricane Warning', 'Hurricane Watch', 'Tropical Storm Warning', 'Tropical Storm Watch', 'Storm Surge Warning', 'Typhoon Warning'],
  heat: ['Extreme Heat Warning', 'Excessive Heat Warning', 'Heat Advisory', 'Red Flag Warning', 'Fire Weather Watch'],
  wind: ['High Wind Warning', 'High Wind Watch', 'Dust Storm Warning', 'Wind Advisory'],
  fog: ['Dense Fog Advisory'],
}
const EVENT_CATEGORY = Object.fromEntries(
  Object.entries(ALERT_EVENTS).flatMap(([cat, events]) => events.map((e) => [e, cat])),
)

const TIER = (event) => (/warning$/i.test(event) ? 0 : /watch$/i.test(event) ? 1 : 2)

// "Adams; Arapahoe; Denver; Douglas" → ["Adams", "Arapahoe", ...]
const areaList = (desc) => (desc ?? '').split(';').map((s) => s.trim()).filter(Boolean)

export async function fetchNotableAlerts() {
  const events = Object.values(ALERT_EVENTS).flat().join(',')
  const res = await fetch(
    `https://api.weather.gov/alerts/active?status=actual&event=${encodeURIComponent(events)}`,
    { headers: { Accept: 'application/geo+json' } },
  )
  if (!res.ok) throw new Error(`NWS ${res.status}`)
  const body = await res.json()
  return dedupeAlerts(body.features ?? [])
    .map((f) => {
      const p = f.properties ?? {}
      const category = EVENT_CATEGORY[p.event]
      if (!category) return null
      const ugc = p.geocode?.UGC ?? []
      const states = [...new Set(ugc.map((z) => z.slice(0, 2)))]
      return {
        id: p.id ?? f.id,
        event: p.event,
        category,
        tier: TIER(p.event),
        areas: areaList(p.areaDesc),
        states,
        office: (p.senderName ?? '').replace(/^NWS\s+/, ''),
        ends: p.ends ?? p.expires ?? null,
        sent: p.sent ?? null,
        geometry: f.geometry ?? null,
        zones: p.affectedZones ?? [],
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.tier - b.tier || new Date(b.sent ?? 0) - new Date(a.sent ?? 0))
}

// The middle of an alert's shape (a plain average of its outer ring's points:
// close enough to put a forecast inside it). Null when it has none.
export function centroid(geometry) {
  if (!geometry) return null
  const ring = geometry.type === 'Polygon' ? geometry.coordinates?.[0]
    : geometry.type === 'MultiPolygon' ? geometry.coordinates?.[0]?.[0]
      : null
  if (!ring?.length) return null
  const [lon, lat] = ring.reduce(([x, y], [px, py]) => [x + px, y + py], [0, 0])
  return { latitude: lat / ring.length, longitude: lon / ring.length }
}

// A place to open for an alert: the middle of its polygon, or, for the
// zone-based alerts that have none (most winter and heat alerts), the middle of
// its first zone, fetched from NWS.
export async function alertPlace(alert) {
  let at = centroid(alert.geometry)
  if (!at && alert.zones[0]) {
    const res = await fetch(alert.zones[0], { headers: { Accept: 'application/geo+json' } })
    if (res.ok) at = centroid((await res.json()).geometry)
  }
  if (!at) return null
  return {
    name: alert.areas[0] ?? alert.office,
    admin1: alert.states[0] ?? '',
    country_code: 'US',
    latitude: Math.round(at.latitude * 1e4) / 1e4,
    longitude: Math.round(at.longitude * 1e4) / 1e4,
  }
}
