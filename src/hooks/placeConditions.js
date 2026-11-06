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

const cache = new Map()    // key → { at, cond }
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
  const p = loadForecast(place)
    .then(({ data }) => {
      const cur = data.current
      const code = liveWeatherCode(cur, data.minutely_15, radarEnhancedOn() ? data.radarClear : null)
      const cond = {
        name: place.name,
        temp: cur.temperature_2m,
        feels: cur.apparent_temperature ?? cur.temperature_2m,
        code,
        isDay: cur.is_day !== 0,
        severe: !!cur.severe_storm,
        headline: weatherHeadline(data, code, place.name),
      }
      cache.set(key, { at: Date.now(), cond })
      return cond
    })
    .finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}
