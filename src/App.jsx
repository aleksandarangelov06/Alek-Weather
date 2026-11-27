import { useState, useEffect, useLayoutEffect, useRef, useCallback, useReducer, useMemo } from 'react'
import {
  Search, MapPin, MapPinOff, AlertCircle, HelpCircle, ArrowLeft, Building2, X, Navigation, Bookmark,
  ArrowUpDown, Check, Plus,
} from 'lucide-react'
import { ReorderList } from './components/ReorderListLazy'
import { preloadReorderList } from './components/reorderChunk'
import { blockMeta } from './components/blockMeta'
import { useCoverHistory } from './utils/detailCover'
import { useWeather } from './hooks/useWeather'
import { useStaleRefresh } from './hooks/useStaleRefresh'
import { RADAR_ENHANCED_KEY } from './hooks/useRadarPrecip'
import { useSavedCities } from './hooks/useSavedCities'
import { usePersistentSetting, onByDefault, orDefault } from './hooks/usePersistentSetting'
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
import { SkyStage } from './components/SkyStage'
import { PrecipNowcast } from './components/PrecipNowcast'
import { WeatherAlerts } from './components/WeatherAlerts'
import { WeatherOverview } from './components/WeatherOverview'
import { TodayCard } from './components/TodayCard'
import { SettingsPage } from './components/SettingsPageLazy'
import { HelpPage } from './components/HelpPage'
import { StormCenterBanner, StormSheet } from './components/StormSheet'
import { ExplorePage } from './components/ExplorePageLazy'
import { FREEZING_RAIN_CODES, isStormAlert, sortAlerts, stormCenterAlert, stormTint } from './utils/stormCenter'
import { preloadSettings } from './components/settingsChunk'
import { BuildingsIcon, GearIcon, SearchIcon } from './components/headerGlyphs'
import { SlidersIcon } from './components/SlidersIcon'
import { MAX_CARD_TRANSPARENCY, IOS_FULL_CLARITY_AT } from './utils/appearance'
// The web layout's components arrive with its own chunk (see webShellChunk) and
// are read off loadedWebShell() at render; only the tab list and the hook that
// holds the selected tab are needed whatever the style.
import { loadWebShell, loadedWebShell } from './components/web/webShellChunk'
import { TABS as WEB_TABS, useWebTab } from './components/web/tabs'
import { SplashCities } from './components/SplashCities'
import { LoadingScreen } from './components/LoadingScreen'
import { liveWeatherCode, getWeatherInfo, precipTier, SNOW_CODES } from './utils/weatherCodes'
import { isSnowing } from './utils/conditions'
import { WeatherIcon } from './components/WeatherIcon'
import { useIconSet, setIconSet } from './utils/iconSet'
import { useLocalConditions, locatedPlace, localConditionsFailed } from './hooks/useLocalConditions'
import { rememberConditions } from './hooks/placeConditions'
import { loadUnits, saveUnit } from './utils/units'
import { APP_VERSION_LABEL, IS_ANDROID_APP } from './utils/version'
import { UpdateToast } from './components/UpdateToast'
import { WebUpdateToast } from './components/WebUpdateToast'
import { useWebUpdateReady } from './utils/webUpdate'
import { SourceNote } from './components/SourceNote'
import { ApkPrompt } from './components/ApkPrompt'
import { IS_PHONE, IS_DESKTOP } from './utils/device'
import { DESKTOP_MQ, PLATFORM_THEME_KEY, initialPlatformTheme } from './utils/platformTheme'
import { applyMaterialTokens, DEFAULT_SEED, isValidSeed, resolveSeed, systemSeed, SYSTEM_SEED } from './utils/materialTheme'
import { useNotifications } from './hooks/useNotifications'
import { syncNotificationSettings, notificationPlace } from './utils/notifications'
import { liftNativeBoot, rememberBootLook } from './utils/bootStage'
import { armPageTransition } from './utils/pageTransition'
import { installTactilePress } from './utils/tactilePress'
import { haptic, setHapticsEnabled, HAPTICS_KEY } from './utils/haptics'
import './App.css'
// The few phone rules that used to live in WebApp.css, in the slot WebApp.css
// had. WebApp.css itself now comes with the web layout's chunk, still after
// App.css, so the web app's rules win the same ties against the shared card
// styles they refine.
import './PhoneShell.css'

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

// The night sky's stars, scattered once per page load.
const STARS = Array.from({ length: 40 }, () => ({
  top:   `${Math.random() * 88 + 4}%`,
  left:  `${Math.random() * 92 + 2}%`,
  dur:   `${(Math.random() * 3 + 2).toFixed(1)}s`,
  delay: `${-(Math.random() * 4).toFixed(1)}s`,
}))

const THEME_KEY = 'alek-weather-theme'
const MATERIAL_COLOR_KEY = 'alek-weather-material-color' // seed hex for the Material You palette
const CARD_TRANSPARENCY_KEY = 'alek-weather-card-transparency' // 0–90, percent of card fill removed
const CARD_LAYOUT_KEY = 'alek-weather-layout' // 'connected' (one sheet) | 'separate' (a card each)

// The viewport width the desktop layout takes over at is DESKTOP_MQ
// (utils/platformTheme, shared with the first-run default)...
// ...and this is the width it gives up at. The two differ on purpose: with a single
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
// Going Home on the phone ('enter'): the forecast fades out under the splash
// fading in, and is dropped once it has gone (.app--splash-enter, 0.22s). The
// phase itself lasts a touch longer than the splash's fade (0.32s,
// .splash-bg--enter), so that has finished when its classes come off.
const SPLASH_ENTER_DROP_MS = 250
const SPLASH_ENTER_MS = 340
// The round icon buttons on the phone shells (header search and settings, the
// current card's home and save) all dip under a press. :active alone can come
// and go on a quick tap before the dip has painted, so the press is also held as a
// data-pressed attribute for at least this long (an attribute, because React
// rewrites className when hold state changes and would wipe a class). See the effect in App.
const PRESS_DIP_MIN_MS = 110
const PRESS_DIP_SELECTOR = '.app-header .header-icon-btn, .app-header .settings-btn, .current-card .fav-btn, .current-card .save-btn'
// Hold the header search button this long to skip the overlay and geolocate.
// Passed to App.css as the --long-press-ms custom property so the fill animation
// always matches this value. A shortcut: the search page has "Use my location"
// in plain sight, so this only has to be long enough not to fire on a slow tap,
// about what the OS itself takes for a long press.
const LONG_PRESS_MS = 700

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

// Launch boot screen timing (see the #boot effect in App), in ms since page start.
const BOOT_MIN_MS = 700
const BOOT_MAX_MS = 8000
// How long the screen spends drawing the app beneath it before it starts to
// fade (see boot--prep in index.html); the fade itself, which matches the #boot
// transition there; and how long after the fade starts the screen is removed
// and data-boot cleared: once the forecast's 0.55s entrance (weather-fade-in in
// App.css) has finished too, so the sky starts moving on a settled page.
const BOOT_PREP_MS = 150
const BOOT_FADE_MS = 450
const BOOT_DONE_MS = 600
// The forecast's sky as last drawn, for the next launch's boot screen to open
// on (read by public/boot-sky.js before the first paint): { bg, at: [lat, lon] }.
const BOOT_SKY_KEY = 'alek-weather-boot-sky'

const BLOCK_ORDER_KEY = 'alek-weather-block-order'
// The cards reorder mode can remove: Weather insight and At a glance. Every
// other card is always in the stack. Weather insight's removal is stored here;
// At a glance keeps its own key (SHOW_TODAY_KEY), where its old Settings
// switch stored it, so a choice made there carries over.
const REMOVABLE_BLOCKS = ['overview', 'today']
const HIDDEN_BLOCKS_KEY = 'alek-weather-hidden-blocks'
const DEFAULT_BLOCK_ORDER = ['overview', 'today', 'nowcast', 'hourly', 'daily', 'details', 'radar']
const SHOW_TODAY_KEY = 'alek-weather-show-today'
const NOWCAST_MODE_KEY  = 'alek-weather-nowcast-mode'
const COLOR_CODING_KEY  = 'alek-weather-color-coding'
// The current-weather reading is always plain, not a setting: it is the largest
// text on the screen, and a coloured figure that size over a sky read as
// decoration more than as information. The other readings, the details tiles
// included, start coloured and each has its toggle in Settings.
const DEFAULT_COLOR_CODING = { current: false, hourly: true, daily: true, overview: true, details: true, glow: true, frost: true }
const ICON_MOTION_KEY   = 'alek-weather-icon-motion'
// How the radar timeline presents its two feeds.
//   'combined'  one scrubber running observed → forecast, divided at now
//   'split'     the two as separate timelines behind an Observed/Forecast toggle
// Only US locations have forecast frames at all; elsewhere both settings come
// out as the same observed-only scrubber.
const RADAR_MODE_KEY = 'alek-weather-radar-mode' // 'combined' | 'split'
const RADAR_SOURCE_KEY = 'alek-weather-radar-source' // 'rainviewer' | 'auto' | 'mrms' | 'nexrad'
const RADAR_SOURCES = ['rainviewer', 'auto', 'mrms', 'nexrad']

// Enter and Space on a non-button element with role="button", the way a real
// button answers them.
const pressOnKey = (action) => (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return
  e.preventDefault()
  action()
}

// Moves the item at `from` to `to`, the rest shuffling up or down to make room.
function arrayMove(list, from, to) {
  const next = list.slice()
  next.splice(to, 0, next.splice(from, 1)[0])
  return next
}

function App() {
  // The plain settings: one localStorage key each, stored as they change (see
  // usePersistentSetting). The ones with more to them follow further down.
  const [unit, changeUnit] = usePersistentSetting('alek-weather-unit', orDefault('F'))
  // Wind, pressure, visibility and precipitation, as one object rather than
  // four states: every consumer wants the whole set, and passing `units` keeps
  // the prop lists from growing a member per measure. Temperature stays its own
  // `unit` — it is threaded through colour coding and toTemp separately.
  const [units, setUnits] = useState(loadUnits)
  const [darkMode, changeDarkMode] = usePersistentSetting(THEME_KEY, orDefault('system'))
  // Phones never keep 'web' and desktops are always it — see
  // initialPlatformTheme, which main.jsx also reads to load the web layout's
  // chunk before the first render when this comes out as 'web'.
  const [platformTheme, setPlatformTheme] = useState(initialPlatformTheme)
  // A hex, or SYSTEM_SEED to follow the wallpaper (Material You, Android 12+
  // app only). Someone who has never picked a colour gets the wallpaper's
  // wherever there is one, the way Android's own apps do.
  const [materialColor, setMaterialColor] = useState(() => {
    const saved = localStorage.getItem(MATERIAL_COLOR_KEY)
    if (saved === SYSTEM_SEED) return SYSTEM_SEED
    if (isValidSeed(saved)) return saved.toLowerCase()
    return systemSeed() ? SYSTEM_SEED : DEFAULT_SEED
  })
  const [cardTransparency, changeCardTransparency] = usePersistentSetting(CARD_TRANSPARENCY_KEY, (raw) => {
    const saved = Number(raw)
    return Number.isFinite(saved) ? Math.min(MAX_CARD_TRANSPARENCY, Math.max(0, saved)) : 0
  })
  // The phone styles' Layout setting: the forecast as one connected sheet (the
  // default) or a stack of separate cards. Only an explicit 'separate' keeps
  // the cards.
  const [cardLayout, changeCardLayout] = usePersistentSetting(CARD_LAYOUT_KEY, (raw) => (raw === 'separate' ? 'separate' : 'connected'))
  // On by default: only an explicit 'false' hides the At a Glance card (stored
  // under its old Today card key).
  const [showToday, changeShowToday] = usePersistentSetting(SHOW_TODAY_KEY, onByDefault)
  const [nowcastMode, changeNowcastMode] = usePersistentSetting(NOWCAST_MODE_KEY, orDefault('auto'))
  const [weatherAnimations, changeWeatherAnimations] = usePersistentSetting('alek-weather-animations', onByDefault)
  const [gyroscope, storeGyroscope] = usePersistentSetting('alek-weather-gyroscope', onByDefault)
  // Settings > Haptics (Android app only; utils/haptics.js keeps its own copy
  // for the presses to read).
  const [haptics, setHaptics] = useState(() => localStorage.getItem(HAPTICS_KEY) !== 'false')
  // Separate from weatherAnimations, which is the sky backdrop and the canvas
  // effects behind the whole app. This is only the weather icons' own motion —
  // falling rain, drifting cloud, the lightning flash — so it can be turned off
  // by someone who still wants the sky, and vice versa.
  const [iconMotion, changeIconMotion] = usePersistentSetting(ICON_MOTION_KEY, onByDefault)
  // Color (the Fluent glyphs) or Line (Lucide). Stored and broadcast by
  // iconSet.js, which WeatherIcon reads directly — see the note there.
  const iconSet = useIconSet()
  // Defaults on: radar is the only source that observes precipitation over the
  // location itself, and it has caught storms every model and nearby station
  // missed. `!== 'false'` so anyone who explicitly turned it off stays off.
  const [radarEnhanced, changeRadarEnhanced] = usePersistentSetting(RADAR_ENHANCED_KEY, onByDefault)
  const [radarMode, changeRadarMode] = usePersistentSetting(RADAR_MODE_KEY, (saved) => {
    // Migrating the values this key used to hold. 'both' was the single
    // timeline, which is what 'combined' is now. 'nowcast' and 'future' were
    // the retired "opens on" choice, and that only ever existed in the split
    // layout, so either of them lands there.
    if (saved === 'combined' || saved === 'both') return 'combined'
    return 'split'
  })
  // Which observed radar feed the map draws. 'auto' (shown as Default) unless
  // one was picked: in the US that is NOAA from end to end, MRMS zoomed out and
  // the nearest NEXRAD zoomed in, ahead of the NOAA HRRR forecast; elsewhere it
  // is RainViewer, the only feed there is (see WeatherRadar). A saved choice is
  // kept, so anyone who already picked one stays on it.
  const [radarSource, changeRadarSource] = usePersistentSetting(RADAR_SOURCE_KEY, (saved) => (RADAR_SOURCES.includes(saved) ? saved : 'auto'))
  const [colorCoding, setColorCoding] = useState(() => {
    const saved = loadJSON(COLOR_CODING_KEY)
    // `current` is pinned to the default over anything saved: it was a toggle
    // once, and a copy saved back then would otherwise keep it coloured.
    return saved ? { ...DEFAULT_COLOR_CODING, ...saved, current: DEFAULT_COLOR_CODING.current } : DEFAULT_COLOR_CODING
  })
  const [installPrompt, setInstallPrompt] = useState(null)
  const webUpdateReady = useWebUpdateReady()
  const [showSettings, setShowSettings] = useState(false)
  const [settingsClosing, setSettingsClosing] = useState(false)
  // True only while the cog is turning, before the panel is mounted.
  const [settingsOpening, setSettingsOpening] = useState(false)
  // The full-screen cover over an app-style switch: { to, leaving } or null.
  const [styleCover, setStyleCover] = useState(null)
  const styleCoverTimers = useRef([])
  // Counts style switches, so a switch still waiting on the web layout's chunk
  // can tell it has been superseded (see changePlatformTheme).
  const styleSwitchRef = useRef(0)
  useEffect(() => () => styleCoverTimers.current.forEach(clearTimeout), [])
  const settingsOpenTimer = useRef(null)
  // The same, for the magnifier's sweep and the search overlay.
  const [searchSweeping, setSearchSweeping] = useState(false)
  const searchOpenTimer = useRef(null)
  const [subView, setSubView] = useState(null) // null | 'colorcoding' | 'radar' | 'effects' | 'units' | 'theme' | 'notifications'
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia(DESKTOP_MQ).matches)
  const [webTab, setWebTab] = useWebTab()
  // The web app's non-forecast page: 'settings' | null. Kept
  // apart from webTab: they need no forecast, so they can be opened from Home
  // with nothing loaded, and leaving one returns to whichever forecast page you
  // were on. Not persisted: a reload lands on the forecast, as it always has.
  const [webPage, setWebPage] = useState(null)
  const [help, setHelp] = useState(null) // { article } while the Help page is open
  // The phones' Storm Center sheet (see StormSheet), and the card a link on it
  // asked to be taken to once it has closed.
  const [stormOpen, setStormOpen] = useState(false)
  const stormGoTo = useRef(null)
  // The Explore page (the easter egg behind "Alek Studios" in Settings), and
  // the place picked on it, opened once the page and Settings have closed.
  const [exploreOpen, setExploreOpen] = useState(false)
  const exploreGoTo = useRef(null)

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

  // The web layout's components (WebLayout, WebTabs, SplashHome…), from its own
  // chunk. Nothing switches the style to Web before that chunk is in (main.jsx
  // waits for it at launch, changePlatformTheme before a switch), so this is
  // set whenever webLayout is. Should the fetch have failed anyway (offline with
  // nothing cached), the web-only parts render as nothing and it is retried.
  const web = webLayout ? loadedWebShell() : null
  const [, webShellLanded] = useReducer((n) => n + 1, 0)
  useEffect(() => {
    if (webLayout && !loadedWebShell()) loadWebShell().then(webShellLanded, () => {})
  }, [webLayout])

  const [searchOpen, setSearchOpen] = useState(false)
  const [searchClosing, setSearchClosing] = useState(false)
  const [searchInitialQuery, setSearchInitialQuery] = useState('')
  const [savedOpen, setSavedOpen] = useState(false)
  const [savedClosing, setSavedClosing] = useState(false)
  // 'visible' | 'exit' | 'done' | 'enter' ('enter': phone only, the splash
  // fading in over a forecast on the way Home; see handleLogoClick).
  const [splashPhase, setSplashPhase] = useState(HAS_SAVED_CITY ? 'done' : 'visible')
  // The web splash's saved-locations view, opened from the button at its foot.
  // It belongs to the splash, so leaving the splash (a place picked, a tab
  // chosen) puts it away: coming back Home lands on the recents again.
  const [splashSaved, setSplashSaved] = useState(false)
  if (splashSaved && splashPhase === 'done') setSplashSaved(false)

  // The web app's splash doubles as its home screen (search field + the places
  // you've been), so it replaces the phone splash's tap-anywhere-to-search
  // overlay and hint. Every other style keeps the plain splash.
  // Declared here rather than beside webLayout above: it reads splashPhase, so
  // it has to come after that state is initialised.
  const webSplash = webLayout && splashPhase !== 'done'
  // Whether the header is dressed for the splash: its search button is the
  // saved-places button there, and its circles take the splash sky's colours
  // (.app--on-splash). On the phone that ends the moment the exit starts and
  // begins the moment the way Home starts, so the header changes with the rest
  // of the screen rather than once it has all settled. The web splash keeps it
  // for as long as it is up.
  const headerOnSplash = webLayout ? splashPhase !== 'done' : (splashPhase === 'visible' || splashPhase === 'enter')
  const headerRef = useRef(null)
  const searchAreaRef = useRef(null)
  // The search page's two layers and the settings sky layer, held on their
  // first frame while they mount (see the effects after closeSearch).
  const searchOverlayRef = useRef(null)
  const searchBackdropRef = useRef(null)
  const settingsSkyRef = useRef(null)
  const searchHoldTimer = useRef(null)
  const searchLongPressed = useRef(false)
  const [searchHolding, setSearchHolding] = useState(false)
  const [blockOrder, setBlockOrder] = useState(() => {
    const saved = loadJSON(BLOCK_ORDER_KEY)
    if (!saved) return DEFAULT_BLOCK_ORDER
    // A block added in a later version goes in after the block it follows in
    // the default order (Today after Overview), not at the top of the stack.
    const order = [...saved]
    DEFAULT_BLOCK_ORDER.forEach((id, i) => {
      if (order.includes(id)) return
      const after = DEFAULT_BLOCK_ORDER.slice(0, i).reverse().find(p => order.includes(p))
      order.splice(after ? order.indexOf(after) + 1 : 0, 0, id)
    })
    return order
  })

  // Cards only move in reorder mode, entered from the button under the stack,
  // so a stray hold or drag on a card can never pick it up. In that mode a
  // mouse picks a row up after a few pixels, a finger after a short hold (a
  // quick swipe still scrolls the page), and the keyboard with space and the
  // arrow keys. Back, Done, or loading another place leaves the mode.
  const [reordering, setReordering] = useState(false)
  const endReorder = useCoverHistory(reordering, () => setReordering(false))

  // A row dropped onto another (see ReorderList).
  const moveBlock = (id, overId) => {
    setBlockOrder(prev => {
      const next = arrayMove(prev, prev.indexOf(id), prev.indexOf(overId))
      localStorage.setItem(BLOCK_ORDER_KEY, JSON.stringify(next))
      return next
    })
  }

  const {
    location, weather, airQuality, alerts, lastUpdated, searchResults, loading, error,
    searchCity, selectCity, locateMe, setSearchResults, fetchWeather, restoreReading, reset, clearError, retry,
  } = useWeather(INITIAL_CITY)

  // Reorder mode belongs to the stack it was opened on: another place loading
  // closes it. Keyed on the coordinates, since a background refresh sets the
  // same place again. Adjusted during render (React's pattern for state that
  // follows a changing value) rather than in an effect.
  const placeKey = location ? `${location.latitude},${location.longitude}` : ''
  const [reorderPlace, setReorderPlace] = useState(placeKey)
  if (reorderPlace !== placeKey) {
    setReorderPlace(placeKey)
    setReordering(false)
  }
  // On the way in, the page goes to the top: the current weather is set aside
  // and the cards have just collapsed to rows, so the list starts right under
  // the header.
  useEffect(() => {
    if (reordering) window.scrollTo(0, 0)
  }, [reordering])

  // Launch load, background refresh, and refresh-after-restore (see the hook).
  const refreshIfStale = useStaleRefresh({ initialCity: INITIAL_CITY, location, weather, lastUpdated, fetchWeather })

  // Nothing to show means Home. The splash is the start screen in every style,
  // but a few paths leave it marked done with no forecast behind it: opening a
  // Web page from Home (Settings, Locations), switching to Web from the phone
  // Settings page, a cleared error. Coming back from any of those (closing the
  // page, switching back to iOS or Android) used to land on the old "Tap to
  // find a location" screen instead. A layout effect, so that screen never gets
  // a frame. A Web page that's up (navPageUp) is something to show, and
  // loading and error states have screens of their own.
  // The setState in a layout effect is the point here: it lands before paint,
  // on the rare paths above, so the empty screen is never drawn. Deriving it in
  // render instead would mean reworking the splash phases, so the rule is
  // silenced for this line alone.
  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (splashPhase === 'done' && !weather && !loading && !error && !navPageUp) setSplashPhase('visible')
  }, [splashPhase, weather, loading, error, navPageUp])

  // Each forecast reading also fills the splash's card for that place, so going
  // back Home doesn't ask Open-Meteo for a reading already on hand. Keyed on the
  // reading as well as its time: a late NWS overlay or radar call changes what
  // the card should say without changing when the reading was taken.
  useEffect(() => {
    if (weather && location && lastUpdated) rememberConditions(location, weather, lastUpdated.getTime())
  }, [lastUpdated, weather]) // eslint-disable-line react-hooks/exhaustive-deps

  // Radar cross-check for the current condition (opt-in "Radar enhanced accuracy").
  // The verdict is sampled with the reading itself (see loadForecast), so it is
  // always the sweep behind the reading on screen, and it is there from the
  // first frame — sampling it afterwards showed the model's unchecked code (a
  // thunderstorm sky) for a beat before the check corrected it.
  const radarClear = radarEnhanced ? (weather?.radarClear ?? null) : null
  // Whether precipitation over the point just started or just stopped, by the
  // radar's last two sweeps (applyRadar). The same setting governs it.
  const radarTrend = radarEnhanced ? (weather?.current?.radar_trend ?? null) : null

  const { cities, save, remove, isSaved, home, setHome, unsetHome, isHome } = useSavedCities()
  const { recents, addRecent, removeRecent } = useRecentSearches()
  const { notifyEnabled, notifyTypes, permission: notifyPermission, toggleNotifyEnabled, toggleType } = useNotifications()

  // The current-weather card's actions (both shells), held stable so the
  // memoised WebLayout and CurrentWeather can skip the renders App does for
  // every overlay, toggle and keystroke that has nothing to do with them.
  const saveCurrent = useCallback(() => save(location), [save, location])
  const removeCurrent = useCallback(() => remove(location), [remove, location])
  const setHomeCurrent = useCallback(() => setHome(location), [setHome, location])
  const goHome = useCallback(() => { if (home) fetchWeather(home) }, [home, fetchWeather])
  const refreshCurrent = useCallback(() => fetchWeather(location), [fetchWeather, location])

  // Weather notifications are APK-only (they ride the native bridge). The page
  // only publishes settings: the native worker does the checking, on its own
  // schedule, so notifications keep arriving with the app closed.
  // They are for one place: Home, else the first saved place, else whatever was
  // last opened. Browsing another city doesn't move them, and going back to the
  // splash (no location) sends no coordinates, which the shell reads as "keep
  // the place you have" rather than "stop". Keyed on the coordinates, so a
  // refresh of the same place doesn't re-sync.
  const notifyPlace = notificationPlace({ home, cities, location })
  const notifyLat = notifyPlace?.latitude ?? null
  const notifyLon = notifyPlace?.longitude ?? null
  useEffect(() => {
    if (!IS_ANDROID_APP) return
    const place = notifyLat != null && notifyLon != null ? { latitude: notifyLat, longitude: notifyLon } : null
    syncNotificationSettings({ enabled: notifyEnabled, types: notifyTypes, location: place, unit })
  }, [notifyEnabled, notifyTypes, notifyLat, notifyLon, unit])
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

  // Apply dark mode theme. A layout effect so it lands before the first paint:
  // as a plain effect the cards painted in the OS scheme first and then ran
  // their background transition into the saved one on every launch.
  useLayoutEffect(() => {
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

  // The Layout setting, published the same way so App.css can draw the phone
  // forecast as one sheet (see "Connected layout" there). The web layout has
  // its own page grid and never carries it. A layout effect for the same
  // reason as the two above: the cards change in the frame the setting does.
  useLayoutEffect(() => {
    const root = document.documentElement
    if (!webLayout && cardLayout === 'connected') root.setAttribute('data-layout', 'connected')
    else root.removeAttribute('data-layout')
  }, [cardLayout, webLayout])


  // Material You seed color (Android style only — it's the one style whose look
  // is built out of the --md-* tokens, and the only one that offers the picker).
  // App.css ships the baseline purple for both schemes, so a custom seed has to
  // be generated and written inline to outrank it — which means knowing which
  // scheme is actually on screen, including when Theme is System and the OS
  // flips it out from under us.
  // A layout effect for the same reason as the theme above: the custom palette
  // has to be on the root before the first paint, or the cards flash the
  // baseline colours and fade across to it.
  useLayoutEffect(() => {
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

  // Startup guard (see data-booting in main.jsx / index.css): transitions stay
  // off until the first frames have painted with the final theme, so nothing
  // animates from a default look into the saved one on load.
  useEffect(() => {
    let id = requestAnimationFrame(() => {
      id = requestAnimationFrame(() => document.documentElement.removeAttribute('data-booting'))
    })
    return () => cancelAnimationFrame(id)
  }, [])

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
  // A layout effect, like the theme and palette, so it is in place for the
  // first paint.
  useLayoutEffect(() => {
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
  // This reacts to a reading (or an error) *arriving*, not to the state being
  // what it is: going Home with a stale error, say, must not bounce straight
  // back off the splash. Deriving the phase during render would do exactly
  // that, so the effect stays and the rule is silenced for it alone.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (splashPhase !== 'visible') return
    if (error && !weather) { setSplashHold(false); setSplashPhase('done'); return }
    if (!weather) return
    if (!firstOpenRef.current) { setSplashHold(false); setSplashPhase('exit'); return }
    firstOpenRef.current = false
    setSplashHold(true)
    // The beat lasts until the main thread is next idle, which is when the
    // mount's work is done, rather than a fixed 450ms that most devices were
    // finished well inside. 450ms stays as the ceiling, and the wait where
    // there is no idle callback (Safari).
    const exit = () => { setSplashHold(false); setSplashPhase('exit') }
    const ric = window.requestIdleCallback
    let t = 0, idle = 0
    if (ric) idle = ric(exit, { timeout: 450 })
    else t = setTimeout(exit, 450)
    // A later source landing on the reading re-runs this effect; with the ref
    // spent it then exits at once rather than leaving the splash stuck.
    return () => {
      clearTimeout(t)
      if (idle) window.cancelIdleCallback?.(idle)
    }
  }, [weather, error]) // eslint-disable-line react-hooks/exhaustive-deps
  /* eslint-enable react-hooks/set-state-in-effect */

  // The boot screen (#boot in index.html) covers the launch. With a saved city
  // it stays up until the first reading (or an error) lands, so the app opens
  // straight onto the forecast instead of skeletons; with none, the splash is
  // the next screen and it lifts as soon as the app has mounted. It shows for
  // at least BOOT_MIN_MS so it never just flickers, and never longer than
  // BOOT_MAX_MS, so a slow or offline launch still reaches the app.
  //
  // The lift is staged so the fade gets the device to itself:
  //   1. prep: the screen goes a hair under opaque, so the browser draws the
  //      app beneath it now rather than in the fade's first frames;
  //   2. a short wait, then until the main thread is idle, so the fade doesn't
  //      start in the middle of the first render's paint or its effects;
  //   3. the fade, with data-boot="lifting" releasing the forecast's entrance
  //      (held back in App.css) to play under it;
  //   4. once the fade and the entrance are done (BOOT_DONE_MS), the screen is
  //      removed and data-boot cleared, which starts the sky (WeatherCanvas)
  //      and lets idle work like the settings preload run.
  const bootReady = !HAS_SAVED_CITY || !!weather || !!error
  // A launch that already has its reading (restored from storage) skips the
  // BOOT_MIN_MS floor: there is no later swap for the floor to smooth over, and
  // it only kept the forecast behind the boot screen for longer.
  const [bootHadReading] = useState(() => !!weather)
  const [bootTimedOut, setBootTimedOut] = useState(false)
  const [bootGone, setBootGone] = useState(() => !document.getElementById('boot'))
  useEffect(() => {
    const t = setTimeout(() => setBootTimedOut(true), BOOT_MAX_MS)
    return () => clearTimeout(t)
  }, [])
  useEffect(() => {
    if (!bootReady && !bootTimedOut) return
    const root = document.documentElement
    const boot = document.getElementById('boot')
    // No #boot (main.jsx drops it for the Web style): nothing to stage, but
    // the APK's native launch screen still goes now the app has rendered.
    if (!boot) { delete root.dataset.boot; liftNativeBoot(); return }
    if (boot.classList.contains('boot--out')) return
    const ric = window.requestIdleCallback
    let t, idle
    const lift = () => {
      boot.classList.add('boot--out')
      root.dataset.boot = 'lifting'
      // In the APK the native launch screen over #boot fades now, on the same
      // timing, and #boot (blank under it) goes at once.
      liftNativeBoot()
      setTimeout(() => {
        boot.remove()
        delete root.dataset.boot
        root.removeAttribute('data-boot-sky')
        root.style.removeProperty('--boot-sky')
        setBootGone(true)
      }, Math.max(BOOT_FADE_MS, BOOT_DONE_MS))
    }
    t = setTimeout(() => {
      boot.classList.add('boot--prep')
      t = setTimeout(() => {
        if (ric) idle = ric(lift, { timeout: 300 })
        else t = setTimeout(lift, 50)
      }, BOOT_PREP_MS)
    }, bootHadReading ? 0 : Math.max(0, BOOT_MIN_MS - performance.now()))
    return () => {
      clearTimeout(t)
      if (idle) window.cancelIdleCallback?.(idle)
    }
  }, [bootReady, bootTimedOut, bootHadReading])

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

  // The way Home on the phone ('enter'): the splash fades in over the forecast
  // while the forecast fades out. Once the forecast has gone it is dropped,
  // still inside the phase, so what it held on to (the sky-dressed header,
  // above all) changes while the splash is still coming in rather than after
  // it has settled; then the phase settles on the splash. The exit effect
  // above ignores this phase, so a refresh landing mid-fade can't bounce the
  // splash straight back off.
  useEffect(() => {
    if (splashPhase !== 'enter') return
    const drop = setTimeout(reset, SPLASH_ENTER_DROP_MS)
    const settle = setTimeout(() => setSplashPhase('visible'), SPLASH_ENTER_MS)
    return () => { clearTimeout(drop); clearTimeout(settle) }
  }, [splashPhase, reset])

  // The phone splash is a fixed poster over the app, but the page under it can
  // still scroll. In a phone browser a swipe would scroll it, collapse the
  // address bar and resize the viewport, and the bottom-anchored city cards
  // rode up with it. Lock the page while the poster is up (see .splash-lock).
  // The web splash is a real page with its own scrolling, so it is left alone.
  const splashLock = splashPhase !== 'done' && !webSplash
  useEffect(() => {
    if (!splashLock) return
    const root = document.documentElement
    root.classList.add('splash-lock')
    return () => root.classList.remove('splash-lock')
  }, [splashLock])

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

  const changeUnitGroup = (group, value) => {
    setUnits(prev => ({ ...prev, [group]: value }))
    saveUnit(group, value)
  }

  // Whether a card is in the stack. Only REMOVABLE_BLOCKS can be out of it, so
  // a card removed before that list existed is back regardless of the stored
  // list. At a glance reads its own key; Weather insight reads the removed
  // list. A card that comes back returns to the place it had in the order.
  const [hiddenBlocks, setHiddenBlocks] = useState(() => {
    const saved = loadJSON(HIDDEN_BLOCKS_KEY)
    return Array.isArray(saved) ? saved : []
  })
  const isBlockShown = (id) => (!REMOVABLE_BLOCKS.includes(id) ? true
    : id === 'today' ? showToday
    : !hiddenBlocks.includes(id))
  const setBlockShown = (id, shown) => {
    if (id === 'today') { changeShowToday(shown); return }
    setHiddenBlocks(prev => {
      const next = shown ? prev.filter(b => b !== id) : [...prev.filter(b => b !== id), id]
      localStorage.setItem(HIDDEN_BLOCKS_KEY, JSON.stringify(next))
      return next
    })
  }

  // Settings' Color Coding switch: every tile, and the glow and frost on top
  // of them, on or off together. `current` stays pinned (see above).
  const setAllColorCoding = (on) => {
    setColorCoding(prev => {
      const next = { ...prev }
      for (const key of Object.keys(DEFAULT_COLOR_CODING)) if (key !== 'current') next[key] = on
      localStorage.setItem(COLOR_CODING_KEY, JSON.stringify(next))
      return next
    })
  }

  const toggleColorCoding = (key) => {
    setColorCoding(prev => {
      const next = { ...prev, [key]: !prev[key] }
      localStorage.setItem(COLOR_CODING_KEY, JSON.stringify(next))
      return next
    })
  }

  const changeHaptics = (val) => {
    setHaptics(val)
    setHapticsEnabled(val)
    // Turning them on answers with one, so you feel what you just chose.
    if (val) haptic('tap')
  }

  const changeGyroscope = (val) => {
    storeGyroscope(val)
    // iOS 13+ gates motion sensors behind a permission prompt that must be
    // requested from a user gesture — flipping this toggle on is one.
    if (val && typeof DeviceOrientationEvent !== 'undefined'
        && typeof DeviceOrientationEvent.requestPermission === 'function') {
      DeviceOrientationEvent.requestPermission().catch(() => {})
    }
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
    // Web can't be put on screen before its chunk is in (see webShellChunk). The
    // fetch starts on the tap, so it runs while the cover fades in; should it
    // take longer than that, the switch waits under the cover. A later switch
    // supersedes this one (switchId), so a slow fetch can't land on top of it.
    const ready = mode === 'web' ? loadWebShell() : Promise.resolve()
    const switchId = ++styleSwitchRef.current
    const current = () => switchId === styleSwitchRef.current

    // Reduced motion: no cover, just the switch.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      if (mode !== 'web' || loadedWebShell()) apply()
      else ready.then(() => { if (current()) apply() }, () => { /* stays on this style */ })
      return
    }

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
    const timers = []
    styleCoverTimers.current = timers
    const lift = () => {
      delete root.dataset.styleCover
      setStyleCover(c => c && { ...c, leaving: true })
      timers.push(setTimeout(() => setStyleCover(null), STYLE_COVER_OUT_MS))
    }
    timers.push(setTimeout(() => {
      ready.then(() => {
        if (!current()) return
        root.dataset.styleCover = mode
        apply()
        // A beat after the switch, so the new style has painted before it shows.
        timers.push(setTimeout(lift, STYLE_COVER_HOLD_MS))
      }, () => {
        // The web layout couldn't be fetched (offline with nothing cached): the
        // cover lifts on the style that was already there.
        if (current()) lift()
      })
    }, STYLE_COVER_IN_MS))
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

  // A tap on the cog while settings is still closing would be lost: the page
  // is on its way out, so there is nothing to open yet. It is held instead
  // (settingsReopen) and acted on once the close has finished (see the effect
  // after doCloseSettings). Search does the same.
  const settingsReopen = useRef(false)
  const searchReopen = useRef(false)

  const openSettings = () => {
    if (settingsClosing) { settingsReopen.current = true; return }
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
  useEffect(() => {
    if (showSettings || !settingsReopen.current) return
    settingsReopen.current = false
    openSettings()
  }, [showSettings]) // eslint-disable-line react-hooks/exhaustive-deps

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

  // Explore, full screen over Settings. Back closes it onto Settings again;
  // picking a place leaves Settings too (all of its entries, as
  // dismissSettings does) and opens that place's forecast.
  const openExplore = () => {
    if (!exploreOpen) history.pushState({ overlay: 'explore' }, '')
    setExploreOpen(true)
  }
  const closeExplore = () => history.back()
  const exploreGo = (place) => {
    exploreGoTo.current = place
    history.go(-(1 + (showSettings ? (subView ? 2 : 1) : 0)))
  }

  // The Help page, full screen over everything (see HelpPage). `article` opens
  // straight onto one; with none it opens on the list. It takes a history
  // entry so Back closes it, like the other overlays.
  const openHelp = (article = null) => {
    if (!help) history.pushState({ overlay: 'help' }, '')
    setHelp({ article })
  }
  const closeHelp = () => history.back()

  // The phones' Storm Center, full screen over the forecast. It takes a
  // history entry so Back closes it. Its links to the radar and the week close
  // it and scroll to that card instead, since the phones have no tabs.
  const openStormCenter = () => {
    if (!stormOpen) history.pushState({ overlay: 'storm' }, '')
    setStormOpen(true)
  }
  const closeStormCenter = () => history.back()
  const stormNavigate = (id) => {
    stormGoTo.current = id
    history.back()
  }

  // Called straight from a click (the empty state, the location error's link),
  // or by the magnifier through sweepThenOpenSearch.
  const openSearch = () => {
    history.pushState({ overlay: 'search' }, '')
    setSearchOpen(true)
  }

  // Opening search *from the magnifier*, which is the only entry point with an
  // icon to animate. Search opens on the tap itself, as settings does; it used to
  // wait for the glass to finish sweeping, and that wait read as lag. The sweep
  // still plays alongside the reveal, and the timer only ends it.
  const sweepThenOpenSearch = () => {
    if (searchClosing) { searchReopen.current = true; return }
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
  useEffect(() => {
    if (searchOpen || !searchReopen.current) return
    searchReopen.current = false
    sweepThenOpenSearch()
  }, [searchOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  const closeSearch = () => history.back()

  // The phone pages' open transition waits out the frame they mount in, which
  // lays out the whole page (see utils/pageTransition.js). SettingsPage holds
  // its own; these hold what App renders: the search page with its dimmer, and
  // the sky layer behind settings, so each moves as one with its page.
  useLayoutEffect(() => {
    if (!searchOpen) return
    const release = [searchBackdropRef.current, searchOverlayRef.current].map(armPageTransition)
    return () => release.forEach((undo) => undo())
  }, [searchOpen])
  useLayoutEffect(() => {
    if (showSettings) return armPageTransition(settingsSkyRef.current)
  }, [showSettings])

  // Press-and-hold the header location button to detect your location via GPS;
  // a normal tap still opens search. The fill animation under the icon
  // (App.css) signals progress toward the LONG_PRESS_MS threshold.
  const startSearchHold = () => {
    if (headerOnSplash) return
    searchLongPressed.current = false
    setSearchHolding(true)
    searchHoldTimer.current = setTimeout(() => {
      searchLongPressed.current = true
      setSearchHolding(false)
      haptic('heavy')
      locateMe()
    }, LONG_PRESS_MS)
  }

  const endSearchHold = () => {
    clearTimeout(searchHoldTimer.current)
    setSearchHolding(false)
  }

  const handleSearchButton = () => {
    // Swallow the click that trails a completed hold so it doesn't also open search.
    if (searchLongPressed.current) { searchLongPressed.current = false; return }
    if (headerOnSplash) {
      // On the web, the places you've been are already listed on Home.
      if (!webLayout) openSaved()
      return
    }
    sweepThenOpenSearch()
  }

  useEffect(() => () => clearTimeout(searchHoldTimer.current), [])

  // Settings opens on the tap now, with no cog turn to hide a download behind,
  // so its chunk is warmed once the app has gone idle after first paint rather
  // than only on pointerdown (which still runs, for a tap that beats this).
  // Not before the boot screen has gone: the first idle moment is when the
  // screen starts its fade, and parsing a chunk then would stall the reveal.
  useEffect(() => {
    if (!bootGone) return
    const ric = window.requestIdleCallback
    if (ric) {
      const id = ric(() => preloadSettings(), { timeout: 3000 })
      return () => window.cancelIdleCallback?.(id)
    }
    const t = setTimeout(preloadSettings, 1500)
    return () => clearTimeout(t)
  }, [bootGone])

  // The same give and spring-back for everything else you can tap on the
  // phone: rows, tiles, chips, small buttons (utils/tactilePress.js).
  useEffect(() => installTactilePress(), [])

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

  // An entry on the history stack like the other overlays, so the browser's
  // Back steps out of the view instead of out of the app.
  const openSplashSaved = () => {
    history.pushState({ overlay: 'splash-saved' }, '')
    setSplashSaved(true)
  }
  const closeSplashSaved = () => history.back()

  // The Escape and back-button handlers live down here, after every open and
  // close function they call, so none of them is used before it is declared.

  // Close search overlay on Escape key
  useEffect(() => {
    if (!searchOpen) return
    const handler = (e) => { if (e.key === 'Escape') closeSearch() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [searchOpen])

  // Escape closes the settings modal — the dialog behaviour a desktop user
  // expects, and the web app is the only shell that draws one. It goes through
  // history like every other way out of settings, so with a sub-page open it
  // steps back to the main list first rather than dropping the whole modal.
  useEffect(() => {
    if (!showSettings || !webLayout) return
    const handler = (e) => { if (e.key === 'Escape') closeSettings() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [showSettings, webLayout])

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
      // Help sits on top of everything, so it is always the first to go.
      if (help) { setHelp(null); return }
      // The Storm Center sheet is over everything else on the phones. The
      // alert map and the full-screen radar inside it take entries of their
      // own, so it only closes once Back has gone below its entry.
      if (stormOpen) {
        if (history.state?.overlay === 'storm') return
        setStormOpen(false)
        const id = stormGoTo.current
        stormGoTo.current = null
        if (id) {
          requestAnimationFrame(() => {
            document.querySelector(`.sortable-block[data-block="${id}"]`)
              ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
          })
        }
        return
      }
      if (exploreOpen) {
        if (history.state?.overlay === 'explore') return
        setExploreOpen(false)
        const place = exploreGoTo.current
        exploreGoTo.current = null
        if (place) {
          if (showSettings) doCloseSettings()
          // closeNavPage, which is declared further down.
          if (webPage != null) { setWebPage(null); setSubView(null) }
          landFirstPick()
          if (webLayout) setWebTab('today')
          addRecent(place)
          selectCity(place)
        }
        return
      }
      if (subView && history.state?.overlay === 'settings') setSubView(null)
      else if (showSettings) doCloseSettings()
      else if (searchOpen) doCloseSearch()
      else if (savedOpen) doCloseSaved()
      else if (splashSaved) setSplashSaved(false)
    }
    window.addEventListener('popstate', handler)
    return () => window.removeEventListener('popstate', handler)
  }, [help, stormOpen, exploreOpen, subView, showSettings, searchOpen, savedOpen, splashSaved, webPage]) // eslint-disable-line react-hooks/exhaustive-deps

  // The sheet is the phones' alone: widening into the web layout (which shows
  // the Storm Center on Home instead) backs out of its entry, which closes it.
  useEffect(() => {
    if (webLayout && stormOpen) history.back()
  }, [webLayout]) // eslint-disable-line react-hooks/exhaustive-deps

  // Escape backs out of the splash's saved view, as it does out of every page.
  useEffect(() => {
    if (!splashSaved || showSettings || searchOpen || help) return
    const onKey = (e) => { if (e.key === 'Escape') history.back() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [splashSaved, showSettings, searchOpen, help])

  // Escape closes Explore, and only Explore: Settings' own Escape (above) is
  // kept from seeing it, as Help does below.
  useEffect(() => {
    if (!exploreOpen || help) return
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); history.back() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [exploreOpen, help])

  // Escape closes the Help page.
  useEffect(() => {
    if (!help) return
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); history.back() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [help])

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
    locateMe()
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
    refreshIfStale(city, updated)
  }

  // The header's place line on the phone shells (see .app-place): the city
  // and its region, and today's date in the forecast's own timezone. Up for the
  // splash's exit as well, so the headline flying into the header lands on the
  // place rather than on the wordmark (which then gave way to the place a beat
  // later), and through 'enter', where it fades as the splash comes back.
  const placeInHeader = !webLayout && splashPhase !== 'visible' && !!weather && !!location
  // With a forecast up on the phone shells the header floats, so search and
  // settings stay on screen (.app-header--float in App.css). The place in the
  // middle would sit over the cards as plain text, so it fades out once the
  // page has moved. Only a change across the threshold re-renders: setting the
  // same value again is a no-op.
  const [scrolledDown, setScrolledDown] = useState(false)
  useEffect(() => {
    if (!placeInHeader) return
    const onScroll = () => setScrolledDown(window.scrollY > 8)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [placeInHeader])
  const placeLine = location
    ? [location.name, location.admin1 && location.admin1 !== location.name ? location.admin1 : null].filter(Boolean).join(', ')
    : ''
  const placeDate = weather
    ? new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', ...(weather.timezone ? { timeZone: weather.timezone } : {}) })
    : ''

  // Also the way out of a failed fetch, which has no forecast to drop.
  const handleLogoClick = () => {
    if ((!weather && !error) || splashPhase !== 'done') return
    // Phone, with a forecast up: the splash fades in over it first, and the
    // forecast is only dropped once it is covered (the 'enter' effect).
    // Dropping it here cut straight from the forecast to the splash.
    if (!webLayout && weather) { setSplashPhase('enter'); return }
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
    if ((weather || error) && splashPhase === 'done') handleLogoClick()
    else if (wasOnPage && splashPhase === 'done') setSplashPhase('visible')
  }

  const hasActiveAlert = alerts.some(a =>
    a.properties?.severity === 'Extreme' || a.properties?.severity === 'Severe'
  )

  const liveCode = weather ? liveWeatherCode(weather.current, weather.minutely_15, radarClear) : null
  // What makes the web Home tab the Storm Center, and what it glows for. An alert that's a Warning (the
  // hazard is happening or imminent) or rated Extreme outranks everything and
  // glows red; otherwise falling weather right now — storm, snow, rain —
  // glows in its own colour. Nothing notable, no glow.
  // Only storm alerts count (see isStormAlert): a Coastal Flood Warning under a
  // clear sky stays in the alert list and leaves the Storm Center off.
  const brandEvent = (() => {
    const extreme = stormCenterAlert(alerts)
    if (extreme) return { kind: 'extreme', label: extreme.properties.event }
    if (liveCode == null) return null
    // Only weather worth a Storm Center: thunder, ice, and heavy rain or snow.
    // Ordinary rain and light snow opened it too, with a "LIVE" banner over a
    // dial reading Minimal, which taught people to ignore it.
    if (liveCode >= 95) return { kind: 'storm', label: 'Thunderstorm now' }
    if (FREEZING_RAIN_CODES.has(liveCode)) return { kind: 'snow', label: 'Freezing rain now' }
    if (SNOW_CODES.has(liveCode) && precipTier(liveCode) >= 3) return { kind: 'snow', label: 'Heavy snow now' }
    if (!SNOW_CODES.has(liveCode) && precipTier(liveCode) >= 3) return { kind: 'rain', label: 'Heavy rain now' }
    return null
  })()

  // While something is happening over a forecast, the web Home tab is the Storm Center
  // (see WebLayout).
  const stormMode = webLayout && !!brandEvent && !!weather
  // On the phones the card stack stays, and a banner at its top opens the same
  // page as a sheet (see StormSheet), tinted as the page will be.
  const phoneStorm = !webLayout && !!brandEvent && !!weather
  const phoneStormTint = phoneStorm ? stormTint(sortAlerts(alerts).find(isStormAlert), brandEvent.kind) : null

  // The web brand takes you to Home's search field: off Home it reads "Search"
  // (see brandSearch below), and on Home it is the wordmark and just puts the
  // cursor in the field. It leaves the Saved locations view first if that is
  // up. The field mounts with the render this starts (or after the Back that
  // closes Saved), so it is looked for over the next few frames.
  const openWebSearch = () => {
    if (webSplash) { if (splashSaved) closeSplashSaved() }
    else handleNavHome()
    let tries = 12
    const focus = () => {
      const input = document.querySelector('.splash-bg--web .splash-search input')
      if (input) input.focus()
      else if (--tries > 0) requestAnimationFrame(focus)
    }
    requestAnimationFrame(focus)
  }
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
  //
  // .sky-tone-light marks the skies the splash location cards stay light over
  // (the same split as splashSkyTone below). In light mode the iOS weather
  // cards follow it — light glass with dark text over a light sky, dark frost
  // over a dark one — so the forecast and the splash match (see "Light mode
  // over a light sky" in App.css). Those light cards want the plain white-card
  // palette, not the level's lighter tones and text scrims, so iOS drops the
  // level class over a light sky. Dark mode reverts the level's surfaces
  // anyway, so nothing there depends on it.
  const skyToneLight = !!skyC && skyLevel !== 'sky-lvl-dark' && skyLevel !== 'sky-lvl-darkest'
  const levelC   = platformTheme === 'android' || (platformTheme === 'ios' && skyToneLight) ? '' : skyLevel

  // The splash dresses itself in the weather of the most recently opened place
  // (where the device is, when nothing has been opened yet): that sky behind it
  // (with its rain/snow/fog canvas) and that condition's icon in place of the
  // logo. Opening a place puts it first in recents, so going Home afterwards
  // shows that place's weather. The sky follows the Weather Effects setting like
  // the forecast's does; the icon is just an icon, so it shows either way.
  const liveLocal   = useLocalConditions(splashPhase !== 'done', recents[0] ?? null)
  // Picking a place on the phone splash puts it first in recents, which used to
  // re-dress the splash the moment it was tapped: the sky, icon and headline
  // jumped to that place (or back to the plain wordmark, until it was read) and
  // the two cards swapped places, all while the forecast was still loading
  // behind the spinner. The splash now holds as it was until it has gone, so
  // everything changes once, in the exit. Snapshotted during render: the values
  // from the last render before the hold are the ones on screen.
  const holdSplash = !webLayout && (splashPhase === 'exit' || (splashPhase === 'visible' && (loading || !!weather)))
  const [shownLocal, setShownLocal] = useState(liveLocal)
  if (!holdSplash && shownLocal !== liveLocal) setShownLocal(liveLocal)
  const [shownRecents, setShownRecents] = useState(recents)
  if (!holdSplash && shownRecents !== recents) setShownRecents(recents)
  const localCond     = holdSplash ? shownLocal : liveLocal
  const splashRecents = holdSplash ? shownRecents : recents
  const splashSkyC  = localCond && weatherAnimations ? skyClass(localCond.code, localCond.isDay) : ''
  const splashIcon  = localCond ? getWeatherInfo(localCond.code, !localCond.isDay, localCond.severe) : null

  // The phone splash's "where this weather is" pill opens that place's
  // forecast, as the web one does. It can't live in .splash-bg with the
  // headline (that layer is inert and sits under the tap-catching overlay), so
  // it is drawn above both and hung from the headline's measured bottom edge.
  const splashHere = !webLayout && splashPhase !== 'done' && splashIcon && !splashRecents.length && localCond?.name
    ? locatedPlace()
    : null
  const hasSplashHere = !!splashHere
  const splashExiting = splashPhase === 'exit'
  const splashTextRef = useRef(null)
  const [splashHereTop, setSplashHereTop] = useState(null)
  useLayoutEffect(() => {
    const el = splashTextRef.current
    if (!hasSplashHere || splashExiting || !el) return
    const measure = () => setSplashHereTop(el.getBoundingClientRect().bottom)
    measure()
    // Size changes (a wrap, the font landing), the splash's entrance
    // animation settling, and the viewport itself all move that edge.
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    const logo = el.parentElement
    logo?.addEventListener('animationend', measure)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      logo?.removeEventListener('animationend', measure)
      window.removeEventListener('resize', measure)
    }
  }, [hasSplashHere, splashExiting])

  // Published on <html> because the surfaces that have to react to the splash
  // sky live in different trees: the header buttons inside .app, the location
  // cards beside it. "dark" for the skies the forecast tints its cards for most
  // heavily (night, rain, storm), which is where a light-mode surface glares.
  // A layout effect, so it lands in the same frame as the render that shows or
  // hides the splash. As a plain effect it trailed by a frame: going Home, the
  // nav bar was painted once as the forecast's opaque card before turning to
  // the splash's glass, and leaving, once as glass over the forecast, which
  // read as a flash behind the bar on every switch.
  const splashSkyTone = splashSkyC && splashPhase !== 'done'
    ? (SKY_LEVEL[splashSkyC] === 'sky-lvl-dark' || SKY_LEVEL[splashSkyC] === 'sky-lvl-darkest' ? 'dark' : 'light')
    : ''
  useLayoutEffect(() => {
    const root = document.documentElement
    if (splashSkyTone) root.dataset.splashSky = splashSkyTone
    else delete root.dataset.splashSky
  }, [splashSkyTone])

  // What the phone's one sky (SkyStage) shows: the splash's while the splash is
  // up, the forecast's from the moment the exit starts. Through a pick (a
  // forecast already in, the splash still holding) and on the way Home (the
  // forecast still under the splash) it stays on whichever was there, so it
  // only ever changes as the screen does. Going Home to the place on screen,
  // or opening the place the splash shows, both are the same sky (the splash
  // reads the forecast's own reading, see placeConditions), so it doesn't
  // change at all.
  const splashOwnsSky = !webLayout && !!splashSkyC && (splashPhase === 'visible' || !weather)
  const stageSky = splashOwnsSky
    ? { c: splashSkyC, code: localCond.code }
    : weather && weatherAnimations ? { c: skyC, code: liveCode } : null

  // Keep the theme-color metas (status bar) and the body background (navigation
  // bar) matched to the sky, or to the flat app background when effects are
  // off, so both Android system bars stay consistent with what is behind them.
  // On the phone that is the shared sky, splash or forecast, so the bars don't
  // change as one screen hands over to the other (they used to stay flat on
  // the splash and switch to the sky partway through opening a place).
  const barSkyC = webLayout ? (weather && weatherAnimations ? skyC : '') : (stageSky?.c ?? '')
  useEffect(() => {
    const metas = document.querySelectorAll('meta[name="theme-color"]')
    const skyActive = barSkyC && SKY_THEME_COLOR[barSkyC]
    const apply = (dark) => {
      const color = skyActive ? SKY_THEME_COLOR[barSkyC][dark ? 1 : 0] : (dark ? '#000000' : '#f0f2f5')
      metas.forEach(m => { m.content = color })
      // The navigation bar only honors the page background when the document's
      // color-scheme matches the effective theme; set it on the root so it also
      // wins when the in-app theme overrides the system one.
      document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
      // Clearing the inline style hands body back to var(--bg), which already
      // tracks the theme. The sky layer covers the viewport, so this override
      // is invisible to everything except the system bar.
      document.body.style.backgroundColor = skyActive ? SKY_NAV_COLOR[barSkyC][dark ? 1 : 0] : ''
    }
    if (darkMode === 'on')  { apply(true);  return }
    if (darkMode === 'off') { apply(false); return }
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    apply(mq.matches)
    const handler = (e) => apply(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [darkMode, barSkyC])

  // The sky the next launch's boot screen opens on (public/boot-sky.js): the
  // gradient behind the forecast as actually drawn, so the theme's version of
  // it, kept with the place it is for. With effects off the forecast sits on
  // the flat background, so nothing is kept and the boot screen stays plain
  // too. With no forecast up (the splash, or still loading) the last one
  // stands. While this launch's boot screen is still up, it is brought in line
  // with the sky the app actually opened on, should that differ from the one it
  // started with (night has fallen since, or the theme changed): it fades in if
  // the screen had none, and swaps otherwise.
  const skyBgRef = useRef(null)
  const hasWeather = !!weather
  const skyLat = location?.latitude
  const skyLon = location?.longitude
  useEffect(() => {
    // While the phone splash still owns the shared sky, the gradient on screen
    // is the splash's, not this forecast's: wait for the exit to hand it over.
    if (!hasWeather || splashOwnsSky) return
    const save = () => {
      const bg = skyBgRef.current ? getComputedStyle(skyBgRef.current).backgroundImage : ''
      const sky = bg.includes('gradient(') ? bg : null
      try {
        if (sky && skyLat != null) {
          const at = [Math.round(skyLat * 100) / 100, Math.round(skyLon * 100) / 100]
          localStorage.setItem(BOOT_SKY_KEY, JSON.stringify({ bg: sky, at }))
        } else localStorage.removeItem(BOOT_SKY_KEY)
      } catch { /* not kept: the next boot screen is plain */ }
      // The APK's native launch screen keeps its own copy, and takes this one
      // now if it is still up.
      rememberBootLook()
      if (!document.getElementById('boot')) return
      const root = document.documentElement
      if (sky) {
        root.style.setProperty('--boot-sky', sky)
        root.setAttribute('data-boot-sky', '')
      } else root.removeAttribute('data-boot-sky')
    }
    save()
    // On the System theme the sky's dark version follows the OS setting.
    if (darkMode !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', save)
    return () => mq.removeEventListener('change', save)
  }, [darkMode, skyC, hasWeather, weatherAnimations, skyLat, skyLon, splashOwnsSky])

  const blockComponents = weather && !loading ? {
    today:   <TodayCard hourly={weather.hourly} daily={weather.daily} current={weather.current} yesterday={weather.yesterday} timezone={weather.timezone} unit={unit} units={units} airQuality={airQuality} />,
    overview: <WeatherOverview hourly={weather.hourly} daily={weather.daily} current={weather.current} minutely={weather.minutely_15} radarClear={radarClear} timezone={weather.timezone} hasActiveAlert={hasActiveAlert} unit={unit} units={units} airQuality={airQuality} colorCode={colorCoding.overview} />,
    hourly:  <HourlyForecast hourly={weather.hourly} daily={weather.daily} timezone={weather.timezone} unit={unit} units={units} colorCoding={colorCoding.hourly} glow={colorCoding.glow} frost={colorCoding.frost} current={weather.current} minutely={weather.minutely_15} radarClear={radarClear} />,
    daily:   <DailyForecast daily={weather.daily} hourly={weather.hourly} timezone={weather.timezone} unit={unit} units={units} colorCoding={colorCoding.daily} glow={colorCoding.glow} frost={colorCoding.frost} current={weather.current} minutely={weather.minutely_15} radarClear={radarClear} yesterday={weather.yesterday} airQuality={airQuality} />,
    details: <WeatherDetails latitude={weather.latitude} current={weather.current} daily={weather.daily} hourly={weather.hourly} timezone={weather.timezone} unit={unit} units={units} airQuality={airQuality} colorCoding={colorCoding.details} />,
    // No rain over the radar on the phone styles: the overlay is a particle
    // field across the whole map plus a read-back of its tiles several times a
    // second, and on a phone that was cost on top of the map itself for an
    // effect nobody needs to read the radar. The web layout keeps it.
    radar:   <WeatherRadar location={location} timezone={weather.timezone} mode={radarMode} source={radarSource} sky={weatherAnimations ? skyC : ''} rainFx={weatherAnimations && webLayout} snow={isSnowing(weather.current)} />,
    nowcast: <PrecipNowcast minutely={weather.minutely_15} currentTime={weather.current.time} mode={nowcastMode} current={weather.current} radarClear={radarClear} radarTrend={radarTrend} />,
  } : null
  // The cards the phone stack can hold (the right column on desktop, where a
  // few live in the left column instead), in the saved order; then the ones
  // showing, and the ones removed, which reorder mode lists to add back.
  const stackable = blockOrder.filter(id => id !== 'aqi'
    && !(isDesktop && (id === 'nowcast' || id === 'overview' || id === 'today')))
  const stackBlocks = stackable.filter(isBlockShown)
  const removedBlocks = stackable.filter(id => !isBlockShown(id))

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
  //
  // A failed fetch keeps it up too: the error card used to sit under the old
  // corner-button header, with no Home tab to get back out by.
  const forecastFailed = !!error && !loading && !weather
  const headerTabs = webLayout && splashPhase === 'done' && (!!weather || navPageUp || forecastFailed)

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
  // The wordmark goes Home once a forecast is up, while it is the visible
  // header (not covered by the place line or handed off to the tab bar).
  const titleIsButton = splashPhase === 'done' && !!weather && !showNav && !placeInHeader

  // The Radar tab's full-bleed layout. On from the moment the splash starts
  // fading as well as once it has gone: the forecast is revealed under the fade,
  // and gating this on headerTabs alone showed the radar as an ordinary card for
  // the length of the fade before it snapped out to fill the page.
  const radarPageUp = webLayout && !!weather && !navPageUp && webTab === 'radar' && (headerTabs || splashPhase === 'exit')
  // On Locations or Settings with nothing loaded and nowhere to load (a first
  // visit that went straight to Settings), the forecast tabs have nothing to
  // open, so they are offered but disabled.
  //
  // While something is happening (stormMode), Home is the Storm Center, and its
  // tab says so: renamed, and glowing in the colour of what is happening (see
  // "Storm Center glow" in WebApp.css), with the event itself as its tooltip.
  // Memoised on those few values: WebTabs re-measures its pill whenever the
  // array changes, so a fresh one every render would re-measure every render.
  const tabsDisabled = !weather && !navCity && !forecastFailed
  const stormTabKind = stormMode ? brandEvent.kind : null
  const stormTabLabel = stormMode ? brandEvent.label : null
  const navTabs = useMemo(() => WEB_TABS.map((t) => {
    if (tabsDisabled) return { ...t, disabled: true }
    if (t.id === 'today' && stormTabKind) {
      return { ...t, label: 'Storm Center', title: stormTabLabel, className: `web-tab--event web-tab--${stormTabKind}` }
    }
    return t
  }), [tabsDisabled, stormTabKind, stormTabLabel])
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
    } else if (!weather && !loading && error && !fromPage) {
      // On a failed fetch, a tab is another go at the place that failed.
      retry()
    }
  }
  // Settings trails the bar behind a divider. There is no Locations tab: the
  // places you've been and saved are listed on Home.
  const navPages = [
    { id: 'settings', label: 'Settings', onSelect: () => openNavPage('settings') },
  ]
  // With the bar up, Home and Settings are in it, so the header's corner
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
    onHelpOpen: () => openHelp(),
    onExploreOpen: openExplore,
    darkMode,
    onDarkModeChange: changeDarkMode,
    platformTheme,
    onPlatformThemeChange: changePlatformTheme,
    materialColor,
    onMaterialColorChange: changeMaterialColor,
    cardTransparency,
    onCardTransparencyChange: changeCardTransparency,
    cardLayout,
    onCardLayoutChange: changeCardLayout,
    unit,
    onUnitChange: changeUnit,
    units,
    onUnitGroupChange: changeUnitGroup,
    nowcastMode,
    onNowcastModeChange: changeNowcastMode,
    colorCoding,
    onColorCodingToggle: toggleColorCoding,
    onColorCodingAll: setAllColorCoding,
    weatherAnimations,
    onWeatherAnimationsChange: changeWeatherAnimations,
    iconMotion,
    onIconMotionChange: changeIconMotion,
    iconSet,
    onIconSetChange: setIconSet,
    gyroscope,
    onGyroscopeChange: changeGyroscope,
    haptics,
    onHapticsChange: changeHaptics,
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

  const weatherPanel = weather && !loading && !navPageUp && (webLayout ? web && (
    <web.WebLayout
      tab={webTab}
      onNavigate={setWebTab}
      weather={weather}
      location={location}
      airQuality={airQuality}
      alerts={alerts}
      unit={unit}
      units={units}
      radarClear={radarClear}
      radarTrend={radarTrend}
      lastUpdated={lastUpdated}
      loading={loading}
      colorCoding={colorCoding}
      weatherAnimations={weatherAnimations}
      nowcastMode={nowcastMode}
      radarMode={radarMode}
      radarSource={radarSource}
      hasActiveAlert={hasActiveAlert}
      saved={isSaved(location)}
      onSave={saveCurrent}
      onRemove={removeCurrent}
      isHome={isHome(location)}
      hasHome={!!home}
      onGoHome={goHome}
      onSetHome={setHomeCurrent}
      onUnsetHome={unsetHome}
      onRefresh={refreshCurrent}
      // While something is happening, the Home tab is the Storm Center. Strings
      // rather than the brandEvent object, which is rebuilt every render.
      stormKind={stormMode ? brandEvent.kind : null}
      stormLabel={stormMode ? brandEvent.label : null}
    />
  ) : (
    <>
      {/* Set aside while reordering, so the list of cards starts at the top
          of the screen. Hidden rather than unmounted, so the reading and its
          alerts are just as they were on Done. */}
      <div className="weather-left" hidden={reordering}>
        {phoneStorm && (
          <StormCenterBanner
            kind={brandEvent.kind}
            label={brandEvent.label}
            tint={phoneStormTint}
            onOpen={openStormCenter}
          />
        )}
        <WeatherAlerts
          alerts={alerts}
          location={location}
          // Each alert's sheet carries a button into the Storm Center.
          onStormCenter={webLayout ? null : openStormCenter}
        />
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
          onSave={saveCurrent}
          onRemove={removeCurrent}
          isHome={isHome(location)}
          hasHome={!!home}
          onGoHome={goHome}
          onSetHome={setHomeCurrent}
          onUnsetHome={unsetHome}
          lastUpdated={lastUpdated}
          onRefresh={refreshCurrent}
          loading={loading}
          colorCoding={colorCoding.current}
          glow={colorCoding.glow}
          frost={colorCoding.frost}
        />
        {/* On desktop the compact precipitation chart sits under the current
            weather instead of stretching the wide right column. On mobile it
            stays in the reorderable block list below. */}
        {isDesktop && isBlockShown('nowcast') && blockComponents.nowcast}
        {isDesktop && isBlockShown('overview') && blockComponents.overview}
      </div>
      <div className={`weather-right${reordering ? ' weather-right--reordering' : ''}`}>
        {reordering ? (
          <>
            <ReorderList
              blocks={stackBlocks}
              removable={REMOVABLE_BLOCKS}
              onRemove={(b) => setBlockShown(b, false)}
              onMove={moveBlock}
            />
            {/* Removed cards, each one tap from coming back. */}
            {removedBlocks.length > 0 && (
              <div className="card reorder-removed">
                <div className="section-label">REMOVED CARDS</div>
                {removedBlocks.map(id => {
                  const { label, Icon } = blockMeta(id)
                  return (
                    <button
                      key={id}
                      type="button"
                      className="reorder-removed-row"
                      onClick={() => setBlockShown(id, true)}
                      aria-label={`Add ${label} back`}
                    >
                      <span className="reorder-row-action reorder-row-action--add" aria-hidden="true">
                        <Plus size={16} strokeWidth={3} />
                      </span>
                      <Icon size={19} className="reorder-row-icon" aria-hidden="true" />
                      <span className="reorder-row-label">{label}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </>
        ) : stackBlocks.map(id => (
          <div key={id} className="sortable-block" data-block={id}>{blockComponents[id]}</div>
        ))}
        {/* Under the last card: the way into reorder mode, and out of it. */}
        <button
          type="button"
          className={`card reorder-btn${reordering ? ' reorder-btn--done' : ''}`}
          onPointerDown={reordering ? undefined : preloadReorderList}
          onClick={reordering ? endReorder : () => setReordering(true)}
        >
          {reordering
            ? <><Check size={18} aria-hidden="true" />Done</>
            : <><ArrowUpDown size={18} aria-hidden="true" />Reorder cards</>}
        </button>
        {/* Where this forecast came from, at the foot of the page. */}
        {!reordering && <SourceNote current={weather.current} minutely={weather.minutely_15} radarClear={radarClear} />}
      </div>
    </>
  ))

  return (
    <>
      {webLayout ? (
        <>
          {weather && weatherAnimations && <div ref={skyBgRef} className={`sky-bg ${skyC}`} aria-hidden="true" />}
          {/* Not held while loading on the web, whose canvas also feeds the
              header's copy of the sky. */}
          {weather && weatherAnimations && <WeatherCanvas code={liveCode} gyro={gyroscope} />}
          {weather && weatherAnimations && <div className="sky-tint" aria-hidden="true" />}
        </>
      ) : (
        // The phone's one sky, for the splash and the forecast alike (see
        // stageSky). Held while a forecast loads on the forecast screen, so the
        // loading animation has the frames to itself (see `hold` in
        // WeatherCanvas); not while one loads under the splash, whose sky
        // carries on behind the card's spinner.
        <SkyStage
          sky={stageSky}
          gyro={gyroscope}
          hold={loading && splashPhase === 'done'}
          animate={bootGone}
          bgRef={skyBgRef}
        />
      )}
    <div
      className={`app${weatherAnimations && levelC ? ` ${levelC}` : ''}${!weatherAnimations ? ' no-effects' : ''}${weather && weatherAnimations ? ' sky-active' : ''}${weather && weatherAnimations && skyToneLight ? ' sky-tone-light' : ''}${headerTabs ? ' app--web-tabs' : ''}${radarPageUp ? ' app--web-radar' : ''}${webSplash ? ' app--web-splash' : ''}${webSplash && splashPhase === 'exit' ? ' app--web-splash-exit' : ''}${webLayout && splashPhase !== 'visible' ? ' app--revealed' : ''}${!webLayout && splashPhase === 'visible' ? ' app--splash-cover' : ''}${!webLayout && splashPhase === 'exit' ? ' app--splash-exit' : ''}${splashPhase === 'enter' ? ' app--splash-enter' : ''}${!webLayout && (splashPhase === 'exit' || splashPhase === 'enter' || (splashPhase === 'visible' && weather)) ? ' app--splash-handoff' : ''}${headerOnSplash ? ' app--on-splash' : ''}`}
      style={weather && weatherAnimations ? SKY_CARD_VARS[skyC] : undefined}
    >
      <header ref={headerRef} className={`app-header${!weather && !showNav ? ' app-header--no-city' : ''}${showNav ? ' app-header--tabs' : ''}${placeInHeader ? ' app-header--float' : ''}${placeInHeader && scrolledDown ? ' app-header--scrolled' : ''}`}>
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
          aria-label="Search. Hold to use my location"
        >
          <span className="header-search-icons">
            {/* The phone shells draw these from Phosphor
                (see headerGlyphs.jsx); the web layout keeps its line icons. */}
            {(() => {
              const LocIcon = webLayout ? Building2 : BuildingsIcon
              const FindIcon = webLayout ? Search : SearchIcon
              return (
                <>
                  <LocIcon size={24} style={{ opacity: headerOnSplash ? 1 : 0, pointerEvents: headerOnSplash ? undefined : 'none' }} />
                  <FindIcon size={24} style={{ opacity: headerOnSplash ? 0 : 1, pointerEvents: headerOnSplash ? 'none' : undefined }} />
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
            className={`app-title${placeInHeader ? ' app-title--behind-place' : ''}${splashPhase === 'visible' || splashPhase === 'enter' ? ' app-title--splash' : ''}${splashPhase === 'exit' ? ' app-title--splash-exit' : ''}${splashPhase === 'done' && weather ? ' app-title--home' : ''}${showNav ? ' app-title--handed-off' : ''}`}
            onClick={handleLogoClick}
            role={titleIsButton ? 'button' : undefined}
            tabIndex={titleIsButton ? 0 : undefined}
            onKeyDown={titleIsButton ? pressOnKey(handleLogoClick) : undefined}
            aria-label={titleIsButton ? 'Go to home' : undefined}
            aria-hidden={showNav || placeInHeader || undefined}
          >Alek Weather</span>
          {/* Phone shells: once a forecast is up, the place and date take the
              wordmark's spot. The wordmark stays mounted underneath, invisible,
              since it is what the splash logo flies into. Tapping the place
              does what tapping the wordmark did: back to the home screen. */}
          {placeInHeader && (
            <span
              className={`app-place${splashPhase === 'exit' ? ' app-place--handoff' : ''}${splashPhase === 'enter' ? ' app-place--leaving' : ''}`}
              onClick={handleLogoClick}
              role="button"
              tabIndex={0}
              onKeyDown={pressOnKey(handleLogoClick)}
              aria-label={`${placeLine}, ${placeDate}. Go to home`}
            >
              <span className="app-place-name">{placeLine}</span>
              <span className="app-place-date">{placeDate}</span>
            </span>
          )}
          {showNav && web && (
            <div className="web-tabs-row">
              <web.WebTabs
                tabs={navTabs} active={navActive} onChange={handleNavTab}
                pages={navPages}
                // The brand rides at the bar's left end, on every screen the
                // bar is on, the splash included. It is the way back to the
                // splash, whose search field is where search lives on the web:
                // on the splash it is the wordmark, and anywhere else it morphs
                // into a search button (see openWebSearch). The version is in
                // Settings > About.
                brand={
                  <span
                    className={`web-brand${navActive === 'home' ? ' web-brand--active web-tab--active' : ' web-brand--search'}`}
                    onClick={openWebSearch}
                    role="button"
                    tabIndex={0}
                    aria-current={navActive === 'home' ? 'page' : undefined}
                    onKeyDown={pressOnKey(openWebSearch)}
                    aria-label={navActive === 'home' ? 'Alek Weather, search for a place' : 'Search for a place'}
                    title={navActive === 'home' ? undefined : 'Search'}
                  >
                    {/* The tabs' selection pill, for when the brand is the
                        selection (the splash). Shares .web-tab-pill so every
                        theme and sky draws it the same; see .web-brand-pill. */}
                    <span className="web-tab-pill web-brand-pill" aria-hidden="true" />
                    <span className="web-brand-logo" aria-hidden="true">
                      {/* The splash logos minus their sun/moon glow and the cloud's lavender tint. */}
                      <img src={`${import.meta.env.BASE_URL}logo-light-header.svg`} alt="" className="web-brand-img web-brand-img--light" />
                      <img src={`${import.meta.env.BASE_URL}logo-dark-header.svg`} alt="" className="web-brand-img web-brand-img--dark" />
                      <Search size={22} strokeWidth={2.3} className="web-brand-glyph" />
                    </span>
                    <span className="web-brand-name" aria-hidden="true">
                      <span className="web-brand-words">
                        <span className="web-brand-first">Alek</span>
                        <span className="web-brand-last">Weather</span>
                      </span>
                      <span className="web-brand-search-word">Search</span>
                    </span>
                  </span>
                }
              />
              {headerTabs && weather && <web.WebAlertPill alerts={alerts} tab={navPageUp ? webPage : webTab} location={location} />}
            </div>
          )}
        </div>
        <button
          className={`settings-btn${settingsOpening ? ' is-opening' : ''}${navOwnsCorners ? ' header-btn--gone' : ''}`}
          style={{ '--cog-spin-ms': `${SETTINGS_OPEN_MS}ms` }}
          onPointerDown={preloadSettings}
          // On the web, Settings is a page in the tab bar; the cog opens it there.
          onClick={webLayout ? () => openNavPage('settings') : showSettings ? closeSettings : openSettings}
          aria-label="Settings"
        >
          {/* Gear on the phone styles; the web layout keeps the sliders. */}
          {webLayout ? <SlidersIcon size={22} /> : <GearIcon size={22} className="settings-gear" />}
        </button>
      </header>

      <div className="app-grid">
        <main className="main-content">
          {navPageUp && webPage === 'settings' && (
            <div className="weather-content weather-content--web">
              <div className="web-shell">
                <SettingsPage page {...settingsProps} />
              </div>
            </div>
          )}
          {loading && !navPageUp && (webLayout ? web && <web.WebLoadingScreen tab={webTab} /> : <LoadingScreen />)}
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
              // A failed forecast with nothing loaded used to be a bare line of
              // red text, and the logo only goes Home once a forecast is up,
              // so search and settings were the only ways off this screen.
              <div className="location-error-card">
                <AlertCircle size={32} className="location-error-icon" />
                <p className="location-error-msg">{error.replace(/^quota:/, '')}</p>
                <div className="location-error-actions">
                  <button className="location-error-search" onClick={retry}>Try again</button>
                  <button className="location-error-search" onClick={handleNavHome}>{webLayout ? 'Search' : 'Home'}</button>
                  {error.startsWith('quota:') && (
                    <button className="location-error-search location-error-help" onClick={() => openHelp('request-limits')}>
                      <HelpCircle size={15} aria-hidden="true" />
                      Help
                    </button>
                  )}
                </div>
              </div>
            )
          )}
          {!weather && !loading && !error && !navPageUp && splashPhase === 'done' && (
            <div className="empty-state" onClick={openSearch} role="button" tabIndex={0} onKeyDown={pressOnKey(openSearch)} aria-label="Search for a location">
              <MapPin size={72} className="empty-pin-icon" />
              <p className="empty-text">{isDesktop ? 'Click anywhere or begin typing to search for a city' : 'Tap to find a location'}</p>
            </div>
          )}
          <div className={`weather-content${webLayout ? ' weather-content--web' : ''}`}>
            {weatherPanel}
          </div>
        </main>

      </div>

      {/* Splash screen — big logo centered, animates to header on city select */}
      {splashPhase !== 'done' && (
        <>
          {/* The splash is decorative on the phone styles, where the whole thing
              is one big "tap to search" target. The web splash puts a real
              search field and location cards on it, so it can't be hidden from
              assistive tech there — only the scenery inside it is. */}
          <div className={`splash-bg${webSplash ? ' splash-bg--web' : ''}${splashSkyC ? ' splash-bg--sky' : ''}${!webLayout && splashPhase === 'exit' ? ' splash-bg--exit' : ''}${splashPhase === 'enter' ? ' splash-bg--enter' : ''}`} aria-hidden={webSplash ? undefined : true}>
            {/* First child so the scenery and content after it paint on top;
                its z-index also keeps the canvas inside it under them. */}
            {/* The web splash draws its own sky. The phone's is the shared one
                behind the app (SkyStage), which shows through this layer. */}
            {splashSkyC && webLayout && (
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
                  src={`${import.meta.env.BASE_URL}logo-transparent.svg`}
                  alt=""
                  className={`splash-logo-img splash-logo-img-light${splashPhase === 'exit' ? ' splash-logo-img--exit' : ''}`}
                  aria-hidden="true"
                />
                <img
                  src={`${import.meta.env.BASE_URL}logo-dark.svg`}
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
              <span className="splash-logo-text" ref={splashTextRef}>
                {localCond?.headline ?? splashIcon?.label ?? (
                  // The web splash keeps its wordmark at the foot from the
                  // first frame, so this line says what it's doing instead of
                  // flashing the old big-wordmark layout while it loads.
                  webSplash && !localConditionsFailed(recents[0] ?? null) ? 'Checking the weather…' : 'Alek Weather'
                )}
              </span>
            </div>
            {webSplash && web && (
              <web.SplashHome
                recents={recents}
                savedCities={cities}
                home={home}
                onRemoveHome={() => setHome(null)}
                unit={unit}
                exiting={splashPhase === 'exit'}
                busy={loading || splashHold}
                active={splashPhase === 'visible' && !showSettings && !savedOpen && !searchOpen && !splashSaved}
                showSaved={splashSaved}
                onCloseSaved={closeSplashSaved}
                onSelect={handleSplashCitySelect}
                onRemoveRecent={removeRecent}
                onRemoveSaved={remove}
                onSearch={searchCity}
                searchResults={searchResults}
                onSelectResult={handleSplashSearchSelect}
                onUseLocation={() => { landFirstPick(); locateMe() }}
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
            {/* On the web the header already carries the brand, so the foot of
                the splash holds the way to the saved locations instead. */}
            {webSplash ? (
              !splashSaved && (
                <button
                  className={`splash-saved-btn${splashPhase === 'exit' ? ' splash-wordmark--exit' : ''}`}
                  onClick={openSplashSaved}
                  disabled={splashPhase !== 'visible'}
                >
                  <Bookmark size={15} aria-hidden="true" />
                  Saved locations
                </button>
              )
            ) : splashIcon && (
              <span className={`splash-wordmark${splashPhase === 'exit' ? ' splash-wordmark--exit' : ''}`}>Alek Weather</span>
            )}
            <p className="splash-version">Version {APP_VERSION_LABEL}</p>
          </div>
          {(splashPhase === 'visible' || splashPhase === 'enter') && !webSplash && (
            // Inert: .splash-bg lets taps through, so this only keeps them from
            // reaching the app hidden underneath. Tapping the poster does nothing.
            // Up while the splash fades in too, over a forecast that is still
            // there for a moment and must not take taps.
            <div className="splash-overlay" aria-hidden="true" />
          )}
          {/* Names the place the sky and icon are showing, found from the
              device, and opens its forecast. When that place is a recent one
              its card carries the location mark instead. Positioned from the
              headline (see splashHereTop) but drawn here, above the overlay,
              so it takes its own taps. */}
          {splashHere && splashHereTop != null && (
            <button
              className={`splash-place${splashExiting ? ' splash-place--exit' : ''}`}
              style={{ top: splashHereTop }}
              onClick={() => handleSplashCitySelect(splashHere)}
              disabled={splashPhase !== 'visible'}
              aria-label={`Show weather for ${splashHere.name}`}
            >
              <Navigation size={13} aria-hidden="true" />
              {splashHere.name}
            </button>
          )}
          {/* Outside .splash-bg on purpose: that layer is inert and sits under
              the overlay, so cards drawn inside it could not be tapped at all.
              A sibling after the overlay takes its own taps. */}
          {!webSplash && (
            <SplashCities
              recents={splashRecents}
              savedCities={cities}
              unit={unit}
              exiting={splashPhase === 'exit'}
              // Fading in on the way Home: inert until the forecast under it
              // has been dropped, or a pick made now would be wiped with it.
              entering={splashPhase === 'enter'}
              busy={loading}
              onSelect={handleSplashCitySelect}
              isHome={isHome}
              // The hold menu on each card.
              isSaved={isSaved}
              onSave={save}
              onUnsave={remove}
              onSetHome={setHome}
              onClearHome={() => setHome(null)}
              onRemoveRecent={removeRecent}
              // Nothing saved means nothing opens on launch: give the poster
              // a way into search. Only while it is idle, so it can't open
              // over a place that is already loading.
              onSearch={cities.length === 0 && !home && (splashPhase === 'visible' || splashPhase === 'enter') ? openSearch : undefined}
            />
          )}
        </>
      )}

      {/* Search overlay — slides down from top */}
      {searchOpen && (
        <>
          <div ref={searchBackdropRef} className={`search-backdrop${searchClosing ? ' closing' : ''}`} onClick={closeSearch} />
          <div ref={searchOverlayRef} className={`search-overlay${searchClosing ? ' closing' : ''}${!webLayout ? ' search-overlay--sheet' : ''}`}>
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
          comes in the way settings does: it is a .settings-page, so it shares
          the phone page transition (Page transition in App.css). */}
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
        <div ref={settingsSkyRef} className={`settings-sky ${skyC}${settingsClosing ? ' closing' : ''}`} aria-hidden="true" />
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
          onRadarOpen={() => openSubView('radar')}
          onWeatherEffectsOpen={() => openSubView('effects')}
          onUnitsOpen={() => openSubView('units')}
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
      {/* The web app: a deploy waiting to be switched to (see WebUpdateToast).
          It and the APK offer below share the bottom of the screen, so the
          update goes first. */}
      {!IS_ANDROID_APP && <WebUpdateToast />}
      {/* The web version on an Android phone: offer the APK once. ApkPrompt
          checks the device itself and stays empty everywhere else. */}
      {!IS_ANDROID_APP && !webUpdateReady && splashPhase === 'done' && <ApkPrompt />}
      {stormOpen && !webLayout && weather && location && (
        <StormSheet
          onClose={closeStormCenter}
          onNavigate={stormNavigate}
          // The event can end with the sheet open; the page then reads as
          // all clear rather than closing under the reader.
          stormKind={brandEvent?.kind ?? null}
          stormLabel={brandEvent?.label ?? null}
          weather={weather}
          location={location}
          alerts={alerts}
          unit={unit}
          units={units}
          radarClear={radarClear}
          radarTrend={radarTrend}
          nowcastMode={nowcastMode}
          radarMode={radarMode}
          radarSource={radarSource}
          weatherAnimations={weatherAnimations}
          lastUpdated={lastUpdated}
          loading={loading}
          onRefresh={refreshCurrent}
          saved={isSaved(location)}
          onSave={saveCurrent}
          onRemove={removeCurrent}
          isHome={isHome(location)}
          onSetHome={setHomeCurrent}
          onUnsetHome={unsetHome}
        />
      )}
      {exploreOpen && (
        <ExplorePage unit={unit} units={units} onClose={closeExplore} onGo={exploreGo} />
      )}
      {help && (
        <HelpPage
          article={help.article}
          onSelect={(article) => setHelp({ article })}
          onClose={closeHelp}
        />
      )}
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
