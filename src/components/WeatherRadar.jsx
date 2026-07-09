import { useEffect, useRef, useState, useCallback } from 'react'
import { Minimize2, Play, Pause, Navigation, ZoomIn, ZoomOut } from 'lucide-react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const FRAMES_URL = 'https://api.rainviewer.com/public/weather-maps.json'
const TILE_URL   = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'

// Future radar: NOAA HRRR forecast reflectivity served as free XYZ tiles by the
// Iowa Environmental Mesonet (CORS-enabled, no key). RainViewer's free nowcast
// array is unreliable (frequently empty), so HRRR provides the forecast frames.
// The model run can be 1–3h old; refd_0000.json carries model_init_utc, from
// which each 15-min step gets its real valid time. CONUS coverage only.
const HRRR_META_URL = 'https://mesonet.agron.iastate.edu/data/gis/images/4326/hrrr/refd_0000.json'
const HRRR_TILE_URL = (min) =>
  `https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/hrrr::REFD-F${String(min).padStart(4, '0')}-0/{z}/{x}/{y}.png`
const HRRR_STEP_MIN    = 15         // model output cadence
const HRRR_MAX_MIN     = 360        // last step we'll ever request from a run
const HRRR_HORIZON_SEC = 3 * 3600   // don't extend the timeline past now + 3h
// HRRR domain (approximate CONUS bounds); outside it the tiles are blank.
const inHrrrDomain = (lat, lon) => lat >= 21 && lat <= 53 && lon >= -134 && lon <= -60
const MAP_MIN_ZOOM     = 4
const MAP_MAX_ZOOM     = 12
const RADAR_NATIVE_MAX = 7 // RainViewer's 512px radar tiles cap here; higher returns "zoom level not supported"
const RADAR_OPACITY     = 0.65
const RADAR_WINDOW      = 2 // frames either side of current kept attached to the map
const LEGEND_COLORS = ['#43a4c3', '#326985', '#ffd900', '#ff3300', '#d193c9']
// HRRR futurecast tiles use the standard NWS reflectivity ramp (green → yellow
// → orange → red), not RainViewer's palette, so the legend swaps with the frames.
const LEGEND_COLORS_FUTURE = ['#02fd02', '#0173c5', '#fdf802', '#fd9500', '#fd0000']

// Scroll pixels needed per zoom level, tuned separately per input device: a
// mouse wheel fires big discrete notches (needs a large value or it races),
// while a trackpad streams many tiny deltas (needs a smaller value or it crawls).
const WHEEL_PX_MOUSE    = 150
const WHEEL_PX_TRACKPAD = 10

// Classify a wheel event as coming from a physical mouse vs a trackpad.
// Firefox reports line/page mode (deltaMode !== 0) only for mouse wheels; on
// Chromium a mouse wheel yields wheelDeltaY in whole multiples of 120 with a
// sizable deltaY, whereas a trackpad produces small, often fractional deltas.
function isMouseWheel(e) {
  if (e.deltaMode !== 0) return true
  return e.wheelDeltaY != null && Math.abs(e.wheelDeltaY) % 120 === 0 && Math.abs(e.deltaY) >= 100
}

delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({ iconUrl: '', shadowUrl: '' })

function fmtTime(unixSec, timezone) {
  return new Date(unixSec * 1000).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', timeZone: timezone,
  })
}

// mode: 'nowcast' (observed frames only) | 'future' (live frame + forecast only)
// | 'both' (full timeline, default).
export function WeatherRadar({ location, timezone, mode = 'both' }) {
  const mapRef      = useRef(null)
  const mapInst     = useRef(null)
  const baseTileRef = useRef(null)
  const layerCache  = useRef(new Map()) // frame.key -> L.TileLayer (kept alive for smooth playback)
  const activeKey   = useRef(null)
  const wantedKey   = useRef(null) // latest frame requested; guards stale async loads
  const trackRef    = useRef(null)
  const isDragging  = useRef(false)

  const [frames, setFrames]       = useState([])
  const [pastCount, setPastCount] = useState(0)
  const [idx, setIdx]             = useState(0)
  const [playing, setPlaying]     = useState(false)
  const [expanded, setExpanded]   = useState(false)
  const [mapReady, setMapReady]   = useState(false)

  // Fetch the frame list once: RainViewer for observed (+ its nowcast when the
  // free API bothers to include one), then HRRR forecast steps appended after
  // the last RainViewer frame. Each frame carries its own tile URL template so
  // the layer code doesn't care which source it came from.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      let rvFrames = [], pastLen = 0
      try {
        const data = await fetch(FRAMES_URL).then(r => r.json())
        const past = data.radar.past ?? []
        const cast = data.radar.nowcast ?? []
        pastLen = past.length
        // URL is /{size}/{z}/{x}/{y}/{color}/{smooth}_{snow}.png. RainViewer's
        // free API ignores the color and snow flags, but smoothing works.
        rvFrames = [...past, ...cast].map(f => ({
          key: f.path,
          time: f.time,
          url: `${data.host}${f.path}/512/{z}/{x}/{y}/2/1_0.png`,
        }))
      } catch {}

      const futFrames = []
      if (mode !== 'nowcast' && inHrrrDomain(location.latitude, location.longitude)) {
        try {
          const meta = await fetch(HRRR_META_URL).then(r => r.json())
          const init = Date.parse(meta.model_init_utc) / 1000
          const nowSec = Date.now() / 1000
          const lastRv = rvFrames.length ? rvFrames[rvFrames.length - 1].time : nowSec
          if (Number.isFinite(init)) {
            for (let m = HRRR_STEP_MIN; m <= HRRR_MAX_MIN; m += HRRR_STEP_MIN) {
              const t = init + m * 60
              if (t <= lastRv + 60) continue          // already covered by RainViewer
              if (t > nowSec + HRRR_HORIZON_SEC) break // keep the timeline short
              futFrames.push({ key: `hrrr:${m}`, time: t, url: HRRR_TILE_URL(m) })
            }
          }
        } catch {}
      }

      // Apply the radar mode: 'nowcast' keeps only observed frames, 'future'
      // keeps the live frame (so the map still shows "now") plus everything
      // after it, and 'both' keeps the full timeline.
      let all = [...rvFrames, ...futFrames]
      let observed = pastLen
      if (mode === 'nowcast') {
        all = rvFrames.slice(0, pastLen)
      } else if (mode === 'future') {
        const live = pastLen > 0 ? [rvFrames[pastLen - 1]] : []
        all = [...live, ...rvFrames.slice(pastLen), ...futFrames]
        observed = live.length
      }

      if (cancelled || all.length === 0) return
      setFrames(all)
      setPastCount(observed)
      setIdx(Math.max(0, observed - 1))
    })()
    return () => { cancelled = true }
  }, [location.latitude, location.longitude, mode])

  const hasFrames = frames.length > 0

  // Init Leaflet map (without base tile — handled separately so it can swap on theme change)
  useEffect(() => {
    if (!mapRef.current || mapInst.current || !hasFrames) return
    const cache = layerCache.current
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
      // Smooth wheel/trackpad zoom: allow fractional zoom levels (zoomSnap 0)
      // and animate the transition so scrolling glides continuously instead of
      // snapping a whole level at a time. wheelPxPerZoomLevel is set per-device
      // by the wheel listener below. zoomDelta stays 1 so the +/- buttons and
      // arrow keys still step by a full level.
      zoomSnap: 0,
      zoomDelta: 1,
      wheelPxPerZoomLevel: WHEEL_PX_MOUSE,
      wheelDebounceTime: 40,
      zoomAnimation: true,
      markerZoomAnimation: true,
      // Perf on low-end laptops: still skip the tile cross-fade and mid-zoom
      // grid refreshes — the expensive per-frame repaints — during zoom.
      fadeAnimation: false,       // no tile cross-fade (composites every tile load)
      updateWhenZooming: false,   // don't refresh the tile grid mid-zoom
    })

    // Pick the zoom sensitivity to match the device on each scroll. Capture
    // phase so it runs before Leaflet's own wheel handler, which reads the
    // option when it performs the (debounced) zoom.
    const onWheel = (e) => {
      map.options.wheelPxPerZoomLevel = isMouseWheel(e) ? WHEEL_PX_MOUSE : WHEEL_PX_TRACKPAD
    }
    const wheelEl = mapRef.current
    wheelEl.addEventListener('wheel', onWheel, { capture: true, passive: true })

    map.setView([location.latitude, location.longitude], 10)
    L.circleMarker([location.latitude, location.longitude], {
      radius: 5, fillColor: '#3b82f6', color: '#fff', weight: 2, fillOpacity: 1,
    }).addTo(map)
    mapInst.current = map
    setMapReady(true)
    return () => {
      wheelEl.removeEventListener('wheel', onWheel, { capture: true })
      map.remove()
      mapInst.current = null
      baseTileRef.current = null
      cache.clear()
      activeKey.current = null
      setMapReady(false)
    }
  }, [hasFrames, location.latitude, location.longitude])

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
  useEffect(() => {
    const map = mapInst.current
    if (!map || !mapReady || frames.length === 0) return

    // Build/return a layer (cached), but only ATTACH it to the map when it's
    // within the active window. Attached layers reposition & reload tiles on
    // every pan/zoom, so keeping all ~13 on the map at once is what makes the
    // map drag laggy. We keep them in the cache (no recreate churn) but detach
    // the far ones so pan/zoom only moves a handful of grids.
    const getLayer = (frame, attach) => {
      let layer = layerCache.current.get(frame.key)
      if (!layer) {
        layer = L.tileLayer(
          frame.url,
          { opacity: 0, zIndex: 200, maxZoom: MAP_MAX_ZOOM, maxNativeZoom: RADAR_NATIVE_MAX, crossOrigin: true, className: 'radar-tiles' }
        )
        layer.on('load', () => { layer._radarLoaded = true })
        layerCache.current.set(frame.key, layer)
      }
      if (attach && !map.hasLayer(layer)) layer.addTo(map)
      return layer
    }

    // During playback widen the window by one frame: prefetch lead time is
    // what prevents load-aware playback from pausing, and nobody is panning
    // mid-playback so the extra attached grid costs nothing noticeable.
    const win = playing ? RADAR_WINDOW + 1 : RADAR_WINDOW

    // Detach layers outside the window so the map isn't dragging 13 tile grids.
    const inWindow = new Set()
    for (let d = -win; d <= win; d++) {
      inWindow.add(frames[((idx + d) % frames.length + frames.length) % frames.length].key)
    }
    layerCache.current.forEach((layer, key) => {
      // Never detach the active layer — it's the fallback display until the next frame loads.
      // Detaching it before a replacement shows causes a blank map.
      if (!inWindow.has(key) && map.hasLayer(layer) && layer._radarLoaded && key !== activeKey.current) {
        layer.setOpacity(0)
        layer._radarLoaded = false // tiles get unloaded on detach; wait for reload next time
        map.removeLayer(layer)
      }
    })

    const frame = frames[idx]
    if (!frame) return
    wantedKey.current = frame.key
    const layer = getLayer(frame, true)

    const show = () => {
      if (wantedKey.current !== frame.key) return // user moved on before this loaded
      const prev = activeKey.current
      if (prev && prev !== frame.key) {
        const prevLayer = layerCache.current.get(prev)
        if (prevLayer) prevLayer.setOpacity(0)
      }
      layer.setOpacity(RADAR_OPACITY)
      activeKey.current = frame.key
    }

    // Show immediately if tiles are already cached; otherwise keep the old frame
    // up until this one loads, then swap.
    if (layer._radarLoaded) show()
    else layer.once('load', show)

    // Prefetch the full forward window so playback never waits on cold layers.
    for (let d = 1; d <= win; d++) {
      getLayer(frames[(idx + d) % frames.length], true)
    }
  }, [mapReady, frames, idx, playing])

  // Animation playback. Load-aware: if the next frame's tiles aren't in yet,
  // hold the current frame for another tick instead of advancing past it —
  // a brief pause reads as smooth, a skipped frame reads as a glitch. The
  // holds cap forces an advance anyway so a frame whose tiles never load
  // (e.g. all requests error) can't stall the loop. Depending on `idx` means
  // the interval restarts each advance, which also resets the holds count.
  useEffect(() => {
    if (!playing || frames.length === 0) return
    let holds = 0
    const id = setInterval(() => {
      const next = (idx + 1) % frames.length
      const layer = layerCache.current.get(frames[next].key)
      if (layer?._radarLoaded || ++holds >= 4) setIdx(next)
    }, 450)
    return () => clearInterval(id)
  }, [playing, frames, idx])

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

  const isFuture = idx >= pastCount
  // The legend tracks the tiles actually on screen: HRRR frames draw with the
  // NWS reflectivity ramp, while RainViewer frames (past and any nowcast) keep
  // RainViewer's palette.
  const legendColors = frames[idx]?.key?.startsWith('hrrr:') ? LEGEND_COLORS_FUTURE : LEGEND_COLORS

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
            {idx === pastCount - 1 && <span className="radar-live-badge">LIVE</span>}
            {isFuture && <span className="radar-live-badge radar-live-badge--future">FUTURECAST</span>}
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
            {legendColors.map((color, i) => (
              <div key={i} className="radar-legend-block" style={{ background: color }} />
            ))}
          </div>
          <span className="radar-legend-lbl">Heavy</span>
        </div>
      </div>
    </div>
  )
}
