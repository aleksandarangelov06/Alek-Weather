import { useState, useEffect, useRef } from 'react'
import { Settings } from 'lucide-react'
import { useWeather } from './hooks/useWeather'
import { useSavedCities } from './hooks/useSavedCities'
import { SearchBar } from './components/SearchBar'
import { SavedCities } from './components/SavedCities'
import { CurrentWeather } from './components/CurrentWeather'
import { HourlyForecast } from './components/HourlyForecast'
import { DailyForecast } from './components/DailyForecast'
import { WeatherDetails } from './components/WeatherDetails'
import { AirQuality } from './components/AirQuality'
import { SettingsPage } from './components/SettingsPage'
import './App.css'

const THEME_KEY = 'alek-weather-theme'
const SETTINGS_CLOSE_MS = 260

function App() {
  const [unit, setUnit] = useState(() => localStorage.getItem('alek-weather-unit') ?? 'F')
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem(THEME_KEY) ?? 'system')
  const [showSettings, setShowSettings] = useState(false)
  const [settingsClosing, setSettingsClosing] = useState(false)
  const [searchActive, setSearchActive] = useState(false)
  const searchAreaRef = useRef(null)

  const {
    location, weather, airQuality, lastUpdated, searchResults, loading, error,
    searchCity, selectCity, useMyLocation, setSearchResults, fetchWeather,
  } = useWeather()

  const { cities, save, remove, isSaved } = useSavedCities()

  // Apply dark mode theme
  useEffect(() => {
    const root = document.documentElement
    if (darkMode === 'on') root.setAttribute('data-theme', 'dark')
    else if (darkMode === 'off') root.setAttribute('data-theme', 'light')
    else root.removeAttribute('data-theme')
  }, [darkMode])

  // Keep theme-color meta in sync so the Android status bar matches the app background
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]')
    if (!meta) return
    const apply = (dark) => { meta.content = dark ? '#0d1117' : '#f0f2f5' }
    if (darkMode === 'on')  { apply(true);  return }
    if (darkMode === 'off') { apply(false); return }
    // system mode: follow OS and keep listening for changes
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    apply(mq.matches)
    const handler = (e) => apply(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [darkMode])

  // Auto-load first saved city on mount
  useEffect(() => {
    if (cities.length > 0) fetchWeather(cities[0])
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Hide saved cities list when clicking/tapping outside the search area
  useEffect(() => {
    if (!searchActive) return
    const handler = (e) => {
      if (!searchAreaRef.current?.contains(e.target)) {
        setSearchActive(false)
        setSearchResults([])
      }
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('touchstart', handler)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('touchstart', handler)
    }
  }, [searchActive, setSearchResults])

  const changeUnit = (u) => {
    setUnit(u)
    localStorage.setItem('alek-weather-unit', u)
  }

  const changeDarkMode = (mode) => {
    setDarkMode(mode)
    localStorage.setItem(THEME_KEY, mode)
  }

  const openSettings = () => setShowSettings(true)

  const closeSettings = () => {
    setSettingsClosing(true)
    setTimeout(() => {
      setShowSettings(false)
      setSettingsClosing(false)
    }, SETTINGS_CLOSE_MS)
  }

  const handleSavedCitySelect = (city) => {
    fetchWeather(city)
    setSearchActive(false)
  }

  const weatherPanel = weather && !loading && (
    <>
      <CurrentWeather
        current={weather.current}
        daily={weather.daily}
        location={location}
        unit={unit}
        saved={isSaved(location)}
        onSave={() => save(location)}
        onRemove={() => remove(location)}
        lastUpdated={lastUpdated}
        onRefresh={() => fetchWeather(location)}
        loading={loading}
      />
      <HourlyForecast hourly={weather.hourly} timezone={weather.timezone} unit={unit} />
      <DailyForecast daily={weather.daily} unit={unit} />
      <WeatherDetails current={weather.current} daily={weather.daily} timezone={weather.timezone} unit={unit} />
      <AirQuality data={airQuality} />
    </>
  )

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-title">⛅ Alek Weather</div>
        <button
          className="settings-btn"
          onClick={openSettings}
          aria-label="Settings"
        >
          <Settings size={18} />
        </button>
      </header>

      <div className="app-grid">
        {/* Left sidebar: search + saved cities (list only visible while searching) */}
        <aside className="sidebar">
          <div ref={searchAreaRef}>
            <SearchBar
              onSearch={searchCity}
              results={searchResults}
              onSelect={selectCity}
              onUseLocation={useMyLocation}
              onClear={() => setSearchResults([])}
              onActivate={() => setSearchActive(true)}
            />
            {searchActive && cities.length > 0 && (
              <SavedCities
                cities={cities}
                onSelect={handleSavedCitySelect}
                onRemove={remove}
                currentLatitude={location?.latitude}
              />
            )}
          </div>
        </aside>

        {/* Main content */}
        <main className="main-content">
          {loading && (
            <div className="status-message">
              <div className="spinner" />
              <span>Fetching weather...</span>
            </div>
          )}
          {error && !loading && (
            <div className="status-message error">{error}</div>
          )}
          {!weather && !loading && !error && (
            <div className="empty-state">
              <div className="empty-icon">🌍</div>
              <p className="empty-text">Search for a city to see the weather</p>
            </div>
          )}
          <div className="weather-content">
            {weatherPanel}
          </div>
        </main>
      </div>

      {showSettings && (
        <SettingsPage
          onBack={closeSettings}
          darkMode={darkMode}
          onDarkModeChange={changeDarkMode}
          unit={unit}
          onUnitChange={changeUnit}
          closing={settingsClosing}
        />
      )}
    </div>
  )
}

export default App
