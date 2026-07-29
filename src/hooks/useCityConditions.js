import { useEffect, useState } from 'react'

const WEATHER_URL = 'https://api.open-meteo.com/v1/forecast'
// Just enough for an at-a-glance card: the temperature, what it feels like, and
// which icon to draw. No hourly/daily/NWS overlay — that whole pipeline only
// runs once a city is actually opened.
const PARAMS = [
  'current=temperature_2m,apparent_temperature,weather_code,is_day',
  'temperature_unit=fahrenheit',
  'timezone=auto',
].join('&')

// These readings back a glanceable summary, not the forecast itself, so a
// few-minute-old value is fine — and returning to the splash (tapping the
// wordmark) shouldn't refire the request.
const TTL = 10 * 60 * 1000
const cache = new Map() // "lat,lon" → { at, cond }

// Coordinates rounded to ~1 km, matching the tolerance sameCity() treats as one
// place, so a GPS fix and the geocoded city centre share a cache entry.
export function conditionKey(city) {
  return `${city.latitude.toFixed(2)},${city.longitude.toFixed(2)}`
}

function readCache(cities) {
  const now = Date.now()
  const out = {}
  for (const city of cities) {
    const key = conditionKey(city)
    const hit = cache.get(key)
    if (hit && now - hit.at < TTL) out[key] = hit.cond
  }
  return out
}

// Current conditions for a list of cities, keyed by conditionKey(city). Open-Meteo
// accepts comma-separated coordinates, so any number of cities costs one request.
// Failures resolve to a missing entry rather than an error: the cards that use
// this still render the city, just without a temperature.
export function useCityConditions(cities) {
  // Results are tagged with the list they were fetched for, so a changed list
  // drops them on the next render instead of needing an effect to clear them.
  const [fetched, setFetched] = useState({ key: '', data: {} })
  const citiesKey = cities.map(conditionKey).join('|')

  useEffect(() => {
    const cached = readCache(cities)
    const missing = cities.filter(c => !(conditionKey(c) in cached))
    if (!missing.length) return

    const ctrl = new AbortController()
    ;(async () => {
      try {
        const lat = missing.map(c => c.latitude).join(',')
        const lon = missing.map(c => c.longitude).join(',')
        const res = await fetch(`${WEATHER_URL}?latitude=${lat}&longitude=${lon}&${PARAMS}`, { signal: ctrl.signal })
        if (!res.ok) return
        const data = await res.json()
        // One coordinate answers with a bare object, several with an array.
        const list = Array.isArray(data) ? data : [data]
        const next = {}
        missing.forEach((city, i) => {
          const cur = list[i]?.current
          if (!cur || cur.temperature_2m == null) return
          next[conditionKey(city)] = {
            temp:  cur.temperature_2m,
            feels: cur.apparent_temperature ?? cur.temperature_2m,
            code:  cur.weather_code,
            isDay: cur.is_day !== 0,
          }
        })
        const at = Date.now()
        for (const [key, cond] of Object.entries(next)) cache.set(key, { at, cond })
        setFetched({ key: citiesKey, data: next })
      } catch { /* name-only cards are an acceptable fallback */ }
    })()
    return () => ctrl.abort()
  }, [citiesKey]) // eslint-disable-line react-hooks/exhaustive-deps

  return { ...readCache(cities), ...(fetched.key === citiesKey ? fetched.data : {}) }
}
