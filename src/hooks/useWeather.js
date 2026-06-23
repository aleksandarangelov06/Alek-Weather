import { useState, useCallback, useRef } from 'react'

const GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search'
const WEATHER_URL = 'https://api.open-meteo.com/v1/forecast'
const AQI_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality'
const NOAA_ALERTS_URL = 'https://api.weather.gov/alerts/active'

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

  const fetchWeather = useCallback(async (loc) => {
    geoActiveRef.current = false
    setLoading(true)
    setError(null)
    setAirQuality(null)
    setAlerts([])
    try {
      const [weatherResult, aqiResult, alertsResult] = await Promise.allSettled([
        fetch(`${WEATHER_URL}?latitude=${loc.latitude}&longitude=${loc.longitude}&${PARAMS}`),
        fetch(`${AQI_URL}?latitude=${loc.latitude}&longitude=${loc.longitude}&${AQI_PARAMS}`),
        fetch(`${NOAA_ALERTS_URL}?point=${loc.latitude.toFixed(4)},${loc.longitude.toFixed(4)}`, {
          headers: { 'User-Agent': 'AlekWeatherApp/1.0 (angelov6@terpmail.umd.edu)' },
        }),
      ])

      if (weatherResult.status === 'rejected' || !weatherResult.value.ok) throw new Error()
      const data = await weatherResult.value.json()

      // Slice daily from today so existing components are unaffected,
      // but stash yesterday's temps before the slice.
      const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: data.timezone })
      const todayIdx = data.daily.time.indexOf(todayStr)
      const start = todayIdx > 0 ? todayIdx : 0
      const yesterdayTemps = start > 0 ? {
        max: data.daily.temperature_2m_max[start - 1],
        min: data.daily.temperature_2m_min[start - 1],
      } : null
      if (start > 0) {
        data.daily = Object.fromEntries(
          Object.entries(data.daily).map(([k, v]) => [k, Array.isArray(v) ? v.slice(start) : v])
        )
      }

      setWeather({ ...data, yesterdayTemps })
      setLocation(loc)
      setLastUpdated(new Date())

      if (aqiResult.status === 'fulfilled' && aqiResult.value.ok) {
        const aqiData = await aqiResult.value.json()
        if (aqiData.current?.us_aqi != null) setAirQuality(aqiData.current)
      }

      if (alertsResult.status === 'fulfilled' && alertsResult.value.ok) {
        const alertsData = await alertsResult.value.json()
        setAlerts(alertsData.features ?? [])
      }
    } catch {
      setError('Failed to fetch weather data. Please try again.')
    } finally {
      setLoading(false)
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

  const useMyLocation = useCallback(() => {
    if (!navigator.geolocation) { setError('Geolocation is not supported by your browser.'); return }
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
      setError('Timed out getting your location. Make sure location access is allowed and try again.')
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
          ? 'Location access was denied. Enable it for this site in your browser settings.'
          : err.code === 2
            ? 'Your location is unavailable. On Windows, check Settings → Privacy & security → Location is on.'
            : 'Unable to determine your location. Please try again.'
        setError(msg)
        setLoading(false)
      },
      { timeout: 10000, maximumAge: 60000 }
    )
  }, [fetchWeather])

  return {
    location, weather, airQuality, alerts, lastUpdated, searchResults, loading, error,
    searchCity, selectCity, useMyLocation, setSearchResults, fetchWeather,
  }
}
