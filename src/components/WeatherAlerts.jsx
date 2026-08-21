import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { TriangleAlert, X, ChevronRight, Map } from 'lucide-react'
import { resolveStyle } from '../utils/alertStyle'
import { AlertAreaMap } from './AlertAreaMapLazy'

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

export function AlertModal({ alert, location, onClose }) {
  // The area map, opened from the button in the header below and closed back to
  // the sheet rather than out of it — the sheet is what you were reading, and
  // the map is a look at one line of it.
  const [showMap, setShowMap] = useState(false)
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  const props = alert.properties
  const cfg = resolveStyle(props)

  return (
    <>
    <div className="alert-backdrop" onClick={onClose}>
      <div className="alert-sheet" onClick={e => e.stopPropagation()}>
        <div className="alert-sheet-fixed">
          <div className="alert-sheet-header">
            <div className="alert-sheet-title-row">
              <TriangleAlert size={18} style={{ color: cfg.color, flexShrink: 0 }} />
              <span className="alert-sheet-event" style={{ color: cfg.color }}>{props.event}</span>
            </div>
            <div className="alert-sheet-actions">
              <button
                className="alert-map-btn"
                onClick={() => setShowMap(true)}
                aria-label="Show affected area on map"
                title="Show affected area on map"
              >
                <Map size={17} />
              </button>
              <button className="alert-close-btn" onClick={onClose} aria-label="Close">
                <X size={18} />
              </button>
            </div>
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

    {/* Above the sheet rather than inside it — a map in a scrolling column is a
        map you fight the page for. Portalled to the same root the sheet is on,
        so it clears the app's stacking contexts too, and mounted as a sibling of
        the backdrop rather than a child: a portal still bubbles its events
        through the React tree it was written in, so inside the backdrop every
        click on the map would reach that onClick and shut the sheet. */}
    {showMap && createPortal(
      <AlertAreaMap key={alert.id} alert={alert} location={location} onClose={() => setShowMap(false)} />,
      document.getElementById('alert-portal-root') ?? document.body
    )}
    </>
  )
}

export function WeatherAlerts({ alerts, location }) {
  const [selected, setSelected] = useState(null)
  // The alert whose ground is being shown, opened straight from its row. The
  // sheet has its own button for the same map (see AlertModal); this is the one
  // that doesn't ask you to read the alert first, because "where is it" is
  // often the whole question — half these alerts are county lists you are on
  // the edge of.
  const [mapped, setMapped] = useState(null)

  if (!alerts || alerts.length === 0) return null

  const selectedAlert = alerts.find(a => a.id === selected)
  const mappedAlert   = alerts.find(a => a.id === mapped)

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
              // The row and the map button are siblings rather than one inside
              // the other: a button nested in a button is invalid, and the row
              // is a button because tapping anywhere along it opens the alert.
              <div key={alert.id} className="alert-row-wrap">
                <button
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
                {/* The shortcut to the ground the alert covers, without reading
                    the alert first — the sheet carries the same button. */}
                <button
                  className="alert-map-btn"
                  onClick={() => setMapped(alert.id)}
                  aria-label={`Show the area affected by the ${props.event} on a map`}
                  title="Show affected area on map"
                >
                  <Map size={16} />
                </button>
              </div>
            )
          })}
        </div>
      </div>

      {selectedAlert && createPortal(
        <AlertModal alert={selectedAlert} location={location} onClose={() => setSelected(null)} />,
        document.getElementById('alert-portal-root') ?? document.body
      )}

      {mappedAlert && createPortal(
        <AlertAreaMap key={mappedAlert.id} alert={mappedAlert} location={location} onClose={() => setMapped(null)} />,
        document.getElementById('alert-portal-root') ?? document.body
      )}
    </>
  )
}
