import { useState, useEffect, useRef } from 'react'

function skyClass(code, isDay) {
  if (code == null) return ''
  if (code === 95 || code === 96 || code === 99) return 'sky-storm'
  if ((code >= 51 && code <= 65) || (code >= 80 && code <= 82)) return isDay ? 'sky-rain-day' : 'sky-rain-night'
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return isDay ? 'sky-snow-day' : 'sky-snow-night'
  if (code === 45 || code === 48) return 'sky-fog'
  if (code === 3) return isDay ? 'sky-overcast-day' : 'sky-overcast-night'
  if (code === 2) return isDay ? 'sky-partly-day' : 'sky-partly-night'
  return isDay ? 'sky-clear-day' : 'sky-clear-night'
}

const SKY_LEVEL = {
  'sky-clear-night':   'sky-lvl-darkest',
  'sky-partly-day':    'sky-lvl-slight',
  'sky-partly-night':  'sky-lvl-dark',
  'sky-overcast-day':  'sky-lvl-medium',
  'sky-overcast-night':'sky-lvl-darkest',
  'sky-fog':           'sky-lvl-slight',
  'sky-rain-day':      'sky-lvl-dark',
  'sky-rain-night':    'sky-lvl-darkest',
  'sky-snow-day':      'sky-lvl-slight',
  'sky-snow-night':    'sky-lvl-dark',
  'sky-storm':         'sky-lvl-darkest',
}

// Card tint per sky theme: a darkened mid-tone of that sky's gradient, so
// cards blend with the backdrop instead of the one-size slate blue. `card` is
// the surface color, `deep` the nested/darker variant (detail subcards, search
// overlay). Every value keeps white text at ≥ ~4.2:1 contrast. App.css falls
// back to the old slate palette when these vars are absent.
const SKY_CARD_VARS = {
  'sky-clear-day':      { '--sky-card': '#2a6cb4', '--sky-card-deep': '#235d9e' },
  'sky-clear-night':    { '--sky-card': '#182452', '--sky-card-deep': '#111a3e' },
  'sky-partly-day':     { '--sky-card': '#3d6f9f', '--sky-card-deep': '#335f8a' },
  'sky-partly-night':   { '--sky-card': '#243447', '--sky-card-deep': '#1b2838' },
  'sky-overcast-day':   { '--sky-card': '#4e6572', '--sky-card-deep': '#41545f' },
  'sky-overcast-night': { '--sky-card': '#23343c', '--sky-card-deep': '#1a282e' },
  'sky-fog':            { '--sky-card': '#6b7f8a', '--sky-card-deep': '#5b6d77' },
  'sky-rain-day':       { '--sky-card': '#40535e', '--sky-card-deep': '#34454e' },
  'sky-rain-night':     { '--sky-card': '#1c2930', '--sky-card-deep': '#151f25' },
  'sky-snow-day':       { '--sky-card': '#647a89', '--sky-card-deep': '#556876' },
  'sky-snow-night':     { '--sky-card': '#2a3a42', '--sky-card-deep': '#202d34' },
  'sky-storm':          { '--sky-card': '#1a2038', '--sky-card-deep': '#12172a' },
}

const STARS = Array.from({ length: 40 }, () => ({
  top:   `${Math.random() * 88 + 4}%`,
  left:  `${Math.random() * 92 + 2}%`,
  dur:   `${(Math.random() * 3 + 2).toFixed(1)}s`,
  delay: `${-(Math.random() * 4).toFixed(1)}s`,
}))
import { SlidersHorizontal, MapPin, MapPinOff, ArrowLeft, GripHorizontal, Building2, X } from 'lucide-react'
import { DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useWeather } from './hooks/useWeather'
import { useRadarPrecip } from './hooks/useRadarPrecip'
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
import { WeatherCanvas } from './components/WeatherCanvas'
import { PrecipNowcast } from './components/PrecipNowcast'
import { WeatherAlerts } from './components/WeatherAlerts'
import { WeatherOverview } from './components/WeatherOverview'
import { SettingsPage } from './components/SettingsPage'
import { LoadingScreen } from './components/LoadingScreen'
import { liveWeatherCode } from './utils/weatherCodes'
import { APP_VERSION } from './utils/version'
import './App.css'

const THEME_KEY = 'alek-weather-theme'
const SETTINGS_CLOSE_MS = 260
const SEARCH_CLOSE_MS = 220
// Hold the header search button this long to skip the overlay and geolocate.
// Passed to App.css as the --long-press-ms custom property so the fill animation
// always matches this value.
const LONG_PRESS_MS = 2000

// Corrupted localStorage (partial write, manual edit) must never crash the app
// during the initial render — fall back to defaults instead.
function loadJSON(key) {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null') }
  catch { return null }
}

// True when a saved city will auto-load on mount: the app then skips the
// splash "home" screen (whose tap-to-search hint would be wrong) and opens
// straight into the loading skeleton → weather.
// The city to auto-load on launch: the set home takes priority, then the first
// saved city. Reading it here (module scope) lets the app skip the splash and
// start in the loading state when it knows a fetch will fire on mount.
const INITIAL_CITY = (() => {
  try {
    const homeCity = JSON.parse(localStorage.getItem('alek-weather-home'))
    if (homeCity) return homeCity
    return (JSON.parse(localStorage.getItem('alek-weather-saved')) ?? [])[0] ?? null
  } catch { return null }
})()
const HAS_SAVED_CITY = !!INITIAL_CITY

const BLOCK_ORDER_KEY = 'alek-weather-block-order'
const DEFAULT_BLOCK_ORDER = ['overview', 'nowcast', 'hourly', 'daily', 'details', 'radar']
const SHOW_OVERVIEW_KEY = 'alek-weather-show-overview'
const NOWCAST_MODE_KEY  = 'alek-weather-nowcast-mode'
const COLOR_CODING_KEY  = 'alek-weather-color-coding'
const DEFAULT_COLOR_CODING = { current: true, hourly: true, daily: true, overview: true, glow: true, frost: true }
const OVERVIEW_PARTS_KEY = 'alek-weather-overview-parts'
const DEFAULT_OVERVIEW_PARTS = { conditions: true, airQuality: true, clothing: true }
const RADAR_ENHANCED_KEY = 'alek-weather-radar-enhanced'

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
  const [weatherAnimations, setWeatherAnimations] = useState(() => localStorage.getItem('alek-weather-animations') !== 'false')
  const [gyroscope, setGyroscope] = useState(() => localStorage.getItem('alek-weather-gyroscope') !== 'false')
  const [radarEnhanced, setRadarEnhanced] = useState(() => localStorage.getItem(RADAR_ENHANCED_KEY) === 'true')
  const [colorCoding, setColorCoding] = useState(() => {
    const saved = loadJSON(COLOR_CODING_KEY)
    return saved ? { ...DEFAULT_COLOR_CODING, ...saved } : DEFAULT_COLOR_CODING
  })
  const [overviewParts, setOverviewParts] = useState(() => {
    const saved = loadJSON(OVERVIEW_PARTS_KEY)
    return saved ? { ...DEFAULT_OVERVIEW_PARTS, ...saved } : DEFAULT_OVERVIEW_PARTS
  })
  const [installPrompt, setInstallPrompt] = useState(null)
  const [showSettings, setShowSettings] = useState(false)
  const [settingsClosing, setSettingsClosing] = useState(false)
  const [subView, setSubView] = useState(null) // null | 'colorcoding' | 'overview'
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia('(min-width: 1100px)').matches)

  const [searchOpen, setSearchOpen] = useState(false)
  const [searchClosing, setSearchClosing] = useState(false)
  const [searchInitialQuery, setSearchInitialQuery] = useState('')
  const [savedOpen, setSavedOpen] = useState(false)
  const [savedClosing, setSavedClosing] = useState(false)
  const [splashPhase, setSplashPhase] = useState(HAS_SAVED_CITY ? 'done' : 'visible') // 'visible' | 'exit' | 'done'
  const searchAreaRef = useRef(null)
  const searchHoldTimer = useRef(null)
  const searchLongPressed = useRef(false)
  const [searchHolding, setSearchHolding] = useState(false)
  const [blockOrder, setBlockOrder] = useState(() => {
    const saved = loadJSON(BLOCK_ORDER_KEY)
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
    searchCity, selectCity, useMyLocation, setSearchResults, fetchWeather, reset, clearError,
  } = useWeather(HAS_SAVED_CITY)

  // Radar cross-check for the current condition (opt-in "Radar enhanced accuracy").
  const radarClear = useRadarPrecip(location, radarEnhanced)

  const { cities, save, remove, isSaved, home, setHome, unsetHome, isHome } = useSavedCities()
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

  // Auto-load the home city on mount (falling back to the first saved city).
  useEffect(() => {
    if (INITIAL_CITY) fetchWeather(INITIAL_CITY)
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
      if (subView) setSubView(null)
      else if (showSettings) doCloseSettings()
      else if (searchOpen) doCloseSearch()
      else if (savedOpen) doCloseSaved()
    }
    window.addEventListener('popstate', handler)
    return () => window.removeEventListener('popstate', handler)
  }, [subView, showSettings, searchOpen, savedOpen]) // eslint-disable-line react-hooks/exhaustive-deps

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

  const toggleOverviewPart = (key) => {
    setOverviewParts(prev => {
      const next = { ...prev, [key]: !prev[key] }
      localStorage.setItem(OVERVIEW_PARTS_KEY, JSON.stringify(next))
      return next
    })
  }

  const changeWeatherAnimations = (val) => {
    setWeatherAnimations(val)
    localStorage.setItem('alek-weather-animations', String(val))
  }

  const changeGyroscope = (val) => {
    setGyroscope(val)
    localStorage.setItem('alek-weather-gyroscope', String(val))
    // iOS 13+ gates motion sensors behind a permission prompt that must be
    // requested from a user gesture — flipping this toggle on is one.
    if (val && typeof DeviceOrientationEvent !== 'undefined'
        && typeof DeviceOrientationEvent.requestPermission === 'function') {
      DeviceOrientationEvent.requestPermission().catch(() => {})
    }
  }

  const changeRadarEnhanced = (val) => {
    setRadarEnhanced(val)
    localStorage.setItem(RADAR_ENHANCED_KEY, String(val))
  }

  const changeDarkMode = (mode) => {
    setDarkMode(mode)
    localStorage.setItem(THEME_KEY, mode)
  }

  const openSettings = () => {
    setSubView(null)
    history.pushState({ overlay: 'settings' }, '')
    setShowSettings(true)
  }

  const doCloseSettings = () => {
    setSettingsClosing(true)
    setTimeout(() => { setShowSettings(false); setSettingsClosing(false); setSubView(null) }, SETTINGS_CLOSE_MS)
  }

  const closeSettings = () => history.back()

  const openSubView = (view) => {
    history.pushState({ overlay: 'subview' }, '')
    setSubView(view)
  }

  const closeSubView = () => history.back()

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

  // Press-and-hold the header location button to detect your location via GPS;
  // a normal tap still opens search. The fill animation under the icon
  // (App.css) signals progress toward the LONG_PRESS_MS threshold.
  const startSearchHold = () => {
    if (splashPhase !== 'done') return
    searchLongPressed.current = false
    setSearchHolding(true)
    searchHoldTimer.current = setTimeout(() => {
      searchLongPressed.current = true
      setSearchHolding(false)
      navigator.vibrate?.(40)
      useMyLocation()
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

  const liveCode = weather ? liveWeatherCode(weather.current, weather.minutely_15, radarClear) : null
  if (weather) console.log('[radar-enh] decision', { radarEnhanced, radarClear, rawCode: weather.current.weather_code, confirmed: weather.current.weather_code_confirmed, liveCode })
  const skyC     = weather ? skyClass(liveCode, weather.current.is_day) : ''
  const levelC   = SKY_LEVEL[skyC] ?? ''

  const blockComponents = weather && !loading ? {
    overview: <WeatherOverview hourly={weather.hourly} daily={weather.daily} current={weather.current} minutely={weather.minutely_15} radarClear={radarClear} timezone={weather.timezone} hasActiveAlert={hasActiveAlert} unit={unit} airQuality={airQuality} showConditions={overviewParts.conditions} showAirQuality={overviewParts.airQuality} showClothing={overviewParts.clothing} colorCode={colorCoding.overview} />,
    hourly:  <HourlyForecast hourly={weather.hourly} timezone={weather.timezone} unit={unit} colorCoding={colorCoding.hourly} glow={colorCoding.glow} frost={colorCoding.frost} current={weather.current} minutely={weather.minutely_15} radarClear={radarClear} />,
    daily:   <DailyForecast daily={weather.daily} hourly={weather.hourly} timezone={weather.timezone} unit={unit} colorCoding={colorCoding.daily} glow={colorCoding.glow} frost={colorCoding.frost} current={weather.current} minutely={weather.minutely_15} radarClear={radarClear} />,
    details: <WeatherDetails current={weather.current} daily={weather.daily} hourly={weather.hourly} timezone={weather.timezone} unit={unit} airQuality={airQuality} />,
    radar:   <WeatherRadar location={location} timezone={weather.timezone} />,
    nowcast: <PrecipNowcast minutely={weather.minutely_15} currentTime={weather.current.time} mode={nowcastMode} current={weather.current} radarClear={radarClear} />,
  } : null

  const weatherPanel = weather && !loading && (
    <>
      <div className="weather-left">
        <WeatherAlerts alerts={alerts} />
        <CurrentWeather
          current={weather.current}
          minutely={weather.minutely_15}
          radarClear={radarClear}
          location={location}
          timezone={weather.timezone}
          unit={unit}
          saved={isSaved(location)}
          onSave={() => save(location)}
          onRemove={() => remove(location)}
          isHome={isHome(location)}
          hasHome={!!home}
          onGoHome={() => { if (home) fetchWeather(home) }}
          onSetHome={() => setHome(location)}
          onUnsetHome={unsetHome}
          lastUpdated={lastUpdated}
          onRefresh={() => fetchWeather(location)}
          loading={loading}
          colorCoding={colorCoding.current}
          glow={colorCoding.glow}
          frost={colorCoding.frost}
        />
        {/* On desktop the compact precipitation chart sits under the current
            weather instead of stretching the wide right column. On mobile it
            stays in the draggable block list below. */}
        {isDesktop && blockComponents.nowcast}
        {isDesktop && showOverview && blockComponents.overview}
      </div>
      <div className="weather-right">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={blockOrder} strategy={verticalListSortingStrategy}>
            {blockOrder.filter(id => id !== 'aqi' && (id !== 'overview' || showOverview) && !(isDesktop && id === 'nowcast') && !(isDesktop && id === 'overview')).map(id => (
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
    <>
      {weather && weatherAnimations && <div className={`sky-bg ${skyC}`} aria-hidden="true" />}
      {weather && weatherAnimations && <WeatherCanvas code={liveCode} gyro={gyroscope} />}
    <div
      className={`app${weatherAnimations && levelC ? ` ${levelC}` : ''}${!weatherAnimations ? ' no-effects' : ''}${weather && weatherAnimations ? ' sky-active' : ''}`}
      style={weather && weatherAnimations ? SKY_CARD_VARS[skyC] : undefined}
    >
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
            <Building2 size={24} style={{ opacity: splashPhase !== 'done' ? 1 : 0, pointerEvents: splashPhase !== 'done' ? undefined : 'none' }} />
            <MapPin  size={24} style={{ opacity: splashPhase === 'done' ? 1 : 0, pointerEvents: splashPhase === 'done' ? undefined : 'none' }} />
          </span>
        </button>
        <div className="app-title-wrapper">
          <span
            className={`app-title${splashPhase === 'visible' ? ' app-title--splash' : ''}${splashPhase === 'exit' ? ' app-title--splash-exit' : ''}${splashPhase === 'done' && weather ? ' app-title--home' : ''}`}
            onClick={handleLogoClick}
            role={splashPhase === 'done' && weather ? 'button' : undefined}
            aria-label={splashPhase === 'done' && weather ? 'Go to home' : undefined}
          >Alek Weather</span>
        </div>
        <button className="settings-btn" onClick={showSettings ? closeSettings : openSettings} aria-label="Settings">
          <SlidersHorizontal size={22} />
        </button>
      </header>

      <div className="app-grid">
        <main className="main-content">
          {loading && <LoadingScreen />}
          {error && !loading && (
            error.startsWith('geo:') ? (
              <div className="location-error-card">
                <button className="location-error-close" onClick={clearError} aria-label="Dismiss">
                  <X size={18} />
                </button>
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
            <img
              src="/logo-transparent.svg"
              alt=""
              className={`splash-logo-img splash-logo-img-light${splashPhase === 'exit' ? ' splash-logo-img--exit' : ''}`}
              aria-hidden="true"
            />
            <img
              src="/logo-dark.svg"
              alt=""
              className={`splash-logo-img splash-logo-img-dark${splashPhase === 'exit' ? ' splash-logo-img--exit' : ''}`}
              aria-hidden="true"
            />
            <div className="splash-clouds">
              <div className="splash-el e1" /><div className="splash-el e2" /><div className="splash-el e3" />
              <div className="splash-el e4" /><div className="splash-el e5" /><div className="splash-el e6" />
            </div>
            <div className={`splash-logo${splashPhase === 'exit' ? ' splash-logo--exit' : ''}`}>
              <span className="splash-logo-text">Alek Weather</span>
              {splashPhase === 'visible' && (
                <p className="splash-hint">
                  {isDesktop ? 'Click or type anywhere to search for a location' : 'Tap anywhere to find a location'}
                </p>
              )}
            </div>
            <div className="splash-stars">
              {STARS.map((s, i) => (
                <div key={i} className="splash-star" style={{ top: s.top, left: s.left, animationDuration: s.dur, animationDelay: s.delay }} />
              ))}
            </div>
            <p className="splash-version">Version {APP_VERSION}</p>
          </div>
          {splashPhase === 'visible' && (
            <div className="splash-overlay" onClick={openSearch} aria-label="Search for a city" role="button" />
          )}
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
                {(cities.length > 0 || home) && (
                  <SavedCities
                    cities={cities}
                    onSelect={handleSavedCitySelect}
                    onRemove={remove}
                    currentLocation={location}
                    home={home}
                    onRemoveHome={() => setHome(null)}
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
          currentLocation={location}
          closing={savedClosing}
          recents={recents}
          onRemoveRecent={removeRecent}
          home={home}
          onRemoveHome={() => setHome(null)}
        />
      )}

      {showSettings && (
        <SettingsPage
          onBack={closeSettings}
          subView={subView}
          onColorCodingOpen={() => openSubView('colorcoding')}
          onOverviewOpen={() => openSubView('overview')}
          onSubViewBack={closeSubView}
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
          overviewParts={overviewParts}
          onOverviewPartToggle={toggleOverviewPart}
          weatherAnimations={weatherAnimations}
          onWeatherAnimationsChange={changeWeatherAnimations}
          gyroscope={gyroscope}
          onGyroscopeChange={changeGyroscope}
          radarEnhanced={radarEnhanced}
          onRadarEnhancedChange={changeRadarEnhanced}
          installPrompt={installPrompt}
          onInstall={handleInstall}
          closing={settingsClosing}
        />
      )}
      <div id="alert-portal-root" />
    </div>
    </>
  )
}

export default App
