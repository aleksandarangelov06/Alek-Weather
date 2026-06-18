import { useState, useCallback } from 'react'

const GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search'
const WEATHER_URL = 'https://api.open-meteo.com/v1/forecast'

const PARAMS = [
  'current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,cloud_cover,surface_pressure,wind_speed_10m,wind_direction_10m,uv_index,visibility',
  'hourly=temperature_2m,precipitation_probability,weather_code',
  'daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,uv_index_max,sunrise,sunset',
  'temperature_unit=fahrenheit',
  'wind_speed_unit=mph',
  'precipitation_unit=inch',
  'timezone=auto',
  'forecast_days=7',
].join('&')

export function useWeather() {
  const [location, setLocation] = useState(null)
  const [weather, setWeather] = useState(null)
  const [searchResults, setSearchResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const fetchWeather = useCallback(async (loc) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `${WEATHER_URL}?latitude=${loc.latitude}&longitude=${loc.longitude}&${PARAMS}`
      )
      if (!res.ok) throw new Error()
      const data = await res.json()
      setWeather(data)
      setLocation(loc)
    } catch {
      setError('Failed to fetch weather data. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [])

  const searchCity = useCallback(async (query) => {
    if (!query.trim()) { setSearchResults([]); return }
    try {
      const res = await fetch(
        `${GEO_URL}?name=${encodeURIComponent(query)}&count=6&language=en&format=json`
      )
      const data = await res.json()
      setSearchResults(data.results ?? [])
    } catch {
      setSearchResults([])
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
    if (!navigator.geolocation) { setError('Geolocation not supported by your browser.'); return }
    setLoading(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        fetchWeather({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          name: 'My Location',
          country: '',
          admin1: '',
        })
      },
      () => { setError('Location access denied.'); setLoading(false) }
    )
  }, [fetchWeather])

  return {
    location, weather, searchResults, loading, error,
    searchCity, selectCity, useMyLocation, setSearchResults,
  }
}
