import { useState, useEffect, useRef } from 'react'

const STARS = Array.from({ length: 40 }, () => ({
  top:   `${Math.random() * 88 + 4}%`,
  left:  `${Math.random() * 92 + 2}%`,
  dur:   `${(Math.random() * 3 + 2).toFixed(1)}s`,
  delay: `${-(Math.random() * 4).toFixed(1)}s`,
}))
import { SlidersHorizontal, MapPin, MapPinOff, ArrowLeft, GripHorizontal, Library } from 'lucide-react'
import { DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useWeather } from './hooks/useWeather'
import { useSavedCities } from './hooks/useSavedCities'
import { useRecentSearches } from './hooks/useRecentSearches'
import { SearchBar } from './components/SearchBar'
import { SavedCities } from './components/SavedCities'
import { SavedCitiesPage } from './components/SavedCitiesPage'
import { CurrentWeather } from './components/CurrentWeather'
import { HourlyForecast } from './components/HourlyForecast'
import { DailyForecast } from './components/DailyForecast'
import { WeatherDetails } from './components/WeatherDetails'
import { WeatherRadar } from './components/WeatherRadar'
import { PrecipNowcast } from './components/PrecipNowcast'
import { WeatherAlerts } from './components/WeatherAlerts'
import { WeatherOverview } from './components/WeatherOverview'
import { SettingsPage, SettingsPill } from './components/SettingsPage'
import './App.css'

const THEME_KEY = 'alek-weather-theme'
const SETTINGS_CLOSE_MS = 260
const SEARCH_CLOSE_MS = 220
// Hold the header search button this long to skip the overlay and geolocate.
// Passed to App.css as the --long-press-ms custom property so the fill animation
// always matches this value.
const LONG_PRESS_MS = 2000

const BLOCK_ORDER_KEY = 'alek-weather-block-order'
const DEFAULT_BLOCK_ORDER = ['overview', 'nowcast', 'hourly', 'daily', 'details', 'radar']
const SHOW_OVERVIEW_KEY = 'alek-weather-show-overview'
const NOWCAST_MODE_KEY  = 'alek-weather-nowcast-mode'
const COLOR_CODING_KEY  = 'alek-weather-color-coding'
const DEFAULT_COLOR_CODING = { current: true, hourly: true, daily: true, glow: true }

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
  const [colorCoding, setColorCoding] = useState(() => {
    const saved = JSON.parse(localStorage.getItem(COLOR_CODING_KEY) ?? 'null')
    return saved ? { ...DEFAULT_COLOR_CODING, ...saved } : DEFAULT_COLOR_CODING
  })
  const [installPrompt, setInstallPrompt] = useState(null)
  const [showSettings, setShowSettings] = useState(false)
  const [settingsClosing, setSettingsClosing] = useState(false)
  const [colorCodingOpen, setColorCodingOpen] = useState(false)
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia('(min-width: 1100px)').matches)
  const [desktopSettingsOpen, setDesktopSettingsOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchClosing, setSearchClosing] = useState(false)
  const [searchInitialQuery, setSearchInitialQuery] = useState('')
  const [savedOpen, setSavedOpen] = useState(false)
  const [savedClosing, setSavedClosing] = useState(false)
  const [splashPhase, setSplashPhase] = useState('visible') // 'visible' | 'exit' | 'done'
  const searchAreaRef = useRef(null)
  const searchHoldTimer = useRef(null)
  const searchLongPressed = useRef(false)
  const [searchHolding, setSearchHolding] = useState(false)
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
    searchCity, selectCity, useMyLocation, setSearchResults, fetchWeather, reset,
  } = useWeather()

  const { cities, save, remove, isSaved } = useSavedCities()
  const { recents, addRecent, removeRecent } = useRecentSearches()
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

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1100px)')
    const handler = (e) => setIsDesktop(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // Apply dark mode theme
  useEffect(() => {
    const root = document.documentElement
    if (darkMode === 'on') root.setAttribute('data-theme', 'dark')
    else if (darkMode === 'off') root.setAttribute('data-theme', 'light')
    else root.removeAttribute('data-theme')
  }, [darkMode])

  // Keep theme-color metas in sync so the Android status bar and navigation bar match the app background
  useEffect(() => {
    const metas = document.querySelectorAll('meta[name="theme-color"]')
    if (!metas.length) return
    const apply = (dark) => { metas.forEach(m => { m.content = dark ? '#000000' : '#f0f2f5' }) }
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

  // Fly splash logo to header when weather arrives; dismiss immediately on error
  useEffect(() => {
    if (splashPhase !== 'visible') return
    if (weather) {
      setSplashPhase('exit')
      const t = setTimeout(() => setSplashPhase('done'), 700)
      return () => clearTimeout(t)
    }
    if (error) setSplashPhase('done')
  }, [weather, error]) // eslint-disable-line react-hooks/exhaustive-deps

  // On desktop with no city loaded, any printable key press opens search pre-filled
  // with that character so the user can just start typing immediately.
  useEffect(() => {
    if (!isDesktop || weather || loading || searchOpen) return
    const handler = (e) => {
      if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return
      setSearchInitialQuery(e.key)
      history.pushState({ overlay: 'search' }, '')
      setSearchOpen(true)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isDesktop, weather, loading, searchOpen])

  // Hardware back button / Android back gesture
  useEffect(() => {
    const handler = () => {
      if (colorCodingOpen) setColorCodingOpen(false)
      else if (showSettings) doCloseSettings()
      else if (searchOpen) doCloseSearch()
      else if (savedOpen) doCloseSaved()
    }
    window.addEventListener('popstate', handler)
    return () => window.removeEventListener('popstate', handler)
  }, [colorCodingOpen, showSettings, searchOpen, savedOpen]) // eslint-disable-line react-hooks/exhaustive-deps

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

  const toggleColorCoding = (key) => {
    setColorCoding(prev => {
      const next = { ...prev, [key]: !prev[key] }
      localStorage.setItem(COLOR_CODING_KEY, JSON.stringify(next))
      return next
    })
  }

  const changeDarkMode = (mode) => {
    setDarkMode(mode)
    localStorage.setItem(THEME_KEY, mode)
  }

  const openSettings = () => {
    setColorCodingOpen(false)
    history.pushState({ overlay: 'settings' }, '')
    setShowSettings(true)
  }

  const doCloseSettings = () => {
    setSettingsClosing(true)
    setTimeout(() => { setShowSettings(false); setSettingsClosing(false); setColorCodingOpen(false) }, SETTINGS_CLOSE_MS)
  }

  const closeSettings = () => history.back()

  const openColorCoding = () => {
    history.pushState({ overlay: 'colorcoding' }, '')
    setColorCodingOpen(true)
  }

  const closeColorCoding = () => history.back()

  const toggleDesktopSettings = () => {
    setColorCodingOpen(false)
    setDesktopSettingsOpen(v => !v)
  }

  const openSearch = () => {
    history.pushState({ overlay: 'search' }, '')
    setSearchOpen(true)
  }

  const doCloseSearch = () => {
    setSearchClosing(true)
    setSearchInitialQuery('')
    setTimeout(() => {
      setSearchOpen(false)
      setSearchClosing(false)
      setSearchResults([])
    }, SEARCH_CLOSE_MS)
  }

  const closeSearch = () => history.back()

  // Press-and-hold the header search button to open saved cities without going
  // through the search overlay; a normal tap still opens search. The fill
  // animation under the icon (App.css) signals progress toward the LONG_PRESS_MS
  // threshold.
  const startSearchHold = () => {
    if (splashPhase !== 'done') return
    searchLongPressed.current = false
    setSearchHolding(true)
    searchHoldTimer.current = setTimeout(() => {
      searchLongPressed.current = true
      setSearchHolding(false)
      navigator.vibrate?.(40)
      openSaved()
    }, LONG_PRESS_MS)
  }

  const endSearchHold = () => {
    clearTimeout(searchHoldTimer.current)
    setSearchHolding(false)
  }

  const handleSearchButton = () => {
    // Swallow the click that trails a completed hold so it doesn't also open search.
    if (searchLongPressed.current) { searchLongPressed.current = false; return }
    if (splashPhase !== 'done') { openSaved(); return }
    openSearch()
  }

  useEffect(() => () => clearTimeout(searchHoldTimer.current), [])

  const openSaved = () => {
    history.pushState({ overlay: 'saved' }, '')
    setSavedOpen(true)
  }

  const doCloseSaved = () => {
    setSavedClosing(true)
    setTimeout(() => { setSavedOpen(false); setSavedClosing(false) }, SETTINGS_CLOSE_MS)
  }

  const closeSaved = () => history.back()

  const handleSavedPageSelect = (city) => {
    addRecent(city)
    fetchWeather(city)
    closeSaved()
  }

  const handleSavedCitySelect = (city) => {
    addRecent(city)
    fetchWeather(city)
    closeSearch()
  }

  const handleSelectCity = (city) => {
    addRecent(city)
    selectCity(city)
    closeSearch()
  }

  const handleUseLocation = () => {
    useMyLocation()
    closeSearch()
  }

  const handleLogoClick = () => {
    if (!weather || splashPhase !== 'done') return
    reset()
    setSplashPhase('visible')
  }

  const hasActiveAlert = alerts.some(a =>
    a.properties?.severity === 'Extreme' || a.properties?.severity === 'Severe'
  )

  const blockComponents = weather && !loading ? {
    overview: <WeatherOverview hourly={weather.hourly} daily={weather.daily} current={weather.current} minutely={weather.minutely_15} timezone={weather.timezone} hasActiveAlert={hasActiveAlert} />,
    hourly:  <HourlyForecast hourly={weather.hourly} timezone={weather.timezone} unit={unit} colorCoding={colorCoding.hourly} glow={colorCoding.glow} current={weather.current} minutely={weather.minutely_15} />,
    daily:   <DailyForecast daily={weather.daily} hourly={weather.hourly} timezone={weather.timezone} unit={unit} colorCoding={colorCoding.daily} glow={colorCoding.glow} current={weather.current} minutely={weather.minutely_15} />,
    details: <WeatherDetails current={weather.current} daily={weather.daily} hourly={weather.hourly} timezone={weather.timezone} unit={unit} airQuality={airQuality} />,
    radar:   <WeatherRadar location={location} timezone={weather.timezone} />,
    nowcast: <PrecipNowcast minutely={weather.minutely_15} currentTime={weather.current.time} mode={nowcastMode} />,
  } : null

  const weatherPanel = weather && !loading && (
    <>
      <div className="weather-left">
        <WeatherAlerts alerts={alerts} />
        <CurrentWeather
          current={weather.current}
          minutely={weather.minutely_15}
          daily={weather.daily}
          location={location}
          timezone={weather.timezone}
          unit={unit}
          saved={isSaved(location)}
          onSave={() => save(location)}
          onRemove={() => remove(location)}
          lastUpdated={lastUpdated}
          onRefresh={() => fetchWeather(location)}
          loading={loading}
          colorCoding={colorCoding.current}
          glow={colorCoding.glow}
        />
        {/* On desktop the compact precipitation chart sits under the current
            weather instead of stretching the wide right column. On mobile it
            stays in the draggable block list below. */}
        {isDesktop && blockComponents.nowcast}
        {isDesktop && (
          <SettingsPill
            expanded={desktopSettingsOpen}
            onToggle={toggleDesktopSettings}
            colorCodingOpen={colorCodingOpen}
            onColorCodingOpen={openColorCoding}
            onColorCodingBack={closeColorCoding}
            darkMode={darkMode}
            onDarkModeChange={changeDarkMode}
            unit={unit}
            onUnitChange={changeUnit}
            showOverview={showOverview}
            onShowOverviewChange={changeShowOverview}
            nowcastMode={nowcastMode}
            onNowcastModeChange={changeNowcastMode}
            colorCoding={colorCoding}
            onColorCodingToggle={toggleColorCoding}
            installPrompt={installPrompt}
            onInstall={handleInstall}
          />
        )}
      </div>
      <div className="weather-right">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={blockOrder} strategy={verticalListSortingStrategy}>
            {blockOrder.filter(id => id !== 'aqi' && (id !== 'overview' || showOverview) && !(isDesktop && id === 'nowcast')).map(id => (
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
      <header className={`app-header${!weather ? ' app-header--no-city' : ''}`}>
        <button
          className={`header-icon-btn${searchHolding ? ' header-icon-btn--holding' : ''}`}
          style={{ '--long-press-ms': `${LONG_PRESS_MS}ms` }}
          onClick={handleSearchButton}
          onPointerDown={startSearchHold}
          onPointerUp={endSearchHold}
          onPointerLeave={endSearchHold}
          onPointerCancel={endSearchHold}
          onContextMenu={(e) => e.preventDefault()}
          aria-label="Search — hold to use my location"
        >
          <span className="header-loc-icons">
            <Library size={24} style={{ opacity: splashPhase !== 'done' ? 1 : 0, pointerEvents: splashPhase !== 'done' ? undefined : 'none' }} />
            <MapPin  size={24} style={{ opacity: splashPhase === 'done' ? 1 : 0, pointerEvents: splashPhase === 'done' ? undefined : 'none' }} />
          </span>
        </button>
        <span
          className={`app-title${splashPhase === 'visible' ? ' app-title--splash' : ''}${splashPhase === 'exit' ? ' app-title--splash-exit' : ''}${splashPhase === 'done' && weather ? ' app-title--home' : ''}`}
          onClick={handleLogoClick}
          role={splashPhase === 'done' && weather ? 'button' : undefined}
          aria-label={splashPhase === 'done' && weather ? 'Go to home' : undefined}
        >Alek Weather</span>
        <button className="settings-btn" onClick={isDesktop && weather && !loading ? toggleDesktopSettings : (showSettings ? closeSettings : openSettings)} aria-label="Settings">
          <SlidersHorizontal size={22} />
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
            error.startsWith('geo:') ? (
              <div className="location-error-card">
                <MapPinOff size={32} className="location-error-icon" />
                <p className="location-error-msg">{error.slice(4)}</p>
                <button className="location-error-search" onClick={openSearch}>Search for a city instead</button>
              </div>
            ) : (
              <div className="status-message error">{error}</div>
            )
          )}
          {!weather && !loading && !error && splashPhase === 'done' && (
            <div className="empty-state" onClick={openSearch} role="button" aria-label="Search for a location">
              <MapPin size={72} className="empty-pin-icon" />
              <p className="empty-text">{isDesktop ? 'Click anywhere or begin typing to search for a city' : 'Tap to find a location'}</p>
            </div>
          )}
          <div className="weather-content">
            {weatherPanel}
          </div>
        </main>
      </div>

      {/* Splash screen — big logo centered, animates to header on city select */}
      {splashPhase !== 'done' && (
        <>
          <div className="splash-bg" aria-hidden="true">
            <div className="splash-clouds">
              <div className="splash-el e1" /><div className="splash-el e2" /><div className="splash-el e3" />
              <div className="splash-el e4" /><div className="splash-el e5" /><div className="splash-el e6" />
            </div>
            <div className="splash-stars">
              {STARS.map((s, i) => (
                <div key={i} className="splash-star" style={{ top: s.top, left: s.left, animationDuration: s.dur, animationDelay: s.delay }} />
              ))}
            </div>
          </div>
          {splashPhase === 'visible' && (
            <div className="splash-overlay" onClick={openSearch} aria-label="Search for a city" role="button" />
          )}
          <div className={`splash-logo${splashPhase === 'exit' ? ' splash-logo--exit' : ''}`}>
            <span className="splash-logo-text">Alek Weather</span>
            {splashPhase === 'visible' && (
              <p className="splash-hint">
                {isDesktop ? 'Click or type anywhere to search for a location' : 'Tap anywhere to find a location'}
              </p>
            )}
          </div>
        </>
      )}

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
                initialQuery={searchInitialQuery}
                onSearch={searchCity}
                results={searchResults}
                onSelect={handleSelectCity}
                onUseLocation={handleUseLocation}
                onClear={() => { setSearchResults([]); setSearchInitialQuery('') }}
                onActivate={() => {}}
                recents={recents}
                onRemoveRecent={removeRecent}
              >
                {cities.length > 0 && (
                  <SavedCities
                    cities={cities}
                    onSelect={handleSavedCitySelect}
                    onRemove={remove}
                    currentLatitude={location?.latitude}
                  />
                )}
              </SearchBar>
            </div>
          </div>
        </>
      )}

      {savedOpen && (
        <SavedCitiesPage
          cities={cities}
          onSelect={handleSavedPageSelect}
          onRemove={remove}
          onBack={closeSaved}
          currentLatitude={location?.latitude}
          closing={savedClosing}
          recents={recents}
          onRemoveRecent={removeRecent}
        />
      )}

      {showSettings && (!isDesktop || !weather || loading) && (
        <SettingsPage
          onBack={closeSettings}
          colorCodingOpen={colorCodingOpen}
          onColorCodingOpen={openColorCoding}
          onColorCodingBack={closeColorCoding}
          darkMode={darkMode}
          onDarkModeChange={changeDarkMode}
          unit={unit}
          onUnitChange={changeUnit}
          showOverview={showOverview}
          onShowOverviewChange={changeShowOverview}
          nowcastMode={nowcastMode}
          onNowcastModeChange={changeNowcastMode}
          colorCoding={colorCoding}
          onColorCodingToggle={toggleColorCoding}
          installPrompt={installPrompt}
          onInstall={handleInstall}
          closing={settingsClosing}
        />
      )}
    </div>
  )
}

export default App
