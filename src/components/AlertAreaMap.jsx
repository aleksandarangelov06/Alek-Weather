import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { TriangleAlert, X } from 'lucide-react'
import { resolveStyle } from '../utils/alertStyle'
import { loadAlertArea } from '../utils/alertArea'
import { addBasemap } from '../utils/basemap'

// Where to stop when fitting a single small zone. Without a cap, a lone county
// warning opens at street level, where the outline runs off every edge and the
// shape of the thing — the point of the map — can't be read at all.
const FIT_MAX_ZOOM = 10

// "Flood Watch for Montgomery, Howard, Baltimore…" — the areaDesc is a
// semicolon-joined list that runs to a paragraph in a statewide alert. The rows
// and the sheet both show the first entry alone; this shows a few, because the
// question the map answers is which places are in it.
function areaSummary(areaDesc) {
  if (!areaDesc) return null
  const parts = areaDesc.split(';').map(s => s.trim()).filter(Boolean)
  if (parts.length <= 3) return parts.join(', ')
  return `${parts.slice(0, 3).join(', ')} +${parts.length - 3} more`
}

// The alert's ground, drawn. Opened from the map button on an alert row or in
// the alert sheet, and full-screen because an outline is a shape — a thumbnail
// of it tells you nothing you didn't already get from the county names.
export function AlertAreaMap({ alert, location, onClose }) {
  const mapRef  = useRef(null)
  const mapInst = useRef(null)
  const [mapReady, setMapReady] = useState(false)
  // 'loading' → 'drawn' | 'empty' (the alert names no ground) | 'failed'
  const [area, setArea] = useState({ status: 'loading' })

  const props = alert.properties
  const cfg   = resolveStyle(props)

  // Same scroll lock the alert sheet takes, for the same reason: the page behind
  // a full-screen overlay must not scroll under it.
  //
  // Closing is routed through history, the way the full-screen radar does it:
  // the overlay pushes an entry on the way in, and every way out — the button,
  // Esc, the phone's back gesture — is history.back(), which lands here as a pop
  // and unmounts. Straight onClose would leave the entry behind, and the back
  // press after that would spend it on nothing.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    history.pushState({ overlay: 'alertMap' }, '')
    const onPop = () => onClose()
    // Esc leaves; the arrow keys zoom, the same pair the full-screen radar binds.
    // They work wherever the focus is, which is why Leaflet's own keyboard
    // handling is off on the map below — left to it, the arrows would pan
    // whenever the map happened to hold focus and zoom whenever it didn't.
    const onKey = (e) => {
      if (e.key === 'Escape') { history.back(); return }
      if (e.key === 'ArrowUp')   { e.preventDefault(); mapInst.current?.zoomIn() }
      if (e.key === 'ArrowDown') { e.preventDefault(); mapInst.current?.zoomOut() }
    }
    window.addEventListener('popstate', onPop)
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('popstate', onPop)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  // The map itself. Built once and torn down with the overlay — this is not the
  // radar's long-lived instance, so there is no layer cache to keep alive and
  // nothing to invalidate on resize beyond what Leaflet handles.
  useEffect(() => {
    if (!mapRef.current || mapInst.current) return
    const map = L.map(mapRef.current, {
      // The control is built either way and hidden on the phone shell in CSS
      // (see .alert-map .leaflet-bar), rather than being built conditionally
      // here: the shell can change under a mounted map — it is a setting, not a
      // device — and a stylesheet follows that where a constructor option can't.
      zoomControl: true,
      attributionControl: false,
      // Arrow keys are bound above, for the whole overlay rather than for the
      // map's focus state.
      keyboard: false,
      // A starting view so the tiles have somewhere to be while the zones load;
      // the fit below replaces it. Falls back to the middle of the country when
      // the overlay was opened from a surface that has no location to hand.
      center: location ? [location.latitude, location.longitude] : [39.5, -98.35],
      zoom: location ? 7 : 4,
    })
    // The same base the radar draws on, carrying the same .map-base-tiles class:
    // the theme and sky-level filters in App.css are bound to that class, so the
    // map here darkens with the rest of the app for free.
    addBasemap(L, map)
    // Where you are, in the same dot the radar uses — the one thing that turns
    // an outline into an answer about you rather than about the county list.
    if (location) {
      L.marker([location.latitude, location.longitude], {
        icon: L.divIcon({ className: 'radar-here', iconSize: [12, 12], iconAnchor: [6, 6] }),
        interactive: false, keyboard: false,
      }).addTo(map)
    }
    mapInst.current = map
    setMapReady(true)
    return () => { map.remove(); mapInst.current = null; setMapReady(false) }
  }, [location])

  // Fetching the ground. Storm-based warnings carry their polygon and land here
  // immediately; zone-based ones spend a moment on api.weather.gov first. See
  // loadAlertArea.
  // Mounted per alert (the callers key on the alert's id), so this runs once and
  // the state it lands in is the state it keeps — nothing here resets `area`
  // back to loading, because there is no second alert to load it for.
  useEffect(() => {
    let cancelled = false
    loadAlertArea(alert)
      .then(res => {
        if (cancelled) return
        setArea(res ? { status: 'drawn', ...res } : { status: 'empty' })
      })
      .catch(() => { if (!cancelled) setArea({ status: 'failed' }) })
    return () => { cancelled = true }
  }, [alert])

  // Drawing it, once both the map and the geometry exist — either can arrive
  // first, so this waits on both rather than living inside one of them.
  //
  // The colours are left to CSS (.alert-area-shape, painted from the
  // --alert-color this overlay sets): resolveStyle returns var(--cond-*)
  // references, and a var() handed to Leaflet becomes an SVG presentation
  // attribute, which browsers do not resolve. As a stylesheet rule it is an
  // ordinary custom property again, and it also wins over the inline attribute
  // Leaflet writes.
  useEffect(() => {
    const map = mapInst.current
    if (!map || !mapReady || area.status !== 'drawn') return
    // className goes in the layer options rather than in `style`: Leaflet reads
    // it once, when the <path> is created on add, and only the options object is
    // guaranteed to be carrying it by then.
    const layer = L.geoJSON(area.geo, {
      className: 'alert-area-shape',
      interactive: false,
      style: { weight: 2, opacity: 1, fillOpacity: 0.18 },
    }).addTo(map)
    const bounds = layer.getBounds()
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [28, 28], maxZoom: FIT_MAX_ZOOM })
    return () => { map.removeLayer(layer) }
  }, [mapReady, area])

  const summary = areaSummary(props.areaDesc)

  return (
    <div className="alert-map-overlay" style={{ '--alert-color': cfg.color }}>
      <header className="alert-map-bar">
        <TriangleAlert size={18} style={{ color: cfg.color, flexShrink: 0 }} />
        <div className="alert-map-titles">
          <span className="alert-map-event" style={{ color: cfg.color }}>{props.event}</span>
          {summary && <span className="alert-map-area">{summary}</span>}
        </div>
        <button className="alert-close-btn" onClick={() => history.back()} aria-label="Close map">
          <X size={18} />
        </button>
      </header>

      <div className="alert-map-wrap">
        <div ref={mapRef} className="alert-map" />
        {/* One line over the map, and only when there is something to say about
            what is drawn: that it is still coming, that it can't be drawn, or
            that what is on screen is part of a larger warned area. */}
        {area.status === 'loading' && (
          <p className="alert-map-note">Loading affected area…</p>
        )}
        {area.status === 'empty' && (
          <p className="alert-map-note">This alert doesn’t include a mapped area.</p>
        )}
        {area.status === 'failed' && (
          <p className="alert-map-note">The affected area couldn’t be loaded.</p>
        )}
        {area.status === 'drawn' && area.drawn < area.zones && (
          <p className="alert-map-note">
            Showing {area.drawn} of {area.zones} affected zones
          </p>
        )}
      </div>
    </div>
  )
}
