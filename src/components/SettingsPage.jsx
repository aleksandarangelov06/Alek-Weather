import { useState } from 'react'
import { ArrowLeft, ChevronRight, ChevronDown, X, Info } from 'lucide-react'
import { APP_VERSION } from '../utils/version'

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


const COLOR_CODING_TILES = [
  { key: 'current',  label: 'Current Weather'  },
  { key: 'hourly',   label: 'Hourly Forecast'  },
  { key: 'daily',    label: '7-Day Forecast'   },
  { key: 'overview', label: 'Weather Overview' },
  { key: 'details',  label: 'Weather Details'  },
]

function ColorCodingView({ colorCoding, onToggle, onBack }) {
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
        {COLOR_CODING_TILES.map(({ key, label }) => (
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

function ThemeView({ darkMode, onDarkModeChange, platformTheme, onPlatformThemeChange, onBack }) {
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
      <p className="color-coding-desc">Match the app to your device. iOS uses the Apple font and look; Android uses Google Sans and a Material You style.</p>
      <div className="card settings-card">
        <SettingRow label="App Style">
          <SegmentedControl
            value={platformTheme}
            onChange={onPlatformThemeChange}
            options={[
              { value: 'ios',     label: 'iOS'     },
              { value: 'android', label: 'Android' },
            ]}
          />
        </SettingRow>
      </div>
    </>
  )
}

function SettingsBody({ darkMode, onDarkModeChange, unit, onUnitChange, nowcastMode, onNowcastModeChange, radarMode, onRadarModeChange, onColorCodingOpen, onOverviewOpen, onWeatherEffectsOpen, onThemeOpen, weatherAnimations, onWeatherAnimationsChange, radarEnhanced, onRadarEnhancedChange, installPrompt, onInstall }) {
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
        <div className="settings-row">
          <div className="settings-row-label">Weather Effects</div>
          <div className="settings-row-controls">
            <Toggle id="toggle-weather-anim" checked={weatherAnimations} onChange={onWeatherAnimationsChange} />
            {/* Gyroscope tilt lives on its own page and only exists on mobile, so
                the chevron to that page shows only there; desktop gets just the
                toggle and never reaches the (otherwise empty) page. */}
            {isMobileDevice() && (
              <button className="theme-chevron-btn" onClick={onWeatherEffectsOpen} aria-label="More weather effects options">
                <ChevronRight size={16} className="about-chevron" />
              </button>
            )}
          </div>
        </div>
      </div>

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
      </div>

      <div className="settings-group-label">Tiles</div>
      <div className="card settings-card">
        <button className="settings-row about-row" onClick={onOverviewOpen}>
          <div className="settings-row-label">Weather Overview</div>
          <ChevronRight size={16} className="about-chevron" />
        </button>
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
        <SettingRow label="Mode">
          <SegmentedControl
            value={radarMode}
            onChange={onRadarModeChange}
            options={[
              { value: 'nowcast', label: 'Nowcast' },
              { value: 'both',    label: 'Both'    },
              { value: 'future',  label: 'Future'  },
            ]}
          />
        </SettingRow>
        <RadarEnhancedRow checked={radarEnhanced} onChange={onRadarEnhancedChange} />
      </div>

      <div className="settings-group-label">Other</div>
      <InstallSection installPrompt={installPrompt} onInstall={onInstall} />
      <ClearStorageSection />
      <AboutSection />

      <div className="settings-footer">
        <p className="settings-version">Version {APP_VERSION}</p>
        <p className="settings-studio">Alek Studios&#8482;</p>
      </div>
    </>
  )
}

const SUB_VIEW_TITLES = { colorcoding: 'Color Coding', overview: 'Weather Overview Settings', effects: 'Weather Effects', theme: 'Theme' }

export function SettingsPage({ onBack, inline, closing, subView, onColorCodingOpen, onOverviewOpen, onWeatherEffectsOpen, onThemeOpen, onSubViewBack, colorCoding, onColorCodingToggle, overviewParts, onOverviewPartToggle, ...bodyProps }) {
  let body
  if (subView === 'colorcoding') {
    body = <ColorCodingView colorCoding={colorCoding} onToggle={onColorCodingToggle} />
  } else if (subView === 'theme') {
    body = (
      <ThemeView
        darkMode={bodyProps.darkMode}
        onDarkModeChange={bodyProps.onDarkModeChange}
        platformTheme={bodyProps.platformTheme}
        onPlatformThemeChange={bodyProps.onPlatformThemeChange}
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
  } else {
    body = <SettingsBody {...bodyProps} onColorCodingOpen={onColorCodingOpen} onOverviewOpen={onOverviewOpen} onWeatherEffectsOpen={onWeatherEffectsOpen} onThemeOpen={onThemeOpen} />
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
    <div className={`settings-page${closing ? ' closing' : ''}`}>
      <header className="settings-page-header">
        <button className="back-btn" onClick={subView ? onSubViewBack : onBack} aria-label="Back">
          <ArrowLeft size={18} />
          <span>Back</span>
        </button>
        <span className="settings-page-title">{SUB_VIEW_TITLES[subView] ?? 'Settings'}</span>
      </header>
      <div className="settings-body">
        {body}
      </div>
    </div>
  )
}

export function SettingsPill({ expanded, onToggle, subView, onColorCodingOpen, onOverviewOpen, onWeatherEffectsOpen, onThemeOpen, onSubViewBack, colorCoding, onColorCodingToggle, overviewParts, onOverviewPartToggle, ...bodyProps }) {
  let body
  if (subView === 'colorcoding') {
    body = <ColorCodingView colorCoding={colorCoding} onToggle={onColorCodingToggle} onBack={onSubViewBack} />
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
  } else {
    body = <SettingsBody {...bodyProps} onColorCodingOpen={onColorCodingOpen} onOverviewOpen={onOverviewOpen} onWeatherEffectsOpen={onWeatherEffectsOpen} onThemeOpen={onThemeOpen} />
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
