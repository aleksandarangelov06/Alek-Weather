import { useState, useEffect, useLayoutEffect, useRef } from 'react'

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
  'sky-clear-day':     'sky-lvl-slight',
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

// Color the Android status bar (via the theme-color metas) to match the sky
// backdrop behind the header when weather effects are active, so the bar stays
// consistent with the background. Each value is the top gradient stop of the
// matching sky in App.css: [lightTheme, darkTheme]. Night skies and storm have
// no dark-theme override, so both entries are equal.
const SKY_THEME_COLOR = {
  'sky-clear-day':      ['#1565c0', '#081627'],
  'sky-clear-night':    ['#050d1f', '#050d1f'],
  'sky-partly-day':     ['#2e6da4', '#0d1926'],
  'sky-partly-night':   ['#0d1520', '#0d1520'],
  'sky-overcast-day':   ['#455a64', '#11181c'],
  'sky-overcast-night': ['#121a1d', '#121a1d'],
  'sky-fog':            ['#90a4ae', '#222b30'],
  'sky-rain-day':       ['#263238', '#0d1316'],
  'sky-rain-night':     ['#0d1418', '#0d1418'],
  'sky-snow-day':       ['#78909c', '#161e23'],
  'sky-snow-night':     ['#1c2529', '#1c2529'],
  'sky-storm':          ['#0a0c14', '#0a0c14'],
}

// The Android navigation bar ignores theme-color; in an installed PWA Chrome
// picks its color from the document's color-scheme plus the base background
// color, which propagates from <body>. Both must agree: without a dark
// color-scheme Chrome assumes a light page and paints the bar white no matter
// what body's background is. Each value is the *bottom* gradient stop of the
// matching sky in App.css, since that is the part of the backdrop the bar sits
// against: [lightTheme, darkTheme].
const SKY_NAV_COLOR = {
  'sky-clear-day':      ['#81d4fa', '#174a7c'],
  'sky-clear-night':    ['#1a237e', '#1a237e'],
  'sky-partly-day':     ['#a8cce8', '#2e4d63'],
  'sky-partly-night':   ['#243040', '#243040'],
  'sky-overcast-day':   ['#90a4ae', '#2d3e47'],
  'sky-overcast-night': ['#243038', '#243038'],
  'sky-fog':            ['#cfd8dc', '#4a575f'],
  'sky-rain-day':       ['#546e7a', '#23323b'],
  'sky-rain-night':     ['#1c272d', '#1c272d'],
  'sky-snow-day':       ['#b0bec5', '#32424b'],
  'sky-snow-night':     ['#2e3d44', '#2e3d44'],
  'sky-storm':          ['#1a1f38', '#1a1f38'],
}

const STARS = Array.from({ length: 40 }, () => ({
  top:   `${Math.random() * 88 + 4}%`,
  left:  `${Math.random() * 92 + 2}%`,
  dur:   `${(Math.random() * 3 + 2).toFixed(1)}s`,
  delay: `${-(Math.random() * 4).toFixed(1)}s`,
}))
import { Search, MapPin, MapPinOff, ArrowLeft, GripHorizontal, Building2, X, Navigation, House, Settings as SettingsIcon } from 'lucide-react'
import { DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useWeather } from './hooks/useWeather'
import { RADAR_ENHANCED_KEY } from './hooks/useRadarPrecip'
import { useSavedCities } from './hooks/useSavedCities'
import { useRecentSearches } from './hooks/useRecentSearches'
import { SearchBar } from './components/SearchBar'
import { SearchSheet } from './components/SearchSheet'
import { StyleCoverArt } from './components/StyleCoverArt'
import { SavedCities } from './components/SavedCities'
import { SavedCitiesPage } from './components/SavedCitiesPage'
import { CurrentWeather } from './components/CurrentWeather'
import { HourlyForecast } from './components/HourlyForecast'
import { DailyForecast } from './components/DailyForecast'
import { WeatherDetails } from './components/WeatherDetails'
import { WeatherRadar } from './components/WeatherRadarLazy'
import { WeatherCanvas } from './components/WeatherCanvas'
import { PrecipNowcast } from './components/PrecipNowcast'
import { WeatherAlerts } from './components/WeatherAlerts'
import { WeatherOverview } from './components/WeatherOverview'
import { SettingsPage } from './components/SettingsPageLazy'
import { preloadSettings } from './components/settingsChunk'
import { BuildingsIcon, GearIcon, SearchIcon } from './components/headerGlyphs'
import { SlidersIcon } from './components/SlidersIcon'
import { MAX_CARD_TRANSPARENCY, IOS_FULL_CLARITY_AT } from './utils/appearance'
import { WebLayout } from './components/web/WebLayout'
import { WebTabs } from './components/web/WebTabs'
import { WebAlertPill } from './components/web/WebAlertPill'
import { TABS as WEB_TABS, useWebTab } from './components/web/tabs'
import { SplashHome } from './components/web/SplashHome'
import { LocationsPage } from './components/web/LocationsPage'
import { SplashCities } from './components/SplashCities'
import { LoadingScreen } from './components/LoadingScreen'
import { WebLoadingScreen } from './components/web/WebLoadingScreen'
import { liveWeatherCode, getWeatherInfo } from './utils/weatherCodes'
import { isSnowing } from './utils/conditions'
import { WeatherIcon } from './components/WeatherIcon'
import { useIconSet, setIconSet } from './utils/iconSet'
import { useLocalConditions, locatedPlace, localConditionsFailed } from './hooks/useLocalConditions'
import { loadUnits, saveUnit } from './utils/units'
import { APP_VERSION, IS_ANDROID_APP } from './utils/version'
import { UpdateToast } from './components/UpdateToast'
import { IS_PHONE, IS_DESKTOP, DEV_DEVICE } from './utils/device'
import { applyMaterialTokens, DEFAULT_SEED, isValidSeed, resolveSeed, systemSeed, SYSTEM_SEED } from './utils/materialTheme'
import { useNotifications } from './hooks/useNotifications'
import { syncNotificationSettings } from './utils/notifications'
import './App.css'
// Imported after App.css so the web app's rules win the ties against the shared
// card styles they refine.
import './WebApp.css'

const THEME_KEY = 'alek-weather-theme'
const PLATFORM_THEME_KEY = 'alek-weather-platform-theme' // 'ios' | 'android' | 'web'
const MATERIAL_COLOR_KEY = 'alek-weather-material-color' // seed hex for the Material You palette
const CARD_TRANSPARENCY_KEY = 'alek-weather-card-transparency' // 0–90, percent of card fill removed

// Viewport width at which the desktop layout takes over. Shared with the
// isDesktop media query below so the first-run default and the layout agree on
// what counts as a desktop.
const DESKTOP_MQ = '(min-width: 1100px)'
// ...and the width it gives up at. The two differ on purpose: with a single
// threshold, a window parked near 1100px (or a laptop at 125% browser zoom,
// which lands right about there) flips shells on a one-pixel drag. Desktop is
// entered at 1100 and only surrendered below 940, so the layout has to be
// clearly too narrow before it changes its mind.
const MOBILE_MQ = '(max-width: 939.98px)'

// Resolve the shell width state with that hysteresis: widening past DESKTOP_MQ
// turns desktop on, narrowing past MOBILE_MQ turns it off, and in the band
// between them whatever is already on screen stays.
function nextIsDesktop(current) {
  if (window.matchMedia(DESKTOP_MQ).matches) return true
  if (window.matchMedia(MOBILE_MQ).matches) return false
  return current
}

// First-run app style, from the device. The order matters: the APK is always
// the phone app no matter how large the tablet it runs on, so it is settled
// first; then Apple touch devices take the iOS look (modern iPads report as
// "Macintosh", so touch support is the tell that separates them from actual
// Macs); then anything on a desktop-sized screen opens in the web app rather
// than a phone design stretched across a monitor. Everything left is a
// non-Apple phone, which gets Android. The setting can override the default,
// within limits: phones can't pick Web, and desktops (IS_DESKTOP) are always
// Web.
function defaultPlatformTheme() {
  if (IS_ANDROID_APP) return 'android'
  if (IS_DESKTOP) return 'web'
  // Dev override (see device.js): a pretend phone takes its pretend OS's look.
  if (DEV_DEVICE === 'iphone') return 'ios'
  if (DEV_DEVICE === 'android') return 'android'
  const isApple = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1)
  if (isApple) return 'ios'
  return window.matchMedia(DESKTOP_MQ).matches ? 'web' : 'android'
}
// Where the phone shells' pages zoom out of (and settle back toward): the centre
// of the button that opened them, written to the root as --page-reveal-x/y and
// used as the page's transform-origin by the pageGrowIn/pageShrinkOut keyframes in
// App.css. With no element the page zooms from the middle of the screen.
function setRevealOrigin(el) {
  let x = window.innerWidth / 2
  let y = window.innerHeight / 2
  if (el?.getBoundingClientRect) {
    const r = el.getBoundingClientRect()
    x = r.left + r.width / 2
    y = r.top + r.height / 2
  }
  const root = document.documentElement.style
  root.setProperty('--page-reveal-x', `${x}px`)
  root.setProperty('--page-reveal-y', `${y}px`)
}

// How much of the Card Transparency setting reaches the Android card fill. The
// slider runs 0–MAX_CARD_TRANSPARENCY (35); at this scale its far end thins the
// fill to about 77%. iOS reads the setting separately (--ios-glass-clarity,
// against IOS_FULL_CLARITY_AT) and is unaffected by this.
const ANDROID_THIN_SCALE = 0.65

const SETTINGS_CLOSE_MS = 260
// The cover that hides an app-style switch (see changePlatformTheme): fade in,
// hold while the new style paints underneath, fade out. App.css times the two
// fades off the same figures (.style-cover).
const STYLE_COVER_IN_MS = 240
// Long enough for the cover's art to play: the robot's wave, the apple's bite.
const STYLE_COVER_HOLD_MS = 900
const STYLE_COVER_OUT_MS = 380
const STYLE_NAMES = { ios: 'iOS', android: 'Android', web: 'Web' }
// How long the cog turns when settings opens. App.css runs the rotation off the
// same figure via the --cog-spin-ms custom property. The page no longer waits
// for it: it opens on the tap, and the turn plays alongside the reveal.
const SETTINGS_OPEN_MS = 240
// How long the glass sweeps when search opens (--glass-sweep-ms). Matches the
// cog deliberately, but stays its own number, because the two gestures are
// different shapes and may not want retuning together. Like the cog, it no
// longer holds the page back.
const SEARCH_OPEN_MS = 240
const SEARCH_CLOSE_MS = 220
// The round icon buttons on the phone shells (header search and settings, the
// current card's home and save) all dip under a press. :active alone can come
// and go on a quick tap before the dip has painted, so the press is also held as a
// data-pressed attribute for at least this long (an attribute, because React
// rewrites className when hold state changes and would wipe a class). See the effect in App.
const PRESS_DIP_MIN_MS = 110
const PRESS_DIP_SELECTOR = '.app-header .header-icon-btn, .app-header .settings-btn, .current-card .fav-btn, .current-card .save-btn'
// Hold the header search button this long to skip the overlay and geolocate.
// Passed to App.css as the --long-press-ms custom property so the fill animation
// always matches this value.
const LONG_PRESS_MS = 2000

// How old a reading may be before the app quietly refetches it. A radar sweep
// lands every ~6 minutes and minutely_15 steps every 15, so ten minutes is about
// the point past which the current condition can be describing weather that has
// already moved on. The check runs every minute; nothing is fetched until the
// reading is actually stale.
const STALE_MS = 10 * 60 * 1000
const STALE_CHECK_MS = 60 * 1000

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
const DEFAULT_COLOR_CODING = { current: true, hourly: true, daily: true, overview: true, details: true, glow: true, frost: true }
const OVERVIEW_PARTS_KEY = 'alek-weather-overview-parts'
const DEFAULT_OVERVIEW_PARTS = { insight: true, conditions: true, airQuality: true, clothing: true }
const ICON_MOTION_KEY   = 'alek-weather-icon-motion'
// How the radar timeline presents its two feeds.
//   'combined'  one scrubber running observed → forecast, divided at now
//   'split'     the two as separate timelines behind an Observed/Forecast toggle
// Only US locations have forecast frames at all; elsewhere both settings come
// out as the same observed-only scrubber.
const RADAR_MODE_KEY = 'alek-weather-radar-mode' // 'combined' | 'split'
const RADAR_SOURCE_KEY = 'alek-weather-radar-source' // 'rainviewer' | 'auto' | 'mrms' | 'nexrad'
const RADAR_SOURCES = ['rainviewer', 'auto', 'mrms', 'nexrad']

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
  // Wind, pressure, visibility and precipitation, as one object rather than
  // four states: every consumer wants the whole set, and passing `units` keeps
  // the prop lists from growing a member per measure. Temperature stays its own
  // `unit` — it is threaded through colour coding and toTemp separately.
  const [units, setUnits] = useState(loadUnits)
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem(THEME_KEY) ?? 'system')
  const [platformTheme, setPlatformTheme] = useState(() => {
    const saved = localStorage.getItem(PLATFORM_THEME_KEY)
    // The web app needs a desktop-sized viewport: on a phone its header
    // controls run off screen, settings among them, and with settings out of
    // reach the choice can't be undone. So a phone never keeps 'web' — the
    // Web option is hidden there (see SettingsPage), and anything already
    // stored, from an older build or another device, falls back to the phone
    // look on the next launch. A desktop is the reverse: it is always Web, so
    // a stored iOS or Android choice is ignored there.
    if (IS_DESKTOP) return 'web'
    if (!saved || (saved === 'web' && IS_PHONE)) return defaultPlatformTheme()
    return saved
  })
  // A hex, or SYSTEM_SEED to follow the wallpaper (Material You, Android 12+
  // app only). Someone who has never picked a colour gets the wallpaper's
  // wherever there is one, the way Android's own apps do.
  const [materialColor, setMaterialColor] = useState(() => {
    const saved = localStorage.getItem(MATERIAL_COLOR_KEY)
    if (saved === SYSTEM_SEED) return SYSTEM_SEED
    if (isValidSeed(saved)) return saved.toLowerCase()
    return systemSeed() ? SYSTEM_SEED : DEFAULT_SEED
  })
  const [cardTransparency, setCardTransparency] = useState(() => {
    const saved = Number(localStorage.getItem(CARD_TRANSPARENCY_KEY))
    return Number.isFinite(saved) ? Math.min(MAX_CARD_TRANSPARENCY, Math.max(0, saved)) : 0
  })
  const [showOverview, setShowOverview] = useState(() => localStorage.getItem(SHOW_OVERVIEW_KEY) !== 'false')
  const [nowcastMode, setNowcastMode] = useState(() => localStorage.getItem(NOWCAST_MODE_KEY) ?? 'auto')
  const [weatherAnimations, setWeatherAnimations] = useState(() => localStorage.getItem('alek-weather-animations') !== 'false')
  const [gyroscope, setGyroscope] = useState(() => localStorage.getItem('alek-weather-gyroscope') !== 'false')
  // Separate from weatherAnimations, which is the sky backdrop and the canvas
  // effects behind the whole app. This is only the weather icons' own motion —
  // falling rain, drifting cloud, the lightning flash — so it can be turned off
  // by someone who still wants the sky, and vice versa.
  const [iconMotion, setIconMotion] = useState(() => localStorage.getItem(ICON_MOTION_KEY) !== 'false')
  // Color (the Fluent glyphs) or Line (Lucide). Stored and broadcast by
  // iconSet.js, which WeatherIcon reads directly — see the note there.
  const iconSet = useIconSet()
  // Defaults on: radar is the only source that observes precipitation over the
  // location itself, and it has caught storms every model and nearby station
  // missed. `!== 'false'` so anyone who explicitly turned it off stays off.
  const [radarEnhanced, setRadarEnhanced] = useState(() => localStorage.getItem(RADAR_ENHANCED_KEY) !== 'false')
  const [radarMode, setRadarMode] = useState(() => {
    const saved = localStorage.getItem(RADAR_MODE_KEY)
    // Migrating the values this key used to hold. 'both' was the single
    // timeline, which is what 'combined' is now. 'nowcast' and 'future' were
    // the retired "opens on" choice, and that only ever existed in the split
    // layout, so either of them lands there.
    if (saved === 'combined' || saved === 'both') return 'combined'
    return 'split'
  })
  // Which observed radar feed the map draws. RainViewer by default, everywhere;
  // in the US the NOAA feeds are there to opt into (see WeatherRadar). A saved
  // choice is kept, so anyone who already picked one stays on it.
  const [radarSource, setRadarSource] = useState(() => {
    const saved = localStorage.getItem(RADAR_SOURCE_KEY)
    return RADAR_SOURCES.includes(saved) ? saved : 'rainviewer'
  })
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
  // True only while the cog is turning, before the panel is mounted.
  const [settingsOpening, setSettingsOpening] = useState(false)
  // The full-screen cover over an app-style switch: { to, leaving } or null.
  const [styleCover, setStyleCover] = useState(null)
  const styleCoverTimers = useRef([])
  useEffect(() => () => styleCoverTimers.current.forEach(clearTimeout), [])
  const settingsOpenTimer = useRef(null)
  // The same, for the magnifier's sweep and the search overlay.
  const [searchSweeping, setSearchSweeping] = useState(false)
  const searchOpenTimer = useRef(null)
  const [subView, setSubView] = useState(null) // null | 'colorcoding' | 'overview' | 'radar' | 'effects' | 'icons' | 'theme' | 'notifications'
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia(DESKTOP_MQ).matches)
  const [webTab, setWebTab] = useWebTab()
  // The web app's non-forecast pages — 'locations' | 'settings' | null. Kept
  // apart from webTab: they need no forecast, so they can be opened from Home
  // with nothing loaded, and leaving one returns to whichever forecast page you
  // were on. Not persisted: a reload lands on the forecast, as it always has.
  const [webPage, setWebPage] = useState(null)

  // The app style setting is honoured at every width: picking "Web" and then
  // narrowing the window keeps the web app, because a layout that swapped
  // itself out from under you mid-resize was the more confusing behaviour.
  // Viewport width only seeds the first-run default (defaultPlatformTheme).
  // WebApp.css carries the narrow tiers that let the tab bar and the wide
  // grids survive down there; isDesktop still gates the pieces that genuinely
  // need room, and the pointer-specific affordances below.
  const webLayout = platformTheme === 'web'
  const navPageUp = webLayout && webPage != null
  // Switching the app style away from Web on the Settings page leaves no tab bar
  // to come back by, so the page is dropped with the layout.
  if (!webLayout && webPage != null) setWebPage(null)

  const [searchOpen, setSearchOpen] = useState(false)
  const [searchClosing, setSearchClosing] = useState(false)
  const [searchInitialQuery, setSearchInitialQuery] = useState('')
  const [savedOpen, setSavedOpen] = useState(false)
  const [savedClosing, setSavedClosing] = useState(false)
  const [splashPhase, setSplashPhase] = useState(HAS_SAVED_CITY ? 'done' : 'visible') // 'visible' | 'exit' | 'done'

  // The web app's splash doubles as its home screen (search field + the places
  // you've been), so it replaces the phone splash's tap-anywhere-to-search
  // overlay and hint. Every other style keeps the plain splash.
  // Declared here rather than beside webLayout above: it reads splashPhase, so
  // it has to come after that state is initialised.
  const webSplash = webLayout && splashPhase !== 'done'
  const headerRef = useRef(null)
  const searchAreaRef = useRef(null)
  const searchHoldTimer = useRef(null)
  const searchLongPressed = useRef(false)
  // Guards the staleness refresh: a fetch slower than STALE_CHECK_MS would
  // otherwise have a second one firing on top of it.
  const refreshingRef = useRef(false)
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
    searchCity, selectCity, useMyLocation, setSearchResults, fetchWeather, restoreReading, reset, clearError,
  } = useWeather(INITIAL_CITY)

  // Radar cross-check for the current condition (opt-in "Radar enhanced accuracy").
  // The verdict is sampled with the reading itself (see loadForecast), so it is
  // always the sweep behind the reading on screen, and it is there from the
  // first frame — sampling it afterwards showed the model's unchecked code (a
  // thunderstorm sky) for a beat before the check corrected it.
  const radarClear = radarEnhanced ? (weather?.radarClear ?? null) : null

  const { cities, save, remove, isSaved, home, setHome, unsetHome, isHome } = useSavedCities()
  const { recents, addRecent, removeRecent } = useRecentSearches()
  const { notifyEnabled, notifyTypes, permission: notifyPermission, toggleNotifyEnabled, toggleType } = useNotifications()

  // Weather notifications are APK-only (they ride the native bridge). The page
  // only publishes settings: the native worker does the checking, on its own
  // schedule, so notifications keep arriving with the app closed. Re-syncing on
  // a location change is what points it at the place currently on screen.
  useEffect(() => {
    if (!IS_ANDROID_APP) return
    syncNotificationSettings({ enabled: notifyEnabled, types: notifyTypes, location, unit })
  }, [notifyEnabled, notifyTypes, location, unit])
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
    // Both edges of the hysteresis band have to be watched: the desktop query
    // firing false only means "no longer wide", which is not yet narrow enough
    // to drop the shell. nextIsDesktop reads both and keeps the current value
    // while the window sits between them.
    const wide = window.matchMedia(DESKTOP_MQ)
    const narrow = window.matchMedia(MOBILE_MQ)
    const handler = () => setIsDesktop(nextIsDesktop)
    wide.addEventListener('change', handler)
    narrow.addEventListener('change', handler)
    // A resize that crosses both edges before this effect attaches (or a zoom
    // change during hydration) would otherwise leave the state stale.
    handler()
    return () => {
      wide.removeEventListener('change', handler)
      narrow.removeEventListener('change', handler)
    }
  }, [])

  // Mark the root when running inside the installed APK (vs the website), so CSS
  // can hide scrollbars for a native feel. Distinct from data-platform, which is
  // a user-facing style choice rather than the actual runtime.
  useEffect(() => {
    if (IS_ANDROID_APP) document.documentElement.setAttribute('data-native', 'android')
  }, [])

  // Icon motion is switched off at the root rather than by prop, because the
  // animations are bound in CSS by container and never pass through a component.
  // Only the "off" state is marked: an absent attribute is the default, so the
  // icons animate before this effect has run rather than after.
  useEffect(() => {
    const root = document.documentElement
    if (iconMotion) root.removeAttribute('data-icon-motion')
    else root.setAttribute('data-icon-motion', 'off')
  }, [iconMotion])

  // Apply dark mode theme
  useEffect(() => {
    const root = document.documentElement
    if (darkMode === 'on') root.setAttribute('data-theme', 'dark')
    else if (darkMode === 'off') root.setAttribute('data-theme', 'light')
    else root.removeAttribute('data-theme')
  }, [darkMode])

  // The app style setting is really two independent choices, so it is published
  // as two attributes rather than one three-way value:
  //
  //   data-shell    (mobile | desktop) — which app is being rendered. Today both
  //     shells are the same component tree and only CSS tells them apart; this
  //     is the seam a separate desktop view tree will branch on later. It tracks
  //     webLayout, not the raw setting: WebApp.css carries no width query of its
  //     own, so publishing "desktop" for a narrow window with Web selected would
  //     dress the stacked mobile tree that actually rendered in desktop styles.
  //   data-platform (ios | android) — which design language the mobile shell is
  //     drawn in. The desktop shell keeps a value here so it inherits the font
  //     and the Material You settings pages, but rules meant only for the phone
  //     look pair it with [data-shell="mobile"].
  //
  // Splitting them this way is what lets Web borrow most of Android without the
  // parts that are specifically the phone app.
  //
  // A layout effect, so the attributes change in the same frame as the markup
  // that depends on them. As a plain effect they landed a paint late, and in
  // that frame anything styled per shell fell back to its base rules (the
  // phone settings page, for one, played its full-screen slide from the right).
  useLayoutEffect(() => {
    const root = document.documentElement
    root.setAttribute('data-shell', webLayout ? 'desktop' : 'mobile')
    root.setAttribute('data-platform', platformTheme === 'ios' ? 'ios' : 'android')
  }, [platformTheme, webLayout])


  // Material You seed color (Android style only — it's the one style whose look
  // is built out of the --md-* tokens, and the only one that offers the picker).
  // App.css ships the baseline purple for both schemes, so a custom seed has to
  // be generated and written inline to outrank it — which means knowing which
  // scheme is actually on screen, including when Theme is System and the OS
  // flips it out from under us.
  useEffect(() => {
    const root = document.documentElement
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const paint = () => {
      const dark = darkMode === 'on' || (darkMode === 'system' && mq.matches)
      const seed = platformTheme === 'android' ? resolveSeed(materialColor) : null
      applyMaterialTokens(root, seed, dark ? 'dark' : 'light')
    }
    paint()
    mq.addEventListener('change', paint)
    // Following the wallpaper: the system colour can change while the app is in
    // the background, so it is read again whenever the app comes back.
    const onVisible = () => { if (materialColor === SYSTEM_SEED && !document.hidden) paint() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      mq.removeEventListener('change', paint)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [materialColor, platformTheme, darkMode])

  // Card transparency, the other half of that picker — one stored value, but
  // the two styles start from opposite places, so each reads it its own way:
  //
  //   --md-card-alpha  (Android) is the opacity its opaque fills are mixed at,
  //     so the slider maps straight onto it. data-card-glass turns on the
  //     backdrop blur behind them, withheld at zero so the default look never
  //     pays for a filter it can't show.
  //   --ios-glass-clarity (iOS) is not an opacity at all, just how far the
  //     thumb has been pulled, 0 → 1. Those fills are already translucent glass
  //     at a per-surface percentage, and thinning them is only one of the three
  //     things the slider has to do there to read as anything — App.css owns
  //     that whole mapping, since all of it is design; this side only has to
  //     normalise against the clamp, being the side that has it.
  //
  // Neither is scoped to a style in CSS — the rules that read them already are
  // — but both come off entirely under the other styles so nothing lingers on
  // the root.
  // Both readings are also gated on the sky being there to show. Thinning a card
  // with weather effects off doesn't reveal anything — there is no sky behind
  // the stack, only the flat page surface — so all it does is wash the cards
  // out. The stored value is left alone rather than zeroed, so turning effects
  // back on restores the look the user had picked; the Theme page greys the
  // control out for as long as it can't do anything (see CardTransparencyRow).
  useEffect(() => {
    const root = document.documentElement
    const thinned = cardTransparency > 0 && weatherAnimations
    if (thinned && platformTheme === 'android') {
      // Scaled (ANDROID_THIN_SCALE) so the far end of the slider leaves the cards
      // about three-quarters filled rather than half: at 50% the Android
      // containers, dark ones especially, were barely there over the sky.
      root.style.setProperty('--md-card-alpha', `${100 - cardTransparency * ANDROID_THIN_SCALE}%`)
      root.setAttribute('data-card-glass', 'on')
    } else {
      root.style.removeProperty('--md-card-alpha')
      root.removeAttribute('data-card-glass')
    }
    if (thinned && platformTheme === 'ios') {
      root.style.setProperty('--ios-glass-clarity', String(cardTransparency / IOS_FULL_CLARITY_AT))
    } else {
      root.style.removeProperty('--ios-glass-clarity')
    }
    // The clear-glass cards over the sky (both phone styles; see "Cards as
    // clear glass" in App.css) read the setting as 0–1 of the slider.
    if (thinned && platformTheme !== 'web') {
      root.style.setProperty('--card-glass-t', String(cardTransparency / MAX_CARD_TRANSPARENCY))
    } else {
      root.style.removeProperty('--card-glass-t')
    }
  }, [cardTransparency, platformTheme, weatherAnimations])

  // Auto-load the home city on mount (falling back to the first saved city).
  // When useWeather already opened on the cached reading for it, refresh that in
  // place instead — the app is on screen at once and updates when the network
  // answers. A reading still inside STALE_MS is left alone, the same rule the
  // staleness poll below applies.
  useEffect(() => {
    if (!INITIAL_CITY) return
    if (!weather) { fetchWeather(INITIAL_CITY); return }
    if (Date.now() - (lastUpdated?.getTime() ?? 0) < STALE_MS) return
    refreshingRef.current = true
    Promise.resolve(fetchWeather(INITIAL_CITY, { silent: true }))
      .finally(() => { refreshingRef.current = false })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the reading current while the app is open.
  //
  // Weather was fetched exactly once per location — on mount, or when one was
  // picked — and never again without a tap on refresh. A tab left open or a PWA
  // resumed from the background therefore kept showing the sky as it was when it
  // was last opened, with no indication beyond the "Updated N min ago" line. That
  // is the inconsistency between the cards and the radar: WeatherRadar fetches
  // its own frames every time it mounts, so the map was live while the condition
  // card was hours old — over Bel Air MD it read "Slight Rain" (a station report
  // from a shower that had since passed) beside a radar showing nothing at all.
  //
  // Refetch silently once the reading is older than a radar sweep, on whichever
  // comes first: the app coming back to the foreground, or the poll below. Both
  // check staleness rather than acting outright, so switching tabs a dozen times
  // costs nothing.
  useEffect(() => {
    if (!location || !weather) return
    const refreshIfStale = () => {
      if (document.hidden || refreshingRef.current) return
      if (Date.now() - (lastUpdated?.getTime() ?? 0) < STALE_MS) return
      refreshingRef.current = true
      Promise.resolve(fetchWeather(location, { silent: true }))
        .finally(() => { refreshingRef.current = false })
    }
    const timer = setInterval(refreshIfStale, STALE_CHECK_MS)
    document.addEventListener('visibilitychange', refreshIfStale)
    window.addEventListener('focus', refreshIfStale)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', refreshIfStale)
      window.removeEventListener('focus', refreshIfStale)
    }
  }, [location, weather, lastUpdated, fetchWeather])

  // Close search overlay on Escape key
  useEffect(() => {
    if (!searchOpen) return
    const handler = (e) => { if (e.key === 'Escape') closeSearch() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [searchOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  // Escape closes the settings modal — the dialog behaviour a desktop user
  // expects, and the web app is the only shell that draws one. It goes through
  // history like every other way out of settings, so with a sub-page open it
  // steps back to the main list first rather than dropping the whole modal.
  useEffect(() => {
    if (!showSettings || !webLayout) return
    const handler = (e) => { if (e.key === 'Escape') closeSettings() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [showSettings, webLayout]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fly splash logo to header when weather arrives; dismiss immediately on error.
  //
  // The first forecast of a session mounts every page (and pulls in their code
  // and icons) in the same frame the exit animation would start, which made
  // that first fly-out stutter. So the first time, the splash holds still for a
  // beat with the forecast mounting behind it, and only then flies — by which
  // point the heavy work is done and the animation has the main thread to
  // itself. Later openings are already warm and go straight away.
  const firstOpenRef = useRef(true)
  const [splashHold, setSplashHold] = useState(false)
  useEffect(() => {
    if (splashPhase !== 'visible') return
    if (error && !weather) { setSplashHold(false); setSplashPhase('done'); return }
    if (!weather) return
    if (!firstOpenRef.current) { setSplashHold(false); setSplashPhase('exit'); return }
    firstOpenRef.current = false
    setSplashHold(true)
    const t = setTimeout(() => { setSplashHold(false); setSplashPhase('exit') }, 450)
    // A later source landing on the reading re-runs this effect; with the ref
    // spent it then exits at once rather than leaving the splash stuck.
    return () => clearTimeout(t)
  }, [weather, error]) // eslint-disable-line react-hooks/exhaustive-deps

  // The first place picked in a session opens on Today (the overview) rather
  // than whichever page was last left open. Once any forecast has been shown —
  // including one restored on launch — picks keep the current page.
  const firstPickRef = useRef(true)
  useEffect(() => { if (weather) firstPickRef.current = false }, [weather])
  const landFirstPick = () => {
    if (!firstPickRef.current || weather) return
    firstPickRef.current = false
    if (webTab !== 'today') setWebTab('today')
  }

  // The exit's end is timed off the phase, not off the weather. It used to live
  // in the effect above, whose cleanup ran whenever `weather` changed — and the
  // forecast does update again within the exit's 700ms (a later source landing
  // on the first reading), which cancelled the timer with nothing to re-arm it
  // and left the splash stuck over the forecast.
  useEffect(() => {
    if (splashPhase !== 'exit') return
    const t = setTimeout(() => setSplashPhase('done'), 700)
    return () => clearTimeout(t)
  }, [splashPhase])

  // On desktop with no city loaded, any printable key press opens search pre-filled
  // with that character so the user can just start typing immediately. The web
  // splash is the exception: it carries its own search field, and seeds that
  // instead of opening the overlay on top of it.
  useEffect(() => {
    // Nor on the Locations or Settings page, where a key press is meant for the page.
    if (!isDesktop || weather || loading || searchOpen || webSplash || navPageUp) return
    const handler = (e) => {
      if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return
      setSearchInitialQuery(e.key)
      history.pushState({ overlay: 'search' }, '')
      setSearchOpen(true)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isDesktop, weather, loading, searchOpen, webSplash, navPageUp])

  // Hardware back button / Android back gesture
  useEffect(() => {
    const handler = () => {
      // Back pressed while the cog or the glass is still animating just stops
      // the animation; the page itself is already open and closes below.
      if (settingsOpenTimer.current) {
        clearTimeout(settingsOpenTimer.current)
        settingsOpenTimer.current = null
        setSettingsOpening(false)
      }
      if (searchOpenTimer.current) {
        clearTimeout(searchOpenTimer.current)
        searchOpenTimer.current = null
        setSearchSweeping(false)
      }
      // What closes is read from where history landed, not assumed to be one
      // level: dismissing the web app's settings modal from a sub-page pops
      // both of its entries at once, and that has to close the whole thing
      // rather than surface the list underneath.
      if (subView && history.state?.overlay === 'settings') setSubView(null)
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

  const changeUnitGroup = (group, value) => {
    setUnits(prev => ({ ...prev, [group]: value }))
    saveUnit(group, value)
  }

  const changeShowOverview = (val) => {
    setShowOverview(val)
    localStorage.setItem(SHOW_OVERVIEW_KEY, String(val))
    // Turning the overview back on while every content part is off would leave
    // an empty card, so restore all three parts when there's nothing to show.
    if (val && !overviewParts.insight && !overviewParts.conditions && !overviewParts.clothing) {
      const next = { ...overviewParts, insight: true, conditions: true, clothing: true }
      setOverviewParts(next)
      localStorage.setItem(OVERVIEW_PARTS_KEY, JSON.stringify(next))
    }
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
      // With insight, conditions, and clothing all off there's nothing left to
      // show, so switch the whole overview tile off.
      if (!next.insight && !next.conditions && !next.clothing) {
        setShowOverview(false)
        localStorage.setItem(SHOW_OVERVIEW_KEY, 'false')
      }
      return next
    })
  }

  const changeWeatherAnimations = (val) => {
    setWeatherAnimations(val)
    localStorage.setItem('alek-weather-animations', String(val))
  }

  const changeIconMotion = (val) => {
    setIconMotion(val)
    localStorage.setItem(ICON_MOTION_KEY, String(val))
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

  const changeRadarMode = (mode) => {
    setRadarMode(mode)
    localStorage.setItem(RADAR_MODE_KEY, mode)
  }

  const changeRadarSource = (src) => {
    setRadarSource(src)
    localStorage.setItem(RADAR_SOURCE_KEY, src)
  }

  const changeDarkMode = (mode) => {
    setDarkMode(mode)
    localStorage.setItem(THEME_KEY, mode)
  }

  const changePlatformTheme = (mode) => {
    if (mode === 'web' && IS_PHONE) return
    if (mode !== 'web' && IS_DESKTOP) return
    if (mode === platformTheme) return
    const apply = () => {
      setPlatformTheme(mode)
      localStorage.setItem(PLATFORM_THEME_KEY, mode)
      // Switching to Web from the phone Settings page: Web keeps settings on
      // its own page (section list down the left), so land there in the same
      // commit. Left open, the phone page was re-skinned into a dialog
      // mid-switch and replayed its entrance animations.
      if (mode === 'web' && showSettings) {
        clearTimeout(settingsOpenTimer.current)
        settingsOpenTimer.current = null
        setSettingsOpening(false)
        setSettingsClosing(false)
        setShowSettings(false)
        setSubView(null)
        // The style picker lives under Appearance.
        try { localStorage.setItem('alek-weather-web-settings-section', 'appearance') } catch { /* storage unavailable */ }
        setWebPage('settings')
        if (splashPhase !== 'done') setSplashPhase('done')
        window.scrollTo({ top: 0, behavior: 'auto' })
        // Drop the history entries the phone page pushed (the page, plus the
        // Theme sub-page) so Back doesn't spend presses on a page that's gone.
        // Nothing is open by the time that popstate lands, so it closes nothing.
        history.go(subView ? -2 : -1)
      }
    }
    // Reduced motion: no cover, just the switch.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { apply(); return }

    // Changing style re-skins every surface at once, and watching that happen
    // reads as the app glitching. So a full-screen cover comes up first, the
    // switch happens behind it, and it lifts to show the new style.
    styleCoverTimers.current.forEach(clearTimeout)
    setStyleCover({ to: mode, leaving: false })
    // The cover is position: fixed, which can't paint over the window's own
    // scrollbar lane (the web shell reserves one with scrollbar-gutter), so a
    // strip of page and scrollbar showed down its right edge. For as long as
    // the cover is fully opaque, data-style-cover takes the root's scrollbar
    // and lane away (see App.css), so the cover fills the window. It comes off
    // as the cover starts to lift, so the lane returns with the page it
    // belongs to.
    const root = document.documentElement
    styleCoverTimers.current = [
      setTimeout(() => { root.dataset.styleCover = mode; apply() }, STYLE_COVER_IN_MS),
      // A beat after the switch, so the new style has painted before it shows.
      setTimeout(() => {
        delete root.dataset.styleCover
        setStyleCover(c => c && { ...c, leaving: true })
      }, STYLE_COVER_IN_MS + STYLE_COVER_HOLD_MS),
      setTimeout(() => setStyleCover(null), STYLE_COVER_IN_MS + STYLE_COVER_HOLD_MS + STYLE_COVER_OUT_MS),
    ]
  }

  const changeMaterialColor = (hex) => {
    if (hex === SYSTEM_SEED) {
      setMaterialColor(SYSTEM_SEED)
      localStorage.setItem(MATERIAL_COLOR_KEY, SYSTEM_SEED)
      return
    }
    if (!isValidSeed(hex)) return
    const seed = hex.toLowerCase()
    setMaterialColor(seed)
    localStorage.setItem(MATERIAL_COLOR_KEY, seed)
  }

  const changeCardTransparency = (pct) => {
    setCardTransparency(pct)
    localStorage.setItem(CARD_TRANSPARENCY_KEY, String(pct))
  }

  const openSettings = () => {
    if (showSettings) return
    // The page opens on the tap itself. It used to wait for the cog to finish
    // turning first, and that wait read as lag. The cog still turns, alongside
    // the page's circle reveal; the timer only ends that animation.
    setSubView(null)
    history.pushState({ overlay: 'settings' }, '')
    setShowSettings(true)
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    clearTimeout(settingsOpenTimer.current)
    setSettingsOpening(true)
    settingsOpenTimer.current = setTimeout(() => {
      settingsOpenTimer.current = null
      setSettingsOpening(false)
    }, SETTINGS_OPEN_MS)
  }

  const doCloseSettings = () => {
    setSettingsClosing(true)
    setTimeout(() => { setShowSettings(false); setSettingsClosing(false); setSubView(null) }, SETTINGS_CLOSE_MS)
  }

  const closeSettings = () => history.back()

  // Leave settings entirely, from wherever inside it you are. Back and Escape
  // step up a level (a sub-page hands you back to the list); this is for the
  // gestures that mean "out": the modal's backdrop and its close button.
  const dismissSettings = () => history.go(subView ? -2 : -1)

  const openSubView = (view) => {
    history.pushState({ overlay: 'subview' }, '')
    setSubView(view)
  }

  const closeSubView = () => history.back()

  // Called straight from a click (the empty state, the location error's link),
  // the page grows out of whatever was tapped. The magnifier sets its own origin
  // and calls this with no event, after its sweep.
  const openSearch = (e) => {
    if (e?.currentTarget) setRevealOrigin(e.currentTarget)
    history.pushState({ overlay: 'search' }, '')
    setSearchOpen(true)
  }

  // Opening search *from the magnifier*, which is the only entry point with an
  // icon to animate. Search opens on the tap itself, as settings does; it used to
  // wait for the glass to finish sweeping, and that wait read as lag. The sweep
  // still plays alongside the reveal, and the timer only ends it.
  const sweepThenOpenSearch = () => {
    if (searchOpen) return
    openSearch()
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    clearTimeout(searchOpenTimer.current)
    setSearchSweeping(true)
    searchOpenTimer.current = setTimeout(() => {
      searchOpenTimer.current = null
      setSearchSweeping(false)
    }, SEARCH_OPEN_MS)
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

  const handleSearchButton = (e) => {
    // Swallow the click that trails a completed hold so it doesn't also open search.
    if (searchLongPressed.current) { searchLongPressed.current = false; return }
    setRevealOrigin(e?.currentTarget)
    if (splashPhase !== 'done') {
      // On the web, the places you've been are a page of their own now.
      if (webLayout) openNavPage('locations')
      else openSaved()
      return
    }
    sweepThenOpenSearch()
  }

  useEffect(() => () => clearTimeout(searchHoldTimer.current), [])

  // Settings opens on the tap now, with no cog turn to hide a download behind,
  // so its chunk is warmed once the app has gone idle after first paint rather
  // than only on pointerdown (which still runs, for a tap that beats this).
  useEffect(() => {
    const ric = window.requestIdleCallback
    if (ric) {
      const id = ric(() => preloadSettings(), { timeout: 3000 })
      return () => window.cancelIdleCallback?.(id)
    }
    const t = setTimeout(preloadSettings, 1500)
    return () => clearTimeout(t)
  }, [])

  // Tactile press for the round icon buttons (PRESS_DIP_SELECTOR): data-pressed
  // goes on at the touch and comes off at release, but never sooner than
  // PRESS_DIP_MIN_MS after it went on, so even the quickest tap shows the full
  // dip and spring-back. Written straight onto the node, not held in state, so a
  // press never re-renders anything. One listener on the document covers all
  // four buttons, wherever they are rendered.
  useEffect(() => {
    let pressed = null
    let downAt = 0
    let releaseTimer = 0
    const release = () => {
      const el = pressed
      if (!el) return
      pressed = null
      const wait = Math.max(0, PRESS_DIP_MIN_MS - (performance.now() - downAt))
      releaseTimer = setTimeout(() => el.removeAttribute('data-pressed'), wait)
    }
    const onDown = (e) => {
      const el = e.target.closest?.(PRESS_DIP_SELECTOR)
      if (!el) return
      clearTimeout(releaseTimer)
      if (pressed && pressed !== el) pressed.removeAttribute('data-pressed')
      pressed = el
      downAt = performance.now()
      el.setAttribute('data-pressed', '')
    }
    document.addEventListener('pointerdown', onDown, { passive: true })
    document.addEventListener('pointerup', release, { passive: true })
    document.addEventListener('pointercancel', release, { passive: true })
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('pointerup', release)
      document.removeEventListener('pointercancel', release)
      clearTimeout(releaseTimer)
    }
  }, [])

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

  // The splash's own search field and location cards are inline rather than in
  // the overlay, so nothing has been pushed onto the history stack and these
  // skip the closeSearch() the overlay handlers above end with.
  const handleSplashSearchSelect = (city) => {
    landFirstPick()
    addRecent(city)
    selectCity(city)
  }

  // Coming back out of Home to the place you just left is the common case, and
  // its reading is still in storage: show that at once and refresh it in place
  // if it is stale, the same as a launch, instead of the full fetch chain.
  const handleSplashCitySelect = (city) => {
    landFirstPick()
    addRecent(city)
    const updated = restoreReading(city)
    if (updated == null) { fetchWeather(city); return }
    if (Date.now() - updated < STALE_MS || refreshingRef.current) return
    refreshingRef.current = true
    Promise.resolve(fetchWeather(city, { silent: true }))
      .finally(() => { refreshingRef.current = false })
  }

  // The header's place line on the phone shells (see .app-place): the city
  // and its region, and today's date in the forecast's own timezone.
  const placeInHeader = !webLayout && splashPhase === 'done' && !!weather && !!location
  const placeLine = location
    ? [location.name, location.admin1 && location.admin1 !== location.name ? location.admin1 : null].filter(Boolean).join(', ')
    : ''
  const placeDate = weather
    ? new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', ...(weather.timezone ? { timeZone: weather.timezone } : {}) })
    : ''

  const handleLogoClick = () => {
    if (!weather || splashPhase !== 'done') return
    reset()
    setSplashPhase('visible')
  }

  // Opening Locations or Settings from the web tab bar. From Home this leaves
  // the splash outright, with no exit animation — that fade is the forecast
  // being revealed underneath, and there is no forecast behind this page.
  const openNavPage = (id) => {
    if (!webLayout) return
    setSubView(null)
    setWebPage(id)
    if (splashPhase !== 'done') setSplashPhase('done')
    window.scrollTo({ top: 0, behavior: 'auto' })
  }

  const closeNavPage = () => {
    setWebPage(null)
    setSubView(null)
  }

  // Home from the tab bar. From a forecast page it is the logo-tap; from
  // Locations or Settings with nothing loaded there is no forecast to drop, so
  // it just brings the splash back.
  const handleNavHome = () => {
    const wasOnPage = navPageUp
    closeNavPage()
    if (weather && splashPhase === 'done') handleLogoClick()
    else if (wasOnPage && splashPhase === 'done') setSplashPhase('visible')
  }

  // Picking a place on the Locations page opens its forecast on the page you
  // were last on, the same way the splash's cards do.
  const handleLocationsSelect = (city) => {
    closeNavPage()
    handleSplashCitySelect(city)
  }

  const hasActiveAlert = alerts.some(a =>
    a.properties?.severity === 'Extreme' || a.properties?.severity === 'Severe'
  )

  const liveCode = weather ? liveWeatherCode(weather.current, weather.minutely_15, radarClear) : null
  const skyC     = weather ? skyClass(liveCode, weather.current.is_day) : ''
  const skyLevel = SKY_LEVEL[skyC] ?? ''
  // The sky level class is what tints the cards toward the sky (and flips the
  // text on them to white to match). iOS and Web take it: a card left on its
  // own surface is a white hole punched in a dark scene there.
  //
  // Android never does. Its cards are Material You containers generated from
  // the seed colour, and that palette is the point of the style — it stays put
  // whether or not there is weather behind it, so the effects change the
  // backdrop and nothing else. Card Transparency is how the sky gets into the
  // stack under Android, and it runs off --md-card-alpha, not off this class.
  //
  // Everything else about an active sky is unaffected, since .sky-active is set
  // independently — the header, hero and search chrome go on reading over the
  // backdrop as they already do on a clear day, which is the one sky with no
  // level class of its own.
  const levelC   = platformTheme === 'android' ? '' : skyLevel

  // The splash dresses itself in the weather of the most recently opened place
  // (where the device is, when nothing has been opened yet): that sky behind it
  // (with its rain/snow/fog canvas) and that condition's icon in place of the
  // logo. Opening a place puts it first in recents, so going Home afterwards
  // shows that place's weather. The sky follows the Weather Effects setting like
  // the forecast's does; the icon is just an icon, so it shows either way.
  const localCond   = useLocalConditions(splashPhase !== 'done', recents[0] ?? null)
  const splashSkyC  = localCond && weatherAnimations ? skyClass(localCond.code, localCond.isDay) : ''
  const splashIcon  = localCond ? getWeatherInfo(localCond.code, !localCond.isDay, localCond.severe) : null

  // Published on <html> because the surfaces that have to react to the splash
  // sky live in different trees: the header buttons inside .app, the location
  // cards beside it. "dark" for the skies the forecast tints its cards for most
  // heavily (night, rain, storm), which is where a light-mode surface glares.
  const splashSkyTone = splashSkyC && splashPhase !== 'done'
    ? (SKY_LEVEL[splashSkyC] === 'sky-lvl-dark' || SKY_LEVEL[splashSkyC] === 'sky-lvl-darkest' ? 'dark' : 'light')
    : ''
  useEffect(() => {
    const root = document.documentElement
    if (splashSkyTone) root.dataset.splashSky = splashSkyTone
    else delete root.dataset.splashSky
  }, [splashSkyTone])

  // Keep the theme-color metas (status bar) and the body background (navigation
  // bar) matched to the sky, or to the flat app background when effects are
  // off, so both Android system bars stay consistent with what is behind them.
  useEffect(() => {
    const metas = document.querySelectorAll('meta[name="theme-color"]')
    const skyActive = weather && weatherAnimations && skyC && SKY_THEME_COLOR[skyC]
    const apply = (dark) => {
      const color = skyActive ? SKY_THEME_COLOR[skyC][dark ? 1 : 0] : (dark ? '#000000' : '#f0f2f5')
      metas.forEach(m => { m.content = color })
      // The navigation bar only honors the page background when the document's
      // color-scheme matches the effective theme; set it on the root so it also
      // wins when the in-app theme overrides the system one.
      document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
      // Clearing the inline style hands body back to var(--bg), which already
      // tracks the theme. The sky layer covers the viewport, so this override
      // is invisible to everything except the system bar.
      document.body.style.backgroundColor = skyActive ? SKY_NAV_COLOR[skyC][dark ? 1 : 0] : ''
    }
    if (darkMode === 'on')  { apply(true);  return }
    if (darkMode === 'off') { apply(false); return }
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    apply(mq.matches)
    const handler = (e) => apply(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [darkMode, skyC, weather, weatherAnimations])

  const blockComponents = weather && !loading ? {
    overview: <WeatherOverview hourly={weather.hourly} daily={weather.daily} current={weather.current} minutely={weather.minutely_15} radarClear={radarClear} timezone={weather.timezone} hasActiveAlert={hasActiveAlert} unit={unit} units={units} airQuality={airQuality} showInsight={overviewParts.insight} showConditions={overviewParts.conditions} showAirQuality={overviewParts.airQuality} showClothing={overviewParts.clothing} colorCode={colorCoding.overview} />,
    hourly:  <HourlyForecast hourly={weather.hourly} timezone={weather.timezone} unit={unit} colorCoding={colorCoding.hourly} glow={colorCoding.glow} frost={colorCoding.frost} current={weather.current} minutely={weather.minutely_15} radarClear={radarClear} />,
    daily:   <DailyForecast daily={weather.daily} hourly={weather.hourly} timezone={weather.timezone} unit={unit} units={units} colorCoding={colorCoding.daily} glow={colorCoding.glow} frost={colorCoding.frost} current={weather.current} minutely={weather.minutely_15} radarClear={radarClear} />,
    details: <WeatherDetails current={weather.current} daily={weather.daily} hourly={weather.hourly} timezone={weather.timezone} unit={unit} units={units} airQuality={airQuality} colorCoding={colorCoding.details} />,
    radar:   <WeatherRadar location={location} timezone={weather.timezone} mode={radarMode} source={radarSource} sky={weatherAnimations ? skyC : ''} rainFx={weatherAnimations} snow={isSnowing(weather.current)} />,
    nowcast: <PrecipNowcast minutely={weather.minutely_15} currentTime={weather.current.time} mode={nowcastMode} current={weather.current} radarClear={radarClear} />,
  } : null

  // The tab bar takes the logo's place in the header, but only once there is
  // something to navigate: with no city loaded, and while the splash logo is
  // still flying into the header, the header keeps its wordmark.
  //
  // Deliberately not gated on `loading`. A city switch keeps the previous
  // reading in state while the next one is fetched, so gating on it tore the
  // bar out mid-switch and slid the wordmark back in, only to reverse both a
  // moment later — a header jump on top of the page one. The tabs stay, the
  // skeleton under them follows whichever is selected, and switching pages
  // mid-fetch stays possible. First load is still covered: `weather` is null
  // until data arrives, so there is genuinely nothing to navigate yet.
  //
  // Locations and Settings need no forecast, so either of them keeps the bar up
  // on its own — they can be opened from Home before anything has loaded.
  const headerTabs = webLayout && splashPhase === 'done' && (!!weather || navPageUp)

  // The tab bar also stays up over the web splash, with Home selected, so going
  // between the splash and the forecast is the pill sliding along one bar
  // rather than a bar appearing and disappearing. It is the same element across
  // the handoff (rendered in one place, under one condition), which is what
  // keeps it from remounting. See .app--web-splash for how it gets above the
  // splash layer.
  //
  // From the splash, a page tab opens the place you'd most likely mean: home,
  // else the last one looked at, else the first saved, else where the device
  // was found. The bar is up on the web splash even with none of those (a
  // first visit, or after a reset) — it used to drop, and the splash fell back
  // to the old corner-button header until a forecast arrived. With nowhere to
  // go its forecast tabs are offered disabled (navTabs below); Locations and
  // Settings still work.
  const navCity = home ?? recents[0] ?? cities[0] ?? (localCond?.name ? locatedPlace() : null)
  const showNav = headerTabs || webSplash

  // The Radar tab's full-bleed layout. On from the moment the splash starts
  // fading as well as once it has gone: the forecast is revealed under the fade,
  // and gating this on headerTabs alone showed the radar as an ordinary card for
  // the length of the fade before it snapped out to fill the page.
  const radarPageUp = webLayout && !!weather && !navPageUp && webTab === 'radar' && (headerTabs || splashPhase === 'exit')
  // On Locations or Settings with nothing loaded and nowhere to load (a first
  // visit that went straight to Settings), the forecast tabs have nothing to
  // open, so they are offered but disabled.
  const navTabs = !weather && !navCity ? WEB_TABS.map(t => ({ ...t, disabled: true })) : WEB_TABS
  // Home while the splash is idle. Once a place is picked the pill moves to the
  // page it will open on, while the forecast loads behind the splash.
  const navActive = navPageUp ? webPage
    : webSplash && splashPhase === 'visible' && !loading && !splashHold ? 'home' : webTab
  const handleNavTab = (id) => {
    const fromPage = navPageUp
    closeNavPage()
    // Choosing a page is choosing where to land, so the first-pick default
    // (Today) doesn't override it.
    firstPickRef.current = false
    setWebTab(id)
    // Nothing loaded yet (from the splash, or from Locations/Settings opened
    // off it): open the place you'd most likely mean on the chosen page.
    if (!weather && !loading && navCity && ((webSplash && splashPhase === 'visible') || fromPage)) {
      handleSplashCitySelect(navCity)
    }
  }
  // Locations leads the bar as a pin and Settings trails it as a gear, each
  // behind a divider. The labels become their tooltips and accessible names.
  const navLead = { id: 'locations', label: 'Locations', icon: <MapPin size={18} aria-hidden="true" />, onSelect: () => openNavPage('locations') }
  const navPages = [
    { id: 'settings', label: 'Settings', icon: <SettingsIcon size={18} aria-hidden="true" />, onSelect: () => openNavPage('settings') },
  ]
  // With the bar up, Locations and Settings are in it, so the header's corner
  // buttons for them (the building on Home, the cog everywhere) go. Search
  // stays: the magnifier on a forecast page has no tab of its own. When the bar
  // is down (Home with no places yet) the corner buttons are the only way in,
  // so they stay too.
  const navOwnsCorners = webLayout && showNav

  // Half the page scrollbar's width, for centring the tab bar on the window
  // rather than on the page (see .web-tabs-row in WebApp.css). The forecast
  // scrolls and the splash doesn't, so centred on the page the bar stepped
  // sideways by half a scrollbar at every handoff. Observing <html> catches the
  // scrollbar coming and going as well as window resizes, and the observer runs
  // before paint, so the bar is never drawn in the old spot.
  useEffect(() => {
    if (!webLayout) return
    const root = document.documentElement
    const ro = new ResizeObserver(() => {
      // The lane the layout reserves, not the scrollbar on screen: on the splash
      // (overflow: hidden) clientWidth reports the full window while
      // scrollbar-gutter: stable still holds the lane, so this read 0 there and
      // the bar stepped half a lane left going Home. <html>'s own box is what
      // the page is laid out in.
      const gutter = Math.max(0, Math.round(window.innerWidth - root.getBoundingClientRect().width))
      root.style.setProperty('--scrollbar-half', `${gutter / 2}px`)
      // The width of the lane itself, kept from the last time there was one: the
      // Radar tab gives the lane to the map, and the header pads itself by this
      // much so nothing in it moves when the scrollbar goes (see WebApp.css).
      if (gutter > 0) root.style.setProperty('--scrollbar-w', `${gutter}px`)
    })
    ro.observe(root)
    return () => {
      ro.disconnect()
      root.style.removeProperty('--scrollbar-half')
      root.style.removeProperty('--scrollbar-w')
    }
  }, [webLayout])

  // --web-header-h is what everything parked under the sticky header offsets
  // itself by: the Hourly page's own sticky column head (top) and the radar's
  // full-bleed map (min-height). It used to be a hard-coded 92px, the sum of
  // the header's parts at the one width the web app ran at. The tab bar now
  // scales with the viewport, so that arithmetic drifts — and a value even a
  // few pixels too large opens a band between the header and the column head
  // that rows scroll through in the open. Measuring the header is right at
  // every width, and survives a font swap or a longer tab label. Written to
  // .app (the header's parent) because that is the element carrying the
  // fallback in WebApp.css, so the two never disagree about scope.
  //
  // Declared here rather than beside the other layout effects: it reads
  // headerTabs, so it has to come after that is computed.
  useEffect(() => {
    const el = headerRef.current
    if (!el || !headerTabs) return
    const ro = new ResizeObserver(([entry]) => {
      // Ceil, not round: the header's height is fractional at most zoom levels,
      // and rounding down parks the sticky column head half a pixel above the
      // header's real bottom edge, which is enough to show a hairline of the
      // rows scrolling behind it. Erring tall costs nothing visible.
      const h = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height
      el.parentElement?.style.setProperty('--web-header-h', `${Math.ceil(h)}px`)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [headerTabs])

  // Everything the settings screen reads and writes. Shared by the phone
  // shells' settings page and the web app's Settings tab.
  const settingsProps = {
    // The desktop layout doesn't render the overview tile (see TodayPage), so
    // its settings come out with it rather than sitting there as controls for
    // something that isn't on the page.
    webShell: webLayout,
    darkMode,
    onDarkModeChange: changeDarkMode,
    platformTheme,
    onPlatformThemeChange: changePlatformTheme,
    materialColor,
    onMaterialColorChange: changeMaterialColor,
    cardTransparency,
    onCardTransparencyChange: changeCardTransparency,
    unit,
    onUnitChange: changeUnit,
    units,
    onUnitGroupChange: changeUnitGroup,
    showOverview,
    onShowOverviewChange: changeShowOverview,
    nowcastMode,
    onNowcastModeChange: changeNowcastMode,
    colorCoding,
    onColorCodingToggle: toggleColorCoding,
    overviewParts,
    onOverviewPartToggle: toggleOverviewPart,
    weatherAnimations,
    onWeatherAnimationsChange: changeWeatherAnimations,
    iconMotion,
    onIconMotionChange: changeIconMotion,
    iconSet,
    onIconSetChange: setIconSet,
    gyroscope,
    onGyroscopeChange: changeGyroscope,
    radarEnhanced,
    onRadarEnhancedChange: changeRadarEnhanced,
    radarMode,
    onRadarModeChange: changeRadarMode,
    radarSource,
    onRadarSourceChange: changeRadarSource,
    installPrompt,
    onInstall: handleInstall,
    notifyEnabled,
    notifyTypes,
    notifyPermission,
    onNotifyEnabledChange: toggleNotifyEnabled,
    onNotifyTypeToggle: toggleType,
  }

  const weatherPanel = weather && !loading && !navPageUp && (webLayout ? (
    <WebLayout
      tab={webTab}
      onNavigate={setWebTab}
      weather={weather}
      location={location}
      airQuality={airQuality}
      alerts={alerts}
      unit={unit}
      units={units}
      radarClear={radarClear}
      lastUpdated={lastUpdated}
      loading={loading}
      colorCoding={colorCoding}
      weatherAnimations={weatherAnimations}
      overviewParts={overviewParts}
      showOverview={showOverview}
      nowcastMode={nowcastMode}
      radarMode={radarMode}
      radarSource={radarSource}
      hasActiveAlert={hasActiveAlert}
      saved={isSaved(location)}
      onSave={() => save(location)}
      onRemove={() => remove(location)}
      isHome={isHome(location)}
      hasHome={!!home}
      onGoHome={() => { if (home) fetchWeather(home) }}
      onSetHome={() => setHome(location)}
      onUnsetHome={unsetHome}
      onRefresh={() => fetchWeather(location)}
    />
  ) : (
    <>
      <div className="weather-left">
        <WeatherAlerts alerts={alerts} location={location} />
        <CurrentWeather
          // The phone shells show the city and date in the header, and keep
          // home and save on the search page, so the card starts at the icon.
          hideHeader
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
  ))

  return (
    <>
      {weather && weatherAnimations && <div className={`sky-bg ${skyC}`} aria-hidden="true" />}
      {weather && weatherAnimations && <WeatherCanvas code={liveCode} gyro={gyroscope} />}
    <div
      className={`app${weatherAnimations && levelC ? ` ${levelC}` : ''}${!weatherAnimations ? ' no-effects' : ''}${weather && weatherAnimations ? ' sky-active' : ''}${headerTabs ? ' app--web-tabs' : ''}${radarPageUp ? ' app--web-radar' : ''}${webSplash ? ' app--web-splash' : ''}${webSplash && splashPhase === 'exit' ? ' app--web-splash-exit' : ''}${webLayout && splashPhase !== 'visible' ? ' app--revealed' : ''}`}
      style={weather && weatherAnimations ? SKY_CARD_VARS[skyC] : undefined}
    >
      <header ref={headerRef} className={`app-header${!weather && !showNav ? ' app-header--no-city' : ''}${showNav ? ' app-header--tabs' : ''}`}>
                {/* Backdrop for the sticky tab bar. It repaints the same sky gradient
            as .sky-bg, anchored to the viewport the same way (see .header-sky
            in WebApp.css), so it is opaque enough to hide the page scrolling
            beneath it while being invisible against the sky itself. */}
        {headerTabs && weather && weatherAnimations && (
          <div className={`header-sky ${skyC}`} aria-hidden="true" />
        )}
        {/* The weather effects, over that sky. WeatherCanvas copies the slice of
            itself the header covers into this each frame — see mirrorToHeader. */}
        {headerTabs && weather && weatherAnimations && (
          <canvas className="header-fx" aria-hidden="true" />
        )}
        <button
          className={`header-icon-btn${searchHolding ? ' header-icon-btn--holding' : ''}${searchSweeping ? ' is-searching' : ''}${navOwnsCorners ? ' header-btn--gone' : ''}`}
          style={{ '--long-press-ms': `${LONG_PRESS_MS}ms`, '--glass-sweep-ms': `${SEARCH_OPEN_MS}ms` }}
          onClick={handleSearchButton}
          onPointerDown={startSearchHold}
          onPointerUp={endSearchHold}
          onPointerLeave={endSearchHold}
          onPointerCancel={endSearchHold}
          onContextMenu={(e) => e.preventDefault()}
          aria-label="Search — hold to use my location"
        >
          <span className="header-search-icons">
            {/* The phone shells draw these from Phosphor
                (see headerGlyphs.jsx); the web layout keeps its line icons. */}
            {(() => {
              const LocIcon = webLayout ? Building2 : BuildingsIcon
              const FindIcon = webLayout ? Search : SearchIcon
              return (
                <>
                  <LocIcon size={24} style={{ opacity: splashPhase !== 'done' ? 1 : 0, pointerEvents: splashPhase !== 'done' ? undefined : 'none' }} />
                  <FindIcon size={24} style={{ opacity: splashPhase === 'done' ? 1 : 0, pointerEvents: splashPhase === 'done' ? undefined : 'none' }} />
                </>
              )
            })()}
          </span>
        </button>
        <div className="app-title-wrapper">
          {/* The wordmark stays mounted through the handoff: it is the element
              the splash logo flies into, so it has to exist and finish landing
              before the tab bar cross-fades over it. */}
          <span
            className={`app-title${placeInHeader ? ' app-title--behind-place' : ''}${splashPhase === 'visible' ? ' app-title--splash' : ''}${splashPhase === 'exit' ? ' app-title--splash-exit' : ''}${splashPhase === 'done' && weather ? ' app-title--home' : ''}${showNav ? ' app-title--handed-off' : ''}`}
            onClick={handleLogoClick}
            role={splashPhase === 'done' && weather ? 'button' : undefined}
            aria-label={splashPhase === 'done' && weather ? 'Go to home' : undefined}
            aria-hidden={showNav || placeInHeader || undefined}
          >Alek Weather</span>
          {/* Phone shells: once a forecast is up, the place and date take the
              wordmark's spot. The wordmark stays mounted underneath, invisible,
              since it is what the splash logo flies into. Tapping the place
              does what tapping the wordmark did: back to the home screen. */}
          {placeInHeader && (
            <span
              className="app-place"
              onClick={handleLogoClick}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleLogoClick() } }}
              aria-label={`${placeLine}, ${placeDate}. Go to home`}
            >
              <span className="app-place-name">{placeLine}</span>
              <span className="app-place-date">{placeDate}</span>
            </span>
          )}
          {showNav && (
            <div className="web-tabs-row">
              <WebTabs
                tabs={navTabs} active={navActive} onChange={handleNavTab}
                // Back to the splash — the logo-tap the phone shells use, which
                // the web app can't offer because the tab bar has taken the
                // logo's place. On the splash itself it is the selected page.
                home={{ label: 'Home', icon: <House size={17} aria-hidden="true" />, onSelect: handleNavHome }}
                pages={navPages}
                lead={navLead}
              />
              {headerTabs && weather && <WebAlertPill alerts={alerts} tab={navPageUp ? webPage : webTab} location={location} />}
            </div>
          )}
        </div>
        <button
          className={`settings-btn${settingsOpening ? ' is-opening' : ''}${navOwnsCorners ? ' header-btn--gone' : ''}`}
          style={{ '--cog-spin-ms': `${SETTINGS_OPEN_MS}ms` }}
          onPointerDown={preloadSettings}
          // On the web, Settings is a page in the tab bar; the cog opens it there.
          onClick={webLayout ? () => openNavPage('settings') : showSettings ? closeSettings : (e) => { setRevealOrigin(e.currentTarget); openSettings() }}
          aria-label="Settings"
        >
          {/* Gear on the phone styles; the web layout keeps the sliders. */}
          {webLayout ? <SlidersIcon size={22} /> : <GearIcon size={22} className="settings-gear" />}
        </button>
      </header>

      <div className="app-grid">
        <main className="main-content">
          {navPageUp && (
            <div className="weather-content weather-content--web">
              <div className="web-shell">
                {webPage === 'settings' ? (
                  <SettingsPage page {...settingsProps} />
                ) : (
                  <LocationsPage
                    home={home}
                    recents={recents}
                    cities={cities}
                    currentLocation={weather ? location : null}
                    unit={unit}
                    onSelect={handleLocationsSelect}
                    onRemoveHome={() => setHome(null)}
                    onRemoveRecent={removeRecent}
                    onRemoveSaved={remove}
                  />
                )}
              </div>
            </div>
          )}
          {loading && !navPageUp && (webLayout ? <WebLoadingScreen tab={webTab} /> : <LoadingScreen />)}
          {error && !loading && !navPageUp && (
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
          {!weather && !loading && !error && !navPageUp && splashPhase === 'done' && (
            <div className="empty-state" onClick={openSearch} role="button" aria-label="Search for a location">
              <MapPin size={72} className="empty-pin-icon" />
              <p className="empty-text">{isDesktop ? 'Click anywhere or begin typing to search for a city' : 'Tap to find a location'}</p>
            </div>
          )}
          <div className={`weather-content${webLayout ? ' weather-content--web' : ''}`}>
            {weatherPanel}
          </div>
        </main>

        {/* With the tab bar occupying the header, the wordmark moves to the
            foot of the page. It keeps the header logo's job: click to drop the
            current city and go back to the start. The Radar tab is the one
            exception — the map is the whole page there, so there is no foot for
            it to sit at. Settings is the other: its About section already
            carries the name and version, so a second copy under every
            section was only clutter (and extra scroll). */}
        {headerTabs && (navPageUp ? webPage !== 'settings' : webTab !== 'radar') && (
          <footer className="web-footer">
            <span
              className="web-footer-mark"
              onClick={handleLogoClick}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleLogoClick() } }}
              aria-label="Go to home"
            >Alek Weather</span>
            <span className="web-footer-version">Version {APP_VERSION}</span>
          </footer>
        )}
      </div>

      {/* Splash screen — big logo centered, animates to header on city select */}
      {splashPhase !== 'done' && (
        <>
          {/* The splash is decorative on the phone styles, where the whole thing
              is one big "tap to search" target. The web splash puts a real
              search field and location cards on it, so it can't be hidden from
              assistive tech there — only the scenery inside it is. */}
          <div className={`splash-bg${webSplash ? ' splash-bg--web' : ''}${splashSkyC ? ' splash-bg--sky' : ''}`} aria-hidden={webSplash ? undefined : true}>
            {/* First child so the scenery and content after it paint on top;
                its z-index also keeps the canvas inside it under them. */}
            {splashSkyC && (
              <div className={`splash-sky ${splashSkyC}`} aria-hidden="true">
                <WeatherCanvas code={localCond.code} gyro={gyroscope} />
              </div>
            )}
            {splashIcon ? (
              <span
                className={`splash-logo-img splash-logo-icon${splashPhase === 'exit' ? ' splash-logo-img--exit' : ''}`}
                aria-hidden="true"
              >
                <WeatherIcon id={splashIcon.icon} />
              </span>
            ) : (
              <>
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
              </>
            )}
            <div className="splash-clouds" aria-hidden="true">
              <div className="splash-el e1" /><div className="splash-el e2" /><div className="splash-el e3" />
              <div className="splash-el e4" /><div className="splash-el e5" /><div className="splash-el e6" />
            </div>
            <div className={`splash-logo${splashPhase === 'exit' ? ' splash-logo--exit' : ''}`}>
              {/* This line is the weather itself ("Rain in 15 minutes"), on the
                  phone and the web splash alike; the wordmark has its own spot
                  (.splash-wordmark — the foot of the screen on the web, the
                  header row on the phone). Before the weather is known it is
                  the wordmark that sits here. */}
              <span className="splash-logo-text">
                {localCond?.headline ?? splashIcon?.label ?? (
                  // The web splash keeps its wordmark at the foot from the
                  // first frame, so this line says what it's doing instead of
                  // flashing the old big-wordmark layout while it loads.
                  webSplash && !localConditionsFailed(recents[0] ?? null) ? 'Checking the weather…' : 'Alek Weather'
                )}
              </span>
              {/* Names the place the sky and icon are showing. Out of flow (see
                  .splash-place) so it never moves the line the icon is anchored
                  to. When that place is a recent one its card carries the
                  location mark instead, so the pill is only there to name a
                  place found from the device. */}
              {!webSplash && splashIcon && !recents.length && localCond.name && (
                <span className="splash-place">
                  <Navigation size={13} aria-hidden="true" />
                  {localCond.name}
                </span>
              )}
            </div>
            {webSplash && (
              <SplashHome
                recents={recents}
                savedCities={cities}
                unit={unit}
                exiting={splashPhase === 'exit'}
                busy={loading || splashHold}
                active={splashPhase === 'visible' && !showSettings && !savedOpen && !searchOpen}
                onSelect={handleSplashCitySelect}
                onRemoveRecent={removeRecent}
                onRemoveSaved={remove}
                onSearch={searchCity}
                searchResults={searchResults}
                onSelectResult={handleSplashSearchSelect}
                onUseLocation={() => { landFirstPick(); useMyLocation() }}
                onClearSearch={() => setSearchResults([])}
                isSaved={isSaved}
                isHome={isHome}
                // On the web the "where this weather is" pill sits under the
                // search field and opens that place's forecast.
                here={splashIcon && !recents.length && localCond?.name ? locatedPlace() : null}
              />
            )}
            <div className="splash-stars" aria-hidden="true">
              {STARS.map((s, i) => (
                <div key={i} className="splash-star" style={{ top: s.top, left: s.left, animationDuration: s.dur, animationDelay: s.delay }} />
              ))}
            </div>
            {/* Only once the weather has taken the line under the icon —
                until then that line is the wordmark, and two would be one too many. */}
            {(splashIcon || (webSplash && !localConditionsFailed(recents[0] ?? null))) && (
              <span className={`splash-wordmark${splashPhase === 'exit' ? ' splash-wordmark--exit' : ''}`}>Alek Weather</span>
            )}
            <p className="splash-version">Version {APP_VERSION}</p>
          </div>
          {splashPhase === 'visible' && !webSplash && (
            // Inert: .splash-bg lets taps through, so this only keeps them from
            // reaching the app hidden underneath. Tapping the poster does nothing.
            <div className="splash-overlay" aria-hidden="true" />
          )}
          {/* Outside .splash-bg on purpose: that layer is inert and sits under
              the overlay, so cards drawn inside it could not be tapped at all.
              A sibling after the overlay takes its own taps. */}
          {!webSplash && (
            <SplashCities
              recents={recents}
              savedCities={cities}
              unit={unit}
              exiting={splashPhase === 'exit'}
              busy={loading}
              onSelect={handleSplashCitySelect}
              isHome={isHome}
            />
          )}
        </>
      )}

      {/* Search overlay — slides down from top */}
      {searchOpen && (
        <>
          <div className={`search-backdrop${searchClosing ? ' closing' : ''}`} onClick={closeSearch} />
          <div className={`search-overlay${searchClosing ? ' closing' : ''}${!webLayout ? ' search-overlay--sheet' : ''}`}>
            {!webLayout ? (
              <SearchSheet
                barRef={searchAreaRef}
                initialQuery={searchInitialQuery}
                onBack={closeSearch}
                onSearch={searchCity}
                results={searchResults}
                onClear={() => { setSearchResults([]); setSearchInitialQuery('') }}
                onSelect={handleSelectCity}
                onSelectPlace={handleSavedCitySelect}
                onUseLocation={handleUseLocation}
                recents={recents}
                onRemoveRecent={removeRecent}
                cities={cities}
                onRemoveSaved={remove}
                home={home}
                onRemoveHome={() => setHome(null)}
                isSaved={isSaved}
                isHome={isHome}
                currentLocation={weather ? location : null}
                onSaveCurrent={() => save(location)}
                onUnsaveCurrent={() => remove(location)}
                onSetHomeCurrent={() => setHome(location)}
                onUnsetHomeCurrent={unsetHome}
              />
            ) : (
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
                isSaved={isSaved}
                isHome={isHome}
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
            )}
          </div>
        </>
      )}

      {/* The saved locations page, opened from the home screen's corner button,
          zooms out of it the way settings does: it is a .settings-page, so it
          shares the phone page transition (pageGrowIn in App.css). */}
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

      {/* Opaque sky layer behind the translucent settings page (iOS glass, or
          Android's thinned Material surfaces), above the app content — so the
          page shows only the sky, not the weather UI. Reuses the same gradient
          class as the main sky background. */}
      {showSettings && !webLayout && weather && weatherAnimations && (
        <div className={`settings-sky ${skyC}${settingsClosing ? ' closing' : ''}`} aria-hidden="true" />
      )}
      {/* The web app opens settings as a dialog over the page rather than as a
          full-screen page, so it gets a backdrop: it dims what the modal is
          covering, and clicking it is the other way out. Phone shells have no
          modal and no backdrop — there the page is the whole screen. */}
      {showSettings && webLayout && (
        <div
          className={`settings-backdrop${settingsClosing ? ' closing' : ''}`}
          /* Clicking away means leaving, not stepping up a level, so from a
             sub-page this pops that entry and the settings one together. */
          onClick={dismissSettings}
          aria-hidden="true"
        />
      )}
      {showSettings && (
        <SettingsPage
          modal={webLayout}
          onBack={closeSettings}
          onDismiss={dismissSettings}
          subView={subView}
          onColorCodingOpen={() => openSubView('colorcoding')}
          onOverviewOpen={() => openSubView('overview')}
          onRadarOpen={() => openSubView('radar')}
          onWeatherEffectsOpen={() => openSubView('effects')}
          onIconsOpen={() => openSubView('icons')}
          onThemeOpen={() => openSubView('theme')}
          onNotificationsOpen={() => openSubView('notifications')}
          onSubViewBack={closeSubView}
          {...settingsProps}
          closing={settingsClosing}
        />
      )}
      {/* APK only, and only once the splash is out of the way: the bar owns the
          bottom of the screen, and over a loading screen it reads as part of the
          loading rather than as something to act on. Mounting here is what starts
          its (throttled) check — see UpdateToast. */}
      {IS_ANDROID_APP && splashPhase === 'done' && <UpdateToast />}
      <div id="alert-portal-root" />
    </div>
      {styleCover && (
        <div
          className={`style-cover style-cover--${styleCover.to}${styleCover.leaving ? ' leaving' : ''}`}
          style={{ '--style-cover-in': `${STYLE_COVER_IN_MS}ms`, '--style-cover-out': `${STYLE_COVER_OUT_MS}ms` }}
          role="status"
          aria-label={`Switching to the ${STYLE_NAMES[styleCover.to]} style`}
        >
          <div className="style-cover-inner">
            <StyleCoverArt to={styleCover.to} />
            <span className="style-cover-mark">Theme switching to…</span>
            <span className="style-cover-name">{STYLE_NAMES[styleCover.to]}</span>
          </div>
        </div>
      )}
    </>
  )
}

export default App
