import { useEffect, useRef, useState } from 'react'
import {
  ArrowRight, Bookmark, ChevronLeft, ChevronRight, CloudRain, Droplets, Eye, House, Leaf,
  RefreshCw, Sun, Sunrise, Sunset, Wind,
} from 'lucide-react'
import { HouseFilled, UpdatedText } from '../CurrentWeather'
import { TodayCard } from '../TodayCard'
import { WeatherOverview } from '../WeatherOverview'
import { PrecipNowcast } from '../PrecipNowcast'
import { WeatherAlerts } from '../WeatherAlerts'
import { WeatherIcon } from '../WeatherIcon'
import { SourceNote } from '../SourceNote'
import { WeatherRadar } from '../WeatherRadarLazy'
import { isSnowing } from '../../utils/conditions'
import {
  getUVLabel, getWeatherInfo, getWindDirection, liveWeatherCode, nowcastHourlyCode,
  SUN_ORANGE, tempInk, tempStyle, toTemp,
} from '../../utils/weatherCodes'
import { getAQIInfo, getHumidityInfo, getPrecipInfo, getVisibilityInfo, getWindInfo } from '../../utils/conditions'
import { formatPrecip, formatVisibility, formatWind, unitSuffix, unitText } from '../../utils/units'
import { formatMinutes, isoMinutes } from '../../utils/sunTimes'
import {
  currentHourIndex, daylightLength, hourLabel, localNow, METERS_PER_MILE, naiveMinutes, weekdayLabel,
} from './webData'

// The web Today page.
//
//   ┌──────────────────────────────┐ ┌──────────────┐
//   │ Now: place, reading, stats   │ │ At a glance  │
//   ├──────────────────────────────┤ │ (TodayCard)  │
//   │ Next-hour precipitation*     │ ├──────────────┤
//   ├──────────────────────────────┤ │ Insight      │
//   │ Next 24 hours                │ │ (Overview)   │
//   ├──────────────────────────────┤ ├──────────────┤
//   │ Next 7 days                  │ │ Radar → tab  │
//   └──────────────────────────────┘ └──────────────┘
//                                       * only when rain is near
//
// The sidebar holds the phone's own At a glance and Weather insight cards, so
// the web page carries everything the phone stack does (hazards, the activity
// reasons, the Today/Tomorrow pager, clothing) without a second copy of that
// logic. It is about a phone's width, which is what those cards are drawn for.
// Below 1100px the two columns fold into one, in reading order (see WebApp.css).
//
// The forecast's timestamps are naive local wall-clock strings ("2026-11-26T14:00"
// at the forecast location). They're read as text here, never through new Date(),
// which would put them in the browser's time zone and shift every label for a
// city in another zone.

const HOURS = 24
// Shared with the phone's hourly card, so the reading picked on one is the one
// shown on the other.
const METRIC_KEY = 'alek-weather-hourly-metric'

const METRICS = [
  { id: 'temp',     label: 'Temp',     key: 'temperature_2m',            now: 'temperature_2m' },
  { id: 'feels',    label: 'Feels',    key: 'apparent_temperature',      now: 'apparent_temperature' },
  { id: 'precip',   label: 'Precip',   key: 'precipitation_probability' },
  { id: 'wind',     label: 'Wind',     key: 'wind_speed_10m',            now: 'wind_speed_10m' },
  { id: 'humidity', label: 'Humidity', key: 'relative_humidity_2m',      now: 'relative_humidity_2m' },
  { id: 'uv',       label: 'UV',       key: 'uv_index',                  now: 'uv_index' },
]

function metricName(id, unit, units) {
  switch (id) {
    case 'temp':     return `Temperature (°${unit})`
    case 'feels':    return `Feels like (°${unit})`
    case 'precip':   return 'Chance of precipitation (%)'
    case 'wind':     return `Wind (${unitSuffix('wind', units)})`
    case 'humidity': return 'Humidity (%)'
    default:         return 'UV index'
  }
}

// "45 min", "1 hour", "2½ hours".
function untilText(mins) {
  if (mins < 53) return `${Math.max(1, Math.round(mins))} min`
  const quarters = Math.round(mins / 15)
  const whole = Math.floor(quarters / 4)
  const frac = ['', '¼', '½', '¾'][quarters % 4]
  return `${whole}${frac} ${quarters === 4 ? 'hour' : 'hours'}`
}

// Every sunrise and sunset in the forecast, in order.
function sunEvents(daily) {
  const out = []
  daily.time.forEach((_, d) => {
    if (daily.sunrise?.[d]) out.push({ kind: 'rise', iso: daily.sunrise[d] })
    if (daily.sunset?.[d]) out.push({ kind: 'set', iso: daily.sunset[d] })
  })
  return out
}

const reducedMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// Whether a horizontal scroller has more to show on either side.
function useScrollEdges(ref) {
  const [edges, setEdges] = useState({ start: true, end: true })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => {
      const start = el.scrollLeft <= 2
      const end = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2
      setEdges((e) => (e.start === start && e.end === end ? e : { start, end }))
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    // Also catches the panel coming back from display: none on a tab switch.
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => { el.removeEventListener('scroll', update); ro.disconnect() }
  }, [ref])
  return edges
}

// ── Now ──────────────────────────────────────────────────────────────────────

function Stat({ icon: Icon, label, value, sub, color }) {
  return (
    <div className="wt-stat">
      <div className="wt-stat-label">
        <Icon size={14} aria-hidden="true" style={color ? { color } : undefined} />
        {label}
      </div>
      <div className="wt-stat-value" style={color ? { color } : undefined}>{value}</div>
      {sub && <div className="wt-stat-sub" title={typeof sub === 'string' ? sub : undefined}>{sub}</div>}
    </div>
  )
}

function NowCard({
  weather, location, unit, units, radarClear, airQuality, colorCoding, nowIso, nextSun,
  lastUpdated, loading, onRefresh, saved, onSave, onRemove, isHome, onSetHome, onUnsetHome,
}) {
  const { current, daily, timezone } = weather
  const info = getWeatherInfo(liveWeatherCode(current, weather.minutely_15, radarClear), !current.is_day, current.severe_storm)
  const place = [location.name, location.admin1 && location.admin1 !== location.name ? location.admin1 : null]
    .filter(Boolean).join(', ')
  const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: timezone })

  const hi = daily.temperature_2m_max?.[0]
  const lo = daily.temperature_2m_min?.[0]
  const cc = colorCoding.details
  const tint = (c) => (cc ? c : undefined)
  const dayTemp = (f) => (
    <b style={tempStyle(f, colorCoding.current, 0.3, colorCoding.glow, colorCoding.frost)}>{toTemp(f, unit)}°</b>
  )

  // The readings worth knowing before you step out. Everything else lives on
  // the Details page.
  const rain = daily.precipitation_probability_max?.[0]
  const rainSum = daily.precipitation_sum?.[0]
  const wind = current.wind_speed_10m
  const gust = current.wind_gusts_10m
  const uv = getUVLabel(current.uv_index ?? 0)
  const aqi = airQuality?.us_aqi
  const visMi = current.visibility != null ? current.visibility / METERS_PER_MILE : null
  const daylight = daily.sunrise?.[0] && daily.sunset?.[0] ? daylightLength(daily.sunrise[0], daily.sunset[0]) : null

  return (
    <section className="card wt-now" aria-label="Current conditions">
      <header className="wt-now-head">
        <div className="wt-now-where">
          <h1 className="wt-place">{place}</h1>
          <p className="wt-meta">
            <span>{dateStr}</span>
            <span className="wt-meta-dot" aria-hidden="true">·</span>
            <UpdatedText date={lastUpdated} />
            <button
              type="button"
              className={`wt-icon-btn wt-refresh${loading ? ' is-spinning' : ''}`}
              onClick={onRefresh}
              disabled={loading}
              aria-label="Refresh weather"
              title="Refresh"
            >
              <RefreshCw size={13} />
            </button>
          </p>
        </div>
        <div className="wt-actions">
          <button
            type="button"
            className={`wt-action${isHome ? ' is-on' : ''}`}
            onClick={isHome ? onUnsetHome : onSetHome}
            aria-pressed={isHome}
            title={isHome ? 'This is your home location. Click to unset it.' : 'Make this your home location'}
          >
            {isHome ? <HouseFilled size={15} /> : <House size={15} />}
            <span>{isHome ? 'Home' : 'Set as home'}</span>
          </button>
          <button
            type="button"
            className={`wt-action${saved ? ' is-on' : ''}`}
            onClick={saved ? onRemove : onSave}
            aria-pressed={saved}
            title={saved ? 'Remove from saved places' : 'Save this place'}
          >
            <Bookmark size={15} fill={saved ? 'currentColor' : 'none'} />
            <span>{saved ? 'Saved' : 'Save'}</span>
          </button>
        </div>
      </header>

      <div className="wt-reading">
        <span className="wt-reading-icon"><WeatherIcon id={info.icon} alt={info.label} /></span>
        <span
          className="wt-reading-temp"
          style={tempStyle(current.temperature_2m, colorCoding.current, 1, colorCoding.glow, colorCoding.frost)}
        >
          {toTemp(current.temperature_2m, unit)}<span className="wt-reading-unit">°{unit}</span>
        </span>
        <div className="wt-reading-text">
          <div className="wt-reading-cond">{info.label}</div>
          <div className="wt-reading-sub">
            <span>Feels like {dayTemp(current.apparent_temperature)}</span>
            {hi != null && lo != null && (
              <span>High {dayTemp(hi)} <span className="wt-sep">/</span> Low {dayTemp(lo)}</span>
            )}
          </div>
        </div>
      </div>

      <div className="wt-stats">
        <Stat
          icon={CloudRain}
          label="Precipitation"
          value={rain != null ? `${rain}%` : '-'}
          sub={rainSum >= 0.01 ? `${formatPrecip(rainSum, units)} expected` : 'Chance today'}
          color={tint(rain != null ? getPrecipInfo(rain).color : null)}
        />
        <Stat
          icon={Wind}
          label="Wind"
          value={formatWind(wind, units)}
          sub={[
            current.wind_direction_10m != null && `From ${getWindDirection(current.wind_direction_10m)}`,
            gust != null && `gusts ${formatWind(gust, units)}`,
          ].filter(Boolean).join(', ') || null}
          color={tint(wind != null ? getWindInfo(wind).color : null)}
        />
        <Stat
          icon={Droplets}
          label="Humidity"
          value={current.relative_humidity_2m != null ? `${Math.round(current.relative_humidity_2m)}%` : '-'}
          sub={current.dew_point_2m != null ? `Dew point ${toTemp(current.dew_point_2m, unit)}°` : null}
          color={tint(current.relative_humidity_2m != null ? getHumidityInfo(current.relative_humidity_2m).color : null)}
        />
        <Stat icon={Sun} label="UV index" value={Math.round(current.uv_index ?? 0)} sub={uv.label} color={tint(uv.color)} />
        {aqi != null ? (
          <Stat icon={Leaf} label="Air quality" value={Math.round(aqi)} sub={getAQIInfo(aqi).label} color={tint(getAQIInfo(aqi).color)} />
        ) : (
          <Stat
            icon={Eye}
            label="Visibility"
            value={formatVisibility(current.visibility, units)}
            sub={visMi != null ? getVisibilityInfo(visMi).label : null}
            color={tint(visMi != null ? getVisibilityInfo(visMi).color : null)}
          />
        )}
        {nextSun ? (
          <Stat
            icon={nextSun.kind === 'rise' ? Sunrise : Sunset}
            label={nextSun.kind === 'rise' ? 'Sunrise' : 'Sunset'}
            value={formatMinutes(isoMinutes(nextSun.iso))}
            sub={`in ${untilText(naiveMinutes(nextSun.iso) - naiveMinutes(nowIso))}`}
            color={tint(SUN_ORANGE)}
          />
        ) : (
          <Stat icon={Sun} label="Daylight" value={daylight ?? '-'} sub="Today" color={tint(SUN_ORANGE)} />
        )}
      </div>
    </section>
  )
}

// ── Next 24 hours ────────────────────────────────────────────────────────────

function HoursCard({ weather, unit, units, radarClear, colorCoding, nowIso, events }) {
  const { hourly, daily, current, timezone } = weather
  const minutely = weather.minutely_15
  const scrollRef = useRef(null)
  const edges = useScrollEdges(scrollRef)

  const [picked, setPicked] = useState(() => {
    try { return localStorage.getItem(METRIC_KEY) ?? 'temp' } catch { return 'temp' }
  })
  const pick = (id) => {
    setPicked(id)
    try { localStorage.setItem(METRIC_KEY, id) } catch { /* kept for this visit only */ }
  }

  const start = currentHourIndex(hourly, timezone)
  const count = Math.max(0, Math.min(HOURS, hourly.time.length - start))
  const available = METRICS.filter((m) => m.id === 'temp'
    || hourly[m.key]?.slice(start, start + count).some(Number.isFinite))
  const metric = available.find((m) => m.id === picked) ?? available[0]

  // The hour tiles, with the sunrises and sunsets that fall among them slotted
  // in after their hour. An event earlier in the current hour has already
  // happened, so it's left out.
  const items = []
  for (let k = 0; k < count; k++) {
    const i = start + k
    const time = hourly.time[i]
    items.push({ kind: 'hour', i, k, time })
    const prefix = time.slice(0, 13)
    for (const ev of events) {
      if (ev.iso.slice(0, 13) === prefix && (k > 0 || ev.iso > nowIso)) items.push({ kind: 'sun', rise: ev.kind === 'rise', iso: ev.iso })
    }
  }

  const valueOf = (i, k) => {
    // "Now" reads the live values, so the first tile agrees with the card above.
    if (k === 0 && metric.now && Number.isFinite(current[metric.now])) return current[metric.now]
    return hourly[metric.key]?.[i]
  }
  const text = (v) => {
    if (v == null || !Number.isFinite(v)) return '-'
    switch (metric.id) {
      case 'temp':
      case 'feels': return `${toTemp(v, unit)}°`
      case 'wind':  return unitText('wind', v, units)
      case 'uv':    return String(Math.round(v))
      default:      return `${Math.round(v)}%`
    }
  }
  const style = (v) => {
    if (!Number.isFinite(v)) return undefined
    if (metric.id === 'temp' || metric.id === 'feels') {
      return tempStyle(v, colorCoding.hourly, 0.35, colorCoding.glow, colorCoding.frost)
    }
    if (metric.id === 'precip' && v > 0) return { color: 'var(--web-precip)' }
    return undefined
  }

  // Under the strip: today's precipitation total, when there is any.
  const di = daily.time.indexOf(nowIso.slice(0, 10))
  const total = di >= 0 ? daily.precipitation_sum?.[di] : null
  const snow = di >= 0 ? daily.snowfall_sum?.[di] : null
  const notes = []
  if (total >= 0.01) notes.push(`${snow > 0 ? 'Precipitation' : 'Rain'} today: ${formatPrecip(total, units)}`)

  const scrollBy = (dir) => {
    const el = scrollRef.current
    if (!el) return
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: reducedMotion() ? 'auto' : 'smooth' })
  }

  return (
    <section className="card wt-hours" aria-labelledby="wt-hours-title">
      <div className="wt-card-head">
        <h2 id="wt-hours-title" className="section-label wt-title">NEXT 24 HOURS</h2>
        {available.length > 1 && (
          <div className="web-seg wt-seg" role="group" aria-label="Reading shown">
            {available.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`web-seg-btn${m.id === metric.id ? ' web-seg-btn--active' : ''}`}
                aria-pressed={m.id === metric.id}
                aria-label={metricName(m.id, unit, units)}
                onClick={() => pick(m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className={`wt-strip${edges.start ? '' : ' wt-strip--from'}${edges.end ? '' : ' wt-strip--more'}`}>
        <button
          type="button"
          className="wt-strip-nav wt-strip-nav--prev"
          onClick={() => scrollBy(-1)}
          hidden={edges.start}
          aria-label="Earlier hours"
          tabIndex={-1}
        >
          <ChevronLeft size={18} />
        </button>
        <ol className="wt-strip-list" ref={scrollRef} tabIndex={0} aria-label="Hourly forecast">
          {items.map((it) => {
            if (it.kind === 'sun') {
              const Icon = it.rise ? Sunrise : Sunset
              const time = formatMinutes(isoMinutes(it.iso))
              return (
                <li key={`sun-${it.iso}`} className="wt-hour wt-hour--sun" aria-label={`${it.rise ? 'Sunrise' : 'Sunset'} at ${time}`}>
                  <span className="wt-hour-time" aria-hidden="true">{time.replace(' ', ' ')}</span>
                  <span className="wt-hour-glyph"><Icon size={26} aria-hidden="true" /></span>
                  <span className="wt-hour-value" aria-hidden="true">{it.rise ? 'Sunrise' : 'Sunset'}</span>
                  <span className="wt-hour-chance" aria-hidden="true">&nbsp;</span>
                </li>
              )
            }
            const { i, k, time } = it
            const code = k === 0
              ? (liveWeatherCode(current, minutely, radarClear) ?? hourly.weather_code[i])
              : nowcastHourlyCode(hourly.weather_code[i], minutely, time, current)
            const info = getWeatherInfo(code, hourly.is_day?.[i] === 0)
            const v = valueOf(i, k)
            const chance = hourly.precipitation_probability?.[i] ?? 0
            const label = k === 0 ? 'Now' : hourLabel(time)
            const suffix = metric.id === 'wind' && Number.isFinite(v) ? unitSuffix('wind', units) : null
            // The chance of rain rides under every reading but its own.
            const showChance = metric.id !== 'precip' && chance >= 10
            return (
              <li
                key={time}
                className={`wt-hour${k === 0 ? ' wt-hour--now' : ''}`}
                aria-label={`${label}, ${info.label}, ${text(v)}${suffix ? ` ${suffix}` : ''}${showChance ? `, ${chance}% chance of precipitation` : ''}`}
              >
                <span className="wt-hour-time" aria-hidden="true">{label}</span>
                <span className="wt-hour-icon" aria-hidden="true"><WeatherIcon id={info.icon} alt="" /></span>
                <span className="wt-hour-value" style={style(v)} aria-hidden="true">
                  {text(v)}
                  {suffix && <small>{suffix}</small>}
                </span>
                <span className="wt-hour-chance" aria-hidden="true">
                  {showChance ? <><Droplets size={11} />{chance}%</> : ' '}
                </span>
              </li>
            )
          })}
        </ol>
        <button
          type="button"
          className="wt-strip-nav wt-strip-nav--next"
          onClick={() => scrollBy(1)}
          hidden={edges.end}
          aria-label="Later hours"
          tabIndex={-1}
        >
          <ChevronRight size={18} />
        </button>
      </div>

      {notes.length > 0 && <p className="wt-foot">{notes.join(' · ')}</p>}
    </section>
  )
}

// ── Next 7 days ──────────────────────────────────────────────────────────────

function WeekCard({ weather, unit, colorCoding, onNavigate }) {
  const { daily, current, timezone } = weather
  const highs = daily.temperature_2m_max
  const lows = daily.temperature_2m_min
  const weekMin = Math.min(...lows)
  const weekMax = Math.max(...highs)
  const span = weekMax - weekMin || 1
  const pos = (f) => Math.min(100, Math.max(0, ((f - weekMin) / span) * 100))
  const cc = colorCoding.daily
  const temp = (f, cls) => (
    <span className={cls} style={tempStyle(f, cc, 0.35, colorCoding.glow, colorCoding.frost)}>{toTemp(f, unit)}°</span>
  )

  return (
    <section className="card wt-week" aria-labelledby="wt-week-title">
      <div className="wt-card-head">
        <h2 id="wt-week-title" className="section-label wt-title">NEXT 7 DAYS</h2>
        <button type="button" className="web-link-btn" onClick={() => onNavigate('daily')}>
          Full week
          <ArrowRight size={14} />
        </button>
      </div>
      <ul className="wt-days">
        {daily.time.map((date, i) => {
          const info = getWeatherInfo(daily.weather_code[i], false)
          const chance = daily.precipitation_probability_max?.[i] ?? 0
          const lo = lows[i], hi = highs[i]
          const left = pos(lo)
          const width = Math.max(pos(hi) - left, 3)
          const name = i === 0 ? 'Today' : weekdayLabel(date, timezone)
          return (
            <li
              key={date}
              className={`wt-day${i === 0 ? ' wt-day--today' : ''}`}
              aria-label={`${name}: ${info.label}, high ${toTemp(hi, unit)}°, low ${toTemp(lo, unit)}°${chance >= 10 ? `, ${chance}% chance of precipitation` : ''}`}
            >
              <span className="wt-day-name" aria-hidden="true">{name}</span>
              <span className="wt-day-icon" aria-hidden="true"><WeatherIcon id={info.icon} alt="" /></span>
              <span className="wt-day-cond" aria-hidden="true">{info.label}</span>
              <span className="wt-day-chance" aria-hidden="true">
                {chance >= 10 && <><Droplets size={11} />{chance}%</>}
              </span>
              {temp(lo, 'wt-day-lo')}
              <span className="wt-day-track" aria-hidden="true">
                <span
                  className="wt-day-bar"
                  style={{
                    left: `${left}%`,
                    width: `${width}%`,
                    background: cc ? `linear-gradient(90deg, ${tempInk(lo)}, ${tempInk(hi)})` : 'var(--graph-line)',
                  }}
                />
                {i === 0 && current.temperature_2m != null && (
                  <span className="wt-day-now" style={{ left: `${pos(current.temperature_2m)}%` }} title="Now" />
                )}
              </span>
              {temp(hi, 'wt-day-hi')}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function TodayPage(props) {
  const {
    weather, location, alerts, unit, units, radarClear, radarTrend, airQuality, colorCoding, nowcastMode,
    hasActiveAlert, onNavigate, radarMode, radarSource, weatherAnimations,
  } = props
  const { current, hourly, daily, timezone } = weather

  const nowIso = localNow(timezone)
  const events = sunEvents(daily)
  const nextSun = events.find((e) => e.iso > nowIso) ?? null

  return (
    <div className="web-page wt">
      <WeatherAlerts alerts={alerts} location={location} />

      <div className="wt-grid">
        <div className="wt-main">
          <NowCard {...props} nowIso={nowIso} nextSun={nextSun} />

          {/* Draws nothing unless it's raining or about to be (or the setting
              says always), so it costs no space on a dry day. */}
          <PrecipNowcast
            minutely={weather.minutely_15}
            currentTime={current.time}
            mode={nowcastMode}
            current={current}
            radarClear={radarClear}
            radarTrend={radarTrend}
            wide
          />

          <HoursCard
            weather={weather}
            unit={unit}
            units={units}
            radarClear={radarClear}
            colorCoding={colorCoding}
            nowIso={nowIso}
            events={events}
          />

          <WeekCard weather={weather} unit={unit} colorCoding={colorCoding} onNavigate={onNavigate} />
        </div>

        <aside className="wt-side" aria-label="Today's outlook">
          <TodayCard
            hourly={hourly}
            daily={daily}
            current={current}
            yesterday={weather.yesterday}
            timezone={timezone}
            unit={unit}
            units={units}
            airQuality={airQuality}
          />
          <WeatherOverview
            hourly={hourly}
            daily={daily}
            current={current}
            minutely={weather.minutely_15}
            radarClear={radarClear}
            timezone={timezone}
            hasActiveAlert={hasActiveAlert}
            unit={unit}
            units={units}
            airQuality={airQuality}
            colorCode={colorCoding.overview}
          />
          {/* The phone's compact radar card, playable in place; a click on the
              map opens the Radar tab rather than growing the card full-screen. */}
          <div className="wt-radar">
            <WeatherRadar
              location={location}
              timezone={timezone}
              mode={radarMode}
              source={radarSource}
              rainFx={weatherAnimations}
              snow={isSnowing(current)}
              onOpen={() => onNavigate('radar')}
            />
          </div>
        </aside>
      </div>

      <SourceNote current={current} minutely={weather.minutely_15} radarClear={radarClear} />
    </div>
  )
}
