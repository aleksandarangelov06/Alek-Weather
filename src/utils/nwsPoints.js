// What api.weather.gov/points says about a place: the forecast office and grid
// square it falls in (as the URLs of its hourly, daily and gridpoint forecasts)
// and which stations observe it. None of that changes from one load to the next,
// but every load used to ask for it again — and the forecast requests could only
// go out once it had answered, so each refresh paid a whole extra round trip to
// api.weather.gov before the forecast itself was even requested. It is kept here
// per point (coordinates to 4 places, as the request has them) instead.
//
// A place outside NWS coverage (the points call answers 404) is remembered too,
// for less long, so a non-US place stops asking at all.

const KEY = 'alek-weather-nws-points'
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const OUTSIDE_MAX_AGE_MS = 24 * 60 * 60 * 1000
// Each entry is a few hundred bytes; this covers every place in regular use.
const MAX_ENTRIES = 30

function readAll() {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    return all && typeof all === 'object' ? all : {}
  } catch {
    return {} // corrupt or unavailable storage reads as empty
  }
}

function writeAll(all) {
  try {
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch { /* full or unavailable: the next load just asks again */ }
}

// The stored entry for `key` — { at, point, stations? }, where `point` is null
// for a place outside NWS coverage — or undefined when there is none, or it is
// too old to trust.
export function cachedNwsPoint(key) {
  const entry = readAll()[key]
  if (!entry || typeof entry.at !== 'number') return undefined
  const maxAge = entry.point ? MAX_AGE_MS : OUTSIDE_MAX_AGE_MS
  return Date.now() - entry.at < maxAge ? entry : undefined
}

// Stores a fresh lookup (null: outside coverage), replacing any stations the
// previous one had, and keeps only the MAX_ENTRIES most recent places.
export function rememberNwsPoint(key, point) {
  const all = readAll()
  all[key] = { at: Date.now(), point }
  const keys = Object.keys(all).sort((a, b) => (all[b]?.at ?? 0) - (all[a]?.at ?? 0))
  for (const k of keys.slice(MAX_ENTRIES)) delete all[k]
  writeAll(all)
}

// The stations within range of the place, nearest first, as identifiers.
export function rememberNwsStations(key, stations) {
  const all = readAll()
  if (!all[key]?.point) return
  all[key].stations = stations
  writeAll(all)
}

// Drops a stored point whose URLs have stopped answering (NWS re-gridded the
// area), so the next load looks it up again.
export function forgetNwsPoint(key) {
  const all = readAll()
  if (!(key in all)) return
  delete all[key]
  writeAll(all)
}

// Tests only: every load starts from an empty store.
export function clearNwsPoints() {
  try { localStorage.removeItem(KEY) } catch { /* unavailable: nothing stored */ }
}
