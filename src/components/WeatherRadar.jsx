import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Minimize2, Play, Pause, Navigation } from 'lucide-react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const FRAMES_URL = 'https://api.rainviewer.com/public/weather-maps.json'
const TILE_URL   = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
const MAP_MAX_ZOOM     = 14
const RADAR_NATIVE_MAX = 6
const RADAR_OPACITY     = 0.65
const LEGEND_COLORS = ['#43a4c3', '#326985', '#ffff00', '#ff3300', '#d193c9']

delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({ iconUrl: '', shadowUrl: '' })

function fmtTime(unixSec, timezone) {
  return new Date(unixSec * 1000).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', timeZone: timezone,
  })
}

export function WeatherRadar({ location, timezone }) {
  const mapRef      = useRef(null)
  const mapInst     = useRef(null)
  const baseTileRef = useRef(null)
  const radarLayers = useRef([])
  const trackRef    = useRef(null)
  const isDragging  = useRef(false)

  const [host, setHost]           = useState('')
  const [frames, setFrames]       = useState([])
  const [pastCount, setPastCount] = useState(0)
  const [idx, setIdx]             = useState(0)
  const [playing, setPlaying]     = useState(false)
  const [expanded, setExpanded]   = useState(false)
  const [mapReady, setMapReady]   = useState(false)

  // Fetch RainViewer frame list once
  useEffect(() => {
    fetch(FRAMES_URL)
      .then(r => r.json())
      .then(data => {
        const past = data.radar.past ?? []
        const cast = data.radar.nowcast ?? []
        setHost(data.host)
        setFrames([...past, ...cast])
        setPastCount(past.length)
        setIdx(Math.max(0, past.length - 1))
      })
      .catch(() => {})
  }, [])

  // Init Leaflet map (without base tile — handled separately so it can swap on theme change)
  useEffect(() => {
    if (!mapRef.current || mapInst.current || frames.length === 0) return
    const map = L.map(mapRef.current, {
      zoomControl: false,
      attributionControl: false,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      touchZoom: false,
      boxZoom: false,
      keyboard: false,
      maxZoom: MAP_MAX_ZOOM,
    })
    map.setView([location.latitude, location.longitude], 10)
    L.circleMarker([location.latitude, location.longitude], {
      radius: 5, fillColor: '#3b82f6', color: '#fff', weight: 2, fillOpacity: 1,
    }).addTo(map)
    mapInst.current = map
    setMapReady(true)
    return () => {
      map.remove()
      mapInst.current = null
      baseTileRef.current = null
      radarLayers.current = []
      setMapReady(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frames.length > 0, location.latitude, location.longitude])

  // Add base tile layer once map is ready
  useEffect(() => {
    const map = mapInst.current
    if (!map || !mapReady) return
    baseTileRef.current = L.tileLayer(TILE_URL, {
      maxZoom: 20, detectRetina: true, crossOrigin: true,
      className: 'map-base-tiles', zIndex: 1,
    })
    baseTileRef.current.addTo(map)
    return () => {
      if (baseTileRef.current) { map.removeLayer(baseTileRef.current); baseTileRef.current = null }
    }
  }, [mapReady])

  // Preload every frame as a hidden tile layer so playback is instant (no per-frame fetch)
  useEffect(() => {
    const map = mapInst.current
    if (!map || !mapReady || !host || frames.length === 0) return
    radarLayers.current.forEach(l => map.removeLayer(l))
    radarLayers.current = frames.map(frame =>
      L.tileLayer(
        `${host}${frame.path}/512/{z}/{x}/{y}/4/1_1.png`,
        { opacity: 0, zIndex: 200, maxZoom: MAP_MAX_ZOOM, maxNativeZoom: RADAR_NATIVE_MAX, crossOrigin: true }
      ).addTo(map)
    )
    return () => {
      radarLayers.current.forEach(l => map.removeLayer(l))
      radarLayers.current = []
    }
  }, [mapReady, host, frames])

  // Reveal only the active frame (layers stay mounted, so tiles are already cached)
  useEffect(() => {
    radarLayers.current.forEach((layer, i) => layer.setOpacity(i === idx ? RADAR_OPACITY : 0))
  }, [idx, frames])

  // Animation playback
  useEffect(() => {
    if (!playing || frames.length === 0) return
    const id = setInterval(() => setIdx(i => (i + 1) % frames.length), 450)
    return () => clearInterval(id)
  }, [playing, frames.length])

  const expand = () => {
    history.pushState({ overlay: 'radar' }, '')
    setExpanded(true)
  }

  const collapse = () => history.back()

  useEffect(() => {
    if (!expanded) return
    const handler = () => setExpanded(false)
    window.addEventListener('popstate', handler)
    return () => window.removeEventListener('popstate', handler)
  }, [expanded])

  // Resize, re-center, and toggle interaction on expand/collapse
  useEffect(() => {
    const map = mapInst.current
    if (!map) return
    const t = setTimeout(() => {
      map.invalidateSize()
      if (!expanded) map.setView([location.latitude, location.longitude], 10, { animate: false })
    }, 80)
    if (expanded) {
      map.dragging.enable(); map.scrollWheelZoom.enable()
      map.doubleClickZoom.enable(); map.touchZoom.enable()
    } else {
      map.dragging.disable(); map.scrollWheelZoom.disable()
      map.doubleClickZoom.disable(); map.touchZoom.disable()
    }
    return () => clearTimeout(t)
  }, [expanded, location.latitude, location.longitude])

  const handleLocate = useCallback(() => {
    const map = mapInst.current
    if (!map) return
    map.setView([location.latitude, location.longitude], 9, { animate: true })
  }, [location.latitude, location.longitude])

  const handlePointerDown = useCallback((e) => {
    isDragging.current = true
    setPlaying(false)
    e.currentTarget.setPointerCapture(e.pointerId)
    const rect = e.currentTarget.getBoundingClientRect()
    setIdx(Math.round(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * (frames.length - 1)))
  }, [frames.length])

  const handlePointerMove = useCallback((e) => {
    if (!isDragging.current) return
    const rect = trackRef.current.getBoundingClientRect()
    setIdx(Math.round(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * (frames.length - 1)))
  }, [frames.length])

  const handlePointerUp = useCallback(() => { isDragging.current = false }, [])

  if (frames.length === 0) return null

  return (
    <div className={`card radar-card${expanded ? ' radar-expanded' : ''}`}>
      {!expanded && (
        <div className="radar-header">
          <span className="section-label" style={{ margin: 0 }}>RADAR</span>
        </div>
      )}

      <div className="radar-map-wrap">
        <div ref={mapRef} className="radar-map" />
        {expanded && (
          <>
            <button className="radar-expand-btn radar-expand-btn--floating" onClick={collapse} aria-label="Collapse">
              <Minimize2 size={20} />
            </button>
            <button className="radar-locate-btn" onClick={handleLocate} aria-label="Center on location">
              <Navigation size={15} />
            </button>
          </>
        )}
        {!expanded && (
          <div
            className="radar-map-tap"
            onClick={expand}
            role="button"
            aria-label="Expand radar"
          />
        )}
      </div>

      <div className="radar-controls">
        <div className="radar-main-row">
          <div className="radar-big-time">
            {frames[idx] ? fmtTime(frames[idx].time, timezone) : ''}
          </div>
          <button className="radar-play-circle" onClick={() => setPlaying(v => !v)} aria-label={playing ? 'Pause' : 'Play'}>
            {playing ? <Pause size={22} /> : <Play size={22} />}
          </button>
        </div>

        <div
          className="radar-tick-track"
          ref={trackRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          {frames.map((frame, i) => {
            const d    = new Date(frame.time * 1000)
            const prev = i > 0 ? new Date(frames[i - 1].time * 1000) : null
            const isHour = prev !== null && d.getHours() !== prev.getHours()
            return (
              <div key={i} className="radar-tick-col">
                <div className={[
                  'radar-tick',
                  i === idx      && 'radar-tick--active',
                  isHour         && 'radar-tick--hour',
                  i >= pastCount && 'radar-tick--forecast',
                ].filter(Boolean).join(' ')} />
                {isHour && (
                  <span className="radar-tick-label">
                    {d.toLocaleTimeString('en-US', { hour: 'numeric', timeZone: timezone })}
                  </span>
                )}
              </div>
            )
          })}
        </div>

        <div className="radar-legend">
          <span className="radar-legend-lbl">Light</span>
          <div className="radar-legend-blocks">
            {LEGEND_COLORS.map((color, i) => (
              <div key={i} className="radar-legend-block" style={{ background: color }} />
            ))}
          </div>
          <span className="radar-legend-lbl">Heavy</span>
        </div>
      </div>
      {expanded && createPortal(
        <div className="radar-loading-overlay">
          <div className="spinner" />
          <span className="radar-loading-text">Loading radar...</span>
        </div>,
        document.body
      )}
    </div>
  )
}
