import { loadForecast } from './useWeather'
import { radarEnhancedOn } from './useRadarPrecip'
import { liveWeatherCode } from '../utils/weatherCodes'
import { weatherHeadline } from '../utils/headline'

// A place's current conditions, read the way the forecast reads them: the full
// loadForecast pipeline (NWS overlay, station observation, warning cross-check)
// and the same live code CurrentWeather shows. The splash's sky and headline and
// the location cards under it all come from here, so a card can no longer show
// a clear night while the splash above it says thunderstorms — Open-Meteo's bare
// current code, which the cards used to read on their own, disagrees with the
// forecast often enough for that to happen.

// Matches the forecast's own staleness refresh (STALE_MS in App.jsx): going back
// to the splash within it reuses the readings instead of refetching.
const TTL = 10 * 60 * 1000

// Readings older than TTL but younger than this are still shown when a fetch
// fails — a card with last hour's temperature beats a blank one while Open-Meteo
// is refusing requests. Kept in storage so they survive a reload.
const KEEP_MS = 6 * 60 * 60 * 1000
const STORE_KEY = 'alek-weather-place-conditions'

const cache = new Map(loadStored())    // key → { at, cond }

function loadStored() {
  try {
    const now = Date.now()
    return Object.entries(JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}'))
      .filter(([, v]) => v?.cond && now - v.at < KEEP_MS)
  } catch { return [] }
}

function store(key, cond, at = Date.now()) {
  const prev = cache.get(key)
  if (prev && prev.at > at) return // never replace a newer reading with an older one
  cache.set(key, { at, cond })
  try {
    const now = Date.now()
    const kept = Object.fromEntries([...cache].filter(([, v]) => now - v.at < KEEP_MS))
    localStorage.setItem(STORE_KEY, JSON.stringify(kept))
  } catch { /* quota or storage off */ }
}
const inflight = new Map() // key → Promise, so the splash and a card asking for
                           // the same place at once share one fetch

// Coordinates rounded to ~1 km, matching the tolerance sameCity() treats as one
// place, so a GPS fix and the geocoded city centre share an entry.
export function placeKey(place) {
  return `${place.latitude.toFixed(2)},${place.longitude.toFixed(2)}`
}

// The cache is keyed by the Radar enhanced accuracy setting as well as the
// place: the setting changes what the code is, so flipping it must not serve a
// reading taken under the other one.
const cacheKey = (place) => `${placeKey(place)}|${radarEnhancedOn() ? 'radar' : 'model'}`

// The cached reading for `place` if it is still fresh, else null.
export function freshConditions(place) {
  const hit = cache.get(cacheKey(place))
  return hit && Date.now() - hit.at < TTL ? hit.cond : null
}

// The card's reading off a loaded forecast — full or lite, the current fields
// are the same.
function conditionsOf(place, data) {
  const cur = data.current
  const code = liveWeatherCode(cur, data.minutely_15, radarEnhancedOn() ? data.radarClear : null)
  return {
    name: place.name,
    temp: cur.temperature_2m,
    feels: cur.apparent_temperature ?? cur.temperature_2m,
    code,
    isDay: cur.is_day !== 0,
    severe: !!cur.severe_storm,
    headline: weatherHeadline(data, code, place.name),
  }
}

// Files the forecast screen's own reading for its place, so going back to the
// splash shows that card at once instead of asking Open-Meteo again. `at` is
// when the reading was taken, so a restored old one isn't filed as fresh.
export function rememberConditions(place, data, at) {
  if (!place || !data?.current) return
  store(cacheKey(place), conditionsOf(place, data), at)
}

// { name, temp, feels, code, isDay, severe, headline } for `place`.
export function loadConditions(place) {
  const key = cacheKey(place)
  const fresh = freshConditions(place)
  if (fresh) return Promise.resolve(fresh)
  if (inflight.has(key)) return inflight.get(key)

  // With Radar enhanced accuracy on, the forecast screen runs its condition
  // past live radar, which can clear a thunderstorm the model still forecasts.
  // Without the same check here the splash and the cards kept that thunderstorm
  // while the forecast said partly cloudy. The verdict arrives with the reading
  // (data.radarClear, see loadForecast); the setting decides if it applies.
  // Lite: a card needs the current condition, not the week (see LITE_PARAMS).
  const p = loadForecast(place, { lite: true })
    .then(({ data }) => {
      const cond = conditionsOf(place, data)
      store(key, cond)
      return cond
    })
    .catch((e) => {
      // Fall back to the last reading we had, if it isn't too old.
      const hit = cache.get(key)
      if (hit && Date.now() - hit.at < KEEP_MS) return hit.cond
      throw e
    })
    .finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}
