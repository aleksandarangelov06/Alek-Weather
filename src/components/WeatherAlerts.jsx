import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { TriangleAlert, X, ChevronRight } from 'lucide-react'

// Colors are the --cond-* variables so they lighten on dark and sky-tinted
// surfaces; withAlpha uses color-mix because the values are no longer raw hex.
const SEVERITY_CONFIG = {
  Extreme:  { color: 'var(--cond-red)',    bg: withAlpha('var(--cond-red)', 0.12),    label: 'Extreme'  },
  Severe:   { color: 'var(--cond-orange)', bg: withAlpha('var(--cond-orange)', 0.12), label: 'Severe'   },
  Moderate: { color: 'var(--cond-yellow)', bg: withAlpha('var(--cond-yellow)', 0.12), label: 'Moderate' },
  Minor:    { color: 'var(--cond-info)',   bg: withAlpha('var(--cond-info)', 0.10),   label: 'Minor'    },
  Unknown:  { color: '#8b949e',            bg: 'rgba(139,148,158,0.10)',              label: 'Alert'    },
}

// Air Quality "Code <colour>" levels, matching the US AQI scale.
const AQI_CODE_COLORS = {
  green: 'var(--cond-green)', yellow: 'var(--cond-yellow)', orange: 'var(--cond-orange)',
  red: 'var(--cond-red)', purple: 'var(--cond-purple)', maroon: 'var(--cond-violet)',
}

function withAlpha(color, a) {
  return `color-mix(in srgb, ${color} ${a * 100}%, transparent)`
}

// Colour an alert by the action it demands rather than by NWS severity alone:
// Warnings (hazard happening/imminent) are red, Watches (be prepared) orange,
// Advisories yellow. Air Quality Alerts are coloured by their announced
// "Code <colour>" level, so a Code Red shows red, Code Orange orange, etc.
// Falls back to the severity palette for anything that fits none of these.
function resolveStyle(props) {
  const base = SEVERITY_CONFIG[props.severity] ?? SEVERITY_CONFIG.Unknown
  const event = (props.event ?? '').trim()

  if (/air quality/i.test(event)) {
    const haystack = `${event} ${props.headline ?? ''} ${props.description ?? ''}`
    const m = haystack.match(/code\s+(green|yellow|orange|red|purple|maroon)/i)
    if (m) {
      const color = AQI_CODE_COLORS[m[1].toLowerCase()]
      return { ...base, color, bg: withAlpha(color, 0.12) }
    }
  }

  let color
  if (/warning$/i.test(event))       color = 'var(--cond-red)'
  else if (/watch$/i.test(event))    color = 'var(--cond-orange)'
  else if (/advisory$/i.test(event)) color = 'var(--cond-yellow)'
  return color ? { ...base, color, bg: withAlpha(color, 0.12) } : base
}

function formatExpires(iso) {
  if (!iso) return null
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

// NWS alert bodies embed links as bare text: full http(s) URLs, www. hosts, or
// protocol-less domains like "weather.gov/safety". Match all three so they can
// render as anchors.
const URL_RE = /((?:https?:\/\/|www\.)[^\s]+|[a-z0-9][a-z0-9.-]*\.(?:gov|org|com|net|edu|us|mil)(?:\/[^\s]*)?)/gi

// Split a run of text into strings and <a> nodes so URLs become clickable.
// Returns the original string untouched when it holds no links.
function linkify(text) {
  const nodes = []
  let last = 0
  let m
  URL_RE.lastIndex = 0
  while ((m = URL_RE.exec(text)) !== null) {
    let url = m[0]
    // Don't let sentence punctuation ("...visit weather.gov.") ride along into
    // the href; peel it back off and keep it as trailing text.
    const trail = url.match(/[.,;:!?)\]]+$/)?.[0] ?? ''
    url = url.slice(0, url.length - trail.length)
    if (m.index > last) nodes.push(text.slice(last, m.index))
    const href = /^https?:\/\//i.test(url) ? url : `https://${url}`
    nodes.push(
      <a key={m.index} href={href} target="_blank" rel="noopener noreferrer" className="alert-link">
        {url}
      </a>
    )
    if (trail) nodes.push(trail)
    last = m.index + m[0].length
  }
  if (!nodes.length) return text
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

function AlertModal({ alert, onClose }) {
  const [dragOffset, setDragOffset] = useState(0)
  const dragStartY = useRef(null)

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  const handleTouchStart = (e) => {
    dragStartY.current = e.touches[0].clientY
  }

  const handleTouchMove = (e) => {
    if (dragStartY.current === null) return
    const delta = e.touches[0].clientY - dragStartY.current
    if (delta > 0) {
      e.preventDefault()
      setDragOffset(delta)
    }
  }

  const handleTouchEnd = () => {
    if (dragOffset > 80) {
      onClose()
    } else {
      setDragOffset(0)
    }
    dragStartY.current = null
  }

  const props = alert.properties
  const cfg = resolveStyle(props)

  return (
    <div className="alert-backdrop" onClick={onClose}>
      <div
        className="alert-sheet"
        onClick={e => e.stopPropagation()}
        style={{
          transform: dragOffset > 0 ? `translateY(${dragOffset}px)` : undefined,
          transition: dragOffset > 0 ? 'none' : 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        <div className="alert-sheet-fixed">
          <div
            className="alert-sheet-handle-area"
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            <div className="alert-sheet-handle" />
          </div>

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
            <p className="alert-sheet-headline">{linkify(props.headline)}</p>
          )}
          {props.description && props.description.split('\n\n').map((para, i) => (
            <p key={i} className="alert-sheet-description">{linkify(para.replace(/\n/g, ' '))}</p>
          ))}
          {props.instruction && (
            <div className="alert-sheet-instruction">
              <strong>Instructions</strong>
              {props.instruction.split('\n\n').map((para, i) => (
                <p key={i}>{linkify(para.replace(/\n/g, ' '))}</p>
              ))}
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
            const cfg = resolveStyle(props)
            const critical = props.severity === 'Extreme'
            return (
              <button
                key={alert.id}
                className="alert-row"
                onClick={() => setSelected(alert.id)}
              >
                <div
                  className={`alert-row-icon${critical ? ' alert-row-icon--critical' : ''}`}
                  style={{ background: cfg.bg }}
                >
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
        document.getElementById('alert-portal-root') ?? document.body
      )}
    </>
  )
}
