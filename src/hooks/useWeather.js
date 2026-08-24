import { useState, useCallback, useRef } from 'react'
import { nowcastHourlyCode, precipTier, livePrecipRate } from '../utils/weatherCodes'
import { gridHourly, gridHourlyAccum, gridHourlySpans } from '../utils/nwsGrid'

const GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search'
const WEATHER_URL = 'https://api.open-meteo.com/v1/forecast'
const AQI_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality'
const NOAA_ALERTS_URL = 'https://api.weather.gov/alerts/active'
const NWS_POINTS_URL = 'https://api.weather.gov/points'
// NWS requires contact info in the User-Agent. Plus-addressed so scraped spam
// is filterable and the address is identifiable as coming from this app.
const NWS_HEADERS = { 'User-Agent': 'AlekWeatherApp/1.0 (angelov6+alekweather@terpmail.umd.edu)' }

// NWS icon code → WMO weather code
//
// The `_hi` and `_sct` suffixes are *coverage*, not intensity: per the NWS icon
// legend, `rain_showers_hi` is "Rain Showers (Isolated/Scattered)" and `tsra_hi`
// is "Thunderstorm (Isolated)" — the least of each family, not the worst. Reading
// them as an intensity ladder is what turned a 20%-chance isolated-showers hour
// into "Violent Showers" (82) and an isolated-storm hour into "Heavy
// Thunderstorm" (96). WMO has no coverage axis, so each maps to the same code as
// its base condition and the probability column carries the coverage.
const NWS_ICON_TO_WMO = {
  skc: 0, wind_skc: 0, hot: 0, cold: 0,
  few: 1, wind_few: 1,
  sct: 2, wind_sct: 2,
  bkn: 3, wind_bkn: 3, ovc: 3, wind_ovc: 3,
  fog: 45, ice_fog: 48,
  haze: 3, dust: 3, smoke: 3,
  drizzle: 51,
  rain: 61,
  rain_showers: 80,
  rain_showers_hi: 80,
  tsra_sct: 95, tsra: 95,
  tsra_hi: 95,
  snow: 71,
  snow_showers: 85, snow_showers_hi: 85,
  fzra: 67, sleet: 77, blizzard: 75,
  tornado: 99, hurricane: 99,
}

// When a period has two conditions, pick the more severe one. Ordered by
// severity, so each family's coverage variants sit below the family itself —
// widespread thunderstorms outrank isolated ones, not the reverse.
const NWS_ICON_PRIORITY = [
  'tornado', 'hurricane', 'tsra', 'tsra_sct', 'tsra_hi',
  'blizzard',
  'rain', 'rain_showers', 'rain_showers_hi',
  'snow', 'snow_showers', 'snow_showers_hi', 'fzra', 'sleet',
  'drizzle', 'ice_fog', 'fog', 'haze', 'dust', 'smoke',
  'ovc', 'wind_ovc', 'bkn', 'wind_bkn', 'sct', 'wind_sct',
  'few', 'wind_few', 'skc', 'wind_skc', 'hot', 'cold',
]

function parseNWSIcon(iconUrl) {
  if (!iconUrl) return null
  try {
    // e.g. "/icons/land/day/tsra,80" or "/icons/land/day/ovc/tsra,60"
    const parts = new URL(iconUrl).pathname.split('/').filter(Boolean)
    const conditions = parts.slice(3).map(p => p.split(',')[0])
    for (const code of NWS_ICON_PRIORITY) {
      if (conditions.includes(code)) return code
    }
    return conditions[0] ?? null
  } catch {
    return null
  }
}

// Returns the icon code that ranks higher (more severe) in NWS_ICON_PRIORITY.
function pickMoreSevere(a, b) {
  if (!b) return a
  const ia = NWS_ICON_PRIORITY.indexOf(a), ib = NWS_ICON_PRIORITY.indexOf(b)
  if (ia === -1) return b
  if (ib === -1) return a
  return ia <= ib ? a : b
}

// NWS wind direction (cardinal) → degrees
const CARDINAL_TO_DEG = {
  N: 0, NNE: 22, NE: 45, ENE: 68,
  E: 90, ESE: 112, SE: 135, SSE: 157,
  S: 180, SSW: 203, SW: 225, WSW: 248,
  W: 270, WNW: 293, NW: 315, NNW: 338,
}

// "10 to 15 mph" → 15  (take the higher bound)
function parseWindMph(str) {
  if (!str) return null
  const nums = str.match(/\d+/g)
  return nums ? Math.max(...nums.map(Number)) : null
}

// Convert a NWS startTime ISO string to a local "YYYY-MM-DDTHH:00" key.
function nwsLocalKey(isoString, timezone) {
  return new Date(isoString)
    .toLocaleString('sv', { timeZone: timezone })
    .replace(' ', 'T')
    .slice(0, 13) + ':00'
}

// The slot key for the hour the user is currently in, in the location's own
// zone — the same "YYYY-MM-DDTHH:00" shape Open-Meteo's hourly array uses.
function currentHourKey(timezone) {
  const local = new Date().toLocaleString('sv', { timeZone: timezone })
  return `${local.slice(0, 10)}T${local.slice(11, 13)}:00`
}

// The span at which NWS has stopped forecasting hour by hour and is publishing
// one figure for a whole part of the day. Six is its own standard block.
const BLOCK_SPAN_HOURS = 6

// Which gridpoint elements decide an hourly field's resolution. Where a field
// has more than one, the finest of them wins at each hour, because the field is
// as detailed as its most detailed input.
//
// weather_code is the one that matters and the one that is easy to get wrong.
// Judged on `weather` alone it looks hopelessly coarse — that element is sparse
// by design, and a settled week is a single entry saying "nothing" for seventy
// hours. But the icon is not just precipitation: sky cover is what separates
// sunny from overcast, it is published hourly, and it is what actually varies
// across a dry afternoon. Reading `weather` on its own put the icon on
// Open-Meteo for all but the next two hours; reading both puts it on NWS for
// three days.
//
// `is_day` is deliberately absent: it is solar geometry, exact at any range.
const FIELD_ELEMENTS = {
  temperature_2m:            ['temperature'],
  apparent_temperature:      ['apparentTemperature', 'heatIndex', 'windChill'],
  relative_humidity_2m:      ['relativeHumidity'],
  wind_speed_10m:            ['windSpeed'],
  wind_direction_10m:        ['windDirection'],
  wind_gusts_10m:            ['windGust'],
  visibility:                ['visibility'],
  precipitation_probability: ['probabilityOfPrecipitation'],
  weather_code:              ['weather', 'skyCover'],
}

// The finest span covering each hour across a field's backing elements.
function fieldSpans(grid, elements, timezone) {
  const out = new Map()
  for (const element of elements) {
    for (const [key, span] of gridHourlySpans(grid[element], timezone)) {
      const best = out.get(key)
      if (best == null || span < best) out.set(key, span)
    }
  }
  return out
}

// Per field, the first hour from now at which NWS stops forecasting it hour by
// hour. NWS supplies that field up to this point; Open-Meteo — which models
// every hour out to seven days — supplies it from there on.
//
// The cut is monotonic: once a field goes to blocks it stays on Open-Meteo,
// even if a finer entry turns up again later in the week. Switching back and
// forth hour by hour would squeeze a little more NWS out of the range at the
// cost of a row that visibly zigzags between two sources that never agree
// exactly, which is a bad trade for a strip someone reads at a glance.
function nwsFieldHorizons(grid, timezone) {
  const now = currentHourKey(timezone)
  const out = {}
  for (const [field, elements] of Object.entries(FIELD_ELEMENTS)) {
    let horizon = null
    for (const [key, span] of fieldSpans(grid, elements, timezone)) {
      if (key < now || span < BLOCK_SPAN_HOURS) continue
      if (horizon == null || key < horizon) horizon = key
    }
    out[field] = horizon
  }
  return out
}

// Whether NWS still backs `field` at `key`. No horizons at all means the
// gridpoint never loaded, and then NWS is used as far as it reaches — the old
// behaviour, and better than dropping it entirely.
function nwsCovers(horizons, field, key) {
  if (!horizons) return true
  const horizon = horizons[field]
  return horizon == null || key < horizon
}

// Overwrite Open-Meteo hourly arrays with NWS data for US locations, wherever
// NWS publishes a value. Open-Meteo is the fallback, not a rival: it keeps the
// hours NWS doesn't reach — the past day the app carries, and the tail beyond
// this product's range — and every field NWS never publishes at all.
//
// NWS hourly is authoritative for weather_code, precipitation_probability,
// temperature, wind, humidity, and is_day. The fields this product doesn't
// publish — feels-like, gusts, visibility — come from the raw gridpoint behind
// it, merged in mergeNWSGridHourly below.
//
// Each field runs only as far as NWS is still forecasting it hour by hour, and
// that differs sharply between them: temperature stays hourly for the whole
// week, while visibility is published in blocks from the first hour. Past its
// own horizon a field keeps Open-Meteo's values (see nwsFieldHorizons).
function mergeNWSHourly(hourly, periods, timezone, horizons) {
  const lookup = new Map()
  for (const period of periods) {
    const key = nwsLocalKey(period.startTime, timezone)
    const iconCode = parseNWSIcon(period.icon)
    lookup.set(key, {
      wmoCode:  iconCode != null ? (NWS_ICON_TO_WMO[iconCode] ?? 3) : null,
      prob:     period.probabilityOfPrecipitation?.value ?? null,
      temp:     period.temperature ?? null,           // already °F
      windSpd:  parseWindMph(period.windSpeed),       // mph
      windDir:  CARDINAL_TO_DEG[period.windDirection] ?? null,
      humidity: period.relativeHumidity?.value ?? null,
      isDay:    period.isDaytime != null ? (period.isDaytime ? 1 : 0) : null,
    })
  }
  for (let i = 0; i < hourly.time.length; i++) {
    const key = hourly.time[i].slice(0, 13) + ':00'
    const nws = lookup.get(key)
    if (!nws) continue
    const put = (field, value) => {
      if (value != null && hourly[field] && nwsCovers(horizons, field, key)) hourly[field][i] = value
    }
    put('weather_code',              nws.wmoCode)
    put('precipitation_probability', nws.prob)
    put('temperature_2m',            nws.temp)
    put('wind_speed_10m',            nws.windSpd)
    put('wind_direction_10m',        nws.windDir)
    put('relative_humidity_2m',      nws.humidity)
    // No horizon: day and night are astronomy, exact at any range.
    if (nws.isDay != null) hourly.is_day[i] = nws.isDay
  }
}

// The gridpoint elements the app actually reads, expanded to one value per local
// hour and converted to the app's canonical units. Built once and shared by the
// three merges below so the payload is walked once, not three times.
//
// Two elements the app wants have no NWS source at all, and both stay
// Open-Meteo's. There is no UV index at any NWS endpoint. And `pressure` is in
// the grid schema but offices publish it empty (verified against LWX) — the
// only NWS barometer is on the observation stations, and those read at their
// own elevation, not the user's: over Bel Air MD (120 m) the nearest field
// (KMTN, 7 m) reported 1013 hPa against Open-Meteo's 998 for the location
// itself. That gap is altitude, not a better measurement, and taking it would
// have stood the pressure tile 15 hPa above the chart drawn underneath it from
// the hourly series.
function nwsGridMaps(grid, timezone) {
  return {
    feels: gridHourly(grid.apparentTemperature, timezone),
    heat:  gridHourly(grid.heatIndex, timezone),
    chill: gridHourly(grid.windChill, timezone),
    gust:  gridHourly(grid.windGust, timezone),
    vis:   gridHourly(grid.visibility, timezone),
    sky:   gridHourly(grid.skyCover, timezone),
    dew:   gridHourly(grid.dewpoint, timezone),
    qpf:   gridHourlyAccum(grid.quantitativePrecipitation, timezone),
  }
}

// Fill the hourly fields /forecast/hourly doesn't carry. Everything here is
// keyed the same way mergeNWSHourly keys its lookup, so the two land on the
// same slots and an hour is either wholly NWS or wholly Open-Meteo per field.
//
// heatIndex/windChill back up apparentTemperature because the grid publishes
// the feels-like family seasonally: outside the ranges where one applies the
// element is present but null, and the other is what has the number.
function mergeNWSGridHourly(hourly, maps, horizons) {
  for (let i = 0; i < hourly.time.length; i++) {
    const key = hourly.time[i].slice(0, 13) + ':00'
    const put = (field, value) => {
      if (value != null && hourly[field] && nwsCovers(horizons, field, key)) hourly[field][i] = value
    }
    put('apparent_temperature', maps.feels.get(key) ?? maps.heat.get(key) ?? maps.chill.get(key))
    put('wind_gusts_10m', maps.gust.get(key))
    put('visibility', maps.vis.get(key))
  }
}

// NWS's forecast day runs 06:00 to 06:00, not midnight to midnight. Its
// "Tonight" period carries the evening and the small hours together, and belongs
// to the evening it started from — not to the calendar date most of its hours
// happen to fall in.
//
// Bucketing by calendar date instead is what put a 2 a.m. thunderstorm onto the
// *next* day's card: verified over Bel Air MD, where NWS published "Tonight
// 74%" and "Sunday 36%, Mostly Sunny", and the app showed Sunday as 74% off
// that single overnight hour while Sunday's own afternoon sat at 1%.
const NWS_DAY_START_HOUR = 6

// "YYYY-MM-DD" + 1 day. Noon UTC keeps the arithmetic clear of every DST edge —
// no local midnight is ever skipped or repeated in the middle of a day.
function nextDate(date) {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

// Whether an hourly slot ("YYYY-MM-DDTHH:00") belongs to `date`'s NWS forecast
// day: from 06:00 on the date through 05:00 the following morning.
function inNWSForecastDay(slotTime, date) {
  const hour = Number(slotTime.slice(11, 13))
  if (slotTime.startsWith(date)) return hour >= NWS_DAY_START_HOUR
  return hour < NWS_DAY_START_HOUR && slotTime.startsWith(nextDate(date))
}

// WMO code severity for finding the worst condition in a day.
function wmoSeverity(code) {
  if (code >= 95) return 8  // thunderstorm
  if (code >= 85) return 7  // snow showers
  if (code >= 80) return 6  // rain showers
  if (code >= 71) return 5  // snow
  if (code >= 65) return 4  // heavy rain
  if (code >= 61) return 3  // moderate rain
  if (code >= 51) return 2  // drizzle
  if (code >= 45) return 1  // fog
  return 0
}

// After NWS hourly data has been merged into `hourly`, re-derive the daily
// weather code from the hourly arrays so that DailyForecast, HourlyForecast,
// and WeatherOverview always agree.
//
// The NWS period-summary (/forecast) and hourly (/forecast/hourly) endpoints
// are produced by different systems and routinely disagree — e.g. the daily
// period may say "75 % thunderstorms" while the hourly breakdown shows only
// clouds. Re-deriving the code from hourly makes the three views internally
// consistent, and lets the nowcast correction reach the daily summary.
//
// Precipitation probability is deliberately NOT re-derived when the NWS daily
// periods merged. A day's POP is not the maximum of its hours: NWS publishes
// one figure per day/night period, and taking the peak hour instead reports the
// single worst hour as the whole day — 74% for a day NWS itself calls 36% and
// "Mostly Sunny". `nwsDailyMerged` says whether that authoritative figure is
// already in place; when it isn't (non-US, or that fetch failed) the hourly max
// is still the best available answer and is used as before.
function alignDailyWithHourly(daily, hourly, minutely, current, timezone, nwsDailyMerged, codeHorizon) {
  // Only look at future/current slots — past NWS codes can no longer be
  // nowcast-corrected and would inflate the daily summary with phantom events.
  const nowLocal = new Date().toLocaleString('sv', { timeZone: timezone })
  const currentSlot = `${nowLocal.slice(0, 10)}T${nowLocal.slice(11, 13)}:00`

  for (let i = 0; i < daily.time.length; i++) {
    const date = daily.time[i]
    // Once the hourly codes are Open-Meteo's, re-deriving from them would
    // overwrite the day NWS actually published.
    if (codeHorizon != null && date >= codeHorizon.slice(0, 10)) break
    let maxProb = null
    let peakCode = null
    let peakSev = -1
    for (let j = 0; j < hourly.time.length; j++) {
      const slotTime = hourly.time[j]
      if (!inNWSForecastDay(slotTime, date)) continue
      if (slotTime < currentSlot) continue  // skip past hours

      const rawCode = hourly.weather_code?.[j]
      if (rawCode == null) continue

      // Apply the same nowcast correction used by HourlyForecast and WeatherOverview.
      // Slots beyond the minutely window are returned unchanged.
      const code = nowcastHourlyCode(rawCode, minutely, slotTime, current)

      // When nowcast downgrades to non-precip, that slot contributes 0 probability.
      const p = precipTier(code) === 0 ? 0 : (hourly.precipitation_probability?.[j] ?? null)
      if (p != null) maxProb = maxProb == null ? p : Math.max(maxProb, p)

      const sev = wmoSeverity(code)
      if (sev > peakSev) { peakSev = sev; peakCode = code }
    }
    if (!nwsDailyMerged && maxProb != null) daily.precipitation_probability_max[i] = maxProb
    if (peakCode != null) daily.weather_code[i] = peakCode
  }
}

// Overwrite Open-Meteo daily arrays with NWS forecast data for US locations.
// NWS gives day/night period pairs; we map them to daily hi/lo temps, weather
// codes, and max precipitation probability. Precip totals and the day's peak
// wind come from the gridpoint instead, in deriveDailyFromNWS below — the
// period summaries carry neither as a number. Sunrise/sunset stay Open-Meteo's
// (they are astronomy, identical whoever forecasts the weather) and so does UV,
// which NWS does not publish at all.
function mergeNWSDaily(daily, periods, timezone) {
  // Group day/night periods by calendar date
  const dayMap = new Map()
  for (const period of periods) {
    const date = new Date(period.startTime)
      .toLocaleString('sv', { timeZone: timezone })
      .slice(0, 10)
    if (!dayMap.has(date)) dayMap.set(date, {})
    const entry = dayMap.get(date)
    if (period.isDaytime) entry.day = period
    else entry.night = period
  }

  for (let i = 0; i < daily.time.length; i++) {
    const entry = dayMap.get(daily.time[i])
    if (!entry) continue
    const { day, night } = entry

    // Weather code: pick the more severe icon between day and night
    const dayIcon   = parseNWSIcon(day?.icon)
    const nightIcon = parseNWSIcon(night?.icon)
    const best = pickMoreSevere(dayIcon, nightIcon)
    if (best != null) daily.weather_code[i] = NWS_ICON_TO_WMO[best] ?? 3

    // Hi/lo: daytime period = high, nighttime = low
    if (day?.temperature   != null) daily.temperature_2m_max[i] = day.temperature
    if (night?.temperature != null) daily.temperature_2m_min[i] = night.temperature

    // Max precipitation probability across day + night
    const dp = day?.probabilityOfPrecipitation?.value ?? null
    const np = night?.probabilityOfPrecipitation?.value ?? null
    if (dp != null || np != null)
      daily.precipitation_probability_max[i] = Math.max(dp ?? 0, np ?? 0)
  }
}

// Daily precipitation total and peak wind, the two daily numbers the NWS period
// summaries express only as prose.
//
// Precipitation is the delicate one. NWS publishes quantitative precipitation
// out to roughly three days and then stops, and the grid begins at the current
// hour — so a date the grid only partly covers would report part of a day as
// the whole of it, and today would lose whatever already fell before now.
// Overriding only a date whose every hour the grid covers is what keeps that
// honest: today and the far end of the week stay on Open-Meteo's totals, which
// do span the whole day, and the days in between come from NWS.
//
// Peak wind is taken from the already-merged hourly array rather than the grid,
// so it agrees with the wind column the user can scroll through. On today that
// array is Open-Meteo before the current hour and NWS after it — the day's peak
// is a fact about the whole day, and dropping the morning to keep the row pure
// would report a calm afternoon as the day's maximum.
function deriveDailyFromNWS(daily, hourly, maps) {
  for (let i = 0; i < daily.time.length; i++) {
    const date = daily.time[i]
    let hours = 0, covered = 0, total = 0, windMax = null
    for (let j = 0; j < hourly.time.length; j++) {
      if (!hourly.time[j].startsWith(date)) continue
      hours++
      const q = maps.qpf.get(hourly.time[j].slice(0, 13) + ':00')
      if (q != null) { total += q; covered++ }
      const w = hourly.wind_speed_10m?.[j]
      if (w != null) windMax = windMax == null ? w : Math.max(windMax, w)
    }
    if (hours > 0 && covered === hours && daily.precipitation_sum)
      daily.precipitation_sum[i] = Math.round(total * 100) / 100
    if (windMax != null && daily.wind_speed_10m_max)
      daily.wind_speed_10m_max[i] = windMax
  }
}

// NWS /alerts/active often returns an alert AND the update that supersedes it
// (msgType "Update" lists the originals under `references`) while both are
// still technically active — the UI would show the same event twice. Drop
// anything referenced by a newer alert, then collapse remaining duplicates of
// the same event + area down to the most recently sent one.
function dedupeAlerts(features) {
  const superseded = new Set()
  for (const f of features) {
    for (const ref of f.properties?.references ?? []) {
      if (ref.identifier) superseded.add(ref.identifier)
    }
  }
  const sorted = [...features].sort((a, b) =>
    new Date(b.properties?.sent ?? 0) - new Date(a.properties?.sent ?? 0)
  )
  const seen = new Set()
  return sorted.filter(f => {
    const p = f.properties ?? {}
    if (superseded.has(p.id) || superseded.has(f.id)) return false
    const key = `${p.event}|${p.areaDesc}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// Collapse multiple alerts for the same hazard — e.g. Severe Thunderstorm
// Warnings for two neighboring counties plus a Watch for a third — down to the
// single most urgent one, so the alert list shows each distinct hazard once.
// "Most urgent" = highest message level (Warning > Watch > Advisory >
// Statement), then highest severity, then most recently sent. Distinct
// hazards (e.g. a Flood Warning alongside a Tornado Warning) stay separate.
const LEVEL_RANK    = { Warning: 3, Watch: 2, Advisory: 1, Statement: 0 }
const SEVERITY_RANK = { Extreme: 4, Severe: 3, Moderate: 2, Minor: 1, Unknown: 0 }

// "Severe Thunderstorm Warning" and "Severe Thunderstorm Watch" both group
// under "Severe Thunderstorm".
function hazardFamily(event = '') {
  return event.replace(/\s+(Warning|Watch|Advisory|Statement)$/i, '').toLowerCase()
}

function alertUrgency(p = {}) {
  const level = Object.keys(LEVEL_RANK).find(s => p.event?.endsWith(s))
  return [
    level ? LEVEL_RANK[level] : 0,
    SEVERITY_RANK[p.severity] ?? 0,
    new Date(p.sent ?? 0).getTime(),
  ]
}

function collapseAlerts(features) {
  const byHazard = new Map()
  for (const f of features) {
    const key = hazardFamily(f.properties?.event)
    const current = byHazard.get(key)
    if (!current) { byHazard.set(key, f); continue }
    const a = alertUrgency(f.properties)
    const b = alertUrgency(current.properties)
    for (let i = 0; i < a.length; i++) {
      if (a[i] === b[i]) continue
      if (a[i] > b[i]) byHazard.set(key, f)
      break
    }
  }
  return [...byHazard.values()]
}

// How far away a station can be and still be describing the user's weather.
// METAR precipitation is intensely local — a summer cell is a few km across — so
// past a short radius a report is simply someone else's sky. Verified over Bel
// Air MD: KMTN, 23 km southwest, reported Heavy Rain while the nearest field
// (K0W3, 13 km) reported Clear and nothing at all was falling in Bel Air. 16 km
// is roughly the representativeness limit for surface precipitation reports.
const MAX_STATION_KM = 16

// Equirectangular approximation. At these distances the error against haversine
// is centimetres, and it costs a fraction as much.
function distanceKm(lat1, lon1, lat2, lon2) {
  const x = (lon2 - lon1) * Math.cos(((lat1 + lat2) / 2) * Math.PI / 180)
  const y = lat2 - lat1
  return Math.sqrt(x * x + y * y) * 111.32
}

// How stale a report may be before it stops describing *now*, keyed to how fast
// the phenomenon it reports can end. One flat window cannot serve all three: a
// thunderstorm cell crosses a town in about fifteen minutes, steady rain and snow
// outlast that comfortably, and fog can sit for hours. The old flat 75 min is
// what let K0W3's 17:15Z "Light Rain and Fog/Mist and Thunderstorms" still
// headline "Thunderstorm" at 17:44Z over a Bel Air where nothing was falling.
const MAX_OBS_AGE_MIN = { thunder: 25, precip: 45, fog: 75 }

// Classify a NWS station observation (METAR) into a WMO weather code, ignoring
// age. `allowThunder` lets the caller retire a thunder claim that has outlived
// its window while still reading the rain underneath it: "light rain and
// thunderstorms" half an hour on is far better evidence of light rain than of
// thunder, and dropping the whole report would throw away a real measurement.
function classifyObs(obs, allowThunder) {
  // Substring matching: the API uses plural/compound values ("thunderstorms",
  // "snow_showers", "freezing_rain" — verified live against KMTN during a
  // storm), so exact equality would silently miss them.
  const pw = obs.presentWeather ?? []
  const has = (w) => pw.some(x => x.weather?.includes(w))
  const intensityOf = (w) => pw.find(x => x.weather?.includes(w))?.intensity
  if (allowThunder && has('thunder')) return 95
  if (has('freezing_rain') || has('freezing_drizzle')) return 67
  if (has('snow')) {
    const i = intensityOf('snow')
    return i === 'heavy' ? 75 : i === 'light' ? 71 : 73
  }
  if (has('rain')) {
    const i = intensityOf('rain')
    return i === 'heavy' ? 65 : i === 'light' ? 61 : 63
  }
  if (has('drizzle')) return 53
  if (has('fog')) return 45

  // presentWeather is often empty; fall back to the text summary.
  const txt = (obs.textDescription ?? '').toLowerCase()
  if (allowThunder && txt.includes('thunderstorm')) return 95
  if (txt.includes('freezing')) return 67
  if (txt.includes('snow')) return txt.includes('heavy') ? 75 : txt.includes('light') ? 71 : 73
  if (txt.includes('rain') || txt.includes('shower')) return txt.includes('heavy') ? 65 : txt.includes('light') ? 61 : 63
  if (txt.includes('drizzle')) return 53
  if (txt.includes('fog') || txt.includes('mist')) return 45
  return null
}

// Map a NWS station observation (METAR) to a WMO weather code. This is the
// only *measured* current-weather source in the pipeline — everything else is
// model output, which routinely trails radar in convective weather.
// Sky-cover-only observations return null so the model pipeline keeps handling
// clear/cloudy — the station can be far enough away that its cloud deck differs
// from the user's.
function obsToWmoCode(obs) {
  if (!obs?.timestamp) return null
  const ageMin = (Date.now() - new Date(obs.timestamp).getTime()) / 60000
  if (!(ageMin >= 0)) return null

  const code = classifyObs(obs, ageMin <= MAX_OBS_AGE_MIN.thunder)
  if (code == null) return null

  const limit = code === 45 ? MAX_OBS_AGE_MIN.fog : MAX_OBS_AGE_MIN.precip
  return ageMin <= limit ? code : null
}

// Copy the current hour's merged NWS values onto `current`.
//
// The merges above write into `hourly` only, so on US locations the
// authoritative NWS read on the hour the user is actually living in sits one
// array away from the headline with nothing able to reach it. For the weather
// code that meant `current.weather_code` could only ever be overridden by a
// station observation or an active warning; for everything else it meant the
// big number at the top of the screen stayed Open-Meteo's while the first
// column of the hourly row beneath it — the same hour — was NWS's, and the two
// could plainly disagree. Stamping the slot here fixes both, and puts the code
// within reach of liveWeatherCode without threading the hourly arrays through
// every component that renders a current condition.
//
// `maps` is optional: the gridpoint is a separate request from the hourly
// forecast and either can fail on its own, so a missing grid costs the two
// fields only it carries and leaves the rest merged.
function stampCurrentFromNWS(data, maps) {
  if (!data.current) return
  const hourKey = currentHourKey(data.timezone)
  const idx = data.hourly?.time?.indexOf(hourKey) ?? -1
  if (idx === -1) return
  const hourly = data.hourly
  data.current.forecast_hour_code = hourly.weather_code?.[idx] ?? null
  data.current.forecast_hour_pop  = hourly.precipitation_probability?.[idx] ?? null

  // Only fields the NWS merges actually wrote. `weather_code` is deliberately
  // not among them: the current condition has its own ladder — a station that
  // measured it, then an active warning, then this hour's forecast — and
  // preferForecastHour further down is the rung that reads it, under a
  // confidence floor. Overwriting it here would jump the queue and promote a
  // 20%-chance forecast to an observed fact.
  const put = (field, value) => { if (value != null) data.current[field] = value }
  put('temperature_2m',       hourly.temperature_2m?.[idx])
  put('apparent_temperature', hourly.apparent_temperature?.[idx])
  put('relative_humidity_2m', hourly.relative_humidity_2m?.[idx])
  put('wind_speed_10m',       hourly.wind_speed_10m?.[idx])
  put('wind_direction_10m',   hourly.wind_direction_10m?.[idx])
  put('wind_gusts_10m',       hourly.wind_gusts_10m?.[idx])
  put('visibility',           hourly.visibility?.[idx])
  put('is_day',               hourly.is_day?.[idx])
  if (maps) {
    put('dew_point_2m', maps.dew.get(hourKey))
    put('cloud_cover',  maps.sky.get(hourKey))
  }
}

// With no station report and no active warning, the current condition falls all
// the way back to Open-Meteo's model `current` — the weakest source in the stack
// for convection. Over Bel Air MD it read "Partly Cloudy, 0.00 in" while NWS's
// own hourly forecast for that same hour called thunderstorms and a storm was
// overhead. When the merged NWS forecast for this hour is both convective and
// confident, prefer it over the model.
//
// The floor is what keeps this honest: a 30% scattered-convection afternoon means
// storms somewhere in the county, not necessarily on this rooftop, and promoting
// that to a headline "Thunderstorm" would cry wolf all summer. Marked `forecast`
// rather than `station`/`warning` so a clear radar sweep — an actual observation
// — still outranks it in liveWeatherCode.
const FORECAST_POP_FLOOR = 60

function preferForecastHour(data) {
  const c = data.current
  if (!c || !c.nws_hourly) return             // non-US: no authoritative overlay
  if (c.weather_code_confirmed) return        // a station already measured this
  const code = c.forecast_hour_code
  if (code == null || precipTier(code) === 0) return
  if (precipTier(c.weather_code ?? -1) > 0) return   // model already says precip
  if ((c.forecast_hour_pop ?? 0) < FORECAST_POP_FLOOR) return
  c.weather_code = code
  c.weather_code_confirmed = true
  c.weather_code_source = 'forecast'
}

// Open-Meteo's model-driven current conditions can miss convective storms
// entirely — a clear-sky reading while radar shows an active thunderstorm
// overhead. When an active Severe/Extreme *warning* corroborates it, trust
// the most severe of the model's current code and the (NWS-merged) forecast
// code for this hour, and flag it so liveWeatherCode doesn't "correct" it
// back to a sky condition using the equally storm-blind minutely nowcast.
function confirmCurrentCode(data, alerts) {
  const now = new Date()
  const warning = alerts.find(a => {
    const p = a.properties ?? {}
    if (p.severity !== 'Severe' && p.severity !== 'Extreme') return false
    if (!/warning/i.test(p.event ?? '')) return false
    const started    = !p.onset   || new Date(p.onset) <= now
    const notExpired = !p.expires || new Date(p.expires) > now
    return started && notExpired
  })
  if (!warning) return

  // A Severe Thunderstorm Warning is the authoritative "heavy storm" signal the
  // WMO code can't express (95 = slight *or* moderate). Flag it so the current
  // condition can show the strong-storm icon even when the code stays 95. Set
  // independently of the code-correction below, which may return early.
  if (/thunderstorm/i.test(warning.properties?.event ?? '')) {
    data.current.severe_storm = true
  }

  const hourCode = data.current?.forecast_hour_code ?? null
  const currentCode = data.current?.weather_code
  const best = precipTier(hourCode ?? -1) >= precipTier(currentCode ?? -1) ? hourCode : currentCode
  if (best != null && precipTier(best) > 0) {
    data.current.weather_code = best
    data.current.weather_code_confirmed = true
    data.current.weather_code_source = 'warning'
    return
  }

  // No forecast source admits precipitation, but the warning plus ANY
  // measurable nowcast precip is corroboration enough — trace level, well
  // below the display threshold, since the nowcast under-reports convection.
  const rate = livePrecipRate(data.current, data.minutely_15) ?? 0
  if (rate >= 0.004) { // TRACE in weatherCodes.js
    data.current.weather_code = /thunderstorm/i.test(warning.properties?.event ?? '') ? 95 : 65
    data.current.weather_code_confirmed = true
    data.current.weather_code_source = 'warning'
  }
}

const PARAMS = [
  'current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,cloud_cover,surface_pressure,wind_speed_10m,wind_direction_10m,wind_gusts_10m,dew_point_2m,uv_index,visibility',
  'hourly=temperature_2m,apparent_temperature,precipitation_probability,weather_code,is_day,uv_index,wind_speed_10m,wind_direction_10m,wind_gusts_10m,relative_humidity_2m,surface_pressure,visibility',
  'daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,uv_index_max,wind_speed_10m_max,sunrise,sunset',
  'minutely_15=precipitation',
  'temperature_unit=fahrenheit',
  'wind_speed_unit=mph',
  'precipitation_unit=inch',
  'timezone=auto',
  'forecast_days=7',
  'past_days=1',
].join('&')

// Hourly us_aqi + pm2_5 forecast backs the multi-day air-quality insights
// (e.g. persistent wildfire smoke "through the week"); timezone=auto keeps the
// hourly timestamps local so they group by calendar day the same way daily does.
const AQI_PARAMS = [
  'current=us_aqi,pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone',
  'hourly=us_aqi,pm2_5',
  'timezone=auto',
  'forecast_days=5',
].join('&')

// `initialLoading` lets the app start in the loading state when it knows a
// fetch fires on mount (saved-city auto-load), so the empty state never
// flashes for the frame before that effect runs.
export function useWeather(initialLoading = false) {
  const [location, setLocation] = useState(null)
  const [weather, setWeather] = useState(null)
  const [airQuality, setAirQuality] = useState(null)
  const [alerts, setAlerts] = useState([])
  const [lastUpdated, setLastUpdated] = useState(null)
  const [searchResults, setSearchResults] = useState([])
  const searchAbortRef = useRef(null)
  const [loading, setLoading] = useState(!!initialLoading)
  const [error, setError] = useState(null)
  const geoActiveRef = useRef(false)
  const fetchIdRef = useRef(0)

  const reset = useCallback(() => {
    fetchIdRef.current++
    geoActiveRef.current = false
    setLocation(null)
    setWeather(null)
    setAirQuality(null)
    setAlerts([])
    setLastUpdated(null)
    setSearchResults([])
    setLoading(false)
    setError(null)
  }, [])

  // `silent` refetches in place: no loading screen, no torn-down air quality or
  // alerts, and a failure leaves the last good reading on screen instead of
  // replacing it with an error card. It is what the staleness refresh in App.jsx
  // uses — a background poll must never blank the app or shout about a dropped
  // connection the user didn't ask anything of.
  const fetchWeather = useCallback(async (loc, { silent = false } = {}) => {
    geoActiveRef.current = false
    const fetchId = ++fetchIdRef.current
    if (!silent) {
      setLoading(true)
      setError(null)
      setAirQuality(null)
      setAlerts([])
    }
    try {
      const [weatherResult, aqiResult, alertsResult, nwsPointsResult] = await Promise.allSettled([
        fetch(`${WEATHER_URL}?latitude=${loc.latitude}&longitude=${loc.longitude}&${PARAMS}`),
        fetch(`${AQI_URL}?latitude=${loc.latitude}&longitude=${loc.longitude}&${AQI_PARAMS}`),
        fetch(`${NOAA_ALERTS_URL}?point=${loc.latitude.toFixed(4)},${loc.longitude.toFixed(4)}`, { headers: NWS_HEADERS }),
        fetch(`${NWS_POINTS_URL}/${loc.latitude.toFixed(4)},${loc.longitude.toFixed(4)}`, { headers: NWS_HEADERS }),
      ])

      if (weatherResult.status === 'rejected') throw weatherResult.reason
      if (!weatherResult.value.ok) throw new Error(`Open-Meteo forecast returned ${weatherResult.value.status}`)
      const data = await weatherResult.value.json()

      // Parse alerts up front: an active warning corroborates the
      // current-condition cross-check after the NWS merge below.
      let alertFeatures = []
      if (alertsResult.status === 'fulfilled' && alertsResult.value.ok) {
        try {
          const alertsData = await alertsResult.value.json()
          alertFeatures = collapseAlerts(dedupeAlerts(alertsData.features ?? []))
        } catch { /* non-fatal */ }
      }

      // Slice daily from today so existing components are unaffected.
      const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: data.timezone })
      const todayIdx = data.daily.time.indexOf(todayStr)
      const start = todayIdx > 0 ? todayIdx : 0
      if (start > 0) {
        data.daily = Object.fromEntries(
          Object.entries(data.daily).map(([k, v]) => [k, Array.isArray(v) ? v.slice(start) : v])
        )
      }

      // For US locations, overlay NWS data on top of Open-Meteo.
      // Points call already ran in parallel; if it succeeded we fire the hourly,
      // daily and gridpoint fetches in parallel, then merge all three before
      // rendering.
      // Every step is non-fatal: any failure silently keeps the Open-Meteo values.
      if (nwsPointsResult.status === 'fulfilled' && nwsPointsResult.value.ok) {
        try {
          const pointsData = await nwsPointsResult.value.json()
          const hourlyUrl   = pointsData.properties?.forecastHourly
          const forecastUrl = pointsData.properties?.forecast
          const gridUrl     = pointsData.properties?.forecastGridData

          // Latest real observation from nearby stations, fetched in parallel
          // with the forecast calls; failures fall through to the model
          // pipeline (obsToWmoCode returns null). Small AWOS fields often
          // report nothing (verified: K0W3 near Bel Air MD was empty during an
          // active thunderstorm while KMTN two entries later reported +TS +RA),
          // so walk the list until a station actually reports weather — which
          // means a report that survives obsToWmoCode, not merely one with a
          // textDescription. A stale or sky-cover-only report from a nearer
          // station must not short-circuit the walk (verified during heavy
          // showers over Bel Air MD: K0W3 was 2.5 h stale with "Fog/Mist" and
          // KAPG said "Cloudy" while KMTN was reporting Rain).
          //
          // MAX_STATION_KM bounds that walk. Without it, "keep going until
          // someone reports weather" will eventually always find someone — the
          // farther the search runs, the likelier a hit and the less it has to do
          // with this location. Distance is checked before the request, so far
          // stations cost nothing. `limit` is generous because the filter, not
          // the list length, is what ends the walk now.
          const obsPromise = (async () => {
            const stationsUrl = pointsData.properties?.observationStations
            if (!stationsUrl) return null
            const sRes = await fetch(`${stationsUrl}?limit=8`, { headers: NWS_HEADERS })
            if (!sRes.ok) return null
            const stations = (await sRes.json()).features ?? []
            for (const s of stations) {
              const id = s.properties?.stationIdentifier
              if (!id) continue
              const [sLon, sLat] = s.geometry?.coordinates ?? []
              if (sLat == null || sLon == null) continue
              if (distanceKm(loc.latitude, loc.longitude, sLat, sLon) > MAX_STATION_KM) continue
              try {
                const oRes = await fetch(`https://api.weather.gov/stations/${id}/observations/latest`, { headers: NWS_HEADERS })
                if (!oRes.ok) continue
                const obs = (await oRes.json()).properties
                if (obsToWmoCode(obs) != null) return obs
              } catch { /* try the next station */ }
            }
            return null
          })().catch(() => null)

          const [nwsHourlyRes, nwsForecastRes, nwsGridRes] = await Promise.allSettled([
            hourlyUrl   ? fetch(hourlyUrl,   { headers: NWS_HEADERS }) : Promise.reject(),
            forecastUrl ? fetch(forecastUrl, { headers: NWS_HEADERS }) : Promise.reject(),
            gridUrl     ? fetch(gridUrl,     { headers: NWS_HEADERS }) : Promise.reject(),
          ])
          // The gridpoint carries the fields the two text products don't, and
          // its entry spans are what say how far each field stays an hourly
          // forecast before NWS drops to blocks and Open-Meteo takes over.
          let gridMaps = null, horizons = null
          if (nwsGridRes.status === 'fulfilled' && nwsGridRes.value.ok) {
            const d = await nwsGridRes.value.json()
            if (d.properties) {
              gridMaps = nwsGridMaps(d.properties, data.timezone)
              horizons = nwsFieldHorizons(d.properties, data.timezone)
            }
          }

          let nwsHourlyMerged = false
          if (nwsHourlyRes.status === 'fulfilled' && nwsHourlyRes.value.ok) {
            const d = await nwsHourlyRes.value.json()
            mergeNWSHourly(data.hourly, d.properties?.periods ?? [], data.timezone, horizons)
            nwsHourlyMerged = true
            // Marks the hourly codes as NWS-sourced, so the Open-Meteo minutely
            // nowcast stops vetoing them — true only while the codes actually are
            // NWS's. Must be set before alignDailyWithHourly below, which re-runs
            // the nowcast check.
            if (data.current && nwsCovers(horizons, 'weather_code', currentHourKey(data.timezone))) {
              data.current.nws_hourly = true
            }
          }
          if (gridMaps) mergeNWSGridHourly(data.hourly, gridMaps, horizons)

          // Both hourly merges have to land before the current hour is stamped
          // off the array they write.
          if (nwsHourlyMerged || gridMaps) stampCurrentFromNWS(data, gridMaps)

          // The daily card is NWS's own day/night forecast — the resolution it
          // actually publishes for a day, and the one weather.gov shows. Days
          // NWS doesn't reach keep Open-Meteo's.
          let nwsDailyMerged = false
          if (nwsForecastRes.status === 'fulfilled' && nwsForecastRes.value.ok) {
            const d = await nwsForecastRes.value.json()
            mergeNWSDaily(data.daily, d.properties?.periods ?? [], data.timezone)
            nwsDailyMerged = true
          }
          // Re-derive the daily code from the merged hourly data so the daily,
          // hourly and overview views agree, and so the nowcast correction
          // reaches the daily summary. The chance of rain is left out of it —
          // alignDailyWithHourly takes that from NWS's own published day — and
          // so are the days whose hourly codes have passed to Open-Meteo, which
          // would otherwise overwrite NWS's published day with a re-derivation.
          if (nwsHourlyMerged) {
            alignDailyWithHourly(data.daily, data.hourly, data.minutely_15, data.current,
                                 data.timezone, nwsDailyMerged, horizons?.weather_code)
          }
          // Precip total and peak wind read the merged hourly array, so this
          // runs after every hourly merge above.
          if (gridMaps) deriveDailyFromNWS(data.daily, data.hourly, gridMaps)

          // A station actually observing precipitation overrides the model's
          // current condition outright — measured beats predicted.
          const obsCode = obsToWmoCode(await obsPromise)
          if (obsCode != null) {
            data.current.weather_code = obsCode
            data.current.weather_code_confirmed = true
            data.current.weather_code_source = 'station'
          }

          // Nothing measured this hour — fall back to NWS's own forecast for it
          // rather than Open-Meteo's model. No-ops if a station just reported.
          preferForecastHour(data)
        } catch { /* non-fatal */ }
      }

      // Cross-check the current condition against active warnings + NWS hourly
      // so a storm the Open-Meteo model missed still shows as one.
      confirmCurrentCode(data, alertFeatures)

      if (fetchIdRef.current !== fetchId) return
      setWeather(data)
      setLocation(loc)
      setLastUpdated(new Date())
      setAlerts(alertFeatures)
      setError(null)  // a silent refresh skips the clear up top; success clears it here

      if (aqiResult.status === 'fulfilled' && aqiResult.value.ok) {
        const aqiData = await aqiResult.value.json()
        // Spread current so existing consumers keep reading top-level fields
        // (us_aqi, pm2_5, …); the hourly forecast rides along for the overview.
        if (fetchIdRef.current === fetchId && aqiData.current?.us_aqi != null)
          setAirQuality({ ...aqiData.current, hourly: aqiData.hourly ?? null })
      }

    } catch (e) {
      // Log the cause: a network/DNS fault and a bad API response both surface
      // as the same user-facing message, and are otherwise indistinguishable.
      console.error('Weather fetch failed:', e)
      if (!silent && fetchIdRef.current === fetchId) setError('Failed to fetch weather data. Please try again.')
    } finally {
      if (!silent && fetchIdRef.current === fetchId) setLoading(false)
    }
  }, [])

  const searchCity = useCallback(async (query) => {
    const trimmed = query.trim()
    if (!trimmed) { setSearchResults([]); return }
    searchAbortRef.current?.abort()
    searchAbortRef.current = new AbortController()
    try {
      const res = await fetch(
        `${GEO_URL}?name=${encodeURIComponent(trimmed)}&count=6&language=en&format=json`,
        { signal: searchAbortRef.current.signal }
      )
      const data = await res.json()
      setSearchResults(data.results ?? [])
    } catch (e) {
      if (e.name !== 'AbortError') setSearchResults([])
    }
  }, [])

  const selectCity = useCallback((city) => {
    setSearchResults([])
    fetchWeather({
      latitude: city.latitude,
      longitude: city.longitude,
      name: city.name,
      country: city.country_code,
      admin1: city.admin1 ?? '',
    })
  }, [fetchWeather])

  const useMyLocation = useCallback(async () => {
    if (!navigator.geolocation) { setError('Geolocation is not supported by your browser.'); return }

    // Check the stored permission state before starting the loading spinner.
    // If Chrome has already blocked this site, getCurrentPosition fires the
    // error callback immediately (no prompt shown). Detecting it here lets us
    // surface the "denied" card right away without a spinner flash.
    if (navigator.permissions) {
      try {
        const perm = await navigator.permissions.query({ name: 'geolocation' })
        if (perm.state === 'denied') {
          setError('geo:Location access was denied. Enable it for this site in your browser settings.')
          return
        }
      } catch {
        // Permissions API unavailable — fall through to getCurrentPosition
      }
    }

    setLoading(true)
    setError(null)
    geoActiveRef.current = true

    // The `timeout` option below only starts counting once permission is
    // granted — it does NOT cover the time the permission prompt is on screen.
    // So if the prompt is dismissed (or the OS location service never
    // responds), neither callback fires and we'd hang on "Fetching weather…"
    // forever. This watchdog guarantees the loading state always resolves.
    const watchdog = setTimeout(() => {
      if (!geoActiveRef.current) return
      geoActiveRef.current = false
      setError('geo:Timed out getting your location. Make sure location access is allowed and try again.')
      setLoading(false)
    }, 15000)

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        clearTimeout(watchdog)
        if (!geoActiveRef.current) return
        geoActiveRef.current = false
        const { latitude, longitude } = pos.coords
        let name = 'My Location', admin1 = '', country = '', country_code = ''
        try {
          // Privacy: round to 2 decimals (~1 km) before sending coordinates to
          // the third-party reverse geocoder — city-level accuracy is all it
          // needs. The weather APIs still get full precision.
          // Use BigDataCloud's canonical host (api-bdc.io) directly: the old
          // api.bigdatacloud.net now 307-redirects here, and a cross-origin
          // redirect to a host not in the build CSP's connect-src is blocked,
          // which silently failed the lookup and left the name as "My Location".
          const r = await fetch(
            `https://api-bdc.io/data/reverse-geocode-client?latitude=${latitude.toFixed(2)}&longitude=${longitude.toFixed(2)}&localityLanguage=en`
          )
          if (r.ok) {
            const d = await r.json()
            // Most-specific administrative level with a name (city/town/suburb),
            // used when the top-level `city` field comes back empty for some
            // coordinates so we still show a real place rather than "My Location".
            const admin = d.localityInfo?.administrative ?? []
            const adminName = admin.length ? admin[admin.length - 1]?.name : ''
            name = d.city || d.locality || adminName || d.principalSubdivision || 'My Location'
            admin1 = d.principalSubdivision || ''
            country = d.countryCode || ''
            country_code = d.countryCode || ''
          }
        } catch { /* fall through to defaults */ }
        fetchWeather({ latitude, longitude, name, country, country_code, admin1 })
      },
      (err) => {
        clearTimeout(watchdog)
        if (!geoActiveRef.current) return
        geoActiveRef.current = false
        const msg = err.code === 1
          ? 'geo:Location access was denied. Enable it for this site in your browser settings.'
          : err.code === 2
            ? 'geo:Your location is unavailable. On Windows, check Settings → Privacy & security → Location is on.'
            : 'geo:Unable to determine your location. Please try again.'
        setError(msg)
        setLoading(false)
      },
      { timeout: 20000, maximumAge: 60000 }
    )
  }, [fetchWeather])

  // Dismiss the current error without touching loaded weather (so closing the
  // "location not found / denied" card leaves the existing forecast in place).
  const clearError = useCallback(() => setError(null), [])

  return {
    location, weather, airQuality, alerts, lastUpdated, searchResults, loading, error,
    searchCity, selectCity, useMyLocation, setSearchResults, fetchWeather, reset, clearError,
  }
}
