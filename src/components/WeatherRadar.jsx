import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from 'react'
import { Minimize2, Play, Pause, Navigation, ZoomIn, ZoomOut } from 'lucide-react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const FRAMES_URL = 'https://api.rainviewer.com/public/weather-maps.json'
const TILE_URL   = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'

// Observed radar, where NOAA covers it: the MRMS mosaic behind radar.weather.gov,
// served straight from NWS rather than through a third party. No key, CORS open,
// ~5-minute sweeps with a four-hour rolling window — against RainViewer's free
// tier that is finer, fresher, twice the history, and free of the zoom ceiling
// below. RainViewer stays as the fallback and as the only option outside the US.
//
// It is an ArcGIS ImageServer, not an XYZ cache, so there are no tiles to ask
// for: each one is an exportImage render of that tile's bbox. See MrmsLayer.
const MRMS_BASE  = 'https://mapservices.weather.noaa.gov/eventdriven/rest/services/radar/radar_base_reflectivity_time/ImageServer'
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

// MRMS coverage, as the regions the mosaic actually contains. Outside them the
// render is blank, so those locations stay on RainViewer.
const MRMS_REGIONS = [
  [21, 53, -134, -60],    // CONUS
  [50, 73, -180, -129],   // Alaska
  [17, 24, -162, -153],   // Hawaii
  [16, 20, -68, -63],     // Puerto Rico / Caribbean
  [12, 15, 143, 147],     // Guam
]
const inMrmsDomain = (lat, lon) =>
  MRMS_REGIONS.some(([s, n, w, e]) => lat >= s && lat <= n && lon >= w && lon <= e)

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
  const data = await fetch(MRMS_QUERY).then(r => r.json())
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

// ── The reveal, as two composited transforms ────────────────────────────────
//
// It animated clip-path directly for a while, and that was the lag: clip-path is
// not a compositor property in Chromium, so every frame of the circle was a
// main-thread repaint of two full-screen layers, one of them a live tile map. It
// cost the same on every open, which is what told us it was this and not the
// one-off mount cost the day cover pays (see armCover in DailyForecast).
//
// So the circle is a real element now: a round box with overflow:hidden, scaled
// up from the tap. Scaling it would scale the map with it, so the layer directly
// inside runs the exact inverse scale about the same point — the pair cancels,
// the map sits still at its true size, and both animations are pure transforms
// the compositor runs off the main thread.
//
// The inverse has to be sampled rather than declared: CSS interpolates
// scale(a)->scale(b) but not 1/s(t). Both sides are emitted as the same grid of
// keyframes off the same eased clock, so they are exact inverses at every sample
// and linear between them, where the residue is far under a pixel.
// Density matters more than it looks. The two sides are exact inverses *at* every
// sample, but the browser fills the gaps linearly, and a straight line through
// 1/s is not the reciprocal of a straight line through s — so the pair stops
// cancelling between samples and the map breathes. Measured at 24 steps: 1.6%
// oversize at the small end, which is where 1/s moves fastest. The error falls
// off with the square of the interval, so this is cheap to fix by sampling
// harder; 96 pairs is still a trivial amount of keyframe data.
const IRIS_STEPS = 96
// How far the inner layer is ever asked to scale up. The exact inverse of a
// circle starting at zero is infinite, so the circle starts at 1/this instead —
// a hundred-odd px across on a phone — and fades in rather than growing from a
// mathematical point. Chromium rasterises a will-change layer once and scales
// that bitmap, so the earliest frames are soft; at that size there is nothing to
// read into it, and it is sharp long before the circle is big enough to notice.
//
// It is also the peak scale of a screen-sized layer, which is the reason it kept
// coming down. Chromium sizes the raster for a transform animation off the
// largest scale the animation reaches, so this number is squared in pixels
// before it is anything else: at 12 the inner layer asks to be rasterised at 144
// times the area of the screen, which is the kind of number that gets clamped,
// re-rastered mid-flight, or paid for in memory bandwidth on a phone. Six asks
// for a quarter of that. What it costs is a circle that starts twice as wide,
// which the fade over the first eighth of the run covers either way — and a
// smaller dynamic range for the interpolation above to cover, so the residue
// between samples falls too.
const IRIS_MAX_INNER = 6
const IRIS_FADE = 0.12 // fraction of the run spent fading the circle in

// How long the armed frame will wait for the base map to finish filling itself
// in before it gives up and opens anyway.
//
// Going full-screen is a fourfold increase in map area, so invalidateSize asks
// for a screenful of tiles that the compact card never needed. They arrive over
// the next few hundred ms, and every one of them lands as a repaint of the layer
// the iris is scaling — in dark mode through the invert filter on .map-base-tiles,
// which is a full-screen filter pass redone on each arrival. That is main-thread
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

// cubic-bezier(x1,y1,x2,y2) at t: Newton on x, then evaluate y. Six passes lands
// well inside a pixel at these sizes.
function bezier(x1, y1, x2, y2, t) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by
  const fx = (u) => ((ax * u + bx) * u + cx) * u
  const dfx = (u) => (3 * ax * u + 2 * bx) * u + cx
  let u = t
  for (let i = 0; i < 6; i++) {
    const d = dfx(u)
    if (Math.abs(d) < 1e-6) break
    u -= (fx(u) - t) / d
  }
  u = Math.max(0, Math.min(1, u))
  return ((ay * u + by) * u + cy) * u
}

// Mirrors --reveal-ease in App.css. Keep the two in step.
const irisEase = (t) => bezier(0.4, 0, 0.6, 1, t)

// Paired keyframes for the circle and the layer inside it. The curve is its own
// mirror, so closing is the opening read backwards rather than a written twin.
function irisKeyframes(opening) {
  const lo = 1 / IRIS_MAX_INNER
  const outer = [], inner = []
  for (let i = 0; i <= IRIS_STEPS; i++) {
    const t = i / IRIS_STEPS
    const p = opening ? t : 1 - t
    const s = lo + (1 - lo) * irisEase(p)
    outer.push({
      offset: t,
      transform: `scale(${s})`,
      opacity: String(Math.min(1, p / IRIS_FADE)),
    })
    inner.push({ offset: t, transform: `scale(${1 / s})` })
  }
  return { outer, inner }
}

// Everything the two layers need, in the coordinate space of `box` — the card's
// own full-screen box rather than the viewport. That is the part that makes this
// geometry-independent: `position: fixed; inset: 0` is the viewport only while no
// ancestor has established a containing block for it, and one transform, filter
// or backdrop-filter anywhere above the card is enough to make it something
// else. The frame element takes the same `inset: 0` the card used to, so whatever
// that resolves against, every offset below is measured inside it and the circle
// cannot arrive from off-screen.
function irisGeometry(x, y, box) {
  const ox = x - box.left
  const oy = y - box.top
  const r = Math.hypot(
    Math.max(ox, box.width - ox),
    Math.max(oy, box.height - oy),
  )
  return {
    circle: {
      left: `${ox - r}px`, top: `${oy - r}px`,
      width: `${2 * r}px`, height: `${2 * r}px`,
    },
    inner: {
      left: `${r - ox}px`, top: `${r - oy}px`,
      width: `${box.width}px`, height: `${box.height}px`,
      transformOrigin: `${ox}px ${oy}px`,
    },
  }
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
function snapshot(el) {
  const clone = el.cloneNode(true)
  clone.style.marginBottom = '0'
  clone.querySelectorAll('button, a, [tabindex], [role="button"]').forEach(node => {
    node.tabIndex = -1
  })
  return clone
}

// The three layers the reveal drives, or nothing at all in `fill`.
//
// `fill` is the web app's Radar tab, where the card is already the whole page and
// never expands, so there is no reveal to build for it — and the wrappers are not
// free there: WebApp.css spaces that layout with `.web-page > .card`, and three
// divs in between would quietly stop that matching and hand the card back its
// 12px margin. `fill` is fixed for the life of an instance (the two call sites
// are different mounts), so branching on it here costs no remount.
function IrisShell({ fill, className, frameRef, circleRef, innerRef, circleStyle, innerStyle, children }) {
  if (fill) return children
  return (
    <div ref={frameRef} className={className}>
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
export function WeatherRadar({ location, timezone, mode = 'split', fill = false, sky = '' }) {
  const combined = mode === 'combined'
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
  //   past  observed frames — MRMS where NOAA covers it, RainViewer otherwise
  //   cast  RainViewer's own nowcast, when the free API bothers to send one
  //   fut   HRRR forecast steps, continuing on from whatever the two above cover
  const [feed, setFeed] = useState({ past: [], cast: [], fut: [] })
  // Which side the toggle is on, in split mode. Unread in combined mode, where
  // there are no sides.
  const [view, setView] = useState('observed')
  const [idx, setIdx]             = useState(0)
  const [playing, setPlaying]     = useState(false)
  const [expanded, setExpanded]   = useState(false)
  const [mapReady, setMapReady]   = useState(false)

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
  // The tap, in viewport coordinates, held so the armed frame can convert it
  // against the card's measured box rather than an assumed one — see irisGeometry.
  const tapPoint = useRef(null)
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
  // Both halves are fetched whatever `mode` says — combined shows them at once,
  // and in split the toggle can ask for the other one at any point. Paying for
  // HRRR's one metadata request up front is what makes that switch instant
  // rather than a spinner.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { latitude: lat, longitude: lon } = location
      const wantMrms = inMrmsDomain(lat, lon)
      const wantHrrr = inHrrrDomain(lat, lon)

      // All three at once. They have no data dependency on each other — only the
      // trimming below does — and the slowest of them is what the card waits on, so
      // running them in sequence would have made that the sum instead of the max.
      const [rvRes, mrmsRes, hrrrRes] = await Promise.allSettled([
        fetch(FRAMES_URL).then(r => r.json()),
        wantMrms ? fetchMrmsFrames() : Promise.resolve([]),
        wantHrrr ? fetch(HRRR_META_URL).then(r => r.json()) : Promise.resolve(null),
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
        } catch {}
      }

      // Observed: MRMS when it answered, RainViewer when it didn't. The fallback is
      // per-fetch rather than per-location, so an MRMS outage inside the US degrades
      // to the feed this always used instead of to an empty card.
      const mrmsPast = mrmsRes.status === 'fulfilled' ? mrmsRes.value : []
      const past = mrmsPast.length > 0 ? mrmsPast : rvPast
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
      setFeed({ past, cast: rvCast, fut: futFrames })
    })()
    return () => { cancelled = true }
  }, [location.latitude, location.longitude])

  // Coming back to split from combined, start on observed rather than resuming
  // whichever side was last looked at — the timeline in between showed both, so
  // there is no side to resume.
  useEffect(() => { setView('observed') }, [mode])

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

  const hasFrames = frames.length > 0

  // Where to land whenever the timeline is rebuilt — a fresh fetch, or a flip of
  // the toggle: the last observed frame, the live one. The present is what a
  // radar is for, and in combined it sits mid-track with the forecast already
  // laid out to its right. On the forecast side there are no observed frames, so
  // pastCount is 0 and this lands on frame 0 — the earliest forecast step.
  useEffect(() => {
    setIdx(Math.min(Math.max(0, pastCount - 1), Math.max(0, frames.length - 1)))
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
        const opts = { opacity: 0, zIndex: 200, maxZoom: MAP_MAX_ZOOM, crossOrigin: true, className: 'radar-tiles' }
        // MRMS builds each tile's URL from its coords (see MrmsLayer) and takes no
        // template. Its cap is its own — see MRMS_NATIVE_MAX — because it is there
        // to bound how much rendering the request asks for, not because the server
        // would refuse the way RainViewer's does past RADAR_NATIVE_MAX.
        layer = frame.src === 'mrms'
          ? new MrmsLayer('', { ...opts, timeRange: frame.range, maxNativeZoom: MRMS_NATIVE_MAX })
          : L.tileLayer(frame.url, { ...opts, maxNativeZoom: RADAR_NATIVE_MAX })
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
    holdClone.current = el ? snapshot(el) : null
    history.pushState({ overlay: 'radar' }, '')
    if (!revealAnimates()) { setExpanded(true); return }
    // Keyboard activation reports 0,0 — grow from the middle of the screen then.
    const fromPointer = e && (e.clientX || e.clientY)
    tapPoint.current = {
      x: fromPointer ? e.clientX : window.innerWidth / 2,
      y: fromPointer ? e.clientY : window.innerHeight / 2,
    }
    // Provisional geometry, against the viewport, so the armed frame has
    // something laid out to render. It is remeasured against the card's real box
    // on that frame (see the arm effect) before anything moves.
    setRevealStyle(irisGeometry(tapPoint.current.x, tapPoint.current.y, {
      left: 0, top: 0, width: window.innerWidth, height: window.innerHeight,
    }))
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
      if (box && tapPoint.current) {
        setRevealStyle(irisGeometry(tapPoint.current.x, tapPoint.current.y, box))
      }
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

  // Runs the circle and its inverse as one pair of compositor animations.
  //
  // WAAPI rather than CSS classes because the inverse has to be computed: the
  // keyframes are generated (see irisKeyframes) and the easing is already baked
  // into their offsets, so both sides play linear and stay exact inverses. Both
  // are started in the same tick off the same generated grid, which is what keeps
  // them locked together — a CSS animation pair could drift by a frame at start.
  //
  // A layout effect, because a plain one runs after the paint it was scheduled by
  // and the animation's first keyframe is the only thing holding the circle shut.
  // The render that sets 'in' would otherwise paint once with the circle at its
  // natural size — the finished full-screen radar — and the iris would then snap
  // back to a dot and grow out of it. The same frame in reverse on the way out.
  //
  // The settled state is the circle gone entirely: at rest the card is plain
  // position:fixed again, rather than a screen-sized round box with two
  // will-change layers pinned under it for as long as the radar is up.
  useLayoutEffect(() => {
    if (phase !== 'in' && phase !== 'out') return
    const circle = irisCircleRef.current
    const inner  = irisInnerRef.current
    const opening = phase === 'in'
    const duration = opening ? IRIS_IN_MS : IRIS_OUT_MS
    // Closing is torn down by the effect below, on its own clock — it has to
    // outlive the animation to unmount the card, so only the opening settles
    // itself here. Missing layers (reduced motion switched on mid-flight) fall
    // through to the same clock.
    if (!circle || !inner) {
      if (!opening) return
      const t = setTimeout(() => setPhase(null), duration)
      return () => clearTimeout(t)
    }
    const { outer: outerFrames, inner: innerFrames } = irisKeyframes(opening)
    const opts = { duration, easing: 'linear', fill: 'both' }
    const a = circle.animate(outerFrames, opts)
    const b = inner.animate(innerFrames, opts)
    if (opening) a.onfinish = () => setPhase(null)
    // Cancel rather than leave them filling: settled-open is the plain card, and
    // a forwards-filling scale(1) would keep both layers composited for nothing.
    return () => { a.cancel(); b.cancel() }
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

  // The legend tracks the tiles actually on screen. MRMS and HRRR are both NOAA
  // and both draw with the NWS reflectivity ramp; RainViewer keeps its own, and
  // the two can't be reconciled — its free tier ignores the colour-scheme
  // parameter in the tile URL — so instead of hiding the switch the legend blocks
  // ease between the two ramps. Read off the frame's source rather than its key,
  // so a feed can't change its key format and silently take the legend with it.
  const frameSrc     = frames[idx]?.src
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
    rv:   'RainViewer radar',
    hrrr: 'NOAA HRRR model',
  }
  const sourceLabel = idx >= pastCount
    ? `Forecast · ${frameSrc === 'hrrr' ? SOURCE_NAMES.hrrr : 'RainViewer nowcast'}`
    : `Observed · ${SOURCE_NAMES[frameSrc] ?? SOURCE_NAMES.rv}`

  // Whether the circle is a box at all. Only while it is moving: at rest — shut
  // in the stack, or settled open — the three wrappers are display:contents and
  // the card lays out exactly as it did before any of this existed.
  const irisOn = !!revealStyle && (phase === 'arm' || phase === 'in' || phase === 'out')
  // Arming paints the destination — full-screen card, resized map, whatever tiles
  // have landed — with nothing yet telling the circle to be small, so the class
  // holds it transparent for the duration. That is what makes the frame free to
  // wait on (see ARM_TILE_WAIT_MS): the screen it shows is the one the tap landed
  // on, and the iris still opens out of a shut window.
  const irisC = irisOn
    ? ` radar-iris--on${phase === 'arm' ? ' radar-iris--arm' : ''}`
    : ''

  return (
    <>
    {/* Holds the card's place in the stack while it is off being full-screen, so
        the page doesn't shorten under it. Outside the iris on purpose: the iris
        leaves the flow when it opens, and this is what stays behind in it. */}
    {expanded && hold && (
      <div className="radar-placeholder" style={hold} ref={attachSnapshot} aria-hidden="true" />
    )}
    {/* The reveal, in three parts (see irisGeometry and irisKeyframes):
          .radar-iris        the frame. Takes the same `inset: 0` the card used to,
                             so it lands on exactly the box the card will fill and
                             every offset inside is measured against that rather
                             than against an assumed viewport.
          .radar-iris-circle the window. Round, clipping, and the thing that scales.
          .radar-iris-inner  the counter-scale, so the map inside holds still.

        All three wrap the card permanently and are display:contents until the
        circle moves — putting them up only while animating would re-parent the
        card, remount its subtree and destroy the Leaflet instance inside it. */}
    <IrisShell
      fill={fill}
      className={`radar-iris${irisC}`}
      frameRef={irisFrameRef}
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
      className={`card radar-card${expanded ? ' radar-expanded' : ''}${fill ? ' radar-fill' : ''}`}
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
      </div>
    </div>
    </IrisShell>
    </>
  )
}
