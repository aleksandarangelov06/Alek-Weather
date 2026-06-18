import { useState } from 'react'
import { createPortal } from 'react-dom'
import { TriangleAlert, X, ChevronRight } from 'lucide-react'

const SEVERITY_CONFIG = {
  Extreme:  { color: '#ef4444', bg: 'rgba(239,68,68,0.12)',   label: 'Extreme'  },
  Severe:   { color: '#f97316', bg: 'rgba(249,115,22,0.12)',  label: 'Severe'   },
  Moderate: { color: '#eab308', bg: 'rgba(234,179,8,0.12)',   label: 'Moderate' },
  Minor:    { color: '#3b82f6', bg: 'rgba(59,130,246,0.10)',  label: 'Minor'    },
  Unknown:  { color: '#8b949e', bg: 'rgba(139,148,158,0.10)', label: 'Alert'    },
}

function formatExpires(iso) {
  if (!iso) return null
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

function AlertModal({ alert, onClose }) {
  const props = alert.properties
  const cfg = SEVERITY_CONFIG[props.severity] ?? SEVERITY_CONFIG.Unknown

  return (
    <div className="alert-backdrop" onClick={onClose}>
      <div className="alert-sheet" onClick={e => e.stopPropagation()}>
        <div className="alert-sheet-fixed">
          <div className="alert-sheet-handle" />

          <div className="alert-sheet-header">
            <div className="alert-sheet-title-row">
              <TriangleAlert size={18} style={{ color: cfg.color, flexShrink: 0 }} />
              <span className="alert-sheet-event" style={{ color: cfg.color }}>{props.event}</span>
            </div>
            <button className="alert-close-btn" onClick={onClose} aria-label="Close">
              <X size={18} />
            </button>
          </div>

          <div className="alert-sheet-meta">
            <span className="alert-chip" style={{ color: cfg.color, background: cfg.bg }}>
              {cfg.label}
            </span>
            {props.areaDesc && (
              <span className="alert-sheet-area">{props.areaDesc.split(';')[0]}</span>
            )}
          </div>
        </div>

        <div className="alert-sheet-scroll">
          {props.headline && (
            <p className="alert-sheet-headline">{props.headline}</p>
          )}
          {props.description && (
            <p className="alert-sheet-description">{props.description}</p>
          )}
          {props.instruction && (
            <div className="alert-sheet-instruction">
              <strong>Instructions</strong>
              <p>{props.instruction}</p>
            </div>
          )}
          {props.expires && (
            <p className="alert-sheet-expires">Expires {formatExpires(props.expires)}</p>
          )}
        </div>
      </div>
    </div>
  )
}

export function WeatherAlerts({ alerts }) {
  const [selected, setSelected] = useState(null)

  if (!alerts || alerts.length === 0) return null

  const selectedAlert = alerts.find(a => a.id === selected)

  return (
    <>
      <div className="card alerts-card">
        <div className="section-label">WEATHER ALERTS</div>
        <div className="alerts-list">
          {alerts.map(alert => {
            const props = alert.properties
            const cfg = SEVERITY_CONFIG[props.severity] ?? SEVERITY_CONFIG.Unknown
            return (
              <button
                key={alert.id}
                className="alert-row"
                onClick={() => setSelected(alert.id)}
              >
                <div className="alert-row-icon" style={{ background: cfg.bg }}>
                  <TriangleAlert size={14} style={{ color: cfg.color }} />
                </div>
                <div className="alert-row-text">
                  <span className="alert-row-event">{props.event}</span>
                  {props.areaDesc && (
                    <span className="alert-row-area">{props.areaDesc.split(';')[0]}</span>
                  )}
                </div>
                <span className="alert-chip" style={{ color: cfg.color, background: cfg.bg }}>
                  {cfg.label}
                </span>
                <ChevronRight size={14} className="alert-row-chevron" />
              </button>
            )
          })}
        </div>
      </div>

      {selectedAlert && createPortal(
        <AlertModal alert={selectedAlert} onClose={() => setSelected(null)} />,
        document.body
      )}
    </>
  )
}
