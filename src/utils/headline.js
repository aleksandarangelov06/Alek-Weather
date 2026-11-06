import { precipTier, SNOW_CODES, THUNDER_CODES } from './weatherCodes'

// A few words on what the weather is doing, for the splash's location pill:
// "Thunderstorms now", "Rain in 15 minutes", "Showers on the way", "Great
// weather out there".
// The condition label ("Thunderstorm", "Partly Cloudy") says what the sky is;
// this says what that means for the next couple of hours, which is the question
// someone glancing at the splash is actually asking.
//
// `data` is a loadForecast result and `code` the live current code
// (liveWeatherCode), so the headline never disagrees with the icon beside it.

// Inches per 15 min, PrecipNowcast's bands: TRACE is "anything at all", LIGHT is
// where the nowcast card starts calling it rain.
const TRACE = 0.004
const LIGHT = 0.02

// How far ahead each source is trusted. minutely_15 is only a real nowcast for
// its first couple of hours (see NOWCAST_HORIZON_HOURS in weatherCodes); the
// hourly forecast carries "showers ahead" for the rest of the afternoon.
const NOWCAST_SLOTS = 8 // 2 h of 15-minute slots
const AHEAD_HOURS   = 6
const AHEAD_POP     = 50 // %

const DRIZZLE_CODES = new Set([51, 53, 55])

function minutes(m) {
  if (m < 60) return `${m} minutes`
  if (m === 60) return '1 hour'
  if (m % 60 === 0) return `${m / 60} hours`
  return `${Math.floor(m / 60)} hr ${m % 60} min`
}

// Index of the minutely slot holding `now`, or -1.
function nowSlot(minutely, now) {
  const times = minutely?.time
  if (!times?.length || !minutely.precipitation?.length || !now) return -1
  return times.findIndex(t => t >= now)
}

// `place` is the place's name, so the line says where it is happening ("Light
// rain falling in Bel Air"). Each phrase has a nameless form for a place found
// from the device whose reverse geocode came back without one.
export function weatherHeadline(data, code, place = '') {
  const cur = data?.current
  if (!cur || code == null) return null
  const p = place?.trim()
  // The phrase with the place in it, or the one that stands alone.
  const at = (placed, plain) => (p ? placed : plain)
  const minutely = data.minutely_15
  const si = nowSlot(minutely, cur.time)
  const rate = si >= 0 ? (minutely.precipitation[si] ?? 0) : null

  // ── Something is falling ──────────────────────────────────────────────────
  // Said as happening, not as a category: "Raining now" rather than "Rain".
  if (THUNDER_CODES.has(code)) {
    return code !== 95 || cur.severe_storm
      ? at(`Severe storms in ${p}`, 'Severe storms right now')
      : at(`Thunderstorms in ${p}`, 'Thunderstorms now')
  }
  const tier = precipTier(code)
  if (tier > 0) {
    const snow = SNOW_CODES.has(code)
    // Only predict the end from a trace that agrees it is falling now. A
    // station-confirmed code over a dry trace would otherwise "stop in 15
    // minutes" when the trace was never right to begin with.
    if (rate != null && rate >= LIGHT) {
      for (let i = 1; i <= NOWCAST_SLOTS && si + i < minutely.time.length; i++) {
        if ((minutely.precipitation[si + i] ?? 0) < TRACE) {
          return `${snow ? 'Snow' : 'Rain'}${p ? ` in ${p}` : ''} stops in ${minutes(i * 15)}`
        }
      }
    }
    if (snow) {
      return tier >= 3 ? at(`Heavy snow falling in ${p}`, 'Heavy snow falling')
        : tier === 1 ? at(`Flurries flying in ${p}`, 'Flurries flying')
        : at(`Snowing in ${p}`, 'Snowing now')
    }
    if (DRIZZLE_CODES.has(code)) return at(`Drizzling in ${p}`, 'Drizzling now')
    if (tier >= 3) return at(`Pouring in ${p}`, 'Pouring right now')
    return tier === 1 ? at(`Light rain falling in ${p}`, 'Light rain falling') : at(`Raining in ${p}`, 'Raining now')
  }

  // ── Coming soon ───────────────────────────────────────────────────────────
  const cold = cur.temperature_2m != null && cur.temperature_2m <= 32 // °F
  if (si >= 0) {
    for (let i = 1; i <= NOWCAST_SLOTS && si + i < minutely.time.length; i++) {
      if ((minutely.precipitation[si + i] ?? 0) >= LIGHT) {
        return at(`${cold ? 'Snow' : 'Rain'} reaches ${p} in ${minutes(i * 15)}`, `${cold ? 'Snow' : 'Rain'} in ${minutes(i * 15)}`)
      }
    }
  }
  // The minutely model is routinely blind to convection the hourly forecast
  // (often NWS) has right, so the hours ahead get their own look.
  const hourly = data.hourly
  const hi = hourly?.time?.findIndex(t => t.slice(0, 13) === cur.time?.slice(0, 13)) ?? -1
  if (hi >= 0) {
    for (let i = 1; i <= AHEAD_HOURS && hi + i < hourly.time.length; i++) {
      const c = hourly.weather_code?.[hi + i]
      if ((hourly.precipitation_probability?.[hi + i] ?? 0) < AHEAD_POP || precipTier(c) === 0) continue
      const what = THUNDER_CODES.has(c) ? 'Storms' : SNOW_CODES.has(c) ? 'Snow' : 'Showers'
      return at(`${what} heading for ${p}`, `${what} on the way`)
    }
  }

  // ── Dry ───────────────────────────────────────────────────────────────────
  const day = cur.is_day !== 0
  if (code === 45 || code === 48) return at(`Foggy in ${p}`, 'Foggy out there')
  const feels = cur.apparent_temperature ?? cur.temperature_2m
  if (feels != null) {
    if (feels >= 95) return at(`Scorching in ${p}`, 'Scorching out there')
    if (feels >= 88) return day ? at(`Hot one today in ${p}`, 'Hot one today') : at(`Warm night in ${p}`, 'Warm night out')
    if (feels <= 20) return at(`Bitter cold in ${p}`, 'Bitter cold out there')
    if (feels <= 35) return at(`Bundle up, it’s cold in ${p}`, 'Bundle up, it’s cold')
  }
  if ((cur.wind_gusts_10m ?? 0) >= 30) return at(`Windy in ${p}`, 'Windy out there')
  if (code <= 2 && feels != null && feels >= 60 && feels <= 82 && (cur.relative_humidity_2m ?? 0) < 80) {
    return day ? at(`Great weather in ${p}`, 'Great weather out there') : at(`Lovely night in ${p}`, 'Lovely night out')
  }
  if (code <= 1) return day ? at(`Clear skies over ${p}`, 'Clear skies all around') : at(`Clear night over ${p}`, 'Clear night sky')
  if (code === 2) return day ? at(`Sun peeking through in ${p}`, 'Sun peeking through') : at(`A few clouds over ${p} tonight`, 'A few clouds tonight')
  return at(`Gray skies over ${p}`, 'Gray skies overhead')
}
