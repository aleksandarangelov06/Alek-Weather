import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Minimize2, Play, Pause, Navigation, ZoomIn, ZoomOut } from 'lucide-react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const FRAMES_URL = 'https://api.rainviewer.com/public/weather-maps.json'
const TILE_URL   = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
const MAP_MIN_ZOOM     = 4
const MAP_MAX_ZOOM     = 12
const RADAR_NATIVE_MAX = 7 // RainViewer's 512px radar tiles cap here; higher returns "zoom level not supported"
const RADAR_OPACITY     = 0.65
const RADAR_WINDOW      = 2 // frames either side of current kept attached to the map
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
  const layerCache  = useRef(new Map()) // frame.path -> L.TileLayer (kept alive for smooth playback)
  const activeKey   = useRef(null)
  const wantedKey   = useRef(null) // latest frame requested; guards stale async loads
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
      minZoom: MAP_MIN_ZOOM,
      maxZoom: MAP_MAX_ZOOM,
      // Perf on low-end laptops: skip Leaflet's per-frame repaint work.
      fadeAnimation: false,       // no tile cross-fade (composites every tile load)
      zoomAnimation: false,       // no animated zoom re-raster
      markerZoomAnimation: false,
      updateWhenZooming: false,   // don't refresh the tile grid mid-zoom
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
      layerCache.current.clear()
      activeKey.current = null
      setMapReady(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frames.length > 0, location.latitude, location.longitude])

  // Add base tile layer once map is ready
  useEffect(() => {
    const map = mapInst.current
    if (!map || !mapReady) return
    baseTileRef.current = L.tileLayer(TILE_URL, {
      maxZoom: 20, detectRetina: false, crossOrigin: true,
      className: 'map-base-tiles', zIndex: 1,
      updateWhenIdle: true, // only fetch tiles once panning stops — fewer requests/repaints
      keepBuffer: 1,        // hold fewer off-screen tiles in memory
    })
    baseTileRef.current.addTo(map)
    return () => {
      if (baseTileRef.current) { map.removeLayer(baseTileRef.current); baseTileRef.current = null }
    }
  }, [mapReady])

  // Cross-fade between cached radar layers as idx changes.
  // Each frame's layer is created once and cached (no recreate churn). Layers near
  // the current index stay attached to the map (hidden at opacity 0) so scrubbing/
  // playback only toggles opacity instead of refetching; far layers are detached so
  // pan/zoom isn't dragging every frame's tile grid at once. The previous frame stays
  // visible until the new one finishes loading,
  // which prevents the blank-frame flash on slow devices/connections. We also prefetch
  // one frame ahead so the next frame is ready before playback reaches it.
  // URL is /{size}/{z}/{x}/{y}/{color}/{smooth}_{snow}.png. RainViewer's free API
  // ignores the color and snow flags (always one fixed palette), but smoothing works.
  useEffect(() => {
    const map = mapInst.current
    if (!map || !mapReady || !host || frames.length === 0) return

    // Build/return a layer (cached), but only ATTACH it to the map when it's
    // within the active window. Attached layers reposition & reload tiles on
    // every pan/zoom, so keeping all ~13 on the map at once is what makes the
    // map drag laggy. We keep them in the cache (no recreate churn) but detach
    // the far ones so pan/zoom only moves a handful of grids.
    const getLayer = (frame, attach) => {
      let layer = layerCache.current.get(frame.path)
      if (!layer) {
        layer = L.tileLayer(
          `${host}${frame.path}/512/{z}/{x}/{y}/2/1_0.png`,
          { opacity: 0, zIndex: 200, maxZoom: MAP_MAX_ZOOM, maxNativeZoom: RADAR_NATIVE_MAX, crossOrigin: true, className: 'radar-tiles' }
        )
        layer.on('load', () => { layer._radarLoaded = true })
        layerCache.current.set(frame.path, layer)
      }
      if (attach && !map.hasLayer(layer)) layer.addTo(map)
      return layer
    }

    // Detach layers outside the window so the map isn't dragging 13 tile grids.
    const inWindow = new Set()
    for (let d = -RADAR_WINDOW; d <= RADAR_WINDOW; d++) {
      inWindow.add(frames[((idx + d) % frames.length + frames.length) % frames.length].path)
    }
    layerCache.current.forEach((layer, path) => {
      // Never detach the active layer — it's the fallback display until the next frame loads.
      // Detaching it before a replacement shows causes a blank map.
      if (!inWindow.has(path) && map.hasLayer(layer) && layer._radarLoaded && path !== activeKey.current) {
        layer.setOpacity(0)
        layer._radarLoaded = false // tiles get unloaded on detach; wait for reload next time
        map.removeLayer(layer)
      }
    })

    const frame = frames[idx]
    if (!frame) return
    wantedKey.current = frame.path
    const layer = getLayer(frame, true)

    const show = () => {
      if (wantedKey.current !== frame.path) return // user moved on before this loaded
      const prev = activeKey.current
      if (prev && prev !== frame.path) {
        const prevLayer = layerCache.current.get(prev)
        if (prevLayer) prevLayer.setOpacity(0)
      }
      layer.setOpacity(RADAR_OPACITY)
      activeKey.current = frame.path
    }

    // Show immediately if tiles are already cached; otherwise keep the old frame
    // up until this one loads, then swap.
    if (layer._radarLoaded) show()
    else layer.once('load', show)

    // Prefetch the full forward window so playback never waits on cold layers.
    for (let d = 1; d <= RADAR_WINDOW; d++) {
      getLayer(frames[(idx + d) % frames.length], true)
    }
  }, [mapReady, host, frames, idx])

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
    const handler = () => { setExpanded(false); setPlaying(false) }
    window.addEventListener('popstate', handler)
    return () => window.removeEventListener('popstate', handler)
  }, [expanded])

  // Desktop keyboard shortcuts while expanded: Esc collapses, Space toggles play/pause.
  useEffect(() => {
    if (!expanded) return
    const onKey = (e) => {
      if (e.key === 'Escape') {
        collapse()
      } else if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault() // stop the page from scrolling
        setPlaying(v => !v)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        setPlaying(false)
        setIdx(i => (i + 1) % frames.length)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        setPlaying(false)
        setIdx(i => (i - 1 + frames.length) % frames.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        mapInst.current?.zoomIn()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        mapInst.current?.zoomOut()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expanded, frames.length])

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

  const handleZoomIn  = useCallback(() => mapInst.current?.zoomIn(),  [])
  const handleZoomOut = useCallback(() => mapInst.current?.zoomOut(), [])

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
            <div className="radar-zoom-btns">
              <button className="radar-zoom-btn" onClick={handleZoomIn} aria-label="Zoom in">
                <ZoomIn size={16} />
              </button>
              <button className="radar-zoom-btn" onClick={handleZoomOut} aria-label="Zoom out">
                <ZoomOut size={16} />
              </button>
            </div>
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
