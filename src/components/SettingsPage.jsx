import { useState } from 'react'
import { ArrowLeft, ChevronRight, ChevronDown, X } from 'lucide-react'
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

  return (
    <div className="card settings-card">
      <button className="settings-row clear-cache-btn" onClick={handleClear} disabled={cleared}>
        <div className="settings-row-label">{cleared ? 'Refreshing…' : 'Refresh app'}</div>
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
  { key: 'current', label: 'Current Weather' },
  { key: 'hourly',  label: 'Hourly Forecast' },
  { key: 'daily',   label: '7-Day Forecast'  },
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
      <p className="color-coding-desc">Choose which tiles color the temperature by how hot or cold it is.</p>
      <div className="card settings-card">
        {COLOR_CODING_TILES.map(({ key, label }) => (
          <SettingRow key={key} label={label}>
            <Toggle id={`toggle-cc-${key}`} checked={colorCoding[key]} onChange={() => onToggle(key)} />
          </SettingRow>
        ))}
      </div>
      <p className="color-coding-desc">Add a glow to color-coded temperatures when it gets very hot.</p>
      <div className="card settings-card">
        <SettingRow label="Heat Glow">
          <Toggle id="toggle-cc-glow" checked={colorCoding.glow} onChange={() => onToggle('glow')} />
        </SettingRow>
      </div>
    </>
  )
}

function SettingsBody({ darkMode, onDarkModeChange, unit, onUnitChange, showOverview, onShowOverviewChange, nowcastMode, onNowcastModeChange, onColorCodingOpen, weatherAnimations, onWeatherAnimationsChange, installPrompt, onInstall }) {
  return (
    <>
      <div className="settings-group-label">Appearance</div>
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
        <button className="settings-row about-row" onClick={onColorCodingOpen}>
          <div className="settings-row-label">Color Coding</div>
          <ChevronRight size={16} className="about-chevron" />
        </button>
        <SettingRow label="Weather Effects">
          <Toggle id="toggle-weather-anim" checked={weatherAnimations} onChange={onWeatherAnimationsChange} />
        </SettingRow>
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
        <SettingRow label="Weather Overview">
          <Toggle id="toggle-overview" checked={showOverview} onChange={onShowOverviewChange} />
        </SettingRow>
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

export function SettingsPage({ onBack, inline, closing, colorCodingOpen, onColorCodingOpen, onColorCodingBack, colorCoding, onColorCodingToggle, ...bodyProps }) {
  const body = colorCodingOpen
    ? <ColorCodingView colorCoding={colorCoding} onToggle={onColorCodingToggle} />
    : <SettingsBody {...bodyProps} onColorCodingOpen={onColorCodingOpen} />

  if (inline) {
    return (
      <div className="card settings-inline">
        <div className="settings-inline-header">
          {colorCodingOpen ? (
            <button className="back-btn settings-inline-back" onClick={onColorCodingBack} aria-label="Back to settings">
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
        <button className="back-btn" onClick={colorCodingOpen ? onColorCodingBack : onBack} aria-label="Back">
          <ArrowLeft size={18} />
          <span>Back</span>
        </button>
        <span className="settings-page-title">{colorCodingOpen ? 'Color Coding' : 'Settings'}</span>
      </header>
      <div className="settings-body">
        {body}
      </div>
    </div>
  )
}

export function SettingsPill({ expanded, onToggle, colorCodingOpen, onColorCodingOpen, onColorCodingBack, colorCoding, onColorCodingToggle, ...bodyProps }) {
  return (
    <div className="card settings-pill">
      <button className="settings-pill-bar" onClick={onToggle} aria-expanded={expanded}>
        <span className="settings-pill-label">Settings</span>
        <ChevronDown size={16} className={`settings-pill-chevron${expanded ? ' open' : ''}`} />
      </button>
      {expanded && (
        <div className="settings-inline-body">
          {colorCodingOpen
            ? <ColorCodingView colorCoding={colorCoding} onToggle={onColorCodingToggle} onBack={onColorCodingBack} />
            : <SettingsBody {...bodyProps} onColorCodingOpen={onColorCodingOpen} />}
        </div>
      )}
    </div>
  )
}
