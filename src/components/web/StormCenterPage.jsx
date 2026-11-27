import { useEffect, useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  BatteryCharging, Bookmark, BriefcaseMedical, Check, CloudRain, DoorClosed, Flashlight, Fuel,
  GlassWater, House, ShoppingCart, Map as MapIcon, Armchair, Backpack, Pill, Radio, RefreshCw, Sandwich, ShieldCheck, Shirt,
  Shovel, Snowflake, Sun, TriangleAlert, Waves, Wind, Zap,
} from 'lucide-react'
import { AlertModal } from '../WeatherAlerts'
import { AlertAreaMap } from '../AlertAreaMapLazy'
import { PrecipNowcast } from '../PrecipNowcast'
import { WeatherIcon } from '../WeatherIcon'
import { WeatherRadar } from '../WeatherRadarLazy'
import { HouseFilled, UpdatedText } from '../CurrentWeather'
import { SourceNote } from '../SourceNote'
import { resolveStyle } from '../../utils/alertStyle'
import { isSnowing } from '../../utils/conditions'
import {
  alertFacts, alertTier, analyzeStorm, HAZARDS, isStormAlert, stormTint,
} from '../../utils/stormCenter'
import { stormNote, STORM_KIND_NAME } from '../../utils/stormRisk'
import { preparedness } from '../../utils/preparedness'
import { getWeatherInfo, getWindDirection, liveWeatherCode, SNOW_CODES, toTemp } from '../../utils/weatherCodes'
import { formatPrecip, formatWind, unitSuffix, unitText } from '../../utils/units'
import { currentHourIndex, hourLabel } from './webData'
// The page's own styles come with it, so the phones get them when they open
// it (see stormCenterChunk.js) without loading the rest of the web layout.
import './StormCenter.css'

// The web Home tab while something is happening: the Storm Center. WebLayout
// shows it in place of TodayPage whenever something is happening (brandEvent
// in App.jsx), and the phones open it as a sheet (StormSheet). It carries what
// Home does (the place, save and home, the radar, the next hour) alongside the
// storm itself.
//
// A flat dark page, plain sentences first and numbers second, colour only
// where it means something (the alert in force, the risk levels):
//
//   ticker ─────── alerts and conditions, crawling (desktop only)
//   alert banner ─ the most urgent alert in force, if any
//   hero ───────── live tag and place, what is happening, the threat dial
//   facts ──────── now, wind, rain, and the alert's countdown
//   ┌─────────────────────────────┐ ┌───────────────┐
//   │ radar                       │ │ be prepared   │
//   │ 24-hour threat timeline     │ │ next 6 hours  │
//   │ what to expect (hazards)    │ │ next hour     │
//   │ alerts in effect            │ │               │
//   └─────────────────────────────┘ └───────────────┘

// Risk levels, Minimal to Extreme. Minimal is grey rather than green: nothing
// is happening, which isn't the same as good news worth colouring.
const LEVEL_COLORS = ['#8a8f98', '#9cc97a', '#e7c449', '#ec9346', '#ec5f56']

const HAZARD_META = {
  thunder: { name: 'Lightning', Icon: Zap },
  rain:    { name: 'Rain and flooding', Icon: CloudRain },
  wind:    { name: 'Wind', Icon: Wind },
  snow:    { name: 'Snow and ice', Icon: Snowflake },
}

const PREP_ICONS = {
  shelter: DoorClosed, alerts: Radio, charge: BatteryCharging, flashlight: Flashlight, firstaid: BriefcaseMedical,
  water: GlassWater, groceries: ShoppingCart, food: Sandwich, meds: Pill, outdoor: Armchair, route: Waves, gobag: Backpack, fuel: Fuel,
  shovel: Shovel, warm: Shirt, cool: Sun,
}

const TIER_NAME = ['Warning', 'Watch', 'Advisory', 'Statement']

// Re-renders every `ms`.
function useClock(ms) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}

// "45 min", "2h 10m", "1 day 3h".
function spanText(ms) {
  const mins = Math.max(0, Math.round(ms / 60000))
  if (mins < 60) return `${Math.max(1, mins)} min`
  const h = Math.floor(mins / 60)
  if (h < 24) return `${h}h ${String(mins % 60).padStart(2, '0')}m`
  const d = Math.floor(h / 24)
  return `${d} ${d === 1 ? 'day' : 'days'} ${h % 24}h`
}

// An alert's timestamp (a real ISO instant, unlike the forecast's) at the
// forecast location: "4:45 PM", or "Fri 4:45 PM" when it isn't today there.
function alertTime(iso, timezone) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(+d)) return null
  const tz = timezone ? { timeZone: timezone } : {}
  const day = (x) => x.toLocaleDateString('en-CA', tz)
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', ...tz })
  return day(d) === day(new Date()) ? time : `${d.toLocaleDateString('en-US', { weekday: 'short', ...tz })} ${time}`
}

function snowText(inches, units) {
  return units?.precip === 'mm' ? `${(inches * 2.54).toFixed(1)} cm` : `${inches.toFixed(1)} in`
}

// A ticking HH:MM:SS to `to` (ms since the epoch). Its own clock, so only this
// re-renders each second rather than the whole page.
function Countdown({ to }) {
  const now = useClock(1000)
  const ms = Math.max(0, to - now)
  const s = Math.floor(ms / 1000)
  const pad = (n) => String(n).padStart(2, '0')
  const h = Math.floor(s / 3600)
  const text = h >= 24
    ? `${Math.floor(h / 24)}d ${pad(h % 24)}h`
    : `${pad(h)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`
  return <span className="sc-countdown" role="timer" aria-label={spanText(ms)}>{text}</span>
}

// Five steps, filled up to the level.
function RiskMeter({ index }) {
  return (
    <span className="sc-meter" aria-hidden="true">
      {LEVEL_COLORS.map((_, i) => (
        <span key={i} style={i <= index ? { background: LEVEL_COLORS[index] } : undefined} />
      ))}
    </span>
  )
}

// ── Backdrop ─────────────────────────────────────────────────────────────────

// The page's flat background across the whole window: drawn into <body> so it
// covers the app's sky (and its weather canvas) and sits under the app itself.
// [data-storm] on <html> also repaints the tab bar's strip (StormCenter.css).
// On the phones (`inline`) the page is a sheet over the app (StormSheet), so
// the backdrop is drawn inside it rather than under the app.
function Backdrop({ tint, inline = false }) {
  useLayoutEffect(() => {
    const root = document.documentElement
    root.dataset.storm = ''
    root.style.setProperty('--sc-tint', tint)
    return () => {
      delete root.dataset.storm
      root.style.removeProperty('--sc-tint')
    }
  }, [tint])

  const backdrop = <div className="sc-backdrop" aria-hidden="true" />
  return inline ? backdrop : createPortal(backdrop, document.body)
}

// ── Ticker ───────────────────────────────────────────────────────────────────

// The headlines, crawling right to left: each alert with its end time, then the
// conditions. Desktop only; a phone has no width for it to read at. It stops
// under the pointer.
function Ticker({ storm, timezone, lines }) {
  const top = storm.leadAlert
  const tag = top && alertTier(top.properties) === 0 ? 'Warning' : storm.alerts.length ? 'Alerts' : 'Latest'
  const items = [
    ...storm.alerts.map((a) => {
      const end = a.properties.ends ?? a.properties.expires
      return {
        id: a.id,
        color: resolveStyle(a.properties).color,
        text: `${a.properties.event}${end ? ` until ${alertTime(end, timezone)}` : ''}`,
      }
    }),
    ...lines.filter(Boolean).map((text, i) => ({ id: `line-${i}`, text })),
  ]
  const run = (hidden) => (
    <div className="sc-ticker-run" aria-hidden={hidden || undefined}>
      {items.map((it) => (
        <span key={it.id} className="sc-ticker-item" style={it.color ? { '--item': it.color } : undefined}>
          {it.color && <TriangleAlert size={14} aria-hidden="true" />}
          {it.text}
        </span>
      ))}
    </div>
  )
  return (
    <div
      className="sc-ticker"
      style={{ '--dur': `${Math.max(30, items.length * 9)}s`, '--tag': top ? resolveStyle(top.properties).color : undefined }}
    >
      <span className="sc-ticker-tag">{tag}</span>
      <div className="sc-ticker-track" role="marquee" aria-label="Storm headlines">
        <div className="sc-ticker-belt">
          {run(false)}
          {run(true)}
        </div>
      </div>
    </div>
  )
}

// ── Alert banner ─────────────────────────────────────────────────────────────

function AlertBanner({ alert, others, timezone, clock, onRead }) {
  const p = alert.properties
  const color = resolveStyle(p).color
  const startIso = p.onset ?? p.effective
  const endIso = p.ends ?? p.expires
  const pending = startIso && +new Date(startIso) > clock
  const when = pending
    ? `Starts ${alertTime(startIso, timezone)}${endIso ? `, until ${alertTime(endIso, timezone)}` : ''}`
    : endIso ? `In effect until ${alertTime(endIso, timezone)}` : 'In effect now'
  return (
    <section className="sc-banner" style={{ '--alert': color }} aria-label="Alert in effect">
      <TriangleAlert size={22} className="sc-banner-icon" aria-hidden="true" />
      <div className="sc-banner-text">
        <h2 className="sc-banner-title">{p.event}</h2>
        <p className="sc-banner-when">
          {when}
          {p.senderName && <span className="sc-banner-from"> · {p.senderName}</span>}
        </p>
        {others.length > 0 && (
          <p className="sc-banner-also">Also in effect: {others.map((a) => a.properties.event).join(', ')}</p>
        )}
      </div>
      <button type="button" className="sc-banner-btn" onClick={() => onRead(alert.id)}>
        Read the alert
      </button>
    </section>
  )
}

// ── Hero ─────────────────────────────────────────────────────────────────────

// 270 degrees of tick marks, lit up to the score in each band's colour.
function ThreatDial({ score, level }) {
  const N = 45
  const CX = 130, R1 = 100, R2 = 118
  const lit = Math.round((Math.min(100, Math.max(0, score)) / 100) * N)
  const ticks = Array.from({ length: N }, (_, i) => {
    // From the lower left (225°) clockwise round to the lower right (-45°).
    const deg = 225 - (i / (N - 1)) * 270
    const rad = (deg * Math.PI) / 180
    const c = Math.cos(rad), s = Math.sin(rad)
    const band = Math.min(4, Math.floor((i / N) * 5))
    return {
      x1: CX + R1 * c, y1: CX - R1 * s, x2: CX + R2 * c, y2: CX - R2 * s,
      on: i < lit, color: LEVEL_COLORS[band],
    }
  })
  return (
    <div className="sc-dial" role="img" aria-label={`Threat level ${level.label}, ${Math.round(score)} out of 100`}>
      <svg viewBox="0 0 260 260" aria-hidden="true">
        {ticks.map((t, i) => (
          <line
            key={i}
            x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2}
            className={`sc-dial-tick${t.on ? ' is-on' : ''}`}
            style={t.on ? { stroke: t.color, '--d': `${i * 14}ms` } : undefined}
          />
        ))}
      </svg>
      <div className="sc-dial-read">
        <span className="sc-dial-score">{Math.round(score)}</span>
        <span className="sc-dial-level" style={{ color: LEVEL_COLORS[level.index] }}>{level.label}</span>
        <span className="sc-dial-cap">Threat level</span>
      </div>
    </div>
  )
}

// The place's own actions, which Home carries: home, save, and a refresh with
// the age of the reading beside it.
function PlaceActions({ saved, onSave, onRemove, isHome, onSetHome, onUnsetHome, lastUpdated, loading, onRefresh }) {
  return (
    <div className="sc-actions">
      <button
        type="button"
        className={`sc-action${isHome ? ' is-on' : ''}`}
        onClick={isHome ? onUnsetHome : onSetHome}
        aria-pressed={isHome}
        title={isHome ? 'This is your home location. Click to unset it.' : 'Make this your home location'}
      >
        {isHome ? <HouseFilled size={15} /> : <House size={15} aria-hidden="true" />}
        {isHome ? 'Home' : 'Set as home'}
      </button>
      <button
        type="button"
        className={`sc-action${saved ? ' is-on' : ''}`}
        onClick={saved ? onRemove : onSave}
        aria-pressed={saved}
        title={saved ? 'Remove from saved places' : 'Save this place'}
      >
        <Bookmark size={15} fill={saved ? 'currentColor' : 'none'} aria-hidden="true" />
        {saved ? 'Saved' : 'Save'}
      </button>
      <span className="sc-updated">
        <UpdatedText date={lastUpdated} />
        <button
          type="button"
          className={`sc-refresh${loading ? ' is-spinning' : ''}`}
          onClick={onRefresh}
          disabled={loading}
          aria-label="Refresh weather"
          title="Refresh"
        >
          <RefreshCw size={14} />
        </button>
      </span>
    </div>
  )
}

function Hero({ place, title, note, storm, actions }) {
  return (
    <header className="sc-hero">
      <div className="sc-hero-text">
        <p className="sc-kicker">
          <span className="sc-live"><span className="sc-live-dot" aria-hidden="true" />Live</span>
          <span className="sc-place">{place}</span>
        </p>
        <h1 className="sc-title">{title}</h1>
        <p className="sc-note">{note}</p>
        <PlaceActions {...actions} />
      </div>
      <ThreatDial score={storm.threat.score} level={storm.threat.level} />
    </header>
  )
}

function Facts({ storm, weather, info, unit, units, clock }) {
  const { current, timezone } = weather
  const top = storm.leadAlert
  const startIso = top && (top.properties.onset ?? top.properties.effective)
  const endIso = top && (top.properties.ends ?? top.properties.expires)
  const pending = startIso && +new Date(startIso) > clock
  const quiet = storm.calmIdx === 'quiet'
  const gust = current.wind_gusts_10m
  const wintry = (storm.now?.hazard.snow ?? 0) > 0 || SNOW_CODES.has(storm.now?.code)

  return (
    <dl className="sc-facts-row" aria-label="Conditions now">
      <div>
        <dt>Now</dt>
        <dd className="sc-fact-now">
          <span className="sc-fact-icon"><WeatherIcon id={info.icon} alt="" /></span>
          {toTemp(current.temperature_2m, unit)}°
        </dd>
        <dd className="sc-fact-sub">{info.label}</dd>
      </div>
      <div>
        <dt>Wind</dt>
        <dd>{formatWind(current.wind_speed_10m, units)}</dd>
        <dd className="sc-fact-sub">
          {gust != null ? `Gusts ${formatWind(gust, units)}` : ''}
          {current.wind_direction_10m != null && `${gust != null ? ', ' : ''}from ${getWindDirection(current.wind_direction_10m)}`}
        </dd>
      </div>
      <div>
        {/* The chance is of any precipitation, so in snow it is named as snow
            and followed by the snow total rather than the rain one. */}
        <dt>{wintry ? 'Snow chance' : 'Rain chance'}</dt>
        <dd>{storm.now?.pop != null ? `${Math.round(storm.now.pop)}%` : '-'}</dd>
        <dd className="sc-fact-sub">
          {wintry
            ? (storm.detail.snowTotal >= 0.1 ? `${snowText(storm.detail.snowTotal, units)} in the next day` : 'This hour')
            : storm.detail.rainToday >= 0.01 ? `${formatPrecip(storm.detail.rainToday, units)} expected today` : 'This hour'}
        </dd>
      </div>
      {endIso ? (
        <div className="sc-fact-clock" style={{ '--alert': resolveStyle(top.properties).color }}>
          <dt>{pending ? 'Alert begins in' : 'Alert ends in'}</dt>
          <dd><Countdown to={+new Date(pending ? startIso : endIso)} /></dd>
          <dd className="sc-fact-sub">
            {pending ? `Starts ${alertTime(startIso, timezone)}` : `Until ${alertTime(endIso, timezone)}`}
          </dd>
        </div>
      ) : (
        <div>
          <dt>Peak threat</dt>
          <dd>{quiet ? 'None' : storm.peakIdx === 0 ? 'Now' : hourLabel(storm.peak.time)}</dd>
          <dd className="sc-fact-sub">{quiet ? 'Nothing stormy ahead' : `${storm.peak.level.label} risk`}</dd>
        </div>
      )}
    </dl>
  )
}

// ── Sections ─────────────────────────────────────────────────────────────────

function Section({ id, title, aside, className = '', children }) {
  return (
    <section className={`sc-section${className ? ` ${className}` : ''}`} aria-labelledby={id}>
      <header className="sc-section-head">
        <h2 id={id}>{title}</h2>
        {aside != null && <span className="sc-section-aside">{aside}</span>}
      </header>
      {children}
    </section>
  )
}

function RadarSection({ location, weather, radarMode, radarSource, weatherAnimations, onOpenRadar, mobile }) {
  // No separate "Full radar" link: the map itself is the way in. On the web
  // it opens the Radar tab; on the phones it grows to full screen, as it does
  // on the forecast, and Back closes it.
  return (
    <Section id="sc-radar-title" title="Radar" className="sc-radar">
      <div className="sc-radar-frame">
        <WeatherRadar
          location={location}
          timezone={weather.timezone}
          mode={radarMode}
          source={radarSource}
          rainFx={weatherAnimations}
          snow={isSnowing(weather.current)}
          onOpen={mobile ? null : onOpenRadar}
        />
      </div>
    </Section>
  )
}

// A smooth line through the points (Catmull-Rom as cubic Béziers).
function smoothPath(pts) {
  if (pts.length < 2) return ''
  let d = `M ${pts[0][0]} ${pts[0][1]}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]
    d += ` C ${c1[0].toFixed(1)} ${c1[1].toFixed(1)}, ${c2[0].toFixed(1)} ${c2[1].toFixed(1)}, ${p2[0]} ${p2[1]}`
  }
  return d
}

// The next 24 hours of storm risk: a curve with the peak marked, a strip of
// each hour's level under it, and right now, the peak and when it calms down.
function Timeline({ storm }) {
  const { hours, peak, peakIdx, calmIdx, now } = storm
  if (hours.length < 2) return null
  const W = 1000, H = 200
  const quiet = calmIdx === 'quiet'
  const x = (k) => (k / (hours.length - 1)) * W
  const y = (s) => H - Math.max(2, Math.min(100, s)) * (H / 100) * 0.92
  const pts = hours.map((h, k) => [+x(k).toFixed(1), +y(h.score).toFixed(1)])
  const line = smoothPath(pts)
  const area = `${line} L ${W} ${H} L 0 ${H} Z`
  const kindName = (k) => (k ? STORM_KIND_NAME[k].toLowerCase() : 'calm')

  const calmText = quiet ? 'All day'
    : calmIdx == null ? 'Not in the next day'
    : calmIdx === 0 ? 'Now'
    : hourLabel(hours[calmIdx].time)

  return (
    <Section id="sc-timeline" title="24-hour threat timeline" aside="Storm risk by hour">
      <div className="sc-chart">
        <div className="sc-chart-plot">
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <linearGradient id="sc-area" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" style={{ stopColor: 'var(--sc-tint)', stopOpacity: 0.4 }} />
                <stop offset="100%" style={{ stopColor: 'var(--sc-tint)', stopOpacity: 0 }} />
              </linearGradient>
            </defs>
            {[20, 40, 60, 80].map((s) => (
              <line key={s} className="sc-chart-band" x1="0" x2={W} y1={y(s)} y2={y(s)} vectorEffect="non-scaling-stroke" />
            ))}
            <path d={area} fill="url(#sc-area)" />
            <path className="sc-chart-line" d={line} vectorEffect="non-scaling-stroke" />
          </svg>
          <span className="sc-chart-now" aria-hidden="true">Now</span>
          {!quiet && (
            <span
              // Near either end, the tag hangs inward from the dot instead of
              // centred on it, so it stays on the page.
              className={`sc-chart-peak${peakIdx <= 3 ? ' is-start' : peakIdx >= hours.length - 4 ? ' is-end' : ''}`}
              style={{ left: `${(x(peakIdx) / W) * 100}%`, top: `${(y(peak.score) / H) * 100}%`, '--lvl': LEVEL_COLORS[peak.level.index] }}
              aria-hidden="true"
            >
              <span className="sc-chart-peak-tag">Peak {peakIdx === 0 ? 'now' : hourLabel(peak.time)}</span>
            </span>
          )}
        </div>
        <ol className="sc-heat" aria-label="Storm risk for each of the next 24 hours">
          {hours.map((h, k) => (
            <li
              key={h.time}
              style={{ background: LEVEL_COLORS[h.level.index], opacity: h.level.index === 0 ? 0.3 : 1 }}
              title={`${k === 0 ? 'Now' : hourLabel(h.time)}: ${h.level.label}${h.kind ? `, ${kindName(h.kind)}` : ''}`}
              aria-label={`${k === 0 ? 'Now' : hourLabel(h.time)}: ${h.level.label}`}
            />
          ))}
        </ol>
        <div className="sc-hours" aria-hidden="true">
          {hours.map((h, k) => (
            <span key={h.time}>{k % 6 === 0 ? (k === 0 ? 'Now' : hourLabel(h.time)) : ''}</span>
          ))}
        </div>
      </div>

      <dl className="sc-stats">
        <div>
          <dt>Right now</dt>
          <dd style={{ color: LEVEL_COLORS[now.level.index] }}>{now.level.label}</dd>
          <dd className="sc-stats-sub">{now.kind ? STORM_KIND_NAME[now.kind] : 'Calm'}</dd>
        </div>
        <div>
          <dt>Peak</dt>
          <dd style={quiet ? undefined : { color: LEVEL_COLORS[peak.level.index] }}>{quiet ? 'None' : peak.level.label}</dd>
          <dd className="sc-stats-sub">
            {quiet ? 'Nothing stormy ahead' : `${peakIdx === 0 ? 'Now' : hourLabel(peak.time)}, ${kindName(peak.kind)}`}
          </dd>
        </div>
        <div>
          <dt>Calm by</dt>
          <dd>{calmText}</dd>
          <dd className="sc-stats-sub">{quiet ? 'Minimal risk' : 'Risk back to Minimal'}</dd>
        </div>
      </dl>
    </Section>
  )
}

// What the day's snow amounts to here, by its level against what this place
// is used to (snowTolerance in stormCenter.js).
const SNOW_IMPACT = [
  'barely enough to notice here',
  'light for this area',
  'enough to slow travel here',
  'heavy for this area',
  'extreme for this area',
]

function hazardDetail(id, storm, units) {
  const { detail, hours } = storm
  const at = (k) => (k <= 0 ? 'now' : `around ${hourLabel(hours[k].time)}`)
  switch (id) {
    case 'thunder':
      if (detail.thunderAt >= 0) return `Thunder is in the forecast ${at(detail.thunderAt)}.`
      if (detail.capeMax >= 300) return 'The air is unstable enough for storms to form.'
      return 'No thunder expected.'
    case 'rain':
      if (detail.rainToday >= 0.01) return `${formatPrecip(detail.rainToday, units)} of rain expected today.`
      if (detail.popMax >= 10) return `Up to a ${Math.round(detail.popMax)}% chance of rain.`
      return 'Staying dry.'
    case 'wind':
      if (detail.gustMax >= 20) return `Gusts up to ${formatWind(detail.gustMax, units)} ${at(detail.gustAt)}.`
      return 'Light winds.'
    default:
      if (detail.snowTotal >= 0.1) {
        return `${snowText(detail.snowTotal, units)} of snow in the next 24 hours, ${SNOW_IMPACT[detail.snowDay.index]}.`
      }
      if (detail.freezing) return 'An icy mix is possible.'
      return 'No snow or ice expected.'
  }
}

function Hazards({ storm, units }) {
  return (
    <Section id="sc-hazards" title="What to expect" aside="Next 12 hours">
      <ul className="sc-hazards">
        {HAZARDS.map((id) => {
          const h = storm.hazards[id]
          const { name, Icon } = HAZARD_META[id]
          return (
            <li key={id} className="sc-hazard">
              <Icon size={20} className="sc-hazard-icon" aria-hidden="true" />
              <div className="sc-hazard-text">
                <span className="sc-hazard-name">{name}</span>
                <span className="sc-hazard-detail">{hazardDetail(id, storm, units)}</span>
                {h.alert && (
                  <span className="sc-hazard-alert">
                    <span style={{ color: resolveStyle(h.alert.properties).color }}>{h.alert.properties.event}</span>
                    {/* A zone alert covers a county or more; the level above
                        is this spot's own (see alertFloor). */}
                    {h.alertZone && <span className="sc-hazard-scope"> for the wider area</span>}
                  </span>
                )}
              </div>
              <div className="sc-hazard-level">
                <span style={{ color: h.level.index > 0 ? LEVEL_COLORS[h.level.index] : undefined }}>{h.level.label}</span>
                <RiskMeter index={h.level.index} />
              </div>
            </li>
          )
        })}
      </ul>
    </Section>
  )
}

// ── Be prepared ──────────────────────────────────────────────────────────────

// Ticked items are kept on the device, so the list remembers what you already
// have. Shared across places: a flashlight is a flashlight.
const PREP_KEY = 'alek-weather-prep-done'

function usePrepDone() {
  const [done, setDone] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(PREP_KEY) ?? '[]')) } catch { return new Set() }
  })
  const toggle = (id) => {
    setDone((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      try { localStorage.setItem(PREP_KEY, JSON.stringify([...next])) } catch { /* storage off */ }
      return next
    })
  }
  return [done, toggle]
}

function Prepare({ storm, current }) {
  const { level, items } = preparedness(storm, current.temperature_2m)
  const [done, toggle] = usePrepDone()
  const ready = items.filter((i) => done.has(i.id)).length
  const pct = items.length ? Math.round((ready / items.length) * 100) : 0
  return (
    <Section id="sc-prep" title="Be prepared" aside={`${ready} of ${items.length} ready`}>
      <div className={`sc-prep-status sc-prep-status--${level.id}`}>
        <div className="sc-prep-status-top">
          <span className="sc-prep-level">{level.label}</span>
          <span className="sc-prep-pct">{pct}%</span>
        </div>
        <div className="sc-prep-bar" aria-hidden="true"><span style={{ width: `${pct}%` }} /></div>
        <p className="sc-prep-text">{level.text}</p>
      </div>
      <ul className="sc-prep-list">
        {items.map((item) => {
          const Icon = PREP_ICONS[item.id]
          const on = done.has(item.id)
          return (
            <li key={item.id}>
              <button
                type="button"
                className={`sc-prep-item${on ? ' is-done' : ''}`}
                onClick={() => toggle(item.id)}
                aria-pressed={on}
              >
                <span className="sc-prep-icon" aria-hidden="true"><Icon size={20} /></span>
                <span className="sc-prep-words">
                  <span className="sc-prep-label">{item.label}</span>
                  <span className="sc-prep-why">{item.why}</span>
                </span>
                <span className="sc-prep-check" aria-hidden="true">{on && <Check size={14} strokeWidth={3} />}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </Section>
  )
}

function Alerts({ storm, timezone, clock, onRead, onMap }) {
  const { alerts } = storm
  return (
    <Section id="sc-alerts" title="Alerts in effect" aside="National Weather Service">
      {alerts.length === 0 ? (
        <p className="sc-empty">
          <ShieldCheck size={18} aria-hidden="true" />
          No watches, warnings or advisories are in effect here.
        </p>
      ) : (
        <div className="sc-alert-list">
          {alerts.map((a) => {
            const p = a.properties
            const tier = alertTier(p)
            const facts = alertFacts(p.description)
            const startIso = p.onset ?? p.effective ?? p.sent
            const endIso = p.ends ?? p.expires
            const start = startIso ? +new Date(startIso) : null
            const end = endIso ? +new Date(endIso) : null
            const pending = start != null && start > clock
            const areas = (p.areaDesc ?? '').split(';').map((s) => s.trim()).filter(Boolean)
            return (
              <article key={a.id} className="sc-alert" style={{ '--alert': resolveStyle(p).color }}>
                <header className="sc-alert-head">
                  <h3>{p.event}</h3>
                  <span className="sc-alert-tier">{TIER_NAME[tier]}</span>
                </header>
                <p className="sc-alert-when">
                  {pending ? `Starts ${alertTime(startIso, timezone)}` : 'In effect now'}
                  {endIso && `, until ${alertTime(endIso, timezone)}`}
                  {end != null && end > clock && (
                    <span className="sc-alert-left">
                      <Countdown to={pending ? start : end} /> {pending ? 'to go' : 'left'}
                    </span>
                  )}
                </p>
                {areas.length > 0 && (
                  <p className="sc-alert-area">
                    {areas.slice(0, 4).join(', ')}{areas.length > 4 ? ` and ${areas.length - 4} more` : ''}
                  </p>
                )}
                {facts.length > 0 ? (
                  <dl className="sc-alert-facts">
                    {facts.map((f) => (
                      <div key={f.label}>
                        <dt>{f.label}</dt>
                        <dd>{f.text}</dd>
                      </div>
                    ))}
                  </dl>
                ) : p.headline && <p className="sc-alert-headline">{p.headline}</p>}
                <div className="sc-alert-actions">
                  <button type="button" className="sc-btn" onClick={() => onRead(a.id)}>Read full alert</button>
                  <button type="button" className="sc-btn" onClick={() => onMap(a.id)}>
                    <MapIcon size={15} aria-hidden="true" />
                    Affected area
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </Section>
  )
}

// The next six hours as rows of numbers: when it's worst, and whether a given
// hour is one to be out in.
const HOUR_ROWS = 6

function HourByHour({ storm, weather, start, unit, units }) {
  const { hourly, current } = weather
  const rows = storm.hours.slice(0, HOUR_ROWS)
  if (!rows.length) return null
  const worst = rows.reduce((best, h, k) => (h.score > rows[best].score ? k : best), 0)
  const showWorst = rows[worst].level.index > 0
  const windSuffix = unitSuffix('wind', units)

  return (
    <Section
      id="sc-hbh"
      title="Next 6 hours"
      aside={showWorst ? `Worst ${worst === 0 ? 'now' : `at ${hourLabel(rows[worst].time)}`}` : null}
    >
      <table className="sc-hbh">
        <thead>
          <tr>
            <th scope="col">Time</th>
            <th scope="col" aria-label="Conditions" />
            <th scope="col">Rain</th>
            <th scope="col">Gusts</th>
            <th scope="col">Temp</th>
            <th scope="col">Risk</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((h, k) => {
            const i = start + k
            const info = getWeatherInfo(h.code, hourly.is_day?.[i] === 0)
            const temp = k === 0 ? current.temperature_2m : hourly.temperature_2m?.[i]
            // 40 mph is gusty enough to notice, 58 is severe-thunderstorm strength.
            const gustTone = h.gust >= 58 ? ' is-severe' : h.gust >= 40 ? ' is-strong' : ''
            return (
              <tr key={h.time} className={k === worst && showWorst ? 'is-worst' : undefined}>
                <th scope="row">{k === 0 ? 'Now' : hourLabel(h.time)}</th>
                <td className="sc-hbh-icon" title={info.label}><WeatherIcon id={info.icon} alt={info.label} /></td>
                <td>{h.pop != null ? `${Math.round(h.pop)}%` : '-'}</td>
                <td className={`sc-hbh-gust${gustTone}`}>
                  {h.gust != null ? <>{unitText('wind', h.gust, units)}<small> {windSuffix}</small></> : '-'}
                </td>
                <td>{Number.isFinite(temp) ? `${toTemp(temp, unit)}°` : '-'}</td>
                <td style={h.level.index > 0 ? { color: LEVEL_COLORS[h.level.index] } : undefined}>{h.level.label}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </Section>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function StormCenterPage({
  stormKind, stormLabel, active = true, weather, location, alerts, unit, units, radarClear, radarTrend,
  nowcastMode, radarMode, radarSource, weatherAnimations, lastUpdated, loading, onRefresh, onNavigate,
  saved, onSave, onRemove, isHome, onSetHome, onUnsetHome, mobile = false,
}) {
  const clock = useClock(30000)
  const [reading, setReading] = useState(null)
  const [mapped, setMapped] = useState(null)
  const { current, hourly, timezone } = weather
  const event = stormKind ? { kind: stormKind, label: stormLabel } : null
  const liveCode = liveWeatherCode(current, weather.minutely_15, radarClear)
  const start = currentHourIndex(hourly, timezone)
  const storm = analyzeStorm({ weather, alerts, liveCode, start })
  const tint = stormTint(storm.alerts.find(isStormAlert), event?.kind)
  const onOpenRadar = () => onNavigate('radar')
  const info = getWeatherInfo(liveCode ?? current.weather_code, !current.is_day, current.severe_storm)
  const place = [location.name, location.admin1 && location.admin1 !== location.name ? location.admin1 : null]
    .filter(Boolean).join(', ')

  // A warning names the page; otherwise the weather happening now does.
  const top = storm.leadAlert
  const title = event?.label ?? top?.properties?.event ?? 'All clear for now'
  const quiet = storm.calmIdx === 'quiet'
  const note = event || storm.threat.level.index > 0
    ? stormNote(storm.now, storm.peak, storm.peak ? hourLabel(storm.peak.time) : '')
    : 'Nothing stormy is happening here right now.'

  const tickerLines = [
    `${place}: ${info.label}, ${toTemp(current.temperature_2m, unit)}°`,
    current.wind_gusts_10m != null && `Gusts ${formatWind(current.wind_gusts_10m, units)}`,
    note,
    !quiet && storm.peak && `Peak threat ${storm.peak.level.label.toLowerCase()} ${storm.peakIdx === 0 ? 'now' : `around ${hourLabel(storm.peak.time)}`}`,
    storm.detail.rainToday >= 0.01 && `${formatPrecip(storm.detail.rainToday, units)} of rain expected today`,
  ]

  const readingAlert = storm.alerts.find((a) => a.id === reading)
  const mappedAlert = storm.alerts.find((a) => a.id === mapped)
  const portal = () => document.getElementById('alert-portal-root') ?? document.body

  return (
    <>
      {active && <Backdrop tint={tint} inline={mobile} />}
      <div className={mobile ? 'sc sc--mobile' : 'web-page sc'} style={{ '--sc-tint': tint }}>
        {!mobile && <Ticker storm={storm} timezone={timezone} lines={tickerLines} />}
        {top && (
          <AlertBanner
            alert={top}
            others={storm.alerts.filter((a) => a !== top)}
            timezone={timezone}
            clock={clock}
            onRead={setReading}
          />
        )}

        <Hero
          place={place}
          title={title}
          note={note}
          storm={storm}
          actions={{ saved, onSave, onRemove, isHome, onSetHome, onUnsetHome, lastUpdated, loading, onRefresh }}
        />

        <Facts storm={storm} weather={weather} info={info} unit={unit} units={units} clock={clock} />

        <div className="sc-layout">
          <div className="sc-col">
            <RadarSection
              location={location}
              weather={weather}
              radarMode={radarMode}
              radarSource={radarSource}
              weatherAnimations={weatherAnimations}
              onOpenRadar={onOpenRadar}
              mobile={mobile}
            />
            <Timeline storm={storm} />
            <Hazards storm={storm} units={units} />
            <Alerts storm={storm} timezone={timezone} clock={clock} onRead={setReading} onMap={setMapped} />
          </div>
          <div className="sc-col">
            <Prepare storm={storm} current={current} />
            <HourByHour storm={storm} weather={weather} start={start} unit={unit} units={units} />
            {nowcastMode !== 'off' && (
              <div className="sc-section sc-nowcast">
                <PrecipNowcast
                  minutely={weather.minutely_15}
                  currentTime={current.time}
                  mode="always"
                  current={current}
                  radarClear={radarClear}
                  radarTrend={radarTrend}
                  wide
                />
              </div>
            )}
          </div>
        </div>

        <footer className="sc-foot">
          <p>
            Alerts come from the National Weather Service. Threat levels are Alek Weather&apos;s own reading of the
            forecast and the alerts in effect. Always follow official guidance.
          </p>
          <SourceNote current={current} minutely={weather.minutely_15} radarClear={radarClear} />
        </footer>
      </div>

      {readingAlert && createPortal(
        <AlertModal alert={readingAlert} location={location} onClose={() => setReading(null)} />,
        portal(),
      )}
      {mappedAlert && createPortal(
        <AlertAreaMap key={mappedAlert.id} alert={mappedAlert} location={location} onClose={() => setMapped(null)} />,
        portal(),
      )}
    </>
  )
}
