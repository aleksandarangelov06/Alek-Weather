// Open-Meteo's free tier is capped per IP: roughly 600 calls a minute, 5,000 an
// hour and 10,000 a day, where a request asking for more than 10 variables, or
// for several locations at once, counts as several calls. Past a cap every
// request answers 429 until it resets.
//
// Retrying into a 429 only spends calls the moment the cap lifts, so once one
// comes back every Open-Meteo request in the app stands down until a set time.
// That time is kept in storage, so a reload doesn't go straight back to
// hammering a quota that is still spent.

const KEY = 'alek-weather-open-meteo-blocked-until'

// How long to stand down for each limit. The daily reset time isn't published,
// so a spent daily quota is checked again once an hour, which costs one call.
const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS

let blockedUntil = (() => {
  try { return Number(localStorage.getItem(KEY)) || 0 } catch { return 0 }
})()

export class QuotaError extends Error {
  constructor(reason) {
    super(reason || 'Open-Meteo request limit exceeded')
    this.name = 'QuotaError'
    this.status = 429
  }
}

// When the stand-down ends (ms), or null if requests are going out normally.
export function openMeteoBlockedUntil() {
  return Date.now() < blockedUntil ? blockedUntil : null
}

// Lifts the stand-down, for a retry the user asked for: one request is cheap,
// and they may have moved to another network with its own allowance. If the
// quota is still spent, the 429 that comes back starts it again.
export function clearOpenMeteoBlock() {
  blockedUntil = 0
  try { localStorage.removeItem(KEY) } catch { /* storage off */ }
}

// Throws QuotaError while the app is standing down. Call before any Open-Meteo
// request.
export function assertOpenMeteoQuota() {
  if (Date.now() < blockedUntil) throw new QuotaError()
}

// Notes a 429 from Open-Meteo and starts the stand-down. Reads the body for
// which limit it was, so it consumes the response; throws QuotaError.
export async function noteOpenMeteo429(res) {
  let reason = ''
  try { reason = (await res.json())?.reason ?? '' } catch { /* no body */ }
  const now = Date.now()
  let until
  if (/minut/i.test(reason)) until = now + MINUTE_MS
  else if (/hour/i.test(reason)) until = Math.ceil(now / HOUR_MS) * HOUR_MS + MINUTE_MS // just past the hour
  else until = now + HOUR_MS // daily, or unstated
  blockedUntil = Math.max(blockedUntil, until)
  try { localStorage.setItem(KEY, String(blockedUntil)) } catch { /* storage off */ }
  throw new QuotaError(reason)
}
