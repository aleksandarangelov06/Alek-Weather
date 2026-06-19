import { useState } from 'react'
import { ArrowLeft, ChevronRight } from 'lucide-react'

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
    localStorage.clear()
    sessionStorage.clear()
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
        <div className="settings-row-label">{cleared ? 'Clearing…' : 'Clear Cache'}</div>
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
            Alek Weather uses free, open-source weather APIs.
          </p>
          <div className="about-apis">
            <div className="about-api-row">
              <span className="about-api-name">Weather &amp; Forecast</span>
              <span className="about-api-url">api.open-meteo.com</span>
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

const NOTIFY_TYPE_LABELS = {
  rain:     'Upcoming Rain / Storm',
  alerts:   'Weather Alerts',
  tomorrow: 'Weather Tomorrow',
}

function NotificationsSection({ notifyEnabled, notifyTypes, permission, onEnabledChange, onTypeToggle }) {
  const unsupported = permission === 'unsupported'
  const denied = permission === 'denied'
  const active = notifyEnabled && permission === 'granted'

  return (
    <div className="card settings-card">
      <SettingRow label="Notifications">
        {unsupported ? (
          <span className="notify-status-label">Not supported</span>
        ) : (
          <Toggle id="toggle-notify" checked={active} onChange={onEnabledChange} />
        )}
      </SettingRow>
      {denied && (
        <p className="notify-hint">Notifications are blocked. Enable them in your browser or system settings.</p>
      )}
      {active && Object.entries(NOTIFY_TYPE_LABELS).map(([type, label]) => (
        <SettingRow key={type} label={label}>
          <Toggle
            id={`toggle-notify-${type}`}
            checked={notifyTypes.includes(type)}
            onChange={() => onTypeToggle(type)}
          />
        </SettingRow>
      ))}
    </div>
  )
}

export function SettingsPage({ onBack, darkMode, onDarkModeChange, unit, onUnitChange, showOverview, onShowOverviewChange, nowcastMode, onNowcastModeChange, installPrompt, onInstall, closing, notifyEnabled, notifyTypes, notifyPermission, onNotifyEnabledChange, onNotifyTypeToggle }) {
  return (
    <div className={`settings-page${closing ? ' closing' : ''}`}>
      <header className="settings-page-header">
        <button className="back-btn" onClick={onBack} aria-label="Back">
          <ArrowLeft size={18} />
          <span>Back</span>
        </button>
        <span className="settings-page-title">Settings</span>
      </header>

      <div className="settings-body">
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

        <div className="settings-group-label">Notifications</div>
        <NotificationsSection
          notifyEnabled={notifyEnabled}
          notifyTypes={notifyTypes}
          permission={notifyPermission}
          onEnabledChange={onNotifyEnabledChange}
          onTypeToggle={onNotifyTypeToggle}
        />

        <div className="settings-group-label">Other</div>
        <InstallSection installPrompt={installPrompt} onInstall={onInstall} />
        <ClearStorageSection />
        <AboutSection />

        <div className="settings-footer">
          <p className="settings-version">Version 1.6</p>
          <p className="settings-studio">Alek Studios&#8482;</p>
        </div>
      </div>
    </div>
  )
}
