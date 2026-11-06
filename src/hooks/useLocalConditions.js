import { useEffect, useState } from 'react'
import { placeKey as coordKey, freshConditions, loadConditions } from './placeConditions'

// BigDataCloud's client endpoint reverse-geocodes the coordinates it is given,
// and falls back to the caller's IP when given none — city-level at best, which
// is plenty for picking a sky.
const LOCATE_URL = 'https://api-bdc.io/data/reverse-geocode-client?localityLanguage=en'

// Per page load: where the device is never moves far enough to matter in one
// session. The readings themselves live in placeConditions, shared with the
// location cards, and expire there.
let located = null

// The place key whose last reading failed (see localConditionsFailed).
let lastFailedKey = null

// Which place the splash is on: the chosen one, or 'here' until the device has
// been located.
const placeKey = (p) => (p ? coordKey(p) : 'here')

// The device position when location access is already granted, otherwise an
// approximate one from the IP, plus the place name for the splash's location
// pill. Never prompts: this only dresses the splash, and a permission dialog on
// launch is not something the user asked for. Coordinates are rounded to ~1 km
// before they leave the device, matching the reverse geocode in useWeather.
async function locate() {
  let query = ''
  try {
    const status = await navigator.permissions?.query({ name: 'geolocation' })
    if (status?.state === 'granted') {
      const pos = await new Promise((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { maximumAge: 30 * 60 * 1000, timeout: 8000 }))
      query = `&latitude=${pos.coords.latitude.toFixed(2)}&longitude=${pos.coords.longitude.toFixed(2)}`
    }
  } catch { /* no Permissions API (Android WebView), or no fix — fall back to IP */ }
  const r = await fetch(LOCATE_URL + query)
  if (!r.ok) return null
  const d = await r.json()
  if (typeof d.latitude !== 'number' || typeof d.longitude !== 'number') return null
  return {
    latitude: +d.latitude.toFixed(2),
    longitude: +d.longitude.toFixed(2),
    name: d.city || d.locality || d.principalSubdivision || '',
    admin1: d.principalSubdivision || '',
    country: d.countryCode || '',
    country_code: d.countryCode || '',
  }
}

// Where the device was found this page load (null until located), shaped like
// a city so the splash's location pill can open it.
export const locatedPlace = () => located

// The chosen place, or where the device is, read through the same pipeline as
// the forecast and the location cards (see placeConditions).
async function readConditions(chosen) {
  const place = chosen ?? (located ??= await locate())
  if (!place) return null
  return loadConditions(place)
}

function fresh(place) {
  const p = place ?? located
  return p ? freshConditions(p) : null
}

// Current { name, temp, feels, code, isDay, severe, headline } for `place` —
// the most recently opened location, so the splash follows whatever was looked
// at last — or, with no place given, for where the device is. Null until known
// (and for good if it can't be found). Only does any work while `enabled`.
export function useLocalConditions(enabled, place = null) {
  const key = placeKey(place)
  const [state, setState] = useState(() => ({ key, cond: fresh(place) }))

  // The place object is rebuilt on every recents update, so the effect keys on
  // the place's identity (its coordinates) rather than on the object.
  const latitude = place?.latitude, longitude = place?.longitude, name = place?.name
  useEffect(() => {
    if (!enabled) return
    const chosen = latitude != null ? { latitude, longitude, name } : null
    if (fresh(chosen)) return
    let live = true
    readConditions(chosen)
      .then(c => {
        lastFailedKey = c ? null : key
        if (live) setState({ key, cond: c })
      })
      .catch(() => {
        // The default splash scenery stays; the state update re-renders the
        // splash so it can read localConditionsFailed.
        lastFailedKey = key
        if (live) setState({ key, cond: null, failed: true })
      })
    return () => { live = false }
  }, [enabled, key, latitude, longitude, name])

  // A fresh shared reading wins over this instance's state, so a remount inside
  // TTL shows it at once; an expired one stays up while it refreshes. A reading
  // for a different place is never shown for this one.
  if (!enabled) return null
  return fresh(place) ?? (state.key === key ? state.cond : null)
}

// Whether the last reading for `place` (or for where the device is) came back
// empty — located nowhere, or the forecast failed — so the splash can stop
// saying it is checking. A plain read: the failure is a state update in
// useLocalConditions, which is what re-renders the caller.
export function localConditionsFailed(place = null) {
  return lastFailedKey === placeKey(place)
}
