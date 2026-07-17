const codes = {
  0:  { label: 'Clear Sky',               icon: 'sun',       nightIcon: 'moon'     },
  1:  { label: 'Mainly Clear',            icon: 'sunSmall',  nightIcon: 'moon'     },
  2:  { label: 'Partly Cloudy',           icon: 'sunCloud',  nightIcon: 'cloud'    },
  3:  { label: 'Overcast',               icon: 'cloud'                             },
  45: { label: 'Foggy',                  icon: 'fog'                               },
  48: { label: 'Rime Fog',              icon: 'fog'                               },
  51: { label: 'Light Drizzle',          icon: 'sunRain',   nightIcon: 'rain'     },
  53: { label: 'Moderate Drizzle',       icon: 'sunRain',   nightIcon: 'rain'     },
  55: { label: 'Heavy Drizzle',          icon: 'rain'                              },
  61: { label: 'Slight Rain',            icon: 'rain'                              },
  63: { label: 'Moderate Rain',          icon: 'rain'                              },
  65: { label: 'Heavy Rain',             icon: 'rain'                              },
  66: { label: 'Light Freezing Rain',    icon: 'rain'                              },
  67: { label: 'Freezing Rain',          icon: 'rain'                              },
  71: { label: 'Slight Snow',            icon: 'snow'                              },
  73: { label: 'Moderate Snow',          icon: 'snowflake'                         },
  75: { label: 'Heavy Snow',             icon: 'snowflake'                         },
  77: { label: 'Snow Grains',            icon: 'snow'                              },
  80: { label: 'Slight Showers',         icon: 'sunRain',   nightIcon: 'rain'     },
  81: { label: 'Moderate Showers',       icon: 'rain'                              },
  82: { label: 'Violent Showers',        icon: 'storm'                             },
  85: { label: 'Slight Snow Showers',    icon: 'snow'                              },
  86: { label: 'Heavy Snow Showers',     icon: 'snowflake'                         },
  95: { label: 'Thunderstorm',           icon: 'storm'                             },
  96: { label: 'T-Storm w/ Hail',        icon: 'stormStrong'                       },
  99: { label: 'T-Storm w/ Heavy Hail',  icon: 'stormStrong'                       },
}

// WMO codes have no dedicated "heavy thunderstorm" tier — 95 covers slight and
// moderate alike, and only the hail codes (96/99, mapped above) reach the strong
// icon on their own. `severe` lets a caller with an out-of-band intensity signal
// (e.g. an active NWS Severe Thunderstorm Warning) upgrade a plain 95 to the
// strong icon too. It only ever upgrades a thunderstorm; other codes pass through.
export function getWeatherInfo(code, isNight = false, severe = false) {
  const entry = codes[code] ?? { label: 'Unknown', icon: 'therm' }
  let icon = isNight && entry.nightIcon ? entry.nightIcon : entry.icon
  let label = entry.label
  if (severe && code === 95) { icon = 'stormStrong'; label = 'Severe T-Storm' }
  return { label, icon }
}

// ── Precipitation: condition vs. probability ────────────────────────────────
// weather_code is Open-Meteo's *deterministic* "it will precipitate" signal;
// precipitation_probability is a *separate statistical* field that routinely
// reads 0% for the very same hour the code says rain. We trust the condition:
// wherever a precip code is shown (rain icon), the chance must never display a
// contradictory 0%. precipTier gives the code's intensity; displayPrecipChance
// floors the shown chance to an intensity-based minimum (a display guard, not a
// real probability — it only ever raises the number, never lowers it).
export const RAIN_CODES = new Set([51, 53, 55, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99])
export const SNOW_CODES = new Set([71, 73, 75, 77, 85, 86])

// 0 none · 1 light · 2 moderate · 3 heavy · 4 severe
const PRECIP_TIER = {
  51: 1, 53: 2, 55: 2, 61: 1, 63: 2, 65: 3, 66: 1, 67: 2, 71: 1, 73: 2, 75: 3, 77: 1,
  80: 1, 81: 2, 82: 4, 85: 1, 86: 3, 95: 4, 96: 4, 99: 4,
}
export function precipTier(code) { return PRECIP_TIER[code] ?? 0 }

const CHANCE_FLOOR = [0, 25, 45, 60, 75] // indexed by tier
export function displayPrecipChance(code, prob) {
  return Math.max(prob ?? 0, CHANCE_FLOOR[precipTier(code)])
}

// ── Live "right now" condition from the 15-min nowcast ──────────────────────
// Open-Meteo's current.weather_code is a categorical, often-lagging snapshot: a
// brief downpour can leave it reading "Violent Showers" (82) while the live
// minutely_15 trend already shows light, tapering rain (observed in Montreal).
// These helpers re-derive the present condition from the *measured* precip rate
// so the headline matches what's actually falling.

// Inches per 15 min. Matches PrecipNowcast's chart thresholds.
const PRECIP_RATE = { TRACE: 0.004, LIGHT: 0.02, HEAVY: 0.08 }

// Same-family intensity ladders, indexed by tier [light, moderate, heavy/violent].
const FAMILY = {
  drizzle: [51, 53, 55],
  rain:    [61, 63, 65],
  showers: [80, 81, 82],
  snow:    [71, 73, 75],
}
const CODE_FAMILY = {
  51: 'drizzle', 53: 'drizzle', 55: 'drizzle',
  61: 'rain',    63: 'rain',    65: 'rain',
  80: 'showers', 81: 'showers', 82: 'showers',
  71: 'snow',    73: 'snow',    75: 'snow',
}
// Fog is not characterized by precip rate — never downgrade it.
// Thunder is handled explicitly below: show sky condition when nothing is measured.
const NO_RATE_OVERRIDE = new Set([45, 48])

function rateTier(rate) {
  if (rate >= PRECIP_RATE.HEAVY) return 2
  if (rate >= PRECIP_RATE.LIGHT) return 1
  return 0
}

// Sky condition when nothing is falling, from cloud cover (%).
function skyCode(cloudCover) {
  if (cloudCover == null) return 3
  if (cloudCover >= 85) return 3 // overcast
  if (cloudCover >= 40) return 2 // partly cloudy
  if (cloudCover >= 15) return 1 // mainly clear
  return 0                       // clear
}

// Measured precip rate (inches/15min) at the current time from minutely_15.
export function livePrecipRate(current, minutely) {
  const times = minutely?.time, precip = minutely?.precipitation
  if (!times?.length || !precip?.length || !current?.time) return null
  let i = times.findIndex(t => t >= current.time)
  if (i < 0) i = times.length - 1
  return precip[i] ?? null
}

// Reality-checks a FUTURE hourly slot code against the minutely_15 nowcast.
// If the nowcast shows negligible precip across the entire slot window, downgrade
// a precipitation code to a sky condition. Non-precip codes pass through unchanged.
// Safe to call for any slot: returns the original code when minutely data doesn't
// cover that hour (i.e. the slot is beyond the nowcast window).
export function nowcastHourlyCode(code, minutely, slotTimeStr, cloudCover) {
  if (precipTier(code) === 0) return code
  if (!minutely?.time?.length || !minutely?.precipitation?.length) return code
  // slotTimeStr format: "YYYY-MM-DDTHH:MM" — match all minutely entries in the same hour.
  const prefix = slotTimeStr.slice(0, 14) // "YYYY-MM-DDTHH:"
  let peak = 0, found = false
  for (let j = 0; j < minutely.time.length; j++) {
    if (minutely.time[j].startsWith(prefix)) {
      peak = Math.max(peak, minutely.precipitation[j] ?? 0)
      found = true
    }
  }
  return found && peak < PRECIP_RATE.TRACE ? skyCode(cloudCover) : code
}

// Best estimate of the current weather code, corrected against the live nowcast.
// Falls back to the API's weather_code whenever minutely data is unavailable.
// `radarClear` (from the optional "Radar enhanced accuracy" setting) is a real
// radar observation of whether anything is echoing over the location: true =
// nothing overhead, false = echo present, null = unknown/off.
export function liveWeatherCode(current, minutely, radarClear = null) {
  const code = current?.weather_code
  if (code == null || NO_RATE_OVERRIDE.has(code)) return code
  // Radar enhanced accuracy: the radar sees nothing over the location, so no
  // precipitation is reaching the ground here. Downgrade a precip code to the
  // sky condition, and don't let the nowcast upgrade a clear code either.
  //
  // A live radar sweep is a stronger "is it precipitating right here, right now"
  // signal than a routine station report, which can be up to ~75 min old or come
  // from a station miles away — so when the user has opted into radar-enhanced
  // accuracy, a clear radar overrides even a station-confirmed code (this is the
  // drizzle case: the METAR says drizzle, radar is empty, we trust the radar).
  // An active severe *warning* still wins: it's an authoritative alert and radar
  // can briefly show gaps between sweeps or convective cells.
  if (radarClear === true && current.weather_code_source !== 'warning') {
    return precipTier(code) > 0 ? skyCode(current.cloud_cover) : code
  }
  // Confirmed by an active warning (or a station obs when radar isn't clearing
  // it): trust it over the model-driven minutely nowcast, which is routinely
  // blind to convective storms and must not "correct" it back to clear.
  if (current.weather_code_confirmed) return code
  const rate = livePrecipRate(current, minutely)
  if (rate == null) return code
  // Thunderstorm codes: show sky condition when nothing is measurably falling.
  // Hourly models assign code 95/96/99 to the entire forecast window even when
  // the storm is still minutes away, which would show "Thunderstorm" before
  // anything has started. Trust the measured rate to confirm it's actually active.
  if (code === 95 || code === 96 || code === 99) {
    return rate < PRECIP_RATE.TRACE ? skyCode(current.cloud_cover) : code
  }
  const fam = CODE_FAMILY[code]
  if (fam) {
    // Code claims precipitation: if essentially nothing is falling, show the sky.
    if (rate < PRECIP_RATE.TRACE) return skyCode(current.cloud_cover)
    return FAMILY[fam][rateTier(rate)]
  }
  // Code says clear/cloudy but the nowcast shows real precip → upgrade to rain/snow.
  if (rate >= PRECIP_RATE.LIGHT) {
    const snow = current.temperature_2m != null && current.temperature_2m <= 32 // °F
    return FAMILY[snow ? 'snow' : 'rain'][rateTier(rate)]
  }
  return code
}

export function getWindDirection(degrees) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  return dirs[Math.round(degrees / 45) % 8]
}

export function getUVLabel(uv) {
  if (uv <= 2)  return { label: 'Low',       color: 'var(--cond-green)' }
  if (uv <= 5)  return { label: 'Moderate',  color: 'var(--cond-yellow)' }
  if (uv <= 7)  return { label: 'High',      color: 'var(--cond-orange)' }
  if (uv <= 10) return { label: 'Very High', color: 'var(--cond-red)' }
  return              { label: 'Extreme',   color: 'var(--cond-purple)' }
}

// toLocaleTimeString builds a fresh Intl.DateTimeFormat on every call — about a
// millisecond each on a mid-range phone. The hourly strips format dozens of
// labels per render, right as an expansion mounts, so those milliseconds land
// exactly where a dropped frame is most visible. One reusable formatter per
// timezone makes each label a cheap .format() call instead.
const timeFmtCache = new Map()
function cachedTimeFormatter(timezone, withMinutes) {
  const key = `${timezone}|${withMinutes}`
  let fmt = timeFmtCache.get(key)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      ...(withMinutes ? { minute: '2-digit' } : {}),
      timeZone: timezone,
      hour12: true,
    })
    timeFmtCache.set(key, fmt)
  }
  return fmt
}

export function formatTime(isoString, timezone) {
  return cachedTimeFormatter(timezone, true).format(new Date(isoString))
}

// Hour-only label for strip/timeline items, e.g. "3 PM".
export function formatHour(isoString, timezone) {
  return cachedTimeFormatter(timezone, false).format(new Date(isoString))
}

export function toTemp(fahrenheit, unit) {
  if (unit === 'C') return Math.round((fahrenheit - 32) * 5 / 9)
  return Math.round(fahrenheit)
}

// Color stops: [°F, [r, g, b]]
const TEMP_STOPS = [
  [10,  [94,  184, 255]],  // icy blue
  [32,  [116, 192, 252]],  // freezing blue
  [45,  [169, 227,  75]],  // cool light green
  [60,  [ 81, 207, 102]],  // mild green
  [75,  [255, 212,  59]],  // warm yellow
  [85,  [255, 146,  43]],  // hot orange
  [95,  [250,  82,  82]],  // very hot red
  [110, [204,  93, 232]],  // extreme purple
]

export function tempColor(fahrenheit) {
  if (fahrenheit <= TEMP_STOPS[0][0]) return `rgb(${TEMP_STOPS[0][1].join(',')})`
  if (fahrenheit >= TEMP_STOPS[TEMP_STOPS.length - 1][0]) {
    return `rgb(${TEMP_STOPS[TEMP_STOPS.length - 1][1].join(',')})`
  }
  for (let i = 0; i < TEMP_STOPS.length - 1; i++) {
    const [t0, c0] = TEMP_STOPS[i]
    const [t1, c1] = TEMP_STOPS[i + 1]
    if (fahrenheit <= t1) {
      const t = (fahrenheit - t0) / (t1 - t0)
      const r = Math.round(c0[0] + t * (c1[0] - c0[0]))
      const g = Math.round(c0[1] + t * (c1[1] - c0[1]))
      const b = Math.round(c0[2] + t * (c1[2] - c0[2]))
      return `rgb(${r},${g},${b})`
    }
  }
}

// Color-coded temperature style: the text color plus optional effects — a heat
// glow that starts subtly at 90°F and intensifies up to 110°F, and a frosty
// glow that starts at 32°F and intensifies down to 0°F. `scale` tunes the blur
// radius so effects fit smaller temperature elements (hourly/daily) as well as
// the large current temperature. Returns undefined when color coding is off.
export function tempStyle(fahrenheit, colorCoding, scale = 1, glow = true, frost = true) {
  if (!colorCoding) return undefined
  const style = { color: tempColor(fahrenheit) }
  if (glow && fahrenheit >= 90) {
    const t = Math.min((fahrenheit - 90) / 20, 1)
    style.textShadow = `0 0 ${(8 + t * 24) * scale}px currentColor`
  } else if (frost && fahrenheit <= 32) {
    // Icy halo: a bright white core wrapped in a cold blue bloom, deepening as
    // the temperature drops toward 0°F.
    const t = Math.min((32 - fahrenheit) / 32, 1)
    const blur = (6 + t * 16) * scale
    style.textShadow =
      `0 0 ${blur * 0.5}px rgba(255,255,255,${0.35 + t * 0.4}), ` +
      `0 0 ${blur}px rgba(130,200,255,${0.5 + t * 0.5})`
  }
  return style
}

export function formatDay(dateString) {
  const date = new Date(dateString + 'T12:00:00')
  const today = new Date()
  if (date.toDateString() === today.toDateString()) return 'Today'
  return date.toLocaleDateString('en-US', { weekday: 'short' })
}
