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
  // WMO calls 96 and 99 "thunderstorm with slight / heavy hail", but the hail
  // part is only forecast in Central Europe (DWD ICON); every other model emits
  // these as its strong-thunderstorm tier, so a hail label promises a reading
  // that isn't there. Named for the intensity they actually carry.
  96: { label: 'Heavy Thunderstorm',     icon: 'stormStrong'                       },
  99: { label: 'Severe Thunderstorm',    icon: 'stormStrong'                       },
}

// WMO codes have no dedicated "heavy thunderstorm" tier — 95 covers slight and
// moderate alike, and only 96/99 (mapped above) reach the strong icon on their
// own. `severe` lets a caller with an out-of-band intensity signal
// (e.g. an active NWS Severe Thunderstorm Warning) upgrade a plain 95 to the
// strong icon too. It only ever upgrades a thunderstorm; other codes pass through.
export function getWeatherInfo(code, isNight = false, severe = false) {
  const entry = codes[code] ?? { label: 'Unknown', icon: 'therm' }
  let icon = isNight && entry.nightIcon ? entry.nightIcon : entry.icon
  let label = entry.label
  if (severe && code === 95) { icon = 'stormStrong'; label = 'Severe Thunderstorm' }
  return { label, icon }
}

// ── Precipitation: condition vs. probability ────────────────────────────────
// weather_code is a *deterministic* "what it will be doing" signal;
// precipitation_probability is a *separate statistical* field, and the two can
// disagree at any given hour. Neither is derived from the other, so the chance
// shown to the user is always the probability field's own value — never a
// number inferred from the code.
//
// This used to work the other way round: the code's intensity tier set a floor
// (light 25% · moderate 45% · heavy 60% · severe 75%) that the displayed chance
// was raised to, on the theory that a rain icon beside "0%" reads as broken.
// The theory was fine and the mechanism was not. Sampled across eight cities and
// seven days, the contradiction it was written for — a precip code with no
// probability behind it — occurred in 2 of 277 precip hours; the floor fired on
// 76 of them, overwriting a real, non-zero, better-sourced number in 97% of the
// cases where it did anything at all. Where NWS is merged in it was pure damage,
// because there code and probability come from the same forecast and never
// contradict: eight consecutive thunderstorm hours over Bel Air MD carrying
// 53 · 55 · 62 · 63 · 59 · 51 · 43 · 32% were every one of them displayed as
// 75%, an evening of distinct forecasts flattened into a single repeated number
// that belonged to none of them.
//
// A rain icon over an honest 15% is a forecast. A rain icon over an invented 75%
// is a fabrication, and it is the one of the two a reader cannot detect.
// precipTier survives for what it is genuinely good at — ranking severity and
// answering "is this a precipitation code" — and no longer sets any number.
export const RAIN_CODES = new Set([51, 53, 55, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99])
export const SNOW_CODES = new Set([71, 73, 75, 77, 85, 86])
// Thunder is a lightning claim, not a precipitation one — no amount of radar
// reflectivity establishes it, so these codes need a source that actually
// observed or forecast thunder (a station report, a warning, a confident hour).
export const THUNDER_CODES = new Set([95, 96, 99])

// 0 none · 1 light · 2 moderate · 3 heavy · 4 severe
const PRECIP_TIER = {
  51: 1, 53: 2, 55: 2, 61: 1, 63: 2, 65: 3, 66: 1, 67: 2, 71: 1, 73: 2, 75: 3, 77: 1,
  80: 1, 81: 2, 82: 4, 85: 1, 86: 3, 95: 4, 96: 4, 99: 4,
}
export function precipTier(code) { return PRECIP_TIER[code] ?? 0 }


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

// Only the first couple of hours of minutely_15 are an actual nowcast. The
// series itself spans the ENTIRE forecast range (verified: 288 slots = 3 days),
// so the "no minutely data for this hour" escape below never fires and the
// reality-check would otherwise run against plain model output days ahead.
const NOWCAST_HORIZON_HOURS = 2

// Shift a naive local timestamp ("YYYY-MM-DDTHH:MM") by whole hours, staying in
// the same naive frame. Parsed as UTC so the browser's own offset and DST never
// enter into it; the strings are already in the location's local time.
function shiftHours(localTimeStr, hours) {
  const d = new Date(`${localTimeStr.slice(0, 16)}:00Z`)
  d.setUTCHours(d.getUTCHours() + hours)
  return d.toISOString().slice(0, 16)
}

// Reality-checks a FUTURE hourly slot code against the minutely_15 nowcast.
// If the nowcast shows negligible precip across the entire slot window, downgrade
// a precipitation code to a sky condition. Non-precip codes pass through unchanged.
// Safe to call for any slot: returns the original code unchanged whenever the slot
// is beyond the nowcast horizon, minutely data doesn't cover that hour, or the
// hourly codes came from NWS.
//
// Both escapes exist for the same reason — this check is only ever meant to let
// Open-Meteo's minutely model reality-check Open-Meteo's own hourly codes, which
// come from the same forecast system. Beyond the horizon, or wherever NWS codes
// have been merged in, it is a second model overruling the authoritative one.
//
// Open-Meteo's minutely model is routinely bone dry straight through NWS
// convection. Verified twice over Bel Air MD: once during heavy showers with NWS
// at 70% "Showers and Thunderstorms Likely" all afternoon, and again during a
// thunderstorm with NWS calling 55 / 99 / 45% for the next three hours — both
// times minutely_15 read 0.00 for every slot. Capping the horizon alone did not
// fix that, it only moved the damage onto the three hours the user is standing
// in, so NWS-sourced codes now skip the check outright.
export function nowcastHourlyCode(code, minutely, slotTimeStr, current) {
  if (precipTier(code) === 0) return code
  if (!minutely?.time?.length || !minutely?.precipitation?.length) return code
  if (!current?.time) return code
  // Set by fetchWeather once mergeNWSHourly has overwritten the hourly arrays.
  // A single flag is enough: this check already returns early beyond
  // NOWCAST_HORIZON_HOURS, and NWS's hourly forecast always covers that window.
  if (current.nws_hourly) return code
  if (slotTimeStr > shiftHours(current.time, NOWCAST_HORIZON_HOURS)) return code
  // A station is measuring precipitation here right now, so the minutely series
  // is demonstrably wrong at this location and can't be trusted to veto the
  // near-term forecast either. Same rule liveWeatherCode applies to `current`.
  if (current.weather_code_confirmed && precipTier(current.weather_code) > 0) return code
  // slotTimeStr format: "YYYY-MM-DDTHH:MM" — match all minutely entries in the same hour.
  const prefix = slotTimeStr.slice(0, 14) // "YYYY-MM-DDTHH:"
  let peak = 0, found = false
  for (let j = 0; j < minutely.time.length; j++) {
    if (minutely.time[j].startsWith(prefix)) {
      peak = Math.max(peak, minutely.precipitation[j] ?? 0)
      found = true
    }
  }
  return found && peak < PRECIP_RATE.TRACE ? skyCode(current.cloud_cover) : code
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
  // The mirror image: radar sees an echo directly over the location, so something
  // IS falling here no matter what the model says. useRadarPrecip has always
  // reported this state and nothing ever consumed it — only "clear" was acted on.
  // That asymmetry is what left "Partly Cloudy" on screen over Bel Air MD with a
  // saturated echo overhead, every station stale or silent, and no alert issued:
  // radar was the one source that had it right and its answer was discarded.
  //
  // The forecast's own code for this hour says what kind of precipitation it is
  // (it is the local forecast, just not confident enough on its own); plain rain
  // or snow by temperature is the fallback when it offers nothing.
  if (radarClear === false) {
    // Already a precipitation code: radar corroborates it, so short-circuit the
    // rate logic below exactly as a station-confirmed code does. Otherwise the
    // dry minutely series that caused this whole class of bug would still get to
    // downgrade a code radar just confirmed.
    if (precipTier(code) > 0) return code
    // The forecast's code for this hour supplies the type — drizzle vs rain vs
    // snow — but only where it claims something reflectivity can actually stand
    // behind. Thunder is not that: radar sees precipitation, not lightning, and a
    // convective code that reached here is one preferForecastHour already judged
    // too low-confidence to promote (anything at/above FORECAST_POP_FLOOR would
    // have been set on `current` and returned above). Minting "Heavy
    // Thunderstorm" out of an echo and a 20%-chance forecast is the same
    // over-claim as the old code's 0%, pointed the other way — verified over Bel
    // Air MD, where NWS still carried 96 for hours after the storm passed and
    // only light rain was left falling.
    const forecast = current.forecast_hour_code
    if (forecast != null && precipTier(forecast) > 0 && !THUNDER_CODES.has(forecast)) return forecast
    const snow = current.temperature_2m != null && current.temperature_2m <= 32 // °F
    return snow ? 71 : 61
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

// The sun's own colour: golden-yellow when it rides high, deepening to orange
// near the horizon at sunrise and sunset. SUN_YELLOW doubles as the plain
// "sun" accent and SUN_ORANGE as the sunrise/sunset accent.
export const SUN_YELLOW = '#eab308'
export const SUN_ORANGE = '#f97316'

// Interpolated sun colour for how high it sits. `progress` matches the sun-dial
// arc: 0 at sunrise, 0.5 at solar noon, 1 at sunset. Yellow at the peak, orange
// at either horizon (and below, where the caller dims it).
export function sunColor(progress) {
  const p = Math.max(0, Math.min(1, progress))
  const alt = Math.sin(p * Math.PI) // 0 at the horizon, 1 at solar noon
  const orange = [249, 115, 22]
  const yellow = [234, 179, 8]
  const c = orange.map((ch, i) => Math.round(ch + alt * (yellow[i] - ch)))
  return `rgb(${c[0]},${c[1]},${c[2]})`
}

export function formatDay(dateString) {
  const date = new Date(dateString + 'T12:00:00')
  const today = new Date()
  if (date.toDateString() === today.toDateString()) return 'Today'
  return date.toLocaleDateString('en-US', { weekday: 'short' })
}
