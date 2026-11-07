import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from 'react'
import { Minimize2, Play, Pause, Navigation, ZoomIn, ZoomOut } from 'lucide-react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { MRMS_BASE, inMrmsDomain, usViewBounds } from '../utils/mrms'
import { addBasemap } from '../utils/basemap'
import { RadarRain } from './RadarRain'
import { fetchWithin } from '../utils/fetchTimeout'

// The frame lists the card waits on. Past this a source counts as down and the
// timeline falls back to the next one, as it already does on an error.
const RADAR_LIST_TIMEOUT_MS = 8000

const FRAMES_URL = 'https://api.rainviewer.com/public/weather-maps.json'

// Observed radar, where NOAA covers it: the MRMS mosaic behind radar.weather.gov,
// served straight from NWS rather than through a third party. No key, CORS open,
// ~5-minute sweeps with a four-hour rolling window — against RainViewer's free
// tier that is finer, fresher, twice the history, and free of the zoom ceiling
// below. It is opt-in, though (Settings › Radar source): RainViewer is the
// default everywhere, and the only option outside the US.
//
// It is an ArcGIS ImageServer, not an XYZ cache, so there are no tiles to ask
// for: each one is an exportImage render of that tile's bbox. See MrmsLayer.
// The endpoint and its coverage regions live in utils/mrms.js — useRadarPrecip
// samples the same mosaic for the current-condition check.
const MRMS_QUERY = `${MRMS_BASE}/query?where=1%3D1&outFields=idp_validtime&returnGeometry=false&orderByFields=idp_validtime%20DESC&resultRecordCount=200&f=json`
// How many sweeps back the observed timeline runs. Sweeps land every ~6 minutes
// (measured: alternating 6 and 8), so this is ~100 minutes — about the span
// RainViewer's free tier gave, at finer steps than its 10-minute frames. The
// service keeps ~2 hours reachable in one query, which is the real ceiling here;
// the four-hour window it advertises needs paging this doesn't do.
const MRMS_FRAMES = 15

// One sweep is stored as several rasters — CONUS, Alaska, Hawaii, the Caribbean,
// Guam — each stamped with its own valid time a few seconds off the others. Asking
// for a bare instant matches at most one of them and renders a near-empty image, so
// frames are clustered by this gap and requested as a `from,to` range, which is what
// makes the service mosaic the regions together. Measured spread within a sweep is
// under a minute; the gap between sweeps is ~5, so there is a wide margin either way.
const MRMS_CLUSTER_MS = 150000

// Where MRMS tiles stop being fetched and start being upscaled by the browser.
//
// Unlike a tile cache, every request here is a render the server performs, so the
// grid getting four times denser per zoom level is four times the work asked of a
// free public service — and past the data's own resolution it buys nothing, because
// the extra pixels are the server's resampling rather than detail. MRMS is ~1 km,
// which is roughly zoom 8, so 10 is already oversampled enough to stay crisp on a
// retina screen and everything beyond it scales a tile that was going to be smooth
// regardless. Still well past RADAR_NATIVE_MAX, which is the ceiling this replaces.
const MRMS_NATIVE_MAX = 10

// Web Mercator half-circumference: the edge of the XYZ grid in projected metres.
const MERC_R = 20037508.342789244

// A tile layer over an ImageServer. Leaflet asks for {z}/{x}/{y}; exportImage wants
// a bbox, a size and a time — so the URL is built per tile rather than templated.
// The maths is the standard XYZ scheme and needs no map instance: at zoom z the grid
// is 2^z tiles across the full projected width, so tile x starts at -MERC_R + x*span
// and tile y counts down from +MERC_R.
//
// Rendering is server-side, which is the other half of losing the zoom cap: past the
// data's own resolution it resamples rather than refusing, so deep zooms come back
// soft instead of coming back as "zoom level not supported".
const MrmsLayer = L.TileLayer.extend({
  getTileUrl(coords) {
    const span = (2 * MERC_R) / 2 ** coords.z
    const minX = -MERC_R + coords.x * span
    const maxY = MERC_R - coords.y * span
    const q = new URLSearchParams({
      bbox: `${minX},${maxY - span},${minX + span},${maxY}`,
      bboxSR: '3857',
      imageSR: '3857',
      size: '256,256',
      format: 'png32',
      transparent: 'true',
      time: this.options.timeRange,
      f: 'image',
    })
    return `${MRMS_BASE}/exportImage?${q}`
  },
})

// The observed half from MRMS: the sweep times, newest first, clustered into frames.
// Returns oldest-first to match the direction the timeline runs, or [] on any
// failure — every caller treats that as "fall back to RainViewer".
async function fetchMrmsFrames() {
  const data = await fetchWithin(MRMS_QUERY, RADAR_LIST_TIMEOUT_MS).then(r => r.json())
  // Deliberately not deduplicated: `n` below has to count rasters, and two regions
  // of one sweep can share a timestamp exactly. Collapsing those would undercount
  // the sweep and get it thrown out as incomplete. Clustering absorbs duplicates
  // anyway — a repeated time has a gap of zero, so it joins the cluster it belongs to.
  const times = (data.features ?? [])
    .map(f => f.attributes?.idp_validtime)
    .filter(Number.isFinite)
    .sort((a, b) => b - a)

  // Walk newest→oldest, breaking a cluster whenever the gap says a new sweep began.
  // `n` is how many regions that sweep has published, which the trim below reads.
  const clusters = []
  for (const t of times) {
    const last = clusters[clusters.length - 1]
    if (last && last.from - t <= MRMS_CLUSTER_MS) { last.from = t; last.n++ }
    else clusters.push({ from: t, to: t, n: 1 })
    // Past the quota the earlier clusters are closed, so older sweeps have nothing
    // left to say. The spares absorb whatever the filter below drops.
    if (clusters.length > MRMS_FRAMES + 3) break
  }

  // Keep only sweeps that published every region, because a partial one renders as
  // a partial map — the regions that made it drawn, the rest of the country blank.
  // Both ends of the list produce them, for unrelated reasons: the newest sweep is
  // still arriving (its regions publish a few seconds apart), and the oldest is
  // wherever the query's record limit happened to cut, which lands mid-sweep as
  // often as not. A count short of the fullest sweep catches both, and the newest
  // one heals itself on the next mount a minute later.
  const full = Math.max(...clusters.map(c => c.n))

  return clusters
    .filter(c => c.n === full)
    .slice(0, MRMS_FRAMES)
    .reverse()
    .map(c => ({
      key: `mrms:${c.to}`,
      src: 'mrms',
      time: Math.round(c.to / 1000), // the sweep's own clock, for the caption
      range: `${c.from},${c.to}`,
    }))
}

// Single-site NEXRAD: the nearest WSR-88D's super-resolution base reflectivity
// (Level III N0B — 0.25 km gates, against MRMS's ~1 km grid), as XYZ tiles from
// the Iowa Environmental Mesonet's RIDGE cache. CORS open, no key, the NWS ramp.
// Sharp up close but one radar's reach, ~230 km, with the usual blind cone over
// the site itself — so Auto only uses it zoomed in (see AUTO_HD_ZOOM) and MRMS's
// seamless mosaic carries the wide view.
const IEM_RADAR_API = 'https://mesonet.agron.iastate.edu/json/radar.py'
const NEXRAD_TILE_URL = (site, stamp) =>
  `https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/ridge::${site}-N0B-${stamp}/{z}/{x}/{y}.png`
// Volume scans land every 4–6 minutes, so this is roughly the span MRMS_FRAMES
// covers, keeping the two timelines comparable when Auto switches between them.
const NEXRAD_FRAMES = 20
const NEXRAD_WINDOW_MS = 2 * 60 * 60 * 1000
// Past 0.25 km gates there is nothing finer to fetch; 11 already oversamples them
// for a retina screen, and IEM is a university service worth being gentle with.
const NEXRAD_NATIVE_MAX = 11
// Where Auto hands over from the MRMS mosaic to the single site. At zoom 8 the
// card spans ~250 km, about one radar's reach, so the site's coverage edge stays
// off screen; any wider and the map would show where the radar runs out.
const AUTO_HD_ZOOM = 8
// How far apart in time an MRMS sweep and a NEXRAD scan may be and still be the
// "same" Auto frame. Under one sweep interval, so no sweep is shown twice.
const AUTO_PAIR_MS = 4 * 60 * 1000

// IEM's API wants minute-precision UTC: 2026-11-06T03:18Z.
const iemTime = (ms) => new Date(ms).toISOString().slice(0, 16) + 'Z'

// Equirectangular distance in km — plenty to rank radars a few hundred km away.
function approxKm(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180
  const x = (lon2 - lon1) * rad * Math.cos(((lat1 + lat2) / 2) * rad)
  const y = (lat2 - lat1) * rad
  return 6371 * Math.hypot(x, y)
}

// The nearest NEXRAD site's recent scans, oldest first, or [] on any failure —
// callers fall back to MRMS. IEM's "available" list is every radar covering the
// point, unsorted, and includes the airport TDWRs and the national composite;
// only the WSR-88Ds carry N0B, so it is filtered to those and ranked by distance.
async function fetchNexradFrames(lat, lon) {
  const now = Date.now()
  const avail = await fetchWithin(`${IEM_RADAR_API}?operation=available&lat=${lat}&lon=${lon}&start=${iemTime(now)}`, RADAR_LIST_TIMEOUT_MS)
    .then(r => r.json())
  const site = (avail.radars ?? [])
    .filter(r => r.type === 'NEXRAD' && Number.isFinite(r.lat) && Number.isFinite(r.lon))
    .sort((a, b) => approxKm(lat, lon, a.lat, a.lon) - approxKm(lat, lon, b.lat, b.lon))[0]
  if (!site) return []

  const list = await fetchWithin(
    `${IEM_RADAR_API}?operation=list&radar=${site.id}&product=N0B&start=${iemTime(now - NEXRAD_WINDOW_MS)}&end=${iemTime(now)}`,
    RADAR_LIST_TIMEOUT_MS,
  ).then(r => r.json())
  return (list.scans ?? [])
    .map(s => s.ts)
    .filter(ts => typeof ts === 'string' && Number.isFinite(Date.parse(ts)))
    .slice(-NEXRAD_FRAMES)
    .map(ts => ({
      key: `nexrad:${site.id}:${ts}`,
      src: 'nexrad',
      site: site.id,
      time: Math.round(Date.parse(ts) / 1000),
      // 2026-11-06T03:18Z -> 202611060318, the stamp RIDGE tiles are keyed by.
      url: NEXRAD_TILE_URL(site.id, ts.replace(/[-T:Z]/g, '')),
    }))
}

// Auto's timeline: the NEXRAD scans, each carrying the MRMS sweep nearest it in
// time so the layer code can draw either one depending on zoom. A scan with no
// sweep close enough keeps NEXRAD at every zoom rather than leaving a hole.
function pairAutoFrames(nexrad, mrms) {
  return nexrad.map(f => {
    let best = null
    for (const m of mrms) {
      const gap = Math.abs(m.time - f.time) * 1000
      if (gap <= AUTO_PAIR_MS && (!best || gap < best.gap)) best = { m, gap }
    }
    return { ...f, src: 'auto', range: best?.m.range ?? null }
  })
}

// The feed a frame is actually drawn from. Only Auto frames depend on the zoom;
// one with no paired sweep stays on NEXRAD throughout.
const drawnSrc = (frame, hd) =>
  frame.src !== 'auto' ? frame.src : (hd || !frame.range ? 'nexrad' : 'mrms')

// The layer cache's key. An Auto frame gets one layer per feed, so crossing the
// zoom threshold builds the other feed's layer under a new key and the normal
// swap — old frame held until the new one has loaded — covers the handover.
const layerKey = (frame, hd) =>
  frame.src === 'auto' ? `${frame.key}|${drawnSrc(frame, hd)}` : frame.key

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

// The last frame list fetched for each place and feed, so a radar that mounts
// again — the web Radar tab is built fresh on every visit — opens on a timeline
// at once instead of on nothing while four feeds answer. Still refetched on
// every mount; this only decides what is drawn in the meantime. Ten minutes is
// RainViewer's own frame step, so a cached list is at most one frame behind.
const FEED_CACHE_MS = 10 * 60 * 1000
const feedCache = new Map()
const feedKey = (lat, lon, source) => `${lat},${lon},${source}`
function cachedFeed(lat, lon, source) {
  const hit = feedCache.get(feedKey(lat, lon, source))
  return hit && Date.now() - hit.at < FEED_CACHE_MS ? hit.feed : null
}
// Two palettes, because two of the three feeds draw with the standard NWS
// reflectivity ramp (green → yellow → orange → red) and one doesn't. MRMS and HRRR
// are both NOAA products and share it; RainViewer has its own and ignores the
// colour-scheme parameter on the free tier, so it can't be brought into line. The
// legend follows whichever tiles are on screen — see legendColors below.
//
// The upside of the MRMS switch is that the ramp now holds across the handoff for
// US locations: observed and forecast are both NWS-ramped, so scrubbing past now no
// longer changes the colours under the cursor. Only the RainViewer fallback still
// does, and that is the case where there was no forecast half to reach anyway.
const LEGEND_RAINVIEWER = ['#43a4c3', '#326985', '#ffd900', '#ff3300', '#d193c9']
const LEGEND_NWS        = ['#02fd02', '#0173c5', '#fdf802', '#fd9500', '#fd0000']

// Scrubber geometry. One frame is one fixed-width column, rather than a share of
// however wide the track happens to be: the strip slides under a centred playhead
// and runs off both ends of the track, so its width is the timeline's length and
// not the card's. TICK_W is the same number as --radar-tick-w in the stylesheet —
// the CSS lays the columns out, this converts a swipe in pixels into frames, and
// the two have to agree or the strip drifts under the finger.
const TICK_W   = 16
const TAP_SLOP = 4 // px of travel below which a pointer down/up is still a tap

// ...and the width at which the filmstrip stops being the right answer for a
// full-size radar. It earns its keep where a dozen-odd frames can't be told
// apart across the track; given a monitor's worth of room they can, and a strip
// of fixed-width columns instead sits as a ~200px cluster marooned in the middle
// of the bar. Above this the full-size scrubber falls back to the card's
// whole-timeline layout, which spans whatever width it is given. A width and not
// a device class on purpose: what decides it is how much track there is, so a
// half-width window gets the filmstrip on the same machine a maximised one
// doesn't.
const WIDE_TRACK_MQ = '(min-width: 900px)'

const clampIdx = (v, len) => Math.max(0, Math.min(len - 1, v))

// Live answer to a media query. The scrubber picks its layout and its pointer
// arithmetic off the same boolean, so this has to re-render on a resize — a CSS
// query alone would move the ticks while the drag maths carried on in the old
// mode.
function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const onChange = () => setMatches(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [query])
  return matches
}

// The compact card's scrubber, where the whole timeline spans the track and a
// position across it is a position in time.
const idxAcrossTrack = (clientX, el, len) => {
  const rect = el.getBoundingClientRect()
  return Math.round(Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * (len - 1))
}

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

// How far the frame on screen is from the present, for the Radar tab's dock:
// "25 min ago", "in 1 hr 15 min". A clock time alone makes the reader do the
// subtraction, and on a timeline that straddles now that is the question being
// asked. Within a few minutes either way it is just "Now".
function fmtRelative(unixSec, nowSec) {
  const mins = Math.round((unixSec - nowSec) / 60)
  if (Math.abs(mins) < 3) return 'Now'
  const a = Math.abs(mins)
  const h = Math.floor(a / 60), m = a % 60
  const span = h ? (m ? `${h} hr ${m} min` : `${h} hr`) : `${m} min`
  return mins < 0 ? `${span} ago` : `in ${span}`
}

// The full-screen radar opens as the card's own map window growing to fill the
// screen. There is one map: the live one, already laid out full-screen on the
// armed frame, and the animation is a window onto it — clipped to the compact
// card's map box at the start, the whole screen at the end. Inside the window
// the map shifts so the spot that was in the middle of the card's map stays in
// the middle of the window the whole way, which is what makes it read as the
// same map getting bigger rather than a new one appearing. The controls are kept
// out of it and fade in once the window is full; on the way out they go first,
// then the window shrinks back into the card.
//
// The clip is a rounded inset — a plain rounded rectangle, which Chromium keeps
// as a clip on the layer rather than painting a mask — and the shift is a
// translate, so nothing is ever scaled and the map is never re-rasterised. (It
// was once an iris: a round window scaled up from the tap with the map counter-
// scaled inside it, which asked a phone to raster a screen of live map at ~36x
// its area behind a mask, and lagged.)
const WINDOW_IN_MS  = 420
const WINDOW_OUT_MS = 320
// The controls: fade in after the window lands, out before it starts to shrink.
const CHROME_IN_MS  = 260
const CHROME_OUT_MS = 100
// Teardown waits for both halves of the close.
const IRIS_OUT_MS = CHROME_OUT_MS + WINDOW_OUT_MS
// M3 emphasized decelerate for the open, standard emphasized for the close, so
// it settles into the card rather than being thrown at it.
const WINDOW_IN_EASE  = 'cubic-bezier(0.05, 0.7, 0.1, 1)'
const WINDOW_OUT_EASE = 'cubic-bezier(0.2, 0, 0, 1)'

// How long the armed frame will wait for the base map to finish filling itself
// in before it gives up and opens anyway.
//
// Going full-screen is a fourfold increase in map area, so invalidateSize asks
// for a screenful of tiles that the compact card never needed. They arrive over
// the next few hundred ms, and every one of them lands as a repaint of the layer
// the iris is scaling (a full GL redraw of the basemap, since it moved to
// MapLibre — see utils/basemap). That is main-thread
// and raster work spread across exactly the frames that have to be smooth, and it
// is why arming the switch alone did not buy the whole win.
//
// So the armed frame holds until the base layer says it has them. The wait is
// invisible rather than merely brief: the circle is transparent for the whole of
// 'arm' (see .radar-iris--arm), so the screen still shows the stack with the card
// in it, unchanged, the way it did before the tap. The cap is what keeps a slow
// network from turning that into a tap that does nothing — past it the iris opens
// over whatever has arrived, which is the behaviour this had all along.
const ARM_TILE_WAIT_MS = 180

// The closing twin of that wait, and longer, because what it covers is worse.
//
// When the iris has shut, the live card drops back into the stack in place of
// the still that stood in for it — and its map is not ready to be seen. Leaflet
// resizes on the spot, but the GL basemap only follows a frame later, and
// resizing a WebGL canvas clears it, so the first compact frame had a blank map.
// Worse if the map was zoomed or panned while full-screen: snapping back home
// throws the radar tiles away and fetches new ones. Either way the card came
// back empty and then filled in, which was the flash on closing.
//
// So the still stays laid over the live card (see .radar-settle) until the map
// has redrawn at its new size and both layers have their tiles, and only then
// is taken away. Holding a still costs nothing visible; this cap only stops a
// slow network from leaving it there indefinitely.
const SETTLE_MAX_MS = 700

// The window's two ends. `win` is the compact card's map box (read off the
// still in the slot, so it is where the card is *now*), `box` the frame's. Both
// are measured rather than assumed: `position: fixed; inset: 0` is the viewport
// only while no ancestor has established a containing block for it, and one
// transform, filter or backdrop-filter above the card is enough to make it
// something else.
//
// The shift keeps the full-screen map's centre (where Leaflet keeps the
// location, see invalidateSize) under the window's centre. It never uncovers
// the map's edge: at every point of the run the window's edges are inside the
// shifted map's, because both move in straight lines on the same eased clock
// and both ends satisfy it.
function windowFrames(win, box, radius) {
  const l = win.left - box.left
  const t = win.top - box.top
  const r = box.width - l - win.width
  const b = box.height - t - win.height
  const dx = l + win.width / 2 - box.width / 2
  const dy = t + win.height / 2 - box.height / 2
  return {
    clip: [
      { clipPath: `inset(${t}px ${r}px ${b}px ${l}px round ${radius}px)` },
      { clipPath: 'inset(0px 0px 0px 0px round 0px)' },
    ],
    shift: [
      { transform: `translate(${dx}px, ${dy}px)` },
      { transform: 'translate(0px, 0px)' },
    ],
  }
}

// An element's box as it lays out, with its own transform taken back out —
// getBoundingClientRect includes it, and so does any transition in flight on it.
// Assumes translate and scale only (all predictive back ever applies).
function untransformedBox(el) {
  const r = el.getBoundingClientRect()
  const cs = getComputedStyle(el)
  if (!cs.transform || cs.transform === 'none') return r
  const m = new DOMMatrix(cs.transform)
  const [ox, oy] = cs.transformOrigin.split(' ').map(parseFloat)
  return {
    left: r.left - ox + m.a * ox - m.e,
    top: r.top - oy + m.d * oy - m.f,
    width: el.offsetWidth,
    height: el.offsetHeight,
  }
}

// Sizes for the radar's layer and the box inside it, against the frame's box.
function irisGeometry(box) {
  const size = { left: '0px', top: '0px', width: `${box.width}px`, height: `${box.height}px` }
  return { circle: size, inner: size }
}

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
//
// The basemap is the exception to "already a tree of <img>": it is a MapLibre
// canvas, and cloneNode copies a canvas's element but not its pixels — the
// still came out with a blank map. So canvases are copied across by hand. A
// WebGL canvas can only be read back in the frame it was drawn in, which is why
// the caller has MapLibre redraw synchronously just before this.
function snapshot(el) {
  const clone = el.cloneNode(true)
  const from = el.querySelectorAll('canvas')
  clone.querySelectorAll('canvas').forEach((c, i) => {
    try { c.getContext('2d')?.drawImage(from[i], 0, 0) } catch { /* leave it blank */ }
  })
  clone.style.marginBottom = '0'
  clone.querySelectorAll('button, a, [tabindex], [role="button"]').forEach(node => {
    node.tabIndex = -1
  })
  return clone
}

// The layers the morph drives, or nothing at all in `fill`.
//
// `fill` is the web app's Radar tab, where the card is already the whole page and
// never expands, so there is no reveal to build for it — and the wrappers are not
// free there: WebApp.css spaces that layout with `.web-page > .card`, and three
// divs in between would quietly stop that matching and hand the card back its
// 12px margin. `fill` is fixed for the life of an instance (the two call sites
// are different mounts), so branching on it here costs no remount.
function IrisShell({ fill, className, frameRef, scrimRef, circleRef, innerRef, circleStyle, innerStyle, children }) {
  if (fill) return children
  return (
    <div ref={frameRef} className={className}>
      <div ref={scrimRef} className="radar-iris-scrim" aria-hidden="true" />
      <div ref={circleRef} className="radar-iris-circle" style={circleStyle}>
        <div ref={innerRef} className="radar-iris-inner" style={innerStyle}>
          {children}
        </div>
      </div>
    </div>
  )
}

// Whether going full-screen animates at all. The reveal is a phone-style
// opening, so the desktop app keeps the hard cut — and so does anyone who has
// asked for less motion. Read off the same attribute the CSS gates on, so the
// two can't disagree about whether there is an animation to wait for.
const revealAnimates = () =>
  document.documentElement.dataset.shell === 'mobile' &&
  !window.matchMedia('(prefers-reduced-motion: reduce)').matches

// mode: how the timeline's two feeds are arranged.
//
//   'combined'  one scrubber, observed running straight into forecast in time
//               order, with a dashed divider at the handoff. Everything is on
//               the same track, so scrubbing past now is a drag rather than a
//               decision — at the cost of a longer track and a palette that
//               changes under the cursor at the boundary.
//   'split'     the halves as two timelines with an Observed/Forecast toggle
//               above the scrubber. Each side gets the full width of the track,
//               and the palette holds still within a side.
//
// The toggle only appears where there is a second half to reach and room to
// offer it: inside the HRRR domain (US), and full-size — expanded or fill. On
// the compact card the whole tap target is "open me", and outside the domain
// there are no forecast frames at all, so both settings come out as the same
// observed-only scrubber.
//
// fill: the card is the whole page (the web app's Radar tab) rather than one
// block in a stack. The map then gets its controls and its pan/zoom straight
// away instead of hiding them behind tap-to-expand, which only makes sense for
// a map small enough that a tap can't be a drag.
// `source` is the observed feed the user picked in Settings: 'rainviewer' (the
// default), 'auto' (MRMS wide, the nearest NEXRAD site zoomed in), 'mrms' or
// 'nexrad'. Outside NOAA coverage every choice ends up on RainViewer, the only
// feed there is.
export function WeatherRadar({ location, timezone, mode = 'split', source = 'rainviewer', fill = false, sky = '', rainFx = true, snow = false }) {
  const combined = mode === 'combined'
  const mapRef      = useRef(null)
  const mapInst     = useRef(null)
  const baseTileRef = useRef(null)
  const layerCache  = useRef(new Map()) // frame.key -> L.TileLayer (kept alive for smooth playback)
  const activeKey   = useRef(null)
  const wantedKey   = useRef(null) // latest frame requested; guards stale async loads
  const trackRef    = useRef(null)
  // Live state of a scrubber drag: where the finger went down, which frame was
  // centred under it at that moment, and whether it has travelled far enough to
  // count as a swipe rather than a tap. Null between drags — see handlePointerDown.
  const dragRef     = useRef(null)
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
  //   past  observed frames — MRMS where NOAA covers it, RainViewer otherwise
  //   cast  RainViewer's own nowcast, when the free API bothers to send one
  //   fut   HRRR forecast steps, continuing on from whatever the two above cover
  const [feed, setFeed] = useState(() =>
    cachedFeed(location.latitude, location.longitude, source) ?? { past: [], cast: [], fut: [] })
  // Which side the toggle is on, in split mode. Unread in combined mode, where
  // there are no sides.
  const [view, setView] = useState('observed')
  const [idx, setIdx]             = useState(0)
  // Fractional frame position while a scrubber drag is in flight, null at rest.
  // See handlePointerDown.
  const [drag, setDrag]           = useState(null)
  // A finger (or mouse) is on the rail scrubber — see .radar-scrub. The knob
  // follows it 1:1 and grows while it is held.
  const [scrubbing, setScrubbing] = useState(false)
  // What the controls were showing when the radar started closing — the frame
  // and the play state. The close stops playback and returns to the frame the
  // still shows (see the back handler), and both would otherwise land in the
  // controls during their fade-out: the time jumping, the knob sliding across
  // the rail, play flipping from pause. Shown frozen until the controls are gone.
  const [outFrozen, setOutFrozen] = useState(null)
  const liveCtl = useRef({ idx: 0, playing: false })
  const [playing, setPlaying]     = useState(false)
  const [expanded, setExpanded]   = useState(false)
  const [mapReady, setMapReady]   = useState(false)
  // The Leaflet map once it exists, as state, for children that need it during
  // render (RadarRain); mapInst is the same object for effects and handlers.
  const [rainMap, setRainMap]     = useState(null)
  // Whether the map is zoomed in far enough for Auto to draw the single site.
  // Tracked as a boolean rather than the zoom itself so the layer effect only
  // re-runs when the threshold is actually crossed, not on every wheel tick.
  const [hd, setHd] = useState(true)

  // Geometry of the iris — where the circle sits and how far it has to reach,
  // set from the point that was tapped and kept for as long as the card is
  // full-screen so it closes back into where it opened from. See irisGeometry.
  //
  // Its presence is also what says there is a reveal at all: it is only ever set
  // on the path that animates, so the desktop app and reduced motion get the plain
  // switch they had before.
  const [revealStyle, setRevealStyle] = useState(null)
  // The two layers the reveal drives. They wrap the card permanently rather than
  // appearing when it opens: re-parenting the card mid-life would remount the
  // whole subtree and take Leaflet's map instance with it, so instead they sit
  // there as display:contents and only become boxes while the circle is moving.
  const irisFrameRef  = useRef(null)
  const irisCircleRef = useRef(null)
  const irisInnerRef  = useRef(null)
  const irisScrimRef  = useRef(null)
  // The card's slot in the stack while it is away (see .radar-placeholder). The
  // still in it is where the window opens from and closes back into.
  const placeholderRef = useRef(null)
  // When the radar opened: the time of the frame the still shows (see the back
  // handler). framesRef, beside the frame list below, is where it is looked up.
  const snapFrameTime = useRef(null)
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
  // True from the moment a closed card rejoins the stack until its map is ready
  // to be seen; the still is held over it meanwhile. See SETTLE_MAX_MS.
  const [settling, setSettling] = useState(false)
  // The present, for the Radar tab dock's relative caption (see fmtRelative).
  // Ticked once a minute, and only in fill — nothing else reads it.
  const [nowSec, setNowSec] = useState(() => Date.now() / 1000)
  useEffect(() => {
    if (!fill) return
    const id = setInterval(() => setNowSec(Date.now() / 1000), 60000)
    return () => clearInterval(id)
  }, [fill])

  // Fetch the frame list once: RainViewer for observed (+ its nowcast when the
  // free API bothers to include one), then HRRR forecast steps continuing on
  // from the last RainViewer frame. Each frame carries its own tile URL template
  // so the layer code doesn't care which source it came from.
  //
  // Both halves are fetched whatever `mode` says — combined shows them at once,
  // and in split the toggle can ask for the other one at any point. Paying for
  // HRRR's one metadata request up front is what makes that switch instant
  // rather than a spinner.
  const { latitude: lat, longitude: lon } = location
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const wantMrms = inMrmsDomain(lat, lon)
      const wantHrrr = inHrrrDomain(lat, lon)
      // NEXRAD is US-only like MRMS. MRMS is still fetched alongside it on the
      // NEXRAD setting: it is the fallback if IEM is down or has no site here.
      const wantNexrad = wantMrms && (source === 'auto' || source === 'nexrad')

      // All at once. They have no data dependency on each other — only the
      // trimming below does — and the slowest of them is what the card waits on, so
      // running them in sequence would have made that the sum instead of the max.
      const [rvRes, mrmsRes, hrrrRes, nexradRes] = await Promise.allSettled([
        fetchWithin(FRAMES_URL, RADAR_LIST_TIMEOUT_MS).then(r => r.json()),
        wantMrms ? fetchMrmsFrames() : Promise.resolve([]),
        wantHrrr ? fetchWithin(HRRR_META_URL, RADAR_LIST_TIMEOUT_MS).then(r => r.json()) : Promise.resolve(null),
        wantNexrad ? fetchNexradFrames(lat, lon) : Promise.resolve([]),
      ])

      // RainViewer, split into its two halves. The URL is
      // /{size}/{z}/{x}/{y}/{color}/{smooth}_{snow}.png — the free API ignores the
      // colour and snow flags, but smoothing works.
      let rvPast = [], rvCast = []
      if (rvRes.status === 'fulfilled') {
        const data = rvRes.value
        const mk = (f) => ({
          key: f.path,
          src: 'rv',
          time: f.time,
          url: `${data.host}${f.path}/512/{z}/{x}/{y}/2/1_0.png`,
        })
        try {
          rvPast = (data.radar.past ?? []).map(mk)
          rvCast = (data.radar.nowcast ?? []).map(mk)
        } catch { /* malformed frame list: no RainViewer frames */ }
      }

      // Observed: MRMS when it answered, RainViewer when it didn't. The fallback is
      // per-fetch rather than per-location, so an MRMS outage inside the US degrades
      // to the feed this always used instead of to an empty card.
      const mrmsPast = mrmsRes.status === 'fulfilled' ? mrmsRes.value : []
      const nexradPast = nexradRes.status === 'fulfilled' ? nexradRes.value : []
      // The setting picks the feed; each choice falls back down the same chain
      // (NEXRAD -> MRMS -> RainViewer) so a feed being down never empties the card.
      // RainViewer, the default, falls back the other way: to MRMS, which is
      // fetched in the US for exactly that.
      const nexradPick = source === 'auto' ? pairAutoFrames(nexradPast, mrmsPast) : nexradPast
      const past = source === 'rainviewer'
        ? (rvPast.length > 0 ? rvPast : mrmsPast)
        : nexradPick.length > 0 ? nexradPick
        : mrmsPast.length > 0 ? mrmsPast
        : rvPast
      const newest = past[past.length - 1]

      // HRRR steps, picking up after whatever the timeline already covers — the
      // RainViewer nowcast when there is one, otherwise the last observed frame.
      // Both have to count: the combined timeline lays these out in time order, so
      // a step that lands before the last nowcast frame would put the track out of
      // sequence. The model run can be 1–3h old, so its early steps are usually in
      // the past already and get skipped regardless.
      const futFrames = []
      if (hrrrRes.status === 'fulfilled' && hrrrRes.value) {
        const init = Date.parse(hrrrRes.value.model_init_utc) / 1000
        const nowSec = Date.now() / 1000
        const covered = (rvCast.length ? rvCast[rvCast.length - 1] : newest)?.time ?? nowSec
        if (Number.isFinite(init)) {
          for (let m = HRRR_STEP_MIN; m <= HRRR_MAX_MIN; m += HRRR_STEP_MIN) {
            const t = init + m * 60
            if (t <= covered + 60) continue         // already on the timeline
            if (t > nowSec + HRRR_HORIZON_SEC) break // keep the timeline short
            futFrames.push({ key: `hrrr:${m}`, src: 'hrrr', time: t, url: HRRR_TILE_URL(m) })
          }
        }
      }

      if (cancelled || (past.length === 0 && rvCast.length === 0 && futFrames.length === 0)) return
      const next = { past, cast: rvCast, fut: futFrames }
      feedCache.set(feedKey(lat, lon, source), { feed: next, at: Date.now() })
      setFeed(next)
    })()
    return () => { cancelled = true }
  }, [lat, lon, source])

  // Coming back to split from combined, start on observed rather than resuming
  // whichever side was last looked at — the timeline in between showed both, so
  // there is no side to resume.
  // Reset while rendering, React's pattern for state that follows a prop.
  const [prevMode, setPrevMode] = useState(mode)
  if (mode !== prevMode) {
    setPrevMode(mode)
    setView('observed')
  }

  // Only US locations get a forecast half, so only they get the toggle.
  const canForecast = feed.fut.length > 0

  // The visible timeline, built out of the feed.
  //
  // Combined runs the whole thing in time order and leaves it to the divider and
  // the tick styling to say where observed stops.
  //
  // Split slices it by the toggle:
  //   observed  the RainViewer past, and nothing beyond it
  //   forecast  RainViewer's nowcast if it sent one, then the HRRR steps —
  //             forecast frames and nothing else
  // The forecast side used to carry the live observed frame as its leading tick,
  // for continuity with the other side. It doesn't any more: that made the first
  // frame of the forecast an observed one, so opening the side showed the
  // present under a heading that promised the future. "Now" is what the Observed
  // side is for, and in combined it is still there mid-track.
  //
  // `pastCount` is how far into `frames` the observed run goes, and every reader
  // downstream — tick styling, the divider, the caption, the starting index —
  // is derived from it rather than from which side is showing.
  const { frames, pastCount } = useMemo(() => {
    const { past, cast, fut } = feed
    if (combined) {
      return { frames: [...past, ...cast, ...fut], pastCount: past.length }
    }
    // Falling back when there is no observed half covers both observed feeds
    // failing while HRRR answered: a forecast-only timeline beats an empty card.
    if ((view === 'forecast' || past.length === 0) && fut.length > 0) {
      // pastCount 0: every frame here is a forecast, so every tick is styled as
      // one and the starting-index effect below lands on the first of them.
      return { frames: [...cast, ...fut], pastCount: 0 }
    }
    return { frames: past, pastCount: past.length }
  }, [feed, view, combined])
  // The frame list as of the last render, for the radar's back handler.
  const framesRef = useRef(frames)
  useEffect(() => { framesRef.current = frames })
  // The controls' live frame and play state, for the back handler to freeze.
  useEffect(() => { liveCtl.current = { idx, playing } })

  const hasFrames = frames.length > 0

  // Where to land whenever the timeline is rebuilt — a fresh fetch, or a flip of
  // the toggle: the last observed frame, the live one. The present is what a
  // radar is for, and in combined it sits mid-track with the forecast already
  // laid out to its right. On the forecast side there are no observed frames, so
  // pastCount is 0 and this lands on frame 0 — the earliest forecast step.
  // Set while rendering rather than in an effect, so a rebuilt timeline never
  // paints a frame with the old index.
  const startIdx = Math.min(Math.max(0, pastCount - 1), Math.max(0, frames.length - 1))
  // Starts on no frames so the first render lands too: a cached feed means the
  // card can mount with a full timeline already.
  const [idxFor, setIdxFor] = useState({ frames: null, pastCount })
  if (idxFor.frames !== frames || idxFor.pastCount !== pastCount) {
    setIdxFor({ frames, pastCount })
    setIdx(startIdx)
  }

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
    // Starts at 10, past AUTO_HD_ZOOM, which is what `hd`'s initial state says.
    map.on('zoomend', () => setHd(map.getZoom() >= AUTO_HD_ZOOM))
    // Where you are. A DOM marker rather than the circleMarker this was, because
    // Leaflet zooms by CSS-scaling a pane rather than redrawing it mid-gesture,
    // and which pane decides what that does to the dot. Vectors live in the
    // overlay pane, which is the one that gets the scale() — so the dot grew and
    // shrank with the map for the whole animation and only snapped back to its
    // 5px radius when the zoom settled. Markers are in a pane that is translated
    // instead (markerZoomAnimation above), so a DOM dot is the same size on every
    // frame. Sized in CSS to what the vector drew: a 12px circle, 2px of it white
    // ring — see .radar-here.
    L.marker([location.latitude, location.longitude], {
      icon: L.divIcon({ className: 'radar-here', iconSize: [12, 12], iconAnchor: [6, 6] }),
      interactive: false,
      keyboard: false,
    }).addTo(map)
    mapInst.current = map
    setMapReady(true)
    setRainMap(map)
    return () => {
      wheelEl.removeEventListener('wheel', onWheel, { capture: true })
      map.remove()
      mapInst.current = null
      baseTileRef.current = null
      cache.clear()
      activeKey.current = null
      setMapReady(false)
      setRainMap(null)
    }
  }, [hasFrames, location.latitude, location.longitude])

  // Add base tile layer once map is ready
  useEffect(() => {
    const map = mapInst.current
    if (!map || !mapReady) return
    // The basemap arrives asynchronously (see utils/basemap); the ref is what the
    // reveal animation waits on, and until it lands the reveal simply doesn't wait.
    const remove = addBasemap(L, map, (base) => { baseTileRef.current = base })
    return () => {
      remove()
      baseTileRef.current = null
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
      const key = layerKey(frame, hd)
      let layer = layerCache.current.get(key)
      if (!layer) {
        const opts = { opacity: 0, zIndex: 200, maxZoom: MAP_MAX_ZOOM, crossOrigin: true, className: 'radar-tiles' }
        // MRMS builds each tile's URL from its coords (see MrmsLayer) and takes no
        // template. Its cap is its own — see MRMS_NATIVE_MAX — because it is there
        // to bound how much rendering the request asks for, not because the server
        // would refuse the way RainViewer's does past RADAR_NATIVE_MAX.
        const src = drawnSrc(frame, hd)
        layer = src === 'mrms'
          ? new MrmsLayer('', { ...opts, timeRange: frame.range, maxNativeZoom: MRMS_NATIVE_MAX })
          : L.tileLayer(frame.url, { ...opts, maxNativeZoom: src === 'nexrad' ? NEXRAD_NATIVE_MAX : RADAR_NATIVE_MAX })
        layer.on('load', () => { layer._radarLoaded = true })
        layerCache.current.set(key, layer)
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
      inWindow.add(layerKey(frames[((idx + d) % frames.length + frames.length) % frames.length], hd))
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
    const key = layerKey(frame, hd)
    wantedKey.current = key
    const layer = getLayer(frame, true)

    const show = () => {
      if (wantedKey.current !== key) return // user moved on before this loaded
      const prev = activeKey.current
      if (prev && prev !== key) {
        const prevLayer = layerCache.current.get(prev)
        if (prevLayer) prevLayer.setOpacity(0)
      }
      layer.setOpacity(RADAR_OPACITY)
      activeKey.current = key
    }

    // Show immediately if tiles are already cached; otherwise keep the old frame
    // up until this one loads, then swap.
    if (layer._radarLoaded) show()
    else layer.once('load', show)

    // Prefetch the full forward window so playback never waits on cold layers.
    for (let d = 1; d <= win; d++) {
      getLayer(frames[(idx + d) % frames.length], true)
    }
  }, [mapReady, frames, idx, playing, hd])

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
      const layer = layerCache.current.get(layerKey(frames[next], hd))
      if (layer?._radarLoaded || ++holds >= 4) setIdx(next)
    }, 450)
    return () => clearInterval(id)
  }, [playing, frames, idx, hd])

  const expand = () => {
    pageScroll.current = window.scrollY
    scrollPinned.current = true
    // Measured before the switch, while the card is still the compact one in the
    // stack — afterwards it is the size of the screen. The margin comes along
    // because .card carries one that goes away with the card; read off the
    // computed style rather than hard-coded, so a theme that changes the gap
    // can't leave this a few pixels out.
    const el = cardRef.current
    const cs = el && getComputedStyle(el)
    setHold(el
      ? {
          // getBoundingClientRect, not offsetHeight: the card's height is
          // fractional at most text sizes and offsetHeight rounds it, so the slot
          // could come out a fraction of a pixel short — and the placeholder
          // clips, so short means clipping the bottom of the still inside it.
          height: `${el.getBoundingClientRect().height}px`,
          marginBottom: cs.marginBottom,
          // The clip has to be the card's shape, not a rectangle around it. The
          // slot holds a still of a rounded card and cuts it to its own box, so a
          // square box squares off the two bottom corners — which is a card that
          // changes shape the moment you open it.
          borderRadius: cs.borderRadius,
        }
      : null)
    // Draw the basemap now so its canvas still holds the frame when snapshot
    // reads it (see snapshot).
    baseTileRef.current?.getMaplibreMap()?.redraw()
    holdClone.current = el ? snapshot(el) : null
    // The frame the still shows, so the close can land on it (see the back
    // handler below).
    snapFrameTime.current = frames[idx]?.time ?? null
    history.pushState({ overlay: 'radar' }, '')
    if (!revealAnimates()) { setExpanded(true); return }
    // Provisional geometry, against the viewport, so the armed frame has
    // something laid out to render. It is remeasured against the frame's real
    // box on that frame (see the arm effect) before anything moves.
    setRevealStyle(irisGeometry({ width: window.innerWidth, height: window.innerHeight }))
    // The card goes full-screen straight away, hidden: it is the thing the morph
    // grows out of the card's slot. 'arm' holds it hidden for a few frames so
    // the switch isn't paid for out of the animation.
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
      // Go back to the radar frame the card was showing when it opened. The
      // still in the slot is a picture of the card at that moment, and the
      // window closes onto it — so a map left on another frame (scrubbed, or
      // played on) would hand over to a still of a different time, and the
      // card would visibly jump twice: into the old frame, then back once the
      // live card returned. Switched now, while the controls fade, it is the
      // same frame on both sides of every handover.
      setOutFrozen(liveCtl.current)
      const t = snapFrameTime.current
      const back = t == null ? -1 : framesRef.current.findIndex(f => f.time === t)
      if (back !== -1) setIdx(back)
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
    let inner, cap, unhook
    const outer = requestAnimationFrame(() => {
      // Also done by the 80ms timeout further down, but that one would land in the
      // middle of the iris. Leaflet bails early on a size it has already seen, so
      // the later call stays cheap.
      mapInst.current?.invalidateSize()
      // The card is full-screen now, so this is the first moment its real box can
      // be read — and the last before the circle moves. Whatever `inset: 0` turned
      // out to resolve against, every offset is measured inside that same box from
      // here on (see irisGeometry). The extra render is spent on the armed frame,
      // behind a circle that has not started growing.
      const box = cardRef.current?.getBoundingClientRect()
      if (box) setRevealStyle(irisGeometry(box))
      // Then let the tiles the resize just asked for land before the circle
      // moves — see ARM_TILE_WAIT_MS. isLoading() is true from the moment
      // invalidateSize adds a tile above, and the load event is Leaflet saying
      // the grid is complete; a fully cached grid answers false here and opens
      // on the next frame, as it always did.
      inner = requestAnimationFrame(() => {
        const base = baseTileRef.current
        const go = () => { clearTimeout(cap); unhook?.(); unhook = null; setPhase('in') }
        if (!base?.isLoading?.()) { setPhase('in'); return }
        base.once('load', go)
        unhook = () => base.off('load', go)
        cap = setTimeout(go, ARM_TILE_WAIT_MS)
      })
    })
    return () => {
      cancelAnimationFrame(outer); cancelAnimationFrame(inner)
      clearTimeout(cap); unhook?.()
    }
  }, [phase])

  // Runs the window (see the note beside WINDOW_IN_MS).
  //
  // A layout effect, because a plain one runs after the paint it was scheduled by
  // and the animation's first keyframe is the only thing holding the window
  // shut. The render that sets 'in' would otherwise paint once with the radar
  // fully open and then snap back to the card. The same frame in reverse on the
  // way out.
  //
  // Measured here, not stored: on the way out the page may have been rotated or
  // the slot moved since the open, and the window has to land where it is now.
  //
  // The settled state is the layers gone entirely: at rest the card is plain
  // position:fixed again, rather than a clipped screen-sized layer pinned under
  // it for as long as the radar is up.
  useLayoutEffect(() => {
    if (phase !== 'in' && phase !== 'out') return
    const frame  = irisFrameRef.current
    const circle = irisCircleRef.current
    const inner  = irisInnerRef.current
    const scrim  = irisScrimRef.current
    const win    = placeholderRef.current?.querySelector('.radar-map-wrap')
    const opening = phase === 'in'
    // Closing is torn down by the effect below, on its own clock — it has to
    // outlive the animation to unmount the card, so only the opening settles
    // itself here. Missing layers (reduced motion switched on mid-flight) fall
    // through to the same clock.
    if (!frame || !circle || !inner || !win) {
      if (!opening) return
      const t = setTimeout(() => setPhase('chrome'), WINDOW_IN_MS)
      return () => clearTimeout(t)
    }
    // The frame's own box, untransformed. After a predictive back swipe it is
    // still easing back to full size from where the finger left it
    // (utils/predictiveBack.js), so the window is measured against where the
    // frame is going, not where it is mid-ease.
    const box = untransformedBox(frame)
    const radius = parseFloat(getComputedStyle(win).borderTopLeftRadius) || 0
    const f = windowFrames(win.getBoundingClientRect(), box, radius)
    const order = (frames) => (opening ? frames : [...frames].reverse())
    const timing = opening
      ? { duration: WINDOW_IN_MS, easing: WINDOW_IN_EASE, fill: 'both' }
      : { duration: WINDOW_OUT_MS, delay: CHROME_OUT_MS, easing: WINDOW_OUT_EASE, fill: 'both' }
    const anims = [
      circle.animate(order(f.clip), timing),
      inner.animate(order(f.shift), timing),
    ]
    if (scrim) {
      anims.push(scrim.animate(order([{ opacity: 0 }, { opacity: 1 }]), { ...timing, easing: 'linear' }))
    }
    if (opening) anims[0].onfinish = () => setPhase('chrome')
    // Cancel rather than leave them filling: settled-open is the plain card, and
    // a forwards-filling clip would keep the layer composited for nothing.
    return () => anims.forEach(a => a.cancel())
  }, [phase])

  // On the way out, glide the map back to the card's view — the location, at the
  // compact zoom — while the window shrinks. The compact card always shows that
  // view, and re-centres on it the moment it is back (see the layout effect
  // that calls setView on collapse), so a map left panned or zoomed full-screen
  // used to close onto that view and then snap. Starting together, the window
  // shrinks onto a map that is already on its way home, and arrives with it.
  // Skipped when the view hasn't moved, so a plain open-and-close doesn't stir.
  useEffect(() => {
    if (phase !== 'out') return
    const map = mapInst.current
    if (!map) return
    const home = [location.latitude, location.longitude]
    const off = map.latLngToContainerPoint(home).distanceTo(map.getSize().divideBy(2))
    if (map.getZoom() === 10 && off < 2) return
    map.flyTo(home, 10, { duration: IRIS_OUT_MS / 1000, easeLinearity: 0.5 })
    return () => map.stop()
  }, [phase, location.latitude, location.longitude])

  // The window is full: the controls fade in (radarChromeIn, keyed on the
  // --chrome class), then the frame settles to rest.
  useEffect(() => {
    if (phase !== 'chrome') return
    const t = setTimeout(() => setPhase(null), CHROME_IN_MS)
    return () => clearTimeout(t)
  }, [phase])

  // Closed: the card can rejoin the stack now the window is shut over it. The
  // still goes with it, laid over the card until the map is ready (settling).
  useEffect(() => {
    if (phase !== 'out') return
    const t = setTimeout(() => {
      setExpanded(false)
      setPhase(null)
      setRevealStyle(null)
      setHold(null)
      setSettling(!!holdClone.current)
    }, IRIS_OUT_MS)
    return () => clearTimeout(t)
  }, [phase])

  // Lift the still once the live map can be seen. Three frames first: the
  // basemap plugin resizes its container in one, MapLibre clears and re-renders
  // its canvas in the next, and the third is margin. Then wait out any tiles
  // either layer is still fetching — the zoom snapping home is the usual cause.
  useEffect(() => {
    if (!settling) return
    let done = false
    const unhooks = []
    const finish = () => {
      if (done) return
      done = true
      setSettling(false)
      holdClone.current = null
    }
    let raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => {
        raf = requestAnimationFrame(() => {
          const pending = [baseTileRef.current, layerCache.current.get(activeKey.current)]
            .filter(l => l?.isLoading?.())
          if (pending.length === 0) { finish(); return }
          let left = pending.length
          for (const l of pending) {
            const h = () => { if (--left === 0) finish() }
            l.once('load', h)
            unhooks.push(() => l.off('load', h))
          }
        })
      })
    })
    const cap = setTimeout(finish, SETTLE_MAX_MS)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(cap)
      unhooks.forEach(u => u())
    }
  }, [settling])

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

  // Leaflet only re-measures its container on a window resize or when told to.
  // Every other way the box changes size left the map drawn for the old one,
  // with the rest of the box an empty grey: the one that showed was opening the
  // Radar tab from the desktop splash. The page is built under the splash, where
  // the full-bleed radar layout isn't applied yet (it keys off the tab bar,
  // which takes over only once the splash has gone), so the map was created a
  // few hundred pixels short and then left that way when the layout stretched
  // it. Watching the box itself covers that and anything like it. invalidateSize
  // is a no-op at a size Leaflet has already seen, so the calls the expand and
  // collapse paths make on their own stay cheap.
  useEffect(() => {
    const el = mapRef.current
    const map = mapInst.current
    if (!el || !map) return
    // Default options: re-centre without animating, so the location dot stays
    // where it was in the middle rather than drifting with the top-left corner.
    const ro = new ResizeObserver(() => map.invalidateSize())
    ro.observe(el)
    return () => ro.disconnect()
  }, [mapReady])

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

  // US feeds (MRMS, NEXRAD, the HRRR forecast) only cover the US, so while every
  // frame on the timeline is one of them the map is held to the US region the
  // location is in: panning stops at its edges, and zooming out stops at the
  // widest view that still fits inside it. RainViewer is worldwide, so a
  // timeline with any of its frames is left free.
  const usOnly = frames.length > 0 && frames.every((f) => f.src !== 'rv')
  const usBounds = useMemo(
    () => (usOnly ? usViewBounds(location.latitude, location.longitude) : null),
    [usOnly, location.latitude, location.longitude],
  )
  useEffect(() => {
    const map = mapInst.current
    if (!map || !usBounds) return
    const bounds = L.latLngBounds(usBounds)
    // Recomputed whenever the map changes size (card, full screen, fill): a
    // wider box needs a closer zoom to stay inside the region. Capped so a small
    // region (Puerto Rico, Guam) still leaves room to zoom.
    const fitMinZoom = () => {
      map.setMinZoom(Math.min(MAP_MAX_ZOOM - 3, Math.max(MAP_MIN_ZOOM, map.getBoundsZoom(bounds, true))))
    }
    map.options.maxBoundsViscosity = 1 // a hard edge, not a rubber band
    map.setMaxBounds(bounds)
    fitMinZoom()
    map.on('resize', fitMinZoom)
    return () => {
      map.off('resize', fitMinZoom)
      // The map may already be gone (unmount removes it first).
      if (mapInst.current !== map) return
      map.setMaxBounds(null)
      map.setMinZoom(MAP_MIN_ZOOM)
    }
  }, [mapReady, usBounds])

  const handleLocate = useCallback(() => {
    const map = mapInst.current
    if (!map) return
    map.setView([location.latitude, location.longitude], 9, { animate: true })
  }, [location.latitude, location.longitude])

  // The radar layer currently on screen, for RadarRain to read its tiles from.
  const getActiveLayer = useCallback(() => layerCache.current.get(activeKey.current), [])

  const handleZoomIn  = useCallback(() => mapInst.current?.zoomIn(),  [])
  const handleZoomOut = useCallback(() => mapInst.current?.zoomOut(), [])

  // The two surfaces the radar gets a screen to itself on, as against the compact
  // card in the weather stack. Several controls turn on here — see the scrubber
  // below and the Observed/Forecast toggle.
  const fullSize = expanded || fill

  // Which scrubber, by how much *track* the radar has — not by how much screen.
  // (Two statements, not one expression: behind the && the hook would stop being
  // called the moment the radar opened.)
  //
  // Opening the card is no longer part of the question. The phone app's expanded
  // radar keeps the scrubber it had in the stack, because that is the one the
  // reveal opens onto: the card and the full-screen view are the same radar a
  // tap apart, and swapping the timeline underneath the tap made them read as two
  // different controls. The bar also barely grows — a ~356px card becomes a
  // ~390px screen — so there was never the extra track the filmstrip was for.
  //
  // That leaves it to `fill`, the web app's Radar tab, in a window too narrow to
  // lay the run out whole. There the page is the radar and has no compact
  // counterpart to stay consistent with.
  const wideTrack = useMediaQuery(WIDE_TRACK_MQ)
  const stripScrubber = fill && !wideTrack

  // The filmstrip runs under a fixed playhead: the frame being shown sits at the
  // centre of the track and the ticks travel past it, so the gesture is "drag the
  // timeline" from anywhere on the bar instead of "grab the one tick that is the
  // handle". Two things follow.
  //
  // A frame's position is no longer a fraction of the track's width, so the
  // arithmetic is in ticks: every column is TICK_W wide (the CSS reads the same
  // number off --radar-tick-w), and moving the strip one column's worth of pixels
  // moves the timeline exactly one frame — the same swipe means the same amount
  // of time however wide the screen is.
  //
  // And the position under the finger is fractional. `drag` carries it so the
  // strip can follow the finger continuously while setIdx snaps to the nearest
  // frame; without it the strip would only ever sit on whole frames and a slow
  // drag would stutter between them. Released, it goes back to null and the strip
  // settles onto the active frame under CSS transition.
  //
  // Otherwise — the card in the stack, the phone app's full-screen radar, and any
  // full-size radar wider than WIDE_TRACK_MQ — the scrubber the card always had:
  // the whole timeline laid out across the track at once, tapped or dragged to a
  // position that is read straight off the width. At card and phone-screen widths
  // that is because a filmstrip only shows a slice of the run and wants a swipe
  // before it says anything, where the whole track answers "when" at a glance. On
  // a monitor it is the opposite reason: there is room to show the run whole, and
  // a mouse would rather click where it wants to go than drag a strip there.
  const handlePointerDown = useCallback((e) => {
    setPlaying(false)
    e.currentTarget.setPointerCapture(e.pointerId)
    if (!stripScrubber) {
      dragRef.current = { whole: true }
      setScrubbing(true)
      setIdx(idxAcrossTrack(e.clientX, e.currentTarget, frames.length))
      return
    }
    dragRef.current = { x0: e.clientX, from: idx, moved: false }
    setDrag(idx)
  }, [stripScrubber, idx, frames.length])

  const handlePointerMove = useCallback((e) => {
    const d = dragRef.current
    if (!d) return
    if (d.whole) {
      setIdx(idxAcrossTrack(e.clientX, trackRef.current, frames.length))
      return
    }
    const dx = e.clientX - d.x0
    // A few pixels of slop, so a tap that shivers is still a tap.
    if (Math.abs(dx) > TAP_SLOP) d.moved = true
    // Dragging left (negative dx) walks the timeline forward, the way a filmstrip
    // pulled leftwards brings later frames to the centre.
    const pos = clampIdx(d.from - dx / TICK_W, frames.length)
    setDrag(pos)
    setIdx(Math.round(pos))
  }, [frames.length])

  // On the filmstrip, a tap that never became a swipe still means something: the
  // tick under it is asking to be the one in the middle. Measured from the centre
  // of the track, since that is where the frame it started from was sitting.
  const handlePointerUp = useCallback((e) => {
    const d = dragRef.current
    dragRef.current = null
    if (d && !d.whole && !d.moved && trackRef.current) {
      const rect = trackRef.current.getBoundingClientRect()
      const off  = (e.clientX - rect.left - rect.width / 2) / TICK_W
      setIdx(Math.round(clampIdx(d.from + off, frames.length)))
    }
    setDrag(null)
    setScrubbing(false)
  }, [frames.length])

  // Hangs the still inside the placeholder as it mounts. Only ever appends: the
  // clone goes out of the document with its parent, and appendChild will move it
  // back if the slot mounts a second time — which is what StrictMode's double
  // mount does in development, and what a cleanup here would break.
  const attachSnapshot = useCallback((node) => {
    if (node && holdClone.current) node.appendChild(holdClone.current)
  }, [])
  // The still laid over the card just after it closes (see .radar-settle). It
  // has to cover the card's border box exactly, and absolute positioning is
  // measured from inside the border, so it is pushed out by the card's own
  // border widths — read here because they differ by theme (a hairline on the
  // glass styles, none on others).
  const attachSettle = useCallback((node) => {
    if (!node) return
    const card = node.parentElement
    if (card) {
      const cs = getComputedStyle(card)
      node.style.inset = [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth]
        .map(w => `-${parseFloat(w) || 0}px`).join(' ')
    }
    attachSnapshot(node)
  }, [attachSnapshot])
  const attachPlaceholder = useCallback((node) => {
    placeholderRef.current = node
    attachSnapshot(node)
  }, [attachSnapshot])

  // Nothing to draw yet. In the stack the card stays out until it has frames;
  // as the web Radar page it *is* the page, and returning nothing left the tab
  // an empty sky until the feeds answered, then dropped the whole radar in at
  // once. The page's frame — card, empty map — goes up straight away instead,
  // the same box the lazy loader's skeleton holds, so the page fades in on the
  // switch and only the map and controls arrive later.
  if (frames.length === 0) {
    return fill ? (
      <div className="card radar-card radar-fill" aria-busy="true">
        <div className="radar-map-wrap">
          <div className="radar-map" />
        </div>
      </div>
    ) : null
  }

  // The legend tracks the tiles actually on screen. MRMS and HRRR are both NOAA
  // and both draw with the NWS reflectivity ramp; RainViewer keeps its own, and
  // the two can't be reconciled — its free tier ignores the colour-scheme
  // parameter in the tile URL — so instead of hiding the switch the legend blocks
  // ease between the two ramps. Read off the frame's source rather than its key,
  // so a feed can't change its key format and silently take the legend with it.
  // drawnSrc, not the frame's own src: an Auto frame is MRMS or NEXRAD depending
  // on the zoom, and the caption has to name the one actually on screen.
  // The frame and play state the controls show: the live ones, except while
  // closing, when they hold what they had (see outFrozen).
  const frozenCtl    = phase === 'out' ? outFrozen : null
  const shownIdx     = frozenCtl ? frozenCtl.idx : idx
  const shownPlaying = frozenCtl ? frozenCtl.playing : playing
  const frameSrc     = frames[shownIdx] && drawnSrc(frames[shownIdx], hd)
  const legendColors = frameSrc === 'rv' ? LEGEND_RAINVIEWER : LEGEND_NWS

  // Observed → forecast boundary, marked on the scrubber so the palette change
  // reads as a deliberate handoff rather than a glitch. Combined only: in split
  // each side is all one thing, so the toggle is the boundary and a divider
  // would land on an edge of the track and say nothing.
  const showDivider = combined && pastCount > 0 && pastCount < frames.length

  // Names the feed behind the frame under the cursor, which now works the same
  // way on every timeline: pastCount is where observed stops, so it is the whole
  // track on the observed side, none of it on the forecast side, and the divider
  // in combined. Naming the frame used to be wrong in split, where the forecast
  // side led with the shared live frame and so opened reading "Observed" — that
  // frame is gone from it, and with it the reason to caption the side instead.
  // The legend tracks the tiles rather than this, because that is a statement
  // about their colours.
  const SOURCE_NAMES = {
    mrms: 'NOAA MRMS radar',
    // Names the site, since which radar it is decides where the coverage ends.
    nexrad: `NOAA NEXRAD ${frames[shownIdx]?.site ?? ''}`.trim(),
    rv:   'RainViewer radar',
    hrrr: 'NOAA HRRR model',
  }
  const sourceLabel = shownIdx >= pastCount
    ? `Forecast · ${frameSrc === 'hrrr' ? SOURCE_NAMES.hrrr : 'RainViewer nowcast'}`
    : `Observed · ${SOURCE_NAMES[frameSrc] ?? SOURCE_NAMES.rv}`

  // Whether the circle is a box at all. Only while it is moving: settled open, the
  // circle and its counter-scale go back to display:contents and what is left is
  // the full-screen card.
  const irisOn = !!revealStyle && (phase === 'arm' || phase === 'in' || phase === 'out')
  // Whether the *frame* is a box, which outlasts the circle by the whole time the
  // radar is up. Shut in the stack it is display:contents like the other two, so
  // the card lays out exactly as it did before any of this existed; full-screen it
  // stays the fixed box that .radar-sky and the card are positioned inside.
  //
  // Collapsing it the moment the reveal finished was the flash. The card and the
  // sky went back to `position: fixed`, which Chromium composites when it overlaps
  // composited content, so a screen-sized layer was created on precisely the frame
  // that the frame, the 1180px circle and the counter-scale were destroyed — a
  // whole compositor restructure in one commit, under a full-screen map. Keeping
  // the frame means the boundary drops two layers and creates none.
  const irisFramed = !!revealStyle && (expanded || irisOn)
  // Arming paints the destination — full-screen card, resized map, whatever tiles
  // have landed — with nothing yet telling the circle to be small, so the class
  // holds it transparent for the duration. That is what makes the frame free to
  // wait on (see ARM_TILE_WAIT_MS): the screen it shows is the one the tap landed
  // on, and the iris still opens out of a shut window.
  const irisC =
    (irisFramed ? ' radar-iris--framed' : '') +
    (irisOn ? ` radar-iris--on radar-iris--${phase}` : '') +
    (phase === 'chrome' ? ' radar-iris--chrome' : '')

  return (
    <>
    {/* Holds the card's place in the stack while it is off being full-screen, so
        the page doesn't shorten under it. Outside the iris on purpose: the iris
        leaves the flow when it opens, and this is what stays behind in it. */}
    {expanded && hold && (
      <div className="radar-placeholder" style={hold} ref={attachPlaceholder} aria-hidden="true" />
    )}
    {/* The window, in parts (see the note beside WINDOW_IN_MS, and windowFrames):
          .radar-iris        the frame. Takes the same `inset: 0` the card used to,
                             so it lands on exactly the box the card will fill and
                             every offset inside is measured against that rather
                             than against an assumed viewport.
          .radar-iris-scrim  dims the forecast behind.
          .radar-iris-circle the window: the full-screen radar, clipped from the
                             card's map box out to the screen (named for when
                             it was a round one).
          .radar-iris-inner  the radar inside it, shifted so the map's centre
                             stays under the window's.

        The wrappers stay around the card permanently and are display:contents until
        the morph runs — putting them up only while animating would re-parent the
        card, remount its subtree and destroy the Leaflet instance inside it. */}
    <IrisShell
      fill={fill}
      className={`radar-iris${irisC}`}
      frameRef={irisFrameRef}
      scrimRef={irisScrimRef}
      circleRef={irisCircleRef}
      innerRef={irisInnerRef}
      circleStyle={irisOn ? revealStyle.circle : undefined}
      innerStyle={irisOn ? revealStyle.inner : undefined}
    >
    {/* Full-screen radar is a card blown up to the viewport, and with the
        transparency slider up its fill is translucent — so the weather stack it
        is covering reads straight through the controls strip. This paints the
        page backdrop (the sky gradient, or the flat surface with effects off)
        between the two: same fixed geometry as .sky-bg, so it lines up with the
        real sky exactly, but above the app content rather than below it. Only
        while expanded; the compact card is meant to sit in the stack.

        Inside the circle with the card, because it is the other half of what the
        reveal opens onto: outside it, it would black the weather stack out on the
        first frame and the circle would be opening onto a screen already gone. */}
    {expanded && (
      <div className={`radar-sky ${sky}`} aria-hidden="true" />
    )}
    <div
      ref={cardRef}
      className={`card radar-card${expanded ? ' radar-expanded' : ''}${fill ? ' radar-fill' : ''}${settling ? ' radar-settling' : ''}`}
    >
      {/* The still, held over the card just after it closes — see SETTLE_MAX_MS. */}
      {settling && <div className="radar-settle" ref={attachSettle} aria-hidden="true" />}
      {!expanded && !fill && (
        <div className="radar-header">
          <span className="section-label" style={{ margin: 0 }}>RADAR</span>
        </div>
      )}

      {/* The stage holds the map and, on the compact card, the glow that
          spills its colours out onto the card around it (.radar-map-glow).
          Expanded and fill modes lay the map out as before: there the stage
          is display: contents, so it is not a box at all. */}
      <div className="radar-map-stage">
      <div className="radar-map-wrap">
        <div ref={mapRef} className="radar-map" />
        {/* Rain drawn only where the radar shows echoes — on the compact card
            too, so the map that grows into the full-screen view is already the
            one with weather falling on it. */}
        {rainFx && rainMap && (
          <RadarRain map={rainMap} getLayer={getActiveLayer} snow={snow} />
        )}
        {/* The full-screen overlay floats its zoom and collapse tools on the
            map, and is the only mode that offers a way out of itself. Its
            locate button lives with the controls instead — see below. Fill mode
            floats its tools too, as one vertical pill on the right edge (see
            .radar-map-tools in WebApp.css), out of the way of the dock below. */}
        {fill && (
          <div className="radar-map-tools" role="group" aria-label="Map">
            <button className="radar-zoom-btn" onClick={handleZoomIn} aria-label="Zoom in" title="Zoom in">
              <ZoomIn size={18} />
            </button>
            <button className="radar-zoom-btn" onClick={handleZoomOut} aria-label="Zoom out" title="Zoom out">
              <ZoomOut size={18} />
            </button>
            <span className="radar-map-tools-sep" aria-hidden="true" />
            <button className="radar-locate-btn" onClick={handleLocate} aria-label="Center on location" title="Center on location">
              <Navigation size={17} />
            </button>
          </div>
        )}
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
      {!expanded && !fill && <div className="radar-map-glow" aria-hidden="true" />}
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
        {/* Fill (the desktop Radar tab) lays the row out as a media dock: play
            first, where a player puts it, then the time with how far it is from
            now under it, then the legend — the strip's two caption rows folded
            into this one, which is most of what lets the dock float over the map
            instead of taking a band of the window. */}
        {fill ? (
          <div className="radar-main-row radar-main-row--dock">
            <button className={`radar-play-circle${playing ? ' is-playing' : ''}`} onClick={() => setPlaying(v => !v)} aria-label={playing ? 'Pause' : 'Play'} title={playing ? 'Pause (Space)' : 'Play (Space)'}>
              {playing ? <Pause size={20} /> : <Play size={20} />}
            </button>
            <div className="radar-time-block">
              <div className="radar-big-time">
                {frames[idx] ? fmtTime(frames[idx].time, timezone) : ''}
              </div>
              <div className="radar-time-sub">
                <span className={`radar-rel${idx >= pastCount ? ' radar-rel--future' : ''}`}>
                  {frames[idx] ? fmtRelative(frames[idx].time, nowSec) : ''}
                </span>
                <span className="radar-time-src">{sourceLabel}</span>
              </div>
            </div>
            <div className="radar-legend radar-legend--dock" aria-label="Precipitation intensity, light to heavy">
              <span className="radar-legend-lbl">Light</span>
              <div className="radar-legend-blocks">
                {legendColors.map((color, i) => (
                  <div key={i} className="radar-legend-block" style={{ background: color }} />
                ))}
              </div>
              <span className="radar-legend-lbl">Heavy</span>
            </div>
          </div>
        ) : (
          <div className="radar-main-row">
            <div className="radar-big-time">
              {frames[shownIdx] ? fmtTime(frames[shownIdx].time, timezone) : ''}
            </div>
            <div className="radar-row-actions">
              <button className={`radar-play-circle${shownPlaying ? ' is-playing' : ''}`} onClick={() => setPlaying(v => !v)} aria-label={shownPlaying ? 'Pause' : 'Play'}>
                {shownPlaying ? <Pause size={22} /> : <Play size={22} />}
              </button>
            </div>
          </div>
        )}

        {/* Split only, and then only where there is a second half to reach:
            outside the HRRR domain there are no forecast tiles, so rather than
            offer a switch that lands on a blank map the control isn't there at
            all. Sits above the scrubber because it is what the scrubber is a
            scrubber of.

            Full-size only, on top of that — the two surfaces the radar gets a
            screen to itself on, expanded and fill. The compact card in the stack
            is a glance at the weather rather than a map to work, and its whole
            tap target is "open me": a control that isn't that competes with it
            in the space of a couple of rows. The view it is left on carries over
            when the card collapses, so what the caption below says is showing is
            still what is showing. */}
        {(expanded || fill) && canForecast && !combined && (
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

        {/* On the Radar tab in a narrow window, the whole bar is the grab handle: a
            pointer down anywhere on it takes hold of the strip, and the strip
            slides under a playhead fixed at the centre, carrying the frames past
            it. What is centred is what is on the map. The track clips and fades
            its own edges,
            so the timeline reads as continuing past both of them rather than
            ending there.

            The strip is offset by half a tick beyond the frame's own position:
            translating by -(pos + 0.5) columns puts the middle of that column —
            the tick itself — on the centre line, where translating by -pos would
            put its leading edge there and leave every tick half a column late.

            Everywhere else the same markup lays out the other way: the strip is an
            ordinary full-width flex row of stretched columns with no transform of
            its own, so the timeline spans the track whatever the track measures,
            and the active tick is the playhead moving across it. --strip and
            --wide are the two dressings of that row — the card takes neither and
            keeps the compact defaults, and so does the phone app's full-screen
            radar, which is the whole point of it matching the card.

            --wide is gated on the media query rather than on "full-size and not a
            filmstrip". The two were the same test while the filmstrip covered
            every narrow full-size radar; now that expanding on a phone is not one,
            they part company, and it is the width that this was ever about — see
            the rule, which is there to stop a dozen frames 130px apart on a
            monitor from reading as scattered ticks. */}
        <div
          className={[
            'radar-tick-track',
            stripScrubber && 'radar-tick-track--strip',
            stripScrubber && drag !== null && 'radar-tick-track--dragging',
            fullSize && wideTrack && 'radar-tick-track--wide',
            !stripScrubber && 'radar-tick-track--rail',
            !stripScrubber && scrubbing && 'radar-tick-track--scrubbing',
          ].filter(Boolean).join(' ')}
          ref={trackRef}
          style={stripScrubber ? { '--radar-tick-w': `${TICK_W}px` } : undefined}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          {/* The rail (everywhere but the filmstrip): a rounded track, filled in
              the accent up to the frame on screen, striped where the frames are
              forecast, with a round knob on the current frame. Every frame owns an
              equal share of the width and the knob sits in the middle of its
              share — the same arithmetic idxAcrossTrack reads a tap with. The
              columns below still lay out the hour marks and their labels. */}
          {!stripScrubber && frames.length > 0 && (
            <div
              className="radar-scrub"
              aria-hidden="true"
              style={{
                '--scrub-pos': `${((shownIdx + 0.5) / frames.length) * 100}%`,
                '--scrub-fc': `${(pastCount / frames.length) * 100}%`,
              }}
            >
              <div className="radar-scrub-rail" />
              {pastCount < frames.length && <div className="radar-scrub-forecast" />}
              <div className="radar-scrub-fill" />
              <div className="radar-scrub-thumb" />
            </div>
          )}
          <div
            className="radar-tick-strip"
            style={stripScrubber
              ? { transform: `translate3d(${-((drag ?? idx) + 0.5) * TICK_W}px, 0, 0)` }
              : undefined}
          >
            {frames.map((frame, i) => {
              const d    = new Date(frame.time * 1000)
              const prev = i > 0 ? new Date(frames[i - 1].time * 1000) : null
              const isHour = prev !== null && d.getHours() !== prev.getHours()
              return (
                <div key={i} className="radar-tick-col">
                  {showDivider && i === pastCount && <span className="radar-now-divider" aria-hidden="true" />}
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
        </div>

        {/* Fill carries both of these in the dock's top row instead. */}
        {!fill && (
          <>
            <div className="radar-legend">
              <span className="radar-legend-lbl">Light</span>
              <div className="radar-legend-blocks">
                {legendColors.map((color, i) => (
                  <div key={i} className="radar-legend-block" style={{ background: color }} />
                ))}
              </div>
              <span className="radar-legend-lbl">Heavy</span>
            </div>

            <p className="radar-source">{sourceLabel}</p>
          </>
        )}
      </div>
    </div>
    </IrisShell>
    </>
  )
}
