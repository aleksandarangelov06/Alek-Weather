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
            Alek Weather uses free, open-source weather APIs — no account or API key required.
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

export function SettingsPage({ onBack, darkMode, onDarkModeChange, unit, onUnitChange, showOverview, onShowOverviewChange, closing }) {
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
        </div>

        <div className="settings-group-label">Info</div>
        <AboutSection />

        <div className="settings-footer">
          <p className="settings-version">Version 0.1</p>
          <p className="settings-studio">Alek Studios&#8482;</p>
        </div>
      </div>
    </div>
  )
}
