import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from 'react'
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

// The full-screen radar irises open out of the point that was tapped: a circle
// that is a window onto the real thing, not a disc laid over it.
//
// This is the one place in the app that animates clip-path, and the file argues
// against it twice — see .detail-cover, where it was measured as the source of
// the covers' jank. It is here because it is the only way to get what it gets. A
// growing fill can only ever be a colour: the covers get away with that because
// their content fades in on top, and over a whole screen of map that fade reads
// as a coloured circle the radar turns up inside afterwards. Clipping is what
// puts the destination *inside* the circle from the first frame.
//
// What makes it affordable here and not there: the clipped subtree is one
// composited tile map rather than a page of SVG icons and text, and the frame
// that costs the most — the switch to full-screen, and Leaflet's resize with it —
// is paid on the armed frame before the animation starts. If it does stutter on a
// slower device, the honest fallback is the disc: grow an opaque circle and fade
// the radar in on it, which is what the covers do.
//
// Both directions run for --reveal-dur, the covers' own duration — see the note
// beside it in App.css for why it is the number it is, and why the curve is
// symmetric. Keep these two in step with it.
const IRIS_IN_MS  = 520
const IRIS_OUT_MS = 520

// A still of the compact card, for the slot it leaves behind when it goes
// full-screen. This is the screenshot idea without the screenshot: the card is
// already a tree of loaded <img> tiles positioned by inline transforms, so a
// deep clone of it paints the same pixels — no canvas rasterising, no reading
// back cross-origin tiles, and no second Leaflet instance to keep in step.
//
// The copy is inert by construction: it carries no React fiber, so the app's
// delegated listeners find nothing to fire, and the placeholder around it takes
// pointer events out anyway. Its focusables still have to be pulled out of the
// tab order by hand, though — the placeholder is aria-hidden, and a reachable
// button inside an aria-hidden subtree is the one thing screen readers will not
// forgive.
//
// The margin goes because the placeholder is already holding it: the clone is a
// .card and would otherwise contribute a second one inside a slot sized to
// include the first.
function snapshot(el) {
  const clone = el.cloneNode(true)
  clone.style.marginBottom = '0'
  clone.querySelectorAll('button, a, [tabindex], [role="button"]').forEach(node => {
    node.tabIndex = -1
  })
  return clone
}

// Origin and reach of the iris, as the custom properties the keyframes read. The
// radius is the distance to the furthest corner of the screen, so the circle
// always finishes clear of it whichever corner the tap was near — the covers'
// own calculation, against the viewport rather than against a card.
function revealVars(x, y) {
  return {
    '--reveal-x': `${x}px`,
    '--reveal-y': `${y}px`,
    '--reveal-r': `${Math.hypot(
      Math.max(x, window.innerWidth  - x),
      Math.max(y, window.innerHeight - y),
    )}px`,
  }
}

// Whether going full-screen animates at all. The reveal is a phone-style
// opening, so the desktop app keeps the hard cut — and so does anyone who has
// asked for less motion. Read off the same attribute the CSS gates on, so the
// two can't disagree about whether there is an animation to wait for.
const revealAnimates = () =>
  document.documentElement.dataset.shell === 'mobile' &&
  !window.matchMedia('(prefers-reduced-motion: reduce)').matches

// mode: which half of the timeline the radar opens on — 'nowcast'/'both' start
// on observed, 'future' starts on forecast. Inside the HRRR domain the map
// carries its own Observed/Forecast toggle, so this is a starting point rather
// than a lock: the setting decides what you see first, the toggle decides what
// you see next. Outside the domain there are no forecast frames to switch to
// and the toggle doesn't appear.
//
// fill: the card is the whole page (the web app's Radar tab) rather than one
// block in a stack. The map then gets its controls and its pan/zoom straight
// away instead of hiding them behind tap-to-expand, which only makes sense for
// a map small enough that a tap can't be a drag.
export function WeatherRadar({ location, timezone, mode = 'both', fill = false, sky = '' }) {
  const mapRef      = useRef(null)
  const mapInst     = useRef(null)
  const baseTileRef = useRef(null)
  const layerCache  = useRef(new Map()) // frame.key -> L.TileLayer (kept alive for smooth playback)
  const activeKey   = useRef(null)
  const wantedKey   = useRef(null) // latest frame requested; guards stale async loads
  const trackRef    = useRef(null)
  const isDragging  = useRef(false)
  const cardRef     = useRef(null)
  // Where the page was scrolled to when the radar was tapped, and whether that is
  // a position worth putting back. See the layout effect that reads them.
  const pageScroll  = useRef(0)
  const scrollPinned = useRef(false)
  // The still of the card, taken on the way out of the stack and mounted into
  // the placeholder. See snapshot().
  const holdClone   = useRef(null)

  // Both halves of the timeline as fetched, kept apart rather than pre-joined:
  // the Observed/Forecast toggle is a slice of this, so switching views is a
  // re-derive rather than a re-fetch.
  //   rv       RainViewer frames, observed followed by its own nowcast (if any)
  //   pastLen  how many of those are observed
  //   fut      HRRR forecast steps, after the last RainViewer frame
  const [feed, setFeed] = useState({ rv: [], pastLen: 0, fut: [] })
  const [view, setView] = useState(mode === 'future' ? 'forecast' : 'observed')
  const [idx, setIdx]             = useState(0)
  const [playing, setPlaying]     = useState(false)
  const [expanded, setExpanded]   = useState(false)
  const [mapReady, setMapReady]   = useState(false)

  // Geometry of the iris, as custom properties — set from the point that was
  // tapped and kept for as long as the card is full-screen, so it closes back into
  // where it opened from. Viewport rather than card coordinates: the expanded card
  // is fixed to the viewport, so its box is the viewport's box, and the sky layer
  // that gets the same clip is fixed to it too.
  //
  // Its presence is also what says there is a reveal at all: it is only ever set
  // on the path that animates, so the desktop app and reduced motion get the plain
  // switch they had before.
  const [revealStyle, setRevealStyle] = useState(null)
  // The compact card's box, measured on the way out of the stack. Going
  // full-screen means going position:fixed, which takes the card out of the flow
  // and lets the block around it collapse onto the drag handle — the page then
  // shortens by a card and everything below jumps up, which is what reads as the
  // page scrolling. This holds the space open for as long as the card is away.
  //
  // Height and margin are kept apart rather than added together, so the stand-in
  // has the same box the card had and not merely the same total: .card's bottom
  // margin collapses out through the block it sits in, and a placeholder that
  // folded it into its height would keep it inside instead — the same number, a
  // different layout, off by that margin.
  //
  // Nothing to do with the reveal, so it is kept even when there is no animation:
  // the stack closing over the gap was always wrong, just never visible before.
  const [hold, setHold] = useState(null)
  // Where the transition is up to, or null when there is nothing in flight —
  // which covers both settled states, open and closed.
  //
  //   'arm'  card is full-screen and clipped to nothing; the switch and Leaflet's
  //          resize are paid for on this frame, before the iris starts moving
  //   'in'   iris opening
  //   'out'  iris closing, with the card still full-screen behind it
  const [phase, setPhase] = useState(null)

  // Fetch the frame list once: RainViewer for observed (+ its nowcast when the
  // free API bothers to include one), then HRRR forecast steps continuing on
  // from the last RainViewer frame. Each frame carries its own tile URL template
  // so the layer code doesn't care which source it came from.
  //
  // Both halves are fetched whatever `mode` says: the toggle can ask for the
  // other one at any point, and paying for HRRR's one metadata request up front
  // is what makes that switch instant rather than a spinner.
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
      if (inHrrrDomain(location.latitude, location.longitude)) {
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

      if (cancelled || (rvFrames.length === 0 && futFrames.length === 0)) return
      setFeed({ rv: rvFrames, pastLen, fut: futFrames })
    })()
    return () => { cancelled = true }
  }, [location.latitude, location.longitude])

  // A new setting is a new starting point, so it moves the toggle too.
  useEffect(() => { setView(mode === 'future' ? 'forecast' : 'observed') }, [mode])

  // Only US locations get a forecast half, so only they get the toggle.
  const canForecast = feed.fut.length > 0

  // The visible timeline, sliced out of the feed by the toggle.
  //   observed  the RainViewer past, and nothing beyond it
  //   forecast  the live frame (so the map still opens on "now"), then
  //             RainViewer's nowcast if it sent one, then the HRRR steps
  // The live frame is the last observed one, which is the frame both views land
  // on — switching sides therefore holds the same picture still while the rest
  // of the timeline changes under it.
  // `showingForecast` is which timeline was actually built, which is not always
  // which one the toggle asks for — see the fallback below.
  const { frames, pastCount, showingForecast } = useMemo(() => {
    const { rv, pastLen, fut } = feed
    const past = rv.slice(0, pastLen)
    // Falling back when there is no observed half covers RainViewer failing
    // while HRRR answered: a forecast-only timeline beats an empty card.
    if ((view === 'forecast' || past.length === 0) && fut.length > 0) {
      const live = past.slice(-1)
      return {
        frames: [...live, ...rv.slice(pastLen), ...fut],
        pastCount: live.length,
        showingForecast: true,
      }
    }
    return { frames: past, pastCount: past.length, showingForecast: false }
  }, [feed, view])

  const hasFrames = frames.length > 0

  // Land on the live frame whenever the timeline is rebuilt — a fresh fetch, or
  // a flip of the toggle.
  useEffect(() => {
    setIdx(Math.max(0, pastCount - 1))
  }, [frames, pastCount])

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

  const expand = (e) => {
    pageScroll.current = window.scrollY
    scrollPinned.current = true
    // Measured before the switch, while the card is still the compact one in the
    // stack — afterwards it is the size of the screen. The margin comes along
    // because .card carries one that goes away with the card; read off the
    // computed style rather than hard-coded, so a theme that changes the gap
    // can't leave this a few pixels out.
    const el = cardRef.current
    setHold(el
      ? { height: `${el.offsetHeight}px`, marginBottom: getComputedStyle(el).marginBottom }
      : null)
    holdClone.current = el ? snapshot(el) : null
    history.pushState({ overlay: 'radar' }, '')
    if (!revealAnimates()) { setExpanded(true); return }
    // Keyboard activation reports 0,0 — grow from the middle of the screen then.
    const fromPointer = e && (e.clientX || e.clientY)
    setRevealStyle(revealVars(
      fromPointer ? e.clientX : window.innerWidth / 2,
      fromPointer ? e.clientY : window.innerHeight / 2,
    ))
    // The card goes full-screen straight away now, because it is the thing being
    // revealed — the iris is a window onto it, not a lid over it. 'arm' holds the
    // window shut for a frame so the switch isn't paid for out of the animation.
    setExpanded(true)
    setPhase('arm')
  }

  const collapse = () => history.back()

  // Back (gesture, button or Esc) is what closes the overlay. The teardown waits
  // on the iris: the card stays full-screen through 'out' so there is something
  // inside the closing circle, and the 'out' effect below is what unmounts. The
  // listener comes off once that has started, so a second back press navigates the
  // app rather than being swallowed here.
  useEffect(() => {
    if (!expanded) return
    if (phase === 'out') return
    const handler = () => {
      setPlaying(false)
      if (!revealStyle) {
        setExpanded(false); setPhase(null); setHold(null); holdClone.current = null
        return
      }
      setPhase('out')
    }
    window.addEventListener('popstate', handler)
    return () => window.removeEventListener('popstate', handler)
  }, [expanded, phase, revealStyle])

  // The armed frame. Going full-screen is a viewport-wide layout plus a Leaflet
  // resize, both on the main thread, and both would otherwise land on the frames
  // the iris is opening. Here they land on a frame where the window is still shut,
  // so they cost nothing that can be seen. Two rAFs deep for the same reason the
  // day cover's arming is (see armCover in DailyForecast) — the first still runs
  // ahead of the paint that lays the card out.
  useEffect(() => {
    if (phase !== 'arm') return
    let inner
    const outer = requestAnimationFrame(() => {
      // Also done by the 80ms timeout further down, but that one would land in the
      // middle of the iris. Leaflet bails early on a size it has already seen, so
      // the later call stays cheap.
      mapInst.current?.invalidateSize()
      inner = requestAnimationFrame(() => setPhase('in'))
    })
    return () => { cancelAnimationFrame(outer); cancelAnimationFrame(inner) }
  }, [phase])

  // Open: drop the clip entirely rather than leave a circle the size of the screen
  // sitting on two full-screen layers for as long as the radar is up.
  useEffect(() => {
    if (phase !== 'in') return
    const t = setTimeout(() => setPhase(null), IRIS_IN_MS)
    return () => clearTimeout(t)
  }, [phase])

  // Closed: the card can rejoin the stack now the window is shut over it.
  useEffect(() => {
    if (phase !== 'out') return
    const t = setTimeout(() => {
      setExpanded(false)
      setPhase(null)
      setRevealStyle(null)
      setHold(null)
      holdClone.current = null
    }, IRIS_OUT_MS)
    return () => clearTimeout(t)
  }, [phase])

  // The card entering and leaving the flow is two chances for the browser to move
  // the scroll on us — clamping it if the document measures shorter, or
  // scroll-anchoring off the element that just left. The placeholder only stops
  // the first, and the result either way is that the iris closes onto whatever has
  // slid into its place. So the position is pinned across both switches, before
  // the frame that would show it: a layout effect, not an effect.
  useLayoutEffect(() => {
    if (!scrollPinned.current) return
    window.scrollTo(0, pageScroll.current)
    // Disarmed on the way out, so this never fires on an unrelated render.
    if (!expanded) scrollPinned.current = false
  }, [expanded])

  // Desktop keyboard shortcuts while the map is the focus of the screen: Esc
  // collapses (full-screen only — on the Radar tab there is nothing to collapse
  // to), Space toggles play/pause, arrows scrub and zoom.
  useEffect(() => {
    if (!expanded && !fill) return
    const onKey = (e) => {
      if (e.key === 'Escape') {
        // Not while it's already closing, or the second Esc pops a history
        // entry that belongs to the app rather than to this overlay.
        if (expanded && phase !== 'out' && phase !== 'shrink') collapse()
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
  }, [expanded, fill, frames.length, phase])

  // Resize, re-center, and toggle interaction on expand/collapse.
  //
  // mapReady is in the deps because the map is built asynchronously — it can't
  // exist until the frame list has loaded — so on the first pass there is
  // nothing here to configure. Expanding re-runs this and picks the map up, but
  // `fill` never changes after mount, so without mapReady the Radar tab's map
  // kept the dragging: false it was constructed with and could not be panned.
  useEffect(() => {
    const map = mapInst.current
    if (!map) return
    const t = setTimeout(() => {
      map.invalidateSize()
      if (!expanded && !fill) map.setView([location.latitude, location.longitude], 10, { animate: false })
    }, 80)
    if (expanded || fill) {
      map.dragging.enable(); map.scrollWheelZoom.enable()
      map.doubleClickZoom.enable(); map.touchZoom.enable()
    } else {
      map.dragging.disable(); map.scrollWheelZoom.disable()
      map.doubleClickZoom.disable(); map.touchZoom.disable()
    }
    return () => clearTimeout(t)
  }, [expanded, fill, mapReady, location.latitude, location.longitude])

  // The compact card paints on the frame `expanded` goes false, and until something
  // tells it otherwise Leaflet still believes it is the size of the screen — so
  // that frame is a 220px window onto an 800px map, showing a slice of nowhere in
  // particular, and the 80ms timeout above then resizes and re-centres it in full
  // view. That is the map moving on the way out, and the blank moment before it.
  //
  // A layout effect instead: the DOM and the class change are already in, so the
  // size it reads is the compact one, and it lands before the frame is painted.
  // The timeout still runs afterwards and finds nothing left to do.
  useLayoutEffect(() => {
    const map = mapInst.current
    if (!map || expanded || fill) return
    map.invalidateSize()
    map.setView([location.latitude, location.longitude], 10, { animate: false })
  }, [expanded, fill, mapReady, location.latitude, location.longitude])

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

  // Hangs the still inside the placeholder as it mounts. Only ever appends: the
  // clone goes out of the document with its parent, and appendChild will move it
  // back if the slot mounts a second time — which is what StrictMode's double
  // mount does in development, and what a cleanup here would break.
  const attachSnapshot = useCallback((node) => {
    if (node && holdClone.current) node.appendChild(holdClone.current)
  }, [])

  if (frames.length === 0) return null

  // The legend tracks the tiles actually on screen: HRRR frames draw with the
  // NWS reflectivity ramp, while RainViewer frames (past and any nowcast) keep
  // RainViewer's palette. The palettes can't be reconciled — RainViewer's free
  // tier ignores the colour-scheme parameter in the tile URL — so instead of
  // hiding the switch the legend blocks ease between the two ramps.
  const isHrrrFrame  = !!frames[idx]?.key?.startsWith('hrrr:')
  const legendColors = isHrrrFrame ? LEGEND_COLORS_FUTURE : LEGEND_COLORS

  // The iris state, shared by the two layers it clips — the card and the sky
  // behind it — so they open and close as one window rather than two.
  const irisC = !revealStyle ? ''
    : phase === 'arm' ? ' radar-iris--shut'
    : phase === 'in'  ? ' radar-iris--in'
    : phase === 'out' ? ' radar-iris--out'
    : ''

  return (
    <>
    {/* Full-screen radar is a card blown up to the viewport, and with the
        transparency slider up its fill is translucent — so the weather stack it
        is covering reads straight through the controls strip. This paints the
        page backdrop (the sky gradient, or the flat surface with effects off)
        between the two: same fixed geometry as .sky-bg, so it lines up with the
        real sky exactly, but above the app content rather than below it. Only
        while expanded; the compact card is meant to sit in the stack.

        It takes the same clip as the card, because it is the other half of what
        the iris opens onto: unclipped it would black the weather stack out on the
        first frame, and the circle would be opening onto a screen already gone. */}
    {expanded && (
      <div
        className={`radar-sky ${sky}${irisC}`}
        style={revealStyle ?? undefined}
        aria-hidden="true"
      />
    )}
    {/* Holds the card's place in the stack while it is off being full-screen, so
        the page doesn't shorten under it. See hold above.

        Space only, and nothing to look at. It wore `card` for a version, to make
        the slot read as an empty radar card rather than a hole — and that is what
        flashed: an empty card surface is something, so it appeared on the frame the
        real card left and was then covered over by the iris, at both ends of the
        transition.

        What it holds now is the card itself — a still of it, cloned on the way
        out (see snapshot). That was the flaw in both earlier versions: an empty
        slot and a blank card are each a change to the stack, made on the frame
        the iris is opening over the top of it, and the eye catches the change at
        the edges of the circle. A copy of what was already there is the only
        filling that isn't a change. */}
    {expanded && hold && (
      <div className="radar-placeholder" style={hold} ref={attachSnapshot} aria-hidden="true" />
    )}
    <div
      ref={cardRef}
      className={`card radar-card${expanded ? ' radar-expanded' : ''}${fill ? ' radar-fill' : ''}${irisC}`}
      style={expanded && revealStyle ? revealStyle : undefined}
    >
      {!expanded && !fill && (
        <div className="radar-header">
          <span className="section-label" style={{ margin: 0 }}>RADAR</span>
        </div>
      )}

      <div className="radar-map-wrap">
        <div ref={mapRef} className="radar-map" />
        {/* The full-screen overlay floats its zoom and collapse tools on the
            map, and is the only mode that offers a way out of itself. Its
            locate button lives with the controls instead — see below. Fill mode
            puts every tool in the strip: there the map is the whole page, so
            anything laid on it is covering the thing it controls. */}
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
          </>
        )}
        {/* Gone while a transition is in flight as well as while expanded: during
            the grow the card is still the compact one, so without that this stays
            tappable under the surface and a second tap starts a second open. */}
        {!expanded && !fill && !phase && (
          <div
            className="radar-map-tap"
            onClick={expand}
            role="button"
            aria-label="Expand radar"
          />
        )}
      </div>

      <div className="radar-controls">
        {/* Full-screen only, and a child of the pill rather than of the map:
            the pill covers the map's bottom-right corner where this used to
            float, and hanging it off the pill's top edge is what keeps it
            clear without hard-coding the pill's height. */}
        {expanded && (
          <button className="radar-locate-btn" onClick={handleLocate} aria-label="Center on location">
            <Navigation size={15} />
          </button>
        )}
        <div className="radar-main-row">
          <div className="radar-big-time">
            {frames[idx] ? fmtTime(frames[idx].time, timezone) : ''}
          </div>
          <div className="radar-row-actions">
            {fill && (
              <div className="radar-map-tools">
                <button className="radar-zoom-btn" onClick={handleZoomIn} aria-label="Zoom in">
                  <ZoomIn size={16} />
                </button>
                <button className="radar-zoom-btn" onClick={handleZoomOut} aria-label="Zoom out">
                  <ZoomOut size={16} />
                </button>
                <button className="radar-locate-btn" onClick={handleLocate} aria-label="Center on location">
                  <Navigation size={15} />
                </button>
              </div>
            )}
            <button className="radar-play-circle" onClick={() => setPlaying(v => !v)} aria-label={playing ? 'Pause' : 'Play'}>
              {playing ? <Pause size={22} /> : <Play size={22} />}
            </button>
          </div>
        </div>

        {/* US only: outside the HRRR domain there are no forecast tiles to
            show, so rather than offer a switch that lands on a blank map the
            control isn't there at all. Sits above the scrubber because it is
            what the scrubber is a scrubber of. */}
        {canForecast && (
          <div className="radar-view-toggle" role="group" aria-label="Radar timeline">
            {[
              { value: 'observed', label: 'Observed' },
              { value: 'forecast', label: 'Forecast' },
            ].map(opt => (
              <button
                key={opt.value}
                className={`radar-view-btn${view === opt.value ? ' radar-view-btn--active' : ''}`}
                onClick={() => setView(opt.value)}
                aria-pressed={view === opt.value}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}

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

        {/* Names the feed behind the timeline, not behind the frame. Per-frame it
            flickered back to "Observed" on the forecast view's first frame,
            which is the live radar frame both views share — true of that one
            tile, and read as the toggle having failed to take. This is the
            caption for the side being shown; the legend above is what still
            tracks the tiles, because that is a statement about their colours. */}
        <p className="radar-source">
          {showingForecast ? 'Forecast · NOAA HRRR model' : 'Observed · RainViewer radar'}
        </p>
      </div>
    </div>
    </>
  )
}
