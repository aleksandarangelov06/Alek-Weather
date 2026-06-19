import { useState, useEffect, useRef } from 'react'
import { Settings, Search, ArrowLeft, GripHorizontal } from 'lucide-react'
import { DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useWeather } from './hooks/useWeather'
import { useSavedCities } from './hooks/useSavedCities'
import { SearchBar } from './components/SearchBar'
import { SavedCities } from './components/SavedCities'
import { CurrentWeather } from './components/CurrentWeather'
import { HourlyForecast } from './components/HourlyForecast'
import { DailyForecast } from './components/DailyForecast'
import { WeatherDetails } from './components/WeatherDetails'
import { WeatherRadar } from './components/WeatherRadar'
import { PrecipNowcast } from './components/PrecipNowcast'
import { WeatherAlerts } from './components/WeatherAlerts'
import { WeatherOverview } from './components/WeatherOverview'
import { SettingsPage } from './components/SettingsPage'
import './App.css'

const THEME_KEY = 'alek-weather-theme'
const SETTINGS_CLOSE_MS = 260
const SEARCH_CLOSE_MS = 220

const BLOCK_ORDER_KEY = 'alek-weather-block-order'
const DEFAULT_BLOCK_ORDER = ['overview', 'nowcast', 'hourly', 'daily', 'details', 'radar']
const SHOW_OVERVIEW_KEY = 'alek-weather-show-overview'
const NOWCAST_MODE_KEY  = 'alek-weather-nowcast-mode'

function SortableBlock({ id, children }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  return (
    <div
      ref={setNodeRef}
      className={`sortable-block${isDragging ? ' dragging' : ''}`}
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      <div className="drag-handle" {...attributes} {...listeners} title="Drag to reorder">
        <GripHorizontal size={14} />
      </div>
      {children}
    </div>
  )
}

function App() {
  const [unit, setUnit] = useState(() => localStorage.getItem('alek-weather-unit') ?? 'F')
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem(THEME_KEY) ?? 'system')
  const [showOverview, setShowOverview] = useState(() => localStorage.getItem(SHOW_OVERVIEW_KEY) !== 'false')
  const [nowcastMode, setNowcastMode] = useState(() => localStorage.getItem(NOWCAST_MODE_KEY) ?? 'auto')
  const [installPrompt, setInstallPrompt] = useState(null)
  const [showSettings, setShowSettings] = useState(false)
  const [settingsClosing, setSettingsClosing] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchClosing, setSearchClosing] = useState(false)
  const searchAreaRef = useRef(null)
  const [blockOrder, setBlockOrder] = useState(() => {
    const saved = JSON.parse(localStorage.getItem(BLOCK_ORDER_KEY) ?? 'null')
    if (!saved) return DEFAULT_BLOCK_ORDER
    const merged = DEFAULT_BLOCK_ORDER.filter(id => !saved.includes(id))
    return merged.length ? [...merged, ...saved] : saved
  })

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } })
  )

  const handleDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return
    setBlockOrder(prev => {
      const next = arrayMove(prev, prev.indexOf(active.id), prev.indexOf(over.id))
      localStorage.setItem(BLOCK_ORDER_KEY, JSON.stringify(next))
      return next
    })
  }

  const {
    location, weather, airQuality, alerts, lastUpdated, searchResults, loading, error,
    searchCity, selectCity, useMyLocation, setSearchResults, fetchWeather,
  } = useWeather()

  const { cities, save, remove, isSaved } = useSavedCities()

  useEffect(() => {
    const handler = (e) => { e.preventDefault(); setInstallPrompt(e) }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  const handleInstall = async () => {
    if (!installPrompt) return
    installPrompt.prompt()
    const { outcome } = await installPrompt.userChoice
    if (outcome === 'accepted') setInstallPrompt(null)
  }

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

  // Close search overlay on Escape key
  useEffect(() => {
    if (!searchOpen) return
    const handler = (e) => { if (e.key === 'Escape') closeSearch() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [searchOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  const changeUnit = (u) => {
    setUnit(u)
    localStorage.setItem('alek-weather-unit', u)
  }

  const changeShowOverview = (val) => {
    setShowOverview(val)
    localStorage.setItem(SHOW_OVERVIEW_KEY, String(val))
  }

  const changeNowcastMode = (mode) => {
    setNowcastMode(mode)
    localStorage.setItem(NOWCAST_MODE_KEY, mode)
  }

  const changeDarkMode = (mode) => {
    setDarkMode(mode)
    localStorage.setItem(THEME_KEY, mode)
  }

  const openSettings = () => setShowSettings(true)

  const closeSettings = () => {
    setSettingsClosing(true)
    setTimeout(() => { setShowSettings(false); setSettingsClosing(false) }, SETTINGS_CLOSE_MS)
  }

  const openSearch = () => setSearchOpen(true)

  const closeSearch = () => {
    setSearchClosing(true)
    setTimeout(() => {
      setSearchOpen(false)
      setSearchClosing(false)
      setSearchResults([])
    }, SEARCH_CLOSE_MS)
  }

  const handleSavedCitySelect = (city) => {
    fetchWeather(city)
    closeSearch()
  }

  const handleSelectCity = (city) => {
    selectCity(city)
    closeSearch()
  }

  const handleUseLocation = () => {
    useMyLocation()
    closeSearch()
  }

  const blockComponents = weather && !loading ? {
    overview: <WeatherOverview hourly={weather.hourly} daily={weather.daily} current={weather.current} timezone={weather.timezone} yesterdayTemps={weather.yesterdayTemps} />,
    hourly:  <HourlyForecast hourly={weather.hourly} timezone={weather.timezone} unit={unit} />,
    daily:   <DailyForecast daily={weather.daily} unit={unit} />,
    details: <WeatherDetails current={weather.current} daily={weather.daily} timezone={weather.timezone} unit={unit} airQuality={airQuality} />,
    radar:   <WeatherRadar location={location} timezone={weather.timezone} />,
    nowcast: <PrecipNowcast minutely={weather.minutely_15} currentTime={weather.current.time} mode={nowcastMode} />,
  } : null

  const weatherPanel = weather && !loading && (
    <>
      <div className="weather-left">
        <WeatherAlerts alerts={alerts} />
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
      </div>
      <div className="weather-right">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={blockOrder} strategy={verticalListSortingStrategy}>
            {blockOrder.filter(id => id !== 'aqi' && (id !== 'overview' || showOverview)).map(id => (
              <SortableBlock key={id} id={id}>
                {blockComponents[id]}
              </SortableBlock>
            ))}
          </SortableContext>
        </DndContext>
      </div>
    </>
  )

  return (
    <div className="app">
      <header className="app-header">
        <button className="header-icon-btn" onClick={openSearch} aria-label="Search">
          <Search size={24} />
        </button>
        <button className="settings-btn" onClick={openSettings} aria-label="Settings">
          <Settings size={22} />
        </button>
      </header>

      <div className="app-grid">
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
              <p className="empty-text">Tap 🔍 to search for a city</p>
            </div>
          )}
          <div className="weather-content">
            {weatherPanel}
          </div>
          <div className="app-title">Alek Weather</div>
        </main>
      </div>

      {/* Search overlay — slides down from top */}
      {searchOpen && (
        <>
          <div className={`search-backdrop${searchClosing ? ' closing' : ''}`} onClick={closeSearch} />
          <div className={`search-overlay${searchClosing ? ' closing' : ''}`}>
            <div className="search-overlay-bar" ref={searchAreaRef}>
              <button className="header-icon-btn" onClick={closeSearch} aria-label="Cancel search">
                <ArrowLeft size={20} />
              </button>
              <SearchBar
                autoFocus
                onSearch={searchCity}
                results={searchResults}
                onSelect={handleSelectCity}
                onUseLocation={handleUseLocation}
                onClear={() => setSearchResults([])}
                onActivate={() => {}}
              />
            </div>
            {cities.length > 0 && (
              <SavedCities
                cities={cities}
                onSelect={handleSavedCitySelect}
                onRemove={remove}
                currentLatitude={location?.latitude}
              />
            )}
          </div>
        </>
      )}

      {showSettings && (
        <SettingsPage
          onBack={closeSettings}
          darkMode={darkMode}
          onDarkModeChange={changeDarkMode}
          unit={unit}
          onUnitChange={changeUnit}
          showOverview={showOverview}
          onShowOverviewChange={changeShowOverview}
          nowcastMode={nowcastMode}
          onNowcastModeChange={changeNowcastMode}
          installPrompt={installPrompt}
          onInstall={handleInstall}
          closing={settingsClosing}
        />
      )}
    </div>
  )
}

export default App
