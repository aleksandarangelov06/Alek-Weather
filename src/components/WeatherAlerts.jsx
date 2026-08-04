import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { TriangleAlert, X, ChevronRight } from 'lucide-react'
import { resolveStyle } from '../utils/alertStyle'

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

export function AlertModal({ alert, onClose }) {
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  const props = alert.properties
  const cfg = resolveStyle(props)

  return (
    <div className="alert-backdrop" onClick={onClose}>
      <div className="alert-sheet" onClick={e => e.stopPropagation()}>
        <div className="alert-sheet-fixed">
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
            // Blink for Warnings — the hazard is happening or imminent — and not
            // for severity Extreme, which is what this used to test. NWS rates a
            // Tornado Watch Extreme too, so that test made the icon red on an
            // alert resolveStyle() had already coloured orange for being a
            // Watch, leaving the icon disagreeing with the chip beside it.
            // Warnings resolve to red on their own, so the pulse needs no colour
            // of its own now.
            const critical = /warning$/i.test((props.event ?? '').trim())
            return (
              <button
                key={alert.id}
                className="alert-row"
                onClick={() => setSelected(alert.id)}
              >
                <div
                  className={`alert-row-icon${critical ? ' alert-row-icon--critical' : ''}`}
                  style={{ background: cfg.bg, '--alert-color': cfg.color }}
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
