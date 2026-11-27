import { memo, useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { TriangleAlert, X, ChevronRight, Map, Radar } from 'lucide-react'
import { resolveStyle } from '../utils/alertStyle'
import { alertBlocks, alertParagraphs, alertTierName, headlineLines } from '../utils/alertText'
import { lockScroll } from '../utils/scrollLock'
import { AlertAreaMap } from './AlertAreaMapLazy'
import { DetailCover } from './DetailCover'
import { useCoverHistory } from '../utils/detailCover'

// "3:45 AM" today, "Sat 5:00 AM" on another day.
function whenText(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(+d)) return null
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  return d.toDateString() === new Date().toDateString()
    ? time
    : `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${time}`
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

// NWS's message, in its own words, laid out: the headline one statement a
// line, the description paragraph by paragraph, and a forecast (".TODAY...")
// one period a row. `prefix` is the class family of whichever view it is in
// (alert-page on the phones' page, alert-sheet in the desktop dialog).
function AlertMessage({ headline, description, prefix }) {
  const lines = headlineLines(headline)
  return (
    <>
      {lines.length > 0 && (
        <p className={`${prefix}-headline`}>
          {lines.map((line, i) => <span key={i}>{linkify(line)}</span>)}
        </p>
      )}
      {alertBlocks(description).map((block, i) => (block.kind === 'periods' ? (
        <dl key={i} className="alert-periods">
          {block.periods.map((p, j) => (
            <div key={j}>
              <dt>{p.label}</dt>
              <dd>{p.text}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p key={i} className={`${prefix}-${prefix === 'alert-page' ? 'text' : 'description'}`}>{linkify(block.text)}</p>
      )))}
    </>
  )
}

// The full alert: a header in the alert's colour with when it runs and who
// issued it, then NWS's message as written (its headline, the description and
// what to do), and the ways on from here. `onStormCenter`, where
// given (the phone styles), adds a button that opens the Storm Center.
export function AlertModal({ alert, location, onClose, onStormCenter = null }) {
  // The area map, opened from the header or the foot and closed back to the
  // sheet rather than out of it: the sheet is what you were reading, and the
  // map is a look at one line of it.
  const [showMap, setShowMap] = useState(false)
  // When the sheet opened, for "Starts" against "In effect".
  const [openedAt] = useState(() => Date.now())
  // The forecast behind holds still while this is open (see scrollLock).
  useEffect(() => lockScroll(), [])

  const props = alert.properties
  const cfg = resolveStyle(props)
  const tier = alertTierName(props.event)
  // The message as NWS wrote it, paragraph by paragraph. Not read into
  // What / Where / When parts any more: that reordered and relabelled the
  // forecaster's text, and the alert reads better the way it was issued.
  const instruction = alertParagraphs(props.instruction)
  const startIso = props.onset ?? props.effective ?? props.sent
  const endIso = props.ends ?? props.expires
  const started = startIso && +new Date(startIso) <= openedAt
  const office = (props.senderName ?? '').replace(/^NWS\s+/, '')
  // The forecaster's headline (NWSheadline, the "...WINTER STORM WARNING IN
  // EFFECT FROM..." line) when there is one, else the product headline
  // ("Winter Storm Warning issued ... by NWS ..."). Its ellipses go.
  const nwsHeadline = props.parameters?.NWSheadline?.[0]?.replace(/^\.+|\.+$/g, '').trim()
  const message = nwsHeadline || props.headline

  return (
    <>
    <div className="alert-backdrop" onClick={onClose}>
      <div
        className="alert-sheet"
        style={{ '--alert-color': cfg.color }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="alert-sheet-title"
        onClick={e => e.stopPropagation()}
      >
        {/* Set like the Storm Center: type first, colour only where it
            means something (the alert's kind, in its colour), and rules
            between things rather than tiles around them. */}
        <header className="alert-sheet-head">
          <p className="alert-sheet-kicker">
            <TriangleAlert size={15} aria-hidden="true" />
            {tier}
            <span className="alert-sheet-severity">{cfg.label}</span>
          </p>
          <h2 id="alert-sheet-title" className="alert-sheet-event">{props.event}</h2>
          <button className="alert-close-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        <dl className="alert-sheet-times">
          <div>
            <dt>{started ? 'In effect' : 'Starts'}</dt>
            <dd>{started ? 'Now' : whenText(startIso) ?? '-'}</dd>
          </div>
          <div>
            <dt>Ends</dt>
            <dd>{whenText(endIso) ?? 'Until further notice'}</dd>
          </div>
          {office && (
            <div>
              <dt>Issued by</dt>
              <dd>{office}</dd>
            </div>
          )}
        </dl>

        <div className="alert-sheet-scroll">
          {/* NWS's message, as issued: the headline, then the description and
              what to do, paragraph by paragraph in the forecaster's words. */}
          <AlertMessage headline={message} description={props.description} prefix="alert-sheet" />

          {instruction.length > 0 && (
            <section className="alert-sheet-section" aria-label="What to do">
              <h3 className="alert-sheet-section-title">What to do</h3>
              {instruction.map((para, i) => <p key={i}>{linkify(para)}</p>)}
            </section>
          )}
        </div>

        <footer className="alert-sheet-foot">
          {onStormCenter && (
            <button type="button" className="alert-sheet-btn" onClick={onStormCenter}>
              <Radar size={17} aria-hidden="true" />
              Open Storm Center
            </button>
          )}
          <button type="button" className="alert-sheet-btn" onClick={() => setShowMap(true)}>
            <Map size={17} aria-hidden="true" />
            Affected area
          </button>
        </footer>
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

// The parts of an alert both ways of reading it share: when it runs, who
// issued it, and NWS's message as written.
function alertParts(props, openedAt) {
  const startIso = props.onset ?? props.effective ?? props.sent
  const endIso = props.ends ?? props.expires
  // The forecaster's headline (NWSheadline, the "...WINTER STORM WARNING IN
  // EFFECT FROM..." line) when there is one, else the product headline.
  const nwsHeadline = props.parameters?.NWSheadline?.[0]?.replace(/^\.+|\.+$/g, '').trim()
  return {
    started: startIso && +new Date(startIso) <= openedAt,
    startIso,
    endIso,
    office: (props.senderName ?? '').replace(/^NWS\s+/, ''),
    message: nwsHeadline || props.headline,
    paragraphs: alertParagraphs(props.description),
    instruction: alertParagraphs(props.instruction),
    areas: (props.areaDesc ?? '').split(';').map((x) => x.trim()).filter(Boolean),
  }
}

// The alert on the phones: a full page of its own, the way a day of the 7-day
// forecast opens (DetailCover's page shell, on the sky with the forecast faded
// out), built from the same parts as that page: a title with its icon, a
// summary line, a row of three tiles, and titled panels. The alert's colour is
// kept to its icon and its kind; the rest is the app's own surfaces and type.
function AlertPage({ alert, closing, onClose, onMap, onStormCenter }) {
  const [openedAt] = useState(() => Date.now())
  const props = alert.properties
  const cfg = resolveStyle(props)
  const tier = alertTierName(props.event)
  const { started, startIso, endIso, office, message, paragraphs, instruction, areas } = alertParts(props, openedAt)

  return (
    <DetailCover
      page
      variant="alert"
      closing={closing}
      title={props.event}
      icon={<TriangleAlert size={28} aria-hidden="true" />}
      iconStyle={{ color: cfg.color }}
      onClose={onClose}
      bodyClass="alert-page-body"
    >
      <div className="detail-summary">
        <div className="detail-summary-text">
          <div className="detail-summary-label">
            <span className="alert-page-tier" style={{ '--alert-color': cfg.color }}>{tier}</span>
            <span className="alert-page-severity"> · {cfg.label}</span>
          </div>
          {areas.length > 0 && (
            <div className="detail-summary-note">
              {areas.slice(0, 3).join(', ')}{areas.length > 3 ? ` and ${areas.length - 3} more` : ''}
            </div>
          )}
        </div>
      </div>

      <div className="day-stats">
        <div className="day-stat">
          <span className="day-stat-label">{started ? 'In effect' : 'Starts'}</span>
          <span className="day-stat-value">{started ? 'Now' : whenText(startIso) ?? '-'}</span>
          <span className="day-stat-sub">{started && startIso ? `Since ${whenText(startIso)}` : 'Begins'}</span>
        </div>
        <div className="day-stat">
          <span className="day-stat-label">Ends</span>
          <span className="day-stat-value">{whenText(endIso) ?? 'Later'}</span>
          <span className="day-stat-sub">{endIso ? 'Unless extended' : 'Until further notice'}</span>
        </div>
        <div className="day-stat">
          <span className="day-stat-label">Issued by</span>
          <span className="day-stat-value">{office || 'NWS'}</span>
          <span className="day-stat-sub">National Weather Service</span>
        </div>
      </div>

      <div className="alert-page-actions">
        {onStormCenter && (
          <button type="button" className="alert-page-action" onClick={onStormCenter}>
            <Radar size={18} aria-hidden="true" />
            Storm Center
            <ChevronRight size={16} className="alert-page-action-chevron" aria-hidden="true" />
          </button>
        )}
        <button type="button" className="alert-page-action" onClick={onMap}>
          <Map size={18} aria-hidden="true" />
          Affected area
          <ChevronRight size={16} className="alert-page-action-chevron" aria-hidden="true" />
        </button>
      </div>

      {/* NWS's message, as issued: the headline, then the description,
          paragraph by paragraph in the forecaster's words. */}
      {(message || paragraphs.length > 0) && (
        <section className="detail-section alert-page-panel" aria-label="The alert">
          <div className="detail-section-label">Message</div>
          <AlertMessage headline={message} description={props.description} prefix="alert-page" />
        </section>
      )}

      {instruction.length > 0 && (
        <section className="detail-section alert-page-panel" aria-label="What to do">
          <div className="detail-section-label">What to do</div>
          {instruction.map((para, i) => <p key={i} className="alert-page-text alert-page-text--strong">{linkify(para)}</p>)}
        </section>
      )}
    </DetailCover>
  )
}

// How long the page takes to go (pageBgOut and its delay, App.css).
const PAGE_OUT_MS = 220

// "Until 11 AM" today, "Until Sat 11 AM" on another day.
function untilText(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(+d)) return null
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: d.getMinutes() ? '2-digit' : undefined })
  const today = d.toDateString() === new Date().toDateString()
  return `Until ${today ? time : `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${time}`}`
}

// `onStormCenter`, when given (the phone styles), puts a button in each alert's
// sheet that opens the Storm Center: the alert is usually why you'd want it.
// Memoised: App re-renders for every overlay, toggle and keystroke, and the
// props here are the reading and the settings, which those leave alone.
export const WeatherAlerts = memo(function WeatherAlerts({ alerts, location, onStormCenter = null }) {
  const [selected, setSelected] = useState(null)
  // On the phones an alert opens as a page (AlertPage); on the desktop as the
  // dialog (AlertModal). Read when it opens.
  const [asPage, setAsPage] = useState(false)
  const [closing, setClosing] = useState(false)
  const closeTimer = useRef(null)
  const closePage = () => {
    setClosing(true)
    clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => { setSelected(null); setClosing(false) }, PAGE_OUT_MS)
  }
  // The page takes a history entry, so Back (and the gesture) closes it, as
  // it does the 7-day forecast's.
  const dismissPage = useCoverHistory(asPage && selected !== null && !closing, closePage)
  const openAlert = (id) => {
    setAsPage(document.documentElement.dataset.shell === 'mobile')
    clearTimeout(closeTimer.current)
    setClosing(false)
    setSelected(id)
  }
  useEffect(() => () => clearTimeout(closeTimer.current), [])
  useEffect(() => {
    if (!asPage || selected === null) return
    const onKey = (e) => { if (e.key === 'Escape') dismissPage() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [asPage, selected]) // eslint-disable-line react-hooks/exhaustive-deps
  // From the page to the Storm Center: the page's history entry has to be
  // spent before the Storm Center pushes its own, or the pop would land on
  // the new one and close it. So go back first and open it once that lands.
  const pageToStormCenter = () => {
    let done = false
    const go = () => {
      if (done) return
      done = true
      window.removeEventListener('popstate', go)
      setTimeout(onStormCenter, 0)
    }
    window.addEventListener('popstate', go)
    setTimeout(go, 400)
    dismissPage()
  }
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
            const until = untilText(props.ends ?? props.expires)
            return (
              // The row and the map button are siblings rather than one inside
              // the other: a button nested in a button is invalid, and the row
              // is a button because tapping anywhere along it opens the alert.
              // Drawn like At a Glance's banners (.glance-alert): a tint of the
              // alert's colour, a stronger tint behind its icon, and when it
              // ends where the severity chip used to be.
              <div key={alert.id} className="alert-row-wrap">
                <button
                  className="alert-row"
                  style={{ '--alert-color': cfg.color }}
                  onClick={() => openAlert(alert.id)}
                >
                  <span className="alert-row-icon" aria-hidden="true">
                    <TriangleAlert size={18} />
                  </span>
                  <span className="alert-row-text">
                    <span className="alert-row-top">
                      <span className="alert-row-event">{props.event}</span>
                      {until && <span className="alert-row-when">{until}</span>}
                    </span>
                    {props.areaDesc && (
                      <span className="alert-row-area">{props.areaDesc.split(';')[0]}</span>
                    )}
                  </span>
                  <ChevronRight size={16} className="alert-row-chevron" aria-hidden="true" />
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

      {selectedAlert && asPage && (
        <AlertPage
          alert={selectedAlert}
          closing={closing}
          onClose={dismissPage}
          onMap={() => setMapped(selectedAlert.id)}
          onStormCenter={onStormCenter && pageToStormCenter}
        />
      )}

      {selectedAlert && !asPage && createPortal(
        <AlertModal
          alert={selectedAlert}
          location={location}
          onClose={() => setSelected(null)}
          onStormCenter={onStormCenter && (() => { setSelected(null); onStormCenter() })}
        />,
        document.getElementById('alert-portal-root') ?? document.body
      )}

      {/* Into <body> while the alert page is up: the page fades everything
          else in .app out (the portal root included), which would hide the map. */}
      {mappedAlert && createPortal(
        <AlertAreaMap key={mappedAlert.id} alert={mappedAlert} location={location} onClose={() => setMapped(null)} />,
        (selectedAlert && asPage ? null : document.getElementById('alert-portal-root')) ?? document.body
      )}
    </>
  )
})
