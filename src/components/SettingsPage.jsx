import { useState, useEffect, useRef } from 'react'
import { ArrowLeft, ChevronRight, ChevronDown, X, Info } from 'lucide-react'
import { APP_VERSION, ANDROID_VERSION, IS_ANDROID_APP } from '../utils/version'
import { IS_PHONE } from '../utils/device'
import { UNIT_GROUPS, UNIT_GROUP_KEYS } from '../utils/units'

function SettingRow({ label, children }) {
  return (
    <div className="settings-row">
      <div className="settings-row-label">{label}</div>
      {children}
    </div>
  )
}

function SegmentedControl({ options, value, onChange }) {
  return (
    <div className="settings-options">
      {options.map((opt) => (
        <button
          key={opt.value}
          className={`setting-opt ${value === opt.value ? 'active' : ''}`}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

function Toggle({ id, checked, onChange }) {
  return (
    <label className="toggle-switch" htmlFor={id}>
      <input id={id} type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
      <span className="toggle-track" />
    </label>
  )
}

// A toggle row with an inline (i) button that reveals a short explanation below.
function RadarEnhancedRow({ checked, onChange }) {
  const [info, setInfo] = useState(false)
  return (
    <>
      <div className="settings-row">
        <div className="settings-row-labelwrap">
          <span className="settings-row-label">Enhanced accuracy</span>
          <button
            className={`settings-info-btn${info ? ' open' : ''}`}
            onClick={() => setInfo(v => !v)}
            aria-label="About enhanced accuracy"
            aria-expanded={info}
          >
            <Info size={15} />
          </button>
        </div>
        <Toggle id="toggle-radar-enhanced" checked={checked} onChange={onChange} />
      </div>
      {info && (
        <p className="settings-row-info">
          Uses the radar to more accurately display data about the current conditions for your area. </p>
      )}
    </>
  )
}

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || !!window.navigator.standalone

const isMobileDevice = () =>
  /iPad|iPhone|iPod|Android|Mobi/i.test(navigator.userAgent)

const isIOS = () => /iPad|iPhone|iPod/i.test(navigator.userAgent)

function InstallSection({ installPrompt, onInstall }) {
  if (isStandalone() || !isMobileDevice()) return null

  if (installPrompt) {
    return (
      <div className="card settings-card">
        <SettingRow label="Add to Home Screen">
          <button className="install-btn" onClick={onInstall}>Install</button>
        </SettingRow>
      </div>
    )
  }

  if (isIOS()) {
    return (
      <div className="card settings-card">
        <SettingRow label="Add to Home Screen">
          <span className="install-ios-hint">Tap Share → Add to Home Screen</span>
        </SettingRow>
      </div>
    )
  }

  return null
}

function ClearStorageSection() {
  const [cleared, setCleared] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function handleClear() {
    // Only clear the service-worker app-shell cache, not localStorage —
    // saved cities and settings live in localStorage and should survive a refresh.
    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(keys.map(k => caches.delete(k)))
    }
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(regs.map(r => r.unregister()))
    }
    setCleared(true)
    setTimeout(() => window.location.reload(), 600)
  }

  // Destructive: wipes every stored preference and saved place. First tap arms
  // the confirm (auto-disarms after a few seconds); the second tap deletes.
  async function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true)
      setTimeout(() => setConfirmDelete(false), 3500)
      return
    }
    setDeleting(true)
    // Full factory reset: saved cities, home, recent searches, unit, theme,
    // color coding, tile order, nowcast/radar prefs — all live in localStorage.
    localStorage.clear()
    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(keys.map(k => caches.delete(k)))
    }
    setTimeout(() => window.location.reload(), 500)
  }

  return (
    <div className="card settings-card">
      <button className="settings-row clear-cache-btn" onClick={handleClear} disabled={cleared || deleting}>
        <div className="settings-row-label">{cleared ? 'Refreshing…' : 'Refresh app'}</div>
      </button>
      <button
        className={`settings-row clear-cache-btn delete-data-btn${confirmDelete ? ' confirming' : ''}`}
        onClick={handleDelete}
        onBlur={() => setConfirmDelete(false)}
        disabled={deleting || cleared}
      >
        <div className="settings-row-label">
          {deleting ? 'Deleting…' : confirmDelete ? 'Tap again to delete all data' : 'Delete data'}
        </div>
      </button>
    </div>
  )
}

function AboutSection() {
  const [open, setOpen] = useState(false)

  return (
    <div className="card settings-card">
      <button className="settings-row about-row" onClick={() => setOpen(v => !v)}>
        <div className="settings-row-label">About</div>
        <ChevronRight size={16} className={`about-chevron ${open ? 'open' : ''}`} />
      </button>
      {open && (
        <div className="about-content">
          <p className="about-desc">
            Alek Weather uses free, open-source weather APIs. US locations use NWS for improved hourly accuracy.
          </p>
          <div className="about-apis">
            <div className="about-api-row">
              <span className="about-api-name">Weather &amp; Forecast</span>
              <span className="about-api-url">api.open-meteo.com</span>
            </div>
            <div className="about-api-row">
              <span className="about-api-name">US Hourly Forecast</span>
              <span className="about-api-url">api.weather.gov</span>
            </div>
            <div className="about-api-row">
              <span className="about-api-name">Weather Alerts</span>
              <span className="about-api-url">api.weather.gov</span>
            </div>
            <div className="about-api-row">
              <span className="about-api-name">Air Quality</span>
              <span className="about-api-url">air-quality-api.open-meteo.com</span>
            </div>
            <div className="about-api-row">
              <span className="about-api-name">Geocoding</span>
              <span className="about-api-url">geocoding-api.open-meteo.com</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// APK-only self-updater. The web build gates it on IS_ANDROID_APP, and all the
// networking/install happens natively (window.AndroidUpdate, defined in
// MainActivity); this is only the UI. Manual: nothing runs until "Check" is
// tapped. Native reports back via `alekupdate` / `alekupdateprogress` events.
function UpdateSection() {
  // idle | checking | current | available | downloading | permission | error
  const [phase, setPhase] = useState('idle')
  const [latest, setLatest] = useState('')
  const [pct, setPct] = useState(0)
  const urlRef = useRef(null)

  useEffect(() => {
    const onResult = (e) => {
      const d = e.detail || {}
      if (d.status === 'available') { urlRef.current = d.url; setLatest(d.latest); setPhase('available') }
      else if (d.status === 'current') { setLatest(d.latest); setPhase('current') }
      else if (d.status === 'permission') setPhase('permission')
      else setPhase('error')
    }
    const onProgress = (e) => { setPct(Number(e.detail) || 0); setPhase('downloading') }
    window.addEventListener('alekupdate', onResult)
    window.addEventListener('alekupdateprogress', onProgress)
    return () => {
      window.removeEventListener('alekupdate', onResult)
      window.removeEventListener('alekupdateprogress', onProgress)
    }
  }, [])

  const check = () => { setPhase('checking'); window.AndroidUpdate?.check() }
  const install = () => { setPct(0); setPhase('downloading'); window.AndroidUpdate?.install(urlRef.current) }

  const status = {
    checking: 'Checking for updates…',
    current: `You're on the latest version (${ANDROID_VERSION}).`,
    downloading: `Downloading… ${pct}%`,
    permission: 'Allow installs from Alek Weather, then tap Update again.',
    error: "Couldn't check for updates. Try again later.",
  }[phase]

  return (
    <div className="card settings-card">
      <div className="settings-row">
        <div className="settings-row-label">
          {phase === 'available' ? `Version ${latest} available` : 'App updates'}
        </div>
        {phase === 'available'
          ? <button className="install-btn" onClick={install}>Update</button>
          : <button className="install-btn" onClick={check} disabled={phase === 'checking' || phase === 'downloading'}>Check</button>}
      </div>
      {status && <p className="settings-row-info">{status}</p>}
    </div>
  )
}


const NOTIFY_TYPE_LABELS = {
  rain:     'Rain, Snow & Storms',
  alerts:   'Weather Alerts',
  tomorrow: 'Weather Tomorrow',
}

// APK-only (gated by IS_ANDROID_APP where the row into it is rendered): the
// master toggle drives the native POST_NOTIFICATIONS grant. 'default' shows an
// off toggle that prompts on tap; 'denied' points the user to the system
// settings; with the grant in hand the per-type toggles come alive, dimmed and
// inert until then in the same way the Weather Overview options are.
function NotificationsView({ notifyEnabled, notifyTypes, permission, onEnabledChange, onTypeToggle, onBack }) {
  const unsupported = permission === 'unsupported'
  const denied = permission === 'denied'
  const active = notifyEnabled && permission === 'granted'

  return (
    <>
      {onBack && (
        <button className="back-btn color-coding-back" onClick={onBack} aria-label="Back to settings">
          <ArrowLeft size={18} />
          <span>Back</span>
        </button>
      )}
      <p className="color-coding-desc">Get notified about rain on the way, weather alerts for your area, and what tomorrow looks like.</p>
      <div className="card settings-card">
        <SettingRow label="Notifications">
          {unsupported ? (
            <span className="notify-status-label">Not supported</span>
          ) : (
            <Toggle id="toggle-notify" checked={active} onChange={onEnabledChange} />
          )}
        </SettingRow>
        {denied && (
          <p className="notify-hint">Notifications are blocked. Enable them for Alek Weather in your device's app settings.</p>
        )}
      </div>
      <p className="color-coding-desc">Choose what's worth a notification.</p>
      <div className={`card settings-card${active ? '' : ' settings-card--disabled'}`}>
        {Object.entries(NOTIFY_TYPE_LABELS).map(([type, label]) => (
          <SettingRow key={type} label={label}>
            <Toggle
              id={`toggle-notify-${type}`}
              checked={notifyTypes.includes(type)}
              onChange={() => onTypeToggle(type)}
            />
          </SettingRow>
        ))}
      </div>
      <p className="color-coding-desc">The forecast is checked about once an hour in the background, including when the app is closed. Precipitation notices say when it starts and how long it lasts, and repeat only if the day turns worse. Rain, snow, and tomorrow's summary stay quiet overnight; severe weather and alerts arrive whenever they're issued.</p>
    </>
  )
}

const COLOR_CODING_TILES = [
  { key: 'current',  label: 'Current Weather'  },
  { key: 'hourly',   label: 'Hourly Forecast'  },
  { key: 'daily',    label: '7-Day Forecast'   },
  { key: 'overview', label: 'Weather Overview' },
  { key: 'details',  label: 'Weather Details'  },
]

function ColorCodingView({ colorCoding, onToggle, onBack, webShell }) {
  // Same reason the Tiles entry goes on desktop: the overview isn't on the page
  // there, so a switch for how it colours its readings has nothing to colour.
  const tiles = webShell
    ? COLOR_CODING_TILES.filter(t => t.key !== 'overview')
    : COLOR_CODING_TILES
  return (
    <>
      {onBack && (
        <button className="back-btn color-coding-back" onClick={onBack} aria-label="Back to settings">
          <ArrowLeft size={18} />
          <span>Back</span>
        </button>
      )}
      <p className="color-coding-desc">Choose which tiles color their readings by how hot, cold, or severe they are.</p>
      <div className="card settings-card">
        {tiles.map(({ key, label }) => (
          <SettingRow key={key} label={label}>
            <Toggle id={`toggle-cc-${key}`} checked={colorCoding[key]} onChange={() => onToggle(key)} />
          </SettingRow>
        ))}
      </div>
      <p className="color-coding-desc">Add a glow to color-coded temperatures at the extremes: a warm glow when it's very hot, a frosty one when it's freezing.</p>
      <div className="card settings-card">
        <SettingRow label="Heat Glow">
          <Toggle id="toggle-cc-glow" checked={colorCoding.glow} onChange={() => onToggle('glow')} />
        </SettingRow>
        <SettingRow label="Frozen Effect">
          <Toggle id="toggle-cc-frost" checked={colorCoding.frost} onChange={() => onToggle('frost')} />
        </SettingRow>
      </div>
    </>
  )
}

function WeatherEffectsView({ weatherAnimations, onWeatherAnimationsChange, gyroscope, onGyroscopeChange, onBack }) {
  return (
    <>
      {onBack && (
        <button className="back-btn color-coding-back" onClick={onBack} aria-label="Back to settings">
          <ArrowLeft size={18} />
          <span>Back</span>
        </button>
      )}
      <p className="color-coding-desc">Color and animate the background with the current conditions: rain, snow, clouds, and more.</p>
      <div className="card settings-card">
        <SettingRow label="Weather Effects">
          <Toggle id="toggle-weather-anim" checked={weatherAnimations} onChange={onWeatherAnimationsChange} />
        </SettingRow>
      </div>
      {/* Gyroscope tilt only matters where there's a motion sensor and the
          effects are actually drawn, so it's mobile-only. */}
      {isMobileDevice() && (
        <>
          <p className="color-coding-desc">Tilt the effects with your device's motion for a sense of depth.</p>
          <div className={`card settings-card${weatherAnimations ? '' : ' settings-card--disabled'}`}>
            <SettingRow label="Gyroscope Tilt">
              <Toggle id="toggle-gyroscope" checked={gyroscope} onChange={onGyroscopeChange} />
            </SettingRow>
          </div>
        </>
      )}
    </>
  )
}

function OverviewSettingsView({ showOverview, onShowOverviewChange, overviewParts, onToggle, onBack }) {
  const disabled = !showOverview
  return (
    <>
      {onBack && (
        <button className="back-btn color-coding-back" onClick={onBack} aria-label="Back to settings">
          <ArrowLeft size={18} />
          <span>Back</span>
        </button>
      )}
      <p className="color-coding-desc">Show the Weather Overview tile and get a summary with insights and recommendations.</p>
      <div className="card settings-card">
        <SettingRow label="Show Weather Overview">
          <Toggle id="toggle-overview" checked={showOverview} onChange={onShowOverviewChange} />
        </SettingRow>
      </div>
      <p className="color-coding-desc">Choose what the overview includes.</p>
      <div className={`card settings-card${disabled ? ' settings-card--disabled' : ''}`}>
        <SettingRow label="Weather Insight">
          <Toggle id="toggle-ov-insight" checked={overviewParts.insight} onChange={() => onToggle('insight')} />
        </SettingRow>
        <SettingRow label="Current Conditions">
          <Toggle id="toggle-ov-conditions" checked={overviewParts.conditions} onChange={() => onToggle('conditions')} />
        </SettingRow>
        <SettingRow label="Clothing Suggestions">
          <Toggle id="toggle-ov-clothing" checked={overviewParts.clothing} onChange={() => onToggle('clothing')} />
        </SettingRow>
      </div>
      <p className="color-coding-desc">Recommendations</p>
      <div className={`card settings-card${disabled ? ' settings-card--disabled' : ''}`}>
        <SettingRow label="Air Quality Warnings">
          <Toggle id="toggle-ov-aqi" checked={overviewParts.airQuality} onChange={() => onToggle('airQuality')} />
        </SettingRow>
      </div>
    </>
  )
}

// Seed colors for the Material You palette. Each is a source color, not a token
// the app paints directly — the palette generator derives the whole light/dark
// token set from it, so these read as the swatch colors and roughly as the
// light-mode primary. Anything outside the presets goes through the browser's
// own color picker on the last swatch.
const MATERIAL_SEEDS = [
  { value: '#6750a4', label: 'Purple'  },
  { value: '#0b57d0', label: 'Blue'    },
  { value: '#00696e', label: 'Teal'    },
  { value: '#146c2e', label: 'Green'   },
  { value: '#8f4c00', label: 'Orange'  },
  { value: '#b3261e', label: 'Red'     },
  { value: '#8c4a60', label: 'Rose'    },
]

// The most transparent a card may get. Past this the label on it is reading
// against the sky animation rather than against a surface, and the card has
// stopped being a card. Exported because App.jsx clamps the stored value to it
// — a value past this one would mix the fill at a negative opacity, which is
// not a color, which is a card with no background at all.
export const MAX_CARD_TRANSPARENCY = 50

// The transparency control itself, shared by the two phone styles. Both thin
// their card stack over the same sky, so the row, its peek behaviour and the
// stored value are identical — only what each style does with the number
// differs (see the effect in App.jsx).
//
// It goes dead when weather effects are off, because what the slider does is
// let the sky through and there is no sky then — App.jsx stops applying the
// value at the same point, so a control that still moved would be one that did
// nothing. The stored value survives, so the look comes back with the effects.
function CardTransparencyRow({ transparency, onTransparencyChange, onPeekChange, disabled }) {
  return (
    <div className={`settings-row md-slider-row${disabled ? ' settings-row--disabled' : ''}`}>
      <div className="settings-row-label">Card Transparency</div>
      <div className="md-slider-wrap">
        {/* Holding the thumb clears the settings page away so the change
            lands on the real cards while it's being made. The page is only
            faded, never unmounted, and nothing moves: this input owns the
            pointer for the length of the gesture, and taking it out of the
            document — or letting the row reflow under the thumb — would
            strand the drag. */}
        <input
          className="md-slider"
          type="range"
          min="0"
          max={MAX_CARD_TRANSPARENCY}
          step="5"
          value={transparency}
          /* WebKit can't paint the filled half of the track on its own —
             --fill is the gradient stop that stands in for it. */
          style={{ '--fill': `${(transparency / MAX_CARD_TRANSPARENCY) * 100}%` }}
          disabled={disabled}
          onChange={e => onTransparencyChange(Number(e.target.value))}
          onPointerDown={() => onPeekChange(true)}
          onPointerUp={() => onPeekChange(false)}
          onPointerCancel={() => onPeekChange(false)}
          aria-label="Card transparency"
        />
      </div>
    </div>
  )
}

// Explains a slider that has gone grey, so it doesn't read as broken. Only
// shown in the one case that greys it.
function NoSkyNote() {
  return (
    <p className="color-coding-desc">
      Card transparency needs a sky to show through; turn Weather Effects back on to use it.
    </p>
  )
}

function GlassSection({ transparency, onTransparencyChange, onPeekChange, weatherAnimations }) {
  return (
    <>
      <p className="color-coding-desc">Choose how much of the sky behind the cards shows through the glass.</p>
      <div className="card settings-card md-peek-host">
        <CardTransparencyRow
          transparency={transparency}
          onTransparencyChange={onTransparencyChange}
          onPeekChange={onPeekChange}
          disabled={!weatherAnimations}
        />
      </div>
      {!weatherAnimations && <NoSkyNote />}
    </>
  )
}

function MaterialYouSection({ color, onColorChange, transparency, onTransparencyChange, onPeekChange, weatherAnimations }) {
  const custom = !MATERIAL_SEEDS.some(seed => seed.value === color)
  return (
    <>
      <p className="color-coding-desc">Choose the color the Material You theme is built from.</p>
      <div className="card settings-card md-peek-host">
        <div className="settings-row md-color-row">
          <div className="settings-row-label">Theme Color</div>
          <div className="md-swatches">
            {MATERIAL_SEEDS.map(seed => (
              <button
                key={seed.value}
                className={`md-swatch${color === seed.value ? ' active' : ''}`}
                style={{ '--swatch': seed.value }}
                onClick={() => onColorChange(seed.value)}
                aria-label={seed.label}
                aria-pressed={color === seed.value}
                title={seed.label}
              />
            ))}
            {/* The custom slot shows a spectrum until it holds the live color.
                The <input> is the whole hit area — clicking it opens the OS
                color picker, so no separate button is needed. */}
            <label
              className={`md-swatch md-swatch--custom${custom ? ' active' : ''}`}
              style={custom ? { '--swatch': color } : undefined}
              title="Custom color"
            >
              <input
                type="color"
                value={color}
                onChange={e => onColorChange(e.target.value)}
                aria-label="Custom theme color"
              />
            </label>
          </div>
        </div>
        <CardTransparencyRow
          transparency={transparency}
          onTransparencyChange={onTransparencyChange}
          onPeekChange={onPeekChange}
          disabled={!weatherAnimations}
        />
      </div>
      {!weatherAnimations && <NoSkyNote />}
    </>
  )
}

function ThemeView({ darkMode, onDarkModeChange, platformTheme, onPlatformThemeChange, materialColor, onMaterialColorChange, cardTransparency, onCardTransparencyChange, onPeekChange, weatherAnimations, onBack }) {
  return (
    <>
      {onBack && (
        <button className="back-btn color-coding-back" onClick={onBack} aria-label="Back to settings">
          <ArrowLeft size={18} />
          <span>Back</span>
        </button>
      )}
      <p className="color-coding-desc">Choose the app's appearance.</p>
      <div className="card settings-card">
        <SettingRow label="Theme">
          <SegmentedControl
            value={darkMode}
            onChange={onDarkModeChange}
            options={[
              { value: 'off',    label: 'Light'  },
              { value: 'on',     label: 'Dark'   },
              { value: 'system', label: 'System' },
            ]}
          />
        </SettingRow>
      </div>
      <p className="color-coding-desc">
        {IS_PHONE
          ? "Choose the app's style."
          : "Choose the app's style."}
      </p>
      <div className="card settings-card">
        <SettingRow label="App Style">
          {/* No Web on a phone: the desktop app's header controls, settings
              among them, don't fit that width, and a screen you can't reach
              settings from is a screen you can't leave. */}
          <SegmentedControl
            value={platformTheme}
            onChange={onPlatformThemeChange}
            options={[
              { value: 'ios',     label: 'iOS'     },
              { value: 'android', label: 'Android' },
              ...(IS_PHONE ? [] : [{ value: 'web', label: 'Web' }]),
            ]}
          />
        </SettingRow>
      </div>
      {/* Only Android draws itself from the Material You tokens, so the seed
          picker is its alone. Transparency rides along there and stands on its
          own under iOS, whose glass thins the same way. Web has neither: its
          cards are a desktop surface, not a layer over the sky. */}
      {platformTheme === 'android' && (
        <MaterialYouSection
          color={materialColor}
          onColorChange={onMaterialColorChange}
          transparency={cardTransparency}
          onTransparencyChange={onCardTransparencyChange}
          onPeekChange={onPeekChange}
          weatherAnimations={weatherAnimations}
        />
      )}
      {platformTheme === 'ios' && (
        <GlassSection
          transparency={cardTransparency}
          onTransparencyChange={onCardTransparencyChange}
          onPeekChange={onPeekChange}
          weatherAnimations={weatherAnimations}
        />
      )}
    </>
  )
}

function SettingsBody({ darkMode, onDarkModeChange, unit, onUnitChange, units, onUnitGroupChange, nowcastMode, onNowcastModeChange, radarMode, onRadarModeChange, onColorCodingOpen, onOverviewOpen, onWeatherEffectsOpen, onThemeOpen, onNotificationsOpen, weatherAnimations, onWeatherAnimationsChange, iconMotion, onIconMotionChange, radarEnhanced, onRadarEnhancedChange, installPrompt, onInstall, webShell }) {
  return (
    <>
      <div className="settings-group-label">Appearance</div>
      <div className="card settings-card">
        {/* The whole row opens the Theme page; the inline segmented control still
            switches Light/Dark/System without bubbling up to open the page. */}
        <div className="settings-row settings-row--link" onClick={onThemeOpen}>
          <div className="settings-row-label">Theme</div>
          <div className="settings-row-controls">
            <div className="theme-seg-wrap" onClick={e => e.stopPropagation()}>
              <SegmentedControl
                value={darkMode}
                onChange={onDarkModeChange}
                options={[
                  { value: 'off',    label: 'Light'  },
                  { value: 'on',     label: 'Dark'   },
                  { value: 'system', label: 'System' },
                ]}
              />
            </div>
            {/* Deeper theme options (platform style) live on their own page. */}
            <button className="theme-chevron-btn" onClick={onThemeOpen} aria-label="More theme options">
              <ChevronRight size={16} className="about-chevron" />
            </button>
          </div>
        </div>
        <button className="settings-row about-row" onClick={onColorCodingOpen}>
          <div className="settings-row-label">Color Coding</div>
          <ChevronRight size={16} className="about-chevron" />
        </button>
        {/* Gyroscope tilt lives on its own page and only exists on mobile, so on
            mobile this is a plain link into that page (the on/off toggle lives
            there, next to gyroscope — like Color Coding). Desktop has no page, so
            it keeps the inline toggle. */}
        {isMobileDevice() ? (
          <button className="settings-row about-row" onClick={onWeatherEffectsOpen}>
            <div className="settings-row-label">Weather Effects</div>
            <ChevronRight size={16} className="about-chevron" />
          </button>
        ) : (
          <div className="settings-row">
            <div className="settings-row-label">Weather Effects</div>
            <div className="settings-row-controls">
              <Toggle id="toggle-weather-anim" checked={weatherAnimations} onChange={onWeatherAnimationsChange} />
            </div>
          </div>
        )}
        {/* Its own row rather than a switch inside Weather Effects: that page is
            about the sky behind the app, and this is the icons on top of it.
            Someone who turns the backdrop off often still wants the forecast to
            move, so neither should silently disable the other. */}
        <div className="settings-row">
          <div className="settings-row-label">Animated Icons</div>
          <div className="settings-row-controls">
            <Toggle id="toggle-icon-motion" checked={iconMotion} onChange={onIconMotionChange} />
          </div>
        </div>
      </div>

      {/* Temperature is its own state and its own row; the rest are driven off
          the UNIT_GROUPS registry, so adding a measure or an option there puts
          it here without a second edit. Every one of these is display-only —
          the app fetches and reasons in one fixed set of units and converts at
          the last step, so switching is instant and needs no refetch. */}
      <div className="settings-group-label">Units</div>
      <div className="card settings-card">
        <SettingRow label="Temperature">
          <SegmentedControl
            value={unit}
            onChange={onUnitChange}
            options={[
              { value: 'F', label: '°F' },
              { value: 'C', label: '°C' },
            ]}
          />
        </SettingRow>
        {UNIT_GROUP_KEYS.map((group) => (
          <SettingRow key={group} label={UNIT_GROUPS[group].label}>
            <SegmentedControl
              value={units[group]}
              onChange={(value) => onUnitGroupChange(group, value)}
              options={UNIT_GROUPS[group].options}
            />
          </SettingRow>
        ))}
      </div>

      <div className="settings-group-label">Tiles</div>
      <div className="card settings-card">
        {/* Not on desktop: the Web layout's Today page doesn't render the
            overview tile for now (see TodayPage), and a sub-view of switches for
            a tile that isn't on the page is worse than no entry at all — every
            one of them would appear to do nothing. The stored values are left
            alone, so the phone shells keep theirs and this comes back with the
            tile. */}
        {!webShell && (
          <button className="settings-row about-row" onClick={onOverviewOpen}>
            <div className="settings-row-label">Weather Overview</div>
            <ChevronRight size={16} className="about-chevron" />
          </button>
        )}
        <SettingRow label="Precipitation">
          <SegmentedControl
            value={nowcastMode}
            onChange={onNowcastModeChange}
            options={[
              { value: 'on',   label: 'On'   },
              { value: 'auto', label: 'Auto' },
              { value: 'off',  label: 'Off'  },
            ]}
          />
        </SettingRow>
      </div>

      <div className="settings-group-label">Radar</div>
      <div className="card settings-card">
        {/* Whether the observed and forecast halves share one scrubber or sit
            behind a toggle on the map. Only US locations have forecast frames;
            elsewhere there is no second half to arrange and the radar is an
            observed timeline whatever this says. */}
        <SettingRow label="Timeline">
          <SegmentedControl
            value={radarMode}
            onChange={onRadarModeChange}
            options={[
              { value: 'combined', label: 'Combined' },
              { value: 'split',    label: 'Split'    },
            ]}
          />
        </SettingRow>
        <RadarEnhancedRow checked={radarEnhanced} onChange={onRadarEnhancedChange} />
      </div>

      {/* Notifications ride on a native bridge that only exists in the APK.
          The master toggle and the per-type ones live on their own page, the
          way Weather Overview does. */}
      {IS_ANDROID_APP && (
        <>
          <div className="settings-group-label">Notifications</div>
          <div className="card settings-card">
            <button className="settings-row about-row" onClick={onNotificationsOpen}>
              <div className="settings-row-label">Notifications</div>
              <ChevronRight size={16} className="about-chevron" />
            </button>
          </div>
        </>
      )}

      <div className="settings-group-label">Other</div>
      {IS_ANDROID_APP && <UpdateSection />}
      <InstallSection installPrompt={installPrompt} onInstall={onInstall} />
      <ClearStorageSection />
      <AboutSection />

      <div className="settings-footer">
        <p className="settings-version">Version {APP_VERSION}</p>
        {IS_ANDROID_APP && <p className="settings-version">Android {ANDROID_VERSION}</p>}
        <p className="settings-studio">Alek Studios&#8482;</p>
      </div>
    </>
  )
}

const SUB_VIEW_TITLES = { colorcoding: 'Color Coding', overview: 'Weather Overview Settings', effects: 'Weather Effects', theme: 'Theme', notifications: 'Notifications' }

export function SettingsPage({ onBack, onDismiss, inline, modal, closing, subView, onColorCodingOpen, onOverviewOpen, onWeatherEffectsOpen, onThemeOpen, onNotificationsOpen, onSubViewBack, colorCoding, onColorCodingToggle, overviewParts, onOverviewPartToggle, ...bodyProps }) {
  // Set while the transparency thumb is held, which fades the page down to just
  // that slider (see .settings-page.peeking). A pointer released off the input
  // — dragged past the end of the track, or lifted after the browser handed the
  // capture back — would never send pointerup here, so the window is what
  // guarantees the page comes back.
  const [peeking, setPeeking] = useState(false)
  useEffect(() => {
    if (!peeking) return
    const end = () => setPeeking(false)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    return () => {
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
  }, [peeking])

  // Whether the open slide has landed. Only the iOS theme reads it, to hold its
  // backdrop-filter glass back until the page has stopped moving — see the
  // :not(.settled) rules in App.css for why that is what the slide costs.
  //
  // animationend is the real signal. The timer behind it covers the cases where
  // there is no animation to end — reduced motion, or a shell that doesn't
  // slide — since waiting on an event that never fires would mean a page that
  // never frosts at all. Whichever lands first wins; the other is a no-op.
  const [settled, setSettled] = useState(false)
  useEffect(() => {
    // Going out is a slide too, so the glass comes off again for it.
    if (closing) { setSettled(false); return }
    const t = setTimeout(() => setSettled(true), 400)
    return () => clearTimeout(t)
  }, [closing])

  // Opening a dialog should hand it the keyboard, or the next Tab carries on
  // through the page behind the backdrop as if nothing had opened. Programmatic
  // focus on a tabindex="-1" container draws no ring (:focus-visible doesn't
  // match it), so this is only felt by whoever is using the keyboard.
  const panelRef = useRef(null)
  useEffect(() => {
    if (modal) panelRef.current?.focus()
  }, [modal])

  // Scrolling the list costs what the open slide costs, and for the same reason:
  // the sky behind the cards is a fixed layer, so every card that moves has its
  // backdrop re-read and re-blurred that frame, a dozen times over at blur(24px).
  // So the blur comes off for the length of the gesture and back a beat after it
  // stops. What's behind these cards is a smooth gradient, which blurs to itself,
  // so this isn't a look you can catch it without — the rule keeps the saturate
  // for the part you could. See .settings-page.scrolling in App.css.
  //
  // The class is written straight onto the node instead of held in state — a
  // re-render of the whole page per scroll event would cost more than the blur
  // it's saving. React only rewrites className when its own computed value
  // changes, so this survives in between renders.
  const scrollTimer = useRef(0)
  const onScroll = () => {
    const el = panelRef.current
    if (!el) return
    el.classList.add('scrolling')
    clearTimeout(scrollTimer.current)
    scrollTimer.current = setTimeout(() => el.classList.remove('scrolling'), 140)
  }
  useEffect(() => () => clearTimeout(scrollTimer.current), [])

  let body
  if (subView === 'colorcoding') {
    body = <ColorCodingView colorCoding={colorCoding} onToggle={onColorCodingToggle} webShell={bodyProps.webShell} />
  } else if (subView === 'theme') {
    body = (
      <ThemeView
        darkMode={bodyProps.darkMode}
        onDarkModeChange={bodyProps.onDarkModeChange}
        platformTheme={bodyProps.platformTheme}
        onPlatformThemeChange={bodyProps.onPlatformThemeChange}
        materialColor={bodyProps.materialColor}
        onMaterialColorChange={bodyProps.onMaterialColorChange}
        cardTransparency={bodyProps.cardTransparency}
        onCardTransparencyChange={bodyProps.onCardTransparencyChange}
        onPeekChange={setPeeking}
        weatherAnimations={bodyProps.weatherAnimations}
      />
    )
  } else if (subView === 'overview') {
    body = (
      <OverviewSettingsView
        showOverview={bodyProps.showOverview}
        onShowOverviewChange={bodyProps.onShowOverviewChange}
        overviewParts={overviewParts}
        onToggle={onOverviewPartToggle}
      />
    )
  } else if (subView === 'effects') {
    body = (
      <WeatherEffectsView
        weatherAnimations={bodyProps.weatherAnimations}
        onWeatherAnimationsChange={bodyProps.onWeatherAnimationsChange}
        gyroscope={bodyProps.gyroscope}
        onGyroscopeChange={bodyProps.onGyroscopeChange}
      />
    )
  } else if (subView === 'notifications') {
    body = (
      <NotificationsView
        notifyEnabled={bodyProps.notifyEnabled}
        notifyTypes={bodyProps.notifyTypes}
        permission={bodyProps.notifyPermission}
        onEnabledChange={bodyProps.onNotifyEnabledChange}
        onTypeToggle={bodyProps.onNotifyTypeToggle}
      />
    )
  } else {
    body = <SettingsBody {...bodyProps} onColorCodingOpen={onColorCodingOpen} onOverviewOpen={onOverviewOpen} onWeatherEffectsOpen={onWeatherEffectsOpen} onThemeOpen={onThemeOpen} onNotificationsOpen={onNotificationsOpen} />
  }

  if (inline) {
    return (
      <div className="card settings-inline">
        <div className="settings-inline-header">
          {subView ? (
            <button className="back-btn settings-inline-back" onClick={onSubViewBack} aria-label="Back to settings">
              <ArrowLeft size={16} />
              <span>Back</span>
            </button>
          ) : (
            <span className="settings-inline-title">Settings</span>
          )}
          <button className="header-icon-btn" onClick={onBack} aria-label="Close settings">
            <X size={16} />
          </button>
        </div>
        <div className="settings-inline-body">
          {body}
        </div>
      </div>
    )
  }

  return (
    <div
      ref={panelRef}
      tabIndex={modal ? -1 : undefined}
      className={`settings-page${modal ? ' settings-page--modal' : ''}${closing ? ' closing' : ''}${peeking ? ' peeking' : ''}${settled ? ' settled' : ''}`}
      onScroll={onScroll}
      /* Guarded on the target: animations inside the page (a toggle, an info
         panel opening) bubble their end events through here too, and any one
         of them would otherwise report the slide as finished. */
      onAnimationEnd={(e) => { if (e.target === e.currentTarget && !closing) setSettled(true) }}
      /* Only the modal is a dialog. The phone shells are a page that replaces
         what was on screen, and announcing that as a dialog would promise a
         layer the user could dismiss to get back to it. */
      role={modal ? 'dialog' : undefined}
      aria-modal={modal ? 'true' : undefined}
      aria-label={modal ? 'Settings' : undefined}
    >
      <header className="settings-page-header">
        {/* Back is how you leave a page; a dialog has a close button instead.
            So the modal keeps Back only where it means going up a level — out
            of a sub-page and back to the list behind it. */}
        {(!modal || subView) && (
          <button className="back-btn" onClick={subView ? onSubViewBack : onBack} aria-label="Back">
            <ArrowLeft size={18} />
            <span>Back</span>
          </button>
        )}
        <span className="settings-page-title">{SUB_VIEW_TITLES[subView] ?? 'Settings'}</span>
        {/* Closes the dialog outright, from a sub-page as much as from the
            list — Back is what walks up a level. */}
        {modal && (
          <button className="header-icon-btn settings-modal-close" onClick={onDismiss ?? onBack} aria-label="Close settings">
            <X size={18} />
          </button>
        )}
      </header>
      <div className="settings-body">
        {body}
      </div>
    </div>
  )
}

export function SettingsPill({ expanded, onToggle, subView, onColorCodingOpen, onOverviewOpen, onWeatherEffectsOpen, onThemeOpen, onNotificationsOpen, onSubViewBack, colorCoding, onColorCodingToggle, overviewParts, onOverviewPartToggle, ...bodyProps }) {
  let body
  if (subView === 'colorcoding') {
    body = <ColorCodingView colorCoding={colorCoding} onToggle={onColorCodingToggle} onBack={onSubViewBack} webShell={bodyProps.webShell} />
  } else if (subView === 'theme') {
    body = (
      <ThemeView
        darkMode={bodyProps.darkMode}
        onDarkModeChange={bodyProps.onDarkModeChange}
        platformTheme={bodyProps.platformTheme}
        onPlatformThemeChange={bodyProps.onPlatformThemeChange}
        onBack={onSubViewBack}
      />
    )
  } else if (subView === 'overview') {
    body = (
      <OverviewSettingsView
        showOverview={bodyProps.showOverview}
        onShowOverviewChange={bodyProps.onShowOverviewChange}
        overviewParts={overviewParts}
        onToggle={onOverviewPartToggle}
        onBack={onSubViewBack}
      />
    )
  } else if (subView === 'effects') {
    body = (
      <WeatherEffectsView
        weatherAnimations={bodyProps.weatherAnimations}
        onWeatherAnimationsChange={bodyProps.onWeatherAnimationsChange}
        gyroscope={bodyProps.gyroscope}
        onGyroscopeChange={bodyProps.onGyroscopeChange}
        onBack={onSubViewBack}
      />
    )
  } else if (subView === 'notifications') {
    body = (
      <NotificationsView
        notifyEnabled={bodyProps.notifyEnabled}
        notifyTypes={bodyProps.notifyTypes}
        permission={bodyProps.notifyPermission}
        onEnabledChange={bodyProps.onNotifyEnabledChange}
        onTypeToggle={bodyProps.onNotifyTypeToggle}
        onBack={onSubViewBack}
      />
    )
  } else {
    body = <SettingsBody {...bodyProps} onColorCodingOpen={onColorCodingOpen} onOverviewOpen={onOverviewOpen} onWeatherEffectsOpen={onWeatherEffectsOpen} onThemeOpen={onThemeOpen} onNotificationsOpen={onNotificationsOpen} />
  }

  return (
    <div className="card settings-pill">
      <button className="settings-pill-bar" onClick={onToggle} aria-expanded={expanded}>
        <span className="settings-pill-label">Settings</span>
        <ChevronDown size={16} className={`settings-pill-chevron${expanded ? ' open' : ''}`} />
      </button>
      {expanded && (
        <div className="settings-inline-body">
          {body}
        </div>
      )}
    </div>
  )
}
