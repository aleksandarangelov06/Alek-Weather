import { useEffect, useRef, useState, useCallback } from 'react'
import { Minimize2, Play, Pause, ChevronLeft, ChevronRight, Navigation } from 'lucide-react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const FRAMES_URL   = 'https://api.rainviewer.com/public/weather-maps.json'
const TILE_URL = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png'
const MAP_MAX_ZOOM     = 10
const RADAR_NATIVE_MAX = 6
const LEGEND_COLORS = ['#c8e8ff', '#ffff00', '#ff8800', '#ff2200', '#aa00cc']

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
  const radarLayer  = useRef(null)

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
    map.setView([location.latitude, location.longitude], 7)
    L.circleMarker([location.latitude, location.longitude], {
      radius: 5, fillColor: '#3b82f6', color: '#fff', weight: 2, fillOpacity: 1,
    }).addTo(map)
    mapInst.current = map
    setMapReady(true)
    return () => {
      map.remove()
      mapInst.current = null
      baseTileRef.current = null
      radarLayer.current = null
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

  // Swap radar tile layer when frame index changes
  useEffect(() => {
    const map = mapInst.current
    if (!map || !mapReady || !host || frames.length === 0) return
    if (radarLayer.current) { map.removeLayer(radarLayer.current); radarLayer.current = null }
    const frame = frames[idx]
    if (!frame) return
    radarLayer.current = L.tileLayer(
      `${host}${frame.path}/512/{z}/{x}/{y}/6/1_1.png`,
      { opacity: 0.65, zIndex: 200, maxZoom: MAP_MAX_ZOOM, maxNativeZoom: RADAR_NATIVE_MAX, crossOrigin: true }
    ).addTo(map)
  }, [mapReady, host, frames, idx])

  // Animation playback
  useEffect(() => {
    if (!playing || frames.length === 0) return
    const id = setInterval(() => setIdx(i => (i + 1) % frames.length), 450)
    return () => clearInterval(id)
  }, [playing, frames.length])

  // Resize, re-center, and toggle interaction on expand/collapse
  useEffect(() => {
    const map = mapInst.current
    if (!map) return
    const t = setTimeout(() => {
      map.invalidateSize()
      if (!expanded) map.setView([location.latitude, location.longitude], 7, { animate: false })
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

  if (frames.length === 0) return null

  const isForecast = idx >= pastCount
  const timeLabel  = frames[idx] ? fmtTime(frames[idx].time, timezone) : ''

  // Slider track: played | unplayed past | forecast
  const idxFrac  = frames.length > 1 ? (idx / (frames.length - 1)) * 100 : 0
  const pastFrac = frames.length > 0 ? (pastCount / frames.length) * 100 : 70
  const sliderBg = `linear-gradient(to right,
    var(--accent) ${idxFrac.toFixed(1)}%,
    rgba(120,130,150,0.4) ${idxFrac.toFixed(1)}% ${pastFrac.toFixed(1)}%,
    rgba(59,130,246,0.22) ${pastFrac.toFixed(1)}%)`

  return (
    <div className={`card radar-card${expanded ? ' radar-expanded' : ''}`}>
      <div className="radar-header">
        <span className="section-label" style={{ margin: 0 }}>RADAR</span>
        {expanded && (
          <button className="radar-expand-btn" onClick={() => setExpanded(false)} aria-label="Collapse">
            <Minimize2 size={15} />
          </button>
        )}
      </div>

      <div className="radar-map-wrap">
        <div ref={mapRef} className="radar-map" />
        {expanded && (
          <button
            className="radar-locate-btn"
            onClick={handleLocate}
            aria-label="Center on location"
          >
            <Navigation size={15} />
          </button>
        )}
        {!expanded && (
          <div
            className="radar-map-tap"
            onClick={() => setExpanded(true)}
            role="button"
            aria-label="Expand radar"
          />
        )}
      </div>

      <div className="radar-controls">
        <div className="radar-slider-wrap">
          <input
            type="range"
            min={0}
            max={Math.max(0, frames.length - 1)}
            value={idx}
            onChange={e => { setPlaying(false); setIdx(Number(e.target.value)) }}
            className="radar-slider"
            style={{ background: sliderBg }}
          />
        </div>

        <div className="radar-footer">
          <div className="radar-btns">
            <button className="radar-btn" onClick={() => { setPlaying(false); setIdx(i => Math.max(0, i - 1)) }}>
              <ChevronLeft size={15} />
            </button>
            <button className="radar-btn radar-btn-play" onClick={() => setPlaying(v => !v)}>
              {playing ? <Pause size={15} /> : <Play size={15} />}
            </button>
            <button className="radar-btn" onClick={() => { setPlaying(false); setIdx(i => Math.min(frames.length - 1, i + 1)) }}>
              <ChevronRight size={15} />
            </button>
          </div>
          <span className="radar-time">
            {timeLabel}
            {isForecast && <span className="radar-forecast-badge">Forecast</span>}
          </span>
        </div>

        <div className="radar-legend">
          <span className="radar-legend-lbl">Light</span>
          <div className="radar-legend-blocks">
            {LEGEND_COLORS.map((color, i) => (
              <div key={i} className="radar-legend-block" style={{ background: color }} />
            ))}
          </div>
          <span className="radar-legend-lbl">Extreme</span>
        </div>
      </div>
    </div>
  )
}
