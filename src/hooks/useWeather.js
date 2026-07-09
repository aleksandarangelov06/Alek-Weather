import { useState, useCallback, useRef } from 'react'
import { nowcastHourlyCode, precipTier, livePrecipRate } from '../utils/weatherCodes'

const GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search'
const WEATHER_URL = 'https://api.open-meteo.com/v1/forecast'
const AQI_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality'
const NOAA_ALERTS_URL = 'https://api.weather.gov/alerts/active'
const NWS_POINTS_URL = 'https://api.weather.gov/points'
// NWS requires contact info in the User-Agent. Plus-addressed so scraped spam
// is filterable and the address is identifiable as coming from this app.
const NWS_HEADERS = { 'User-Agent': 'AlekWeatherApp/1.0 (angelov6+alekweather@terpmail.umd.edu)' }

// NWS icon code → WMO weather code
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
  rain_showers_hi: 82,
  tsra_sct: 95, tsra: 95,
  tsra_hi: 96,
  snow: 71,
  snow_showers: 85, snow_showers_hi: 86,
  fzra: 67, sleet: 77, blizzard: 75,
  tornado: 99, hurricane: 99,
}

// When a period has two conditions, pick the more severe one
const NWS_ICON_PRIORITY = [
  'tornado', 'hurricane', 'tsra_hi', 'tsra', 'tsra_sct',
  'blizzard', 'rain_showers_hi', 'snow_showers_hi',
  'rain', 'rain_showers', 'snow', 'snow_showers', 'fzra', 'sleet',
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

// Returns the icon code that ranks higher (more severe) in NWS_ICON_PRIORITY.
function pickMoreSevere(a, b) {
  if (!b) return a
  const ia = NWS_ICON_PRIORITY.indexOf(a), ib = NWS_ICON_PRIORITY.indexOf(b)
  if (ia === -1) return b
  if (ib === -1) return a
  return ia <= ib ? a : b
}

// Convert a NWS startTime ISO string to a local "YYYY-MM-DDTHH:00" key.
function nwsLocalKey(isoString, timezone) {
  return new Date(isoString)
    .toLocaleString('sv', { timeZone: timezone })
    .replace(' ', 'T')
    .slice(0, 13) + ':00'
}

// Overwrite Open-Meteo hourly arrays with NWS data for US locations.
// NWS hourly is authoritative for weather_code, precipitation_probability,
// temperature, wind, humidity, and is_day. UV, cloud cover, pressure, and
// visibility are not available from NWS hourly so Open-Meteo values are kept.
function mergeNWSHourly(hourly, periods, timezone) {
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
    const nws = lookup.get(hourly.time[i].slice(0, 13) + ':00')
    if (!nws) continue
    if (nws.wmoCode  != null) hourly.weather_code[i]            = nws.wmoCode
    if (nws.prob     != null) hourly.precipitation_probability[i] = nws.prob
    if (nws.temp     != null) hourly.temperature_2m[i]          = nws.temp
    if (nws.windSpd  != null) hourly.wind_speed_10m[i]          = nws.windSpd
    if (nws.windDir  != null) hourly.wind_direction_10m[i]      = nws.windDir
    if (nws.humidity != null) hourly.relative_humidity_2m[i]    = nws.humidity
    if (nws.isDay    != null) hourly.is_day[i]                  = nws.isDay
  }
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
// weather code and precipitation probability from the hourly arrays so that
// DailyForecast, HourlyForecast, and WeatherOverview always agree.
//
// The NWS period-summary (/forecast) and hourly (/forecast/hourly) endpoints
// are produced by different systems and routinely disagree — e.g. the daily
// period may say "75 % thunderstorms" while the hourly breakdown shows only
// clouds. Re-deriving from hourly makes the three views internally consistent.
function alignDailyWithHourly(daily, hourly, minutely, current, timezone) {
  // Only look at future/current slots — past NWS codes can no longer be
  // nowcast-corrected and would inflate the daily summary with phantom events.
  const nowLocal = new Date().toLocaleString('sv', { timeZone: timezone })
  const currentSlot = `${nowLocal.slice(0, 10)}T${nowLocal.slice(11, 13)}:00`

  for (let i = 0; i < daily.time.length; i++) {
    const date = daily.time[i]
    let maxProb = null
    let peakCode = null
    let peakSev = -1
    for (let j = 0; j < hourly.time.length; j++) {
      const slotTime = hourly.time[j]
      if (!slotTime.startsWith(date)) continue
      if (slotTime < currentSlot) continue  // skip past hours

      const rawCode = hourly.weather_code?.[j]
      if (rawCode == null) continue

      // Apply the same nowcast correction used by HourlyForecast and WeatherOverview.
      // Slots beyond the minutely window are returned unchanged.
      const code = nowcastHourlyCode(rawCode, minutely, slotTime, current?.cloud_cover)

      // When nowcast downgrades to non-precip, that slot contributes 0 probability.
      const p = precipTier(code) === 0 ? 0 : (hourly.precipitation_probability?.[j] ?? null)
      if (p != null) maxProb = maxProb == null ? p : Math.max(maxProb, p)

      const sev = wmoSeverity(code)
      if (sev > peakSev) { peakSev = sev; peakCode = code }
    }
    if (maxProb != null) daily.precipitation_probability_max[i] = maxProb
    if (peakCode != null) daily.weather_code[i] = peakCode
  }
}

// Overwrite Open-Meteo daily arrays with NWS forecast data for US locations.
// NWS gives day/night period pairs; we map them to daily hi/lo temps, weather
// codes, and max precipitation probability. UV, precip totals, sunrise/sunset
// are not available from NWS so Open-Meteo values are kept.
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

// Map a NWS station observation (METAR) to a WMO weather code. This is the
// only *measured* current-weather source in the pipeline — everything else is
// model output, which routinely trails radar in convective weather. Only
// reports from the last 75 min count (stations report hourly, plus special
// reports during storms). Sky-cover-only observations return null so the model
// pipeline keeps handling clear/cloudy — the station can be far enough away
// that its cloud deck differs from the user's.
function obsToWmoCode(obs) {
  if (!obs?.timestamp) return null
  const age = Date.now() - new Date(obs.timestamp).getTime()
  if (!(age >= 0 && age <= 75 * 60 * 1000)) return null

  // Substring matching: the API uses plural/compound values ("thunderstorms",
  // "snow_showers", "freezing_rain" — verified live against KMTN during a
  // storm), so exact equality would silently miss them.
  const pw = obs.presentWeather ?? []
  const has = (w) => pw.some(x => x.weather?.includes(w))
  const intensityOf = (w) => pw.find(x => x.weather?.includes(w))?.intensity
  if (has('thunder')) return 95
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
  if (txt.includes('thunderstorm')) return 95
  if (txt.includes('freezing')) return 67
  if (txt.includes('snow')) return txt.includes('heavy') ? 75 : txt.includes('light') ? 71 : 73
  if (txt.includes('rain') || txt.includes('shower')) return txt.includes('heavy') ? 65 : txt.includes('light') ? 61 : 63
  if (txt.includes('drizzle')) return 53
  if (txt.includes('fog') || txt.includes('mist')) return 45
  return null
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

  const local = now.toLocaleString('sv', { timeZone: data.timezone })
  const hourKey = `${local.slice(0, 10)}T${local.slice(11, 13)}:00`
  const idx = data.hourly?.time?.indexOf(hourKey) ?? -1
  const hourCode = idx !== -1 ? data.hourly.weather_code?.[idx] : null

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
  'current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,cloud_cover,surface_pressure,wind_speed_10m,wind_direction_10m,uv_index,visibility',
  'hourly=temperature_2m,precipitation_probability,weather_code,is_day,uv_index,wind_speed_10m,wind_direction_10m,relative_humidity_2m,surface_pressure,visibility',
  'daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,uv_index_max,sunrise,sunset',
  'minutely_15=precipitation',
  'temperature_unit=fahrenheit',
  'wind_speed_unit=mph',
  'precipitation_unit=inch',
  'timezone=auto',
  'forecast_days=7',
  'past_days=1',
].join('&')

const AQI_PARAMS = 'current=us_aqi,pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone'

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

  const fetchWeather = useCallback(async (loc) => {
    geoActiveRef.current = false
    const fetchId = ++fetchIdRef.current
    setLoading(true)
    setError(null)
    setAirQuality(null)
    setAlerts([])
    try {
      const [weatherResult, aqiResult, alertsResult, nwsPointsResult] = await Promise.allSettled([
        fetch(`${WEATHER_URL}?latitude=${loc.latitude}&longitude=${loc.longitude}&${PARAMS}`),
        fetch(`${AQI_URL}?latitude=${loc.latitude}&longitude=${loc.longitude}&${AQI_PARAMS}`),
        fetch(`${NOAA_ALERTS_URL}?point=${loc.latitude.toFixed(4)},${loc.longitude.toFixed(4)}`, { headers: NWS_HEADERS }),
        fetch(`${NWS_POINTS_URL}/${loc.latitude.toFixed(4)},${loc.longitude.toFixed(4)}`, { headers: NWS_HEADERS }),
      ])

      if (weatherResult.status === 'rejected' || !weatherResult.value.ok) throw new Error()
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
      // Points call already ran in parallel; if it succeeded we fire hourly + daily
      // forecast fetches in parallel, then merge both before rendering.
      // Every step is non-fatal: any failure silently keeps the Open-Meteo values.
      if (nwsPointsResult.status === 'fulfilled' && nwsPointsResult.value.ok) {
        try {
          const pointsData = await nwsPointsResult.value.json()
          const hourlyUrl   = pointsData.properties?.forecastHourly
          const forecastUrl = pointsData.properties?.forecast

          // Latest real observation from nearby stations, fetched in parallel
          // with the forecast calls; failures fall through to the model
          // pipeline (obsToWmoCode returns null). Small AWOS fields often
          // report nothing (verified: K0W3 near Bel Air MD was empty during an
          // active thunderstorm while KMTN two entries later reported +TS +RA),
          // so walk the list until a station actually reports weather.
          const obsPromise = (async () => {
            const stationsUrl = pointsData.properties?.observationStations
            if (!stationsUrl) return null
            const sRes = await fetch(`${stationsUrl}?limit=4`, { headers: NWS_HEADERS })
            if (!sRes.ok) return null
            const stations = (await sRes.json()).features ?? []
            for (const s of stations) {
              const id = s.properties?.stationIdentifier
              if (!id) continue
              try {
                const oRes = await fetch(`https://api.weather.gov/stations/${id}/observations/latest`, { headers: NWS_HEADERS })
                if (!oRes.ok) continue
                const obs = (await oRes.json()).properties
                if (obs?.presentWeather?.length || obs?.textDescription) return obs
              } catch { /* try the next station */ }
            }
            return null
          })().catch(() => null)

          const [nwsHourlyRes, nwsForecastRes] = await Promise.allSettled([
            hourlyUrl   ? fetch(hourlyUrl,   { headers: NWS_HEADERS }) : Promise.reject(),
            forecastUrl ? fetch(forecastUrl, { headers: NWS_HEADERS }) : Promise.reject(),
          ])
          let nwsHourlyMerged = false
          if (nwsHourlyRes.status === 'fulfilled' && nwsHourlyRes.value.ok) {
            const d = await nwsHourlyRes.value.json()
            mergeNWSHourly(data.hourly, d.properties?.periods ?? [], data.timezone)
            nwsHourlyMerged = true
          }
          if (nwsForecastRes.status === 'fulfilled' && nwsForecastRes.value.ok) {
            const d = await nwsForecastRes.value.json()
            mergeNWSDaily(data.daily, d.properties?.periods ?? [], data.timezone)
          }
          // Re-derive daily code + probability from the merged hourly data so
          // all three forecast views (daily, hourly, overview) agree.
          if (nwsHourlyMerged) alignDailyWithHourly(data.daily, data.hourly, data.minutely_15, data.current, data.timezone)

          // A station actually observing precipitation overrides the model's
          // current condition outright — measured beats predicted.
          const obsCode = obsToWmoCode(await obsPromise)
          if (obsCode != null) {
            data.current.weather_code = obsCode
            data.current.weather_code_confirmed = true
            data.current.weather_code_source = 'station'
          }
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

      if (aqiResult.status === 'fulfilled' && aqiResult.value.ok) {
        const aqiData = await aqiResult.value.json()
        if (fetchIdRef.current === fetchId && aqiData.current?.us_aqi != null) setAirQuality(aqiData.current)
      }

    } catch {
      if (fetchIdRef.current === fetchId) setError('Failed to fetch weather data. Please try again.')
    } finally {
      if (fetchIdRef.current === fetchId) setLoading(false)
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
