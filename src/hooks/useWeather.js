import { useState, useCallback, useRef } from 'react'
import { nowcastHourlyCode, precipTier } from '../utils/weatherCodes'

const GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search'
const WEATHER_URL = 'https://api.open-meteo.com/v1/forecast'
const AQI_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality'
const NOAA_ALERTS_URL = 'https://api.weather.gov/alerts/active'
const NWS_POINTS_URL = 'https://api.weather.gov/points'
const NWS_HEADERS = { 'User-Agent': 'AlekWeatherApp/1.0 (angelov6@terpmail.umd.edu)' }

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

export function useWeather() {
  const [location, setLocation] = useState(null)
  const [weather, setWeather] = useState(null)
  const [airQuality, setAirQuality] = useState(null)
  const [alerts, setAlerts] = useState([])
  const [lastUpdated, setLastUpdated] = useState(null)
  const [searchResults, setSearchResults] = useState([])
  const searchAbortRef = useRef(null)
  const [loading, setLoading] = useState(false)
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
        } catch {} // non-fatal
      }

      if (fetchIdRef.current !== fetchId) return
      setWeather(data)
      setLocation(loc)
      setLastUpdated(new Date())

      if (aqiResult.status === 'fulfilled' && aqiResult.value.ok) {
        const aqiData = await aqiResult.value.json()
        if (fetchIdRef.current === fetchId && aqiData.current?.us_aqi != null) setAirQuality(aqiData.current)
      }

      if (alertsResult.status === 'fulfilled' && alertsResult.value.ok) {
        const alertsData = await alertsResult.value.json()
        if (fetchIdRef.current === fetchId) setAlerts(alertsData.features ?? [])
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
      (pos) => {
        clearTimeout(watchdog)
        if (!geoActiveRef.current) return
        geoActiveRef.current = false
        fetchWeather({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          name: 'My Location',
          country: '',
          admin1: '',
        })
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

  return {
    location, weather, airQuality, alerts, lastUpdated, searchResults, loading, error,
    searchCity, selectCity, useMyLocation, setSearchResults, fetchWeather, reset,
  }
}
