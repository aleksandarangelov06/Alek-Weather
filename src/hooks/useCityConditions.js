import { useEffect, useState } from 'react'
import { placeKey, freshConditions, loadConditions } from './placeConditions'

// Cards key their conditions by the same ~1 km coordinate key the shared
// reading uses (see placeConditions).
export const conditionKey = placeKey

function readCache(cities) {
  const out = {}
  for (const city of cities) {
    const hit = freshConditions(city)
    if (hit) out[conditionKey(city)] = hit
  }
  return out
}

// Current conditions for a list of cities, keyed by conditionKey(city), read
// through the same pipeline as the forecast and the splash (see
// placeConditions) so a card always agrees with them. One forecast load per
// city, a couple at a time (placeConditions queues them), and each card fills
// in as its own reading lands rather than all of them waiting for the slowest.
// A failure leaves that city's entry missing rather than erroring, and its
// card still renders the name, just without a temperature.
export function useCityConditions(cities) {
  // Results are tagged with the list they were fetched for, so a changed list
  // drops them on the next render instead of needing an effect to clear them.
  const [fetched, setFetched] = useState({ key: '', data: {} })
  const citiesKey = cities.map(conditionKey).join('|')

  useEffect(() => {
    const cached = readCache(cities)
    const missing = cities.filter(c => !(conditionKey(c) in cached))
    if (!missing.length) return

    let live = true
    const next = {}
    for (const city of missing) {
      loadConditions(city).then((cond) => {
        if (!live || cond?.temp == null) return
        next[conditionKey(city)] = cond
        setFetched({ key: citiesKey, data: { ...next } })
      }, () => { /* that card goes without */ })
    }
    return () => { live = false }
  }, [citiesKey]) // eslint-disable-line react-hooks/exhaustive-deps

  return { ...readCache(cities), ...(fetched.key === citiesKey ? fetched.data : {}) }
}
