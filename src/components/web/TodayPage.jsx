import { useEffect, useState } from 'react'
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ArrowRight, CloudRain, Droplets, Eye, GripHorizontal, Sun, Sunrise, Sunset, Thermometer, Wind } from 'lucide-react'
import { CurrentWeather } from '../CurrentWeather'
import { PrecipNowcast } from '../PrecipNowcast'
import { WeatherAlerts } from '../WeatherAlerts'
import { WeatherIcon } from '../WeatherIcon'
import {
  displayPrecipChance, formatHour, formatTime, getUVLabel, getWeatherInfo, getWindDirection,
  liveWeatherCode, nowcastHourlyCode, precipTier, tempStyle, toTemp,
} from '../../utils/weatherCodes'
import { currentHourIndex, sliceHourly, weekdayLabel } from './webData'
import { formatPrecip, formatVisibility, formatWind } from '../../utils/units'

const TODAY_ORDER_KEY = 'alek-weather-today-order'
// Order is the whole layout: the current card takes the narrow track, and
// whichever widget follows it shares that row. Everything else takes a row of
// its own. So the default reads as today's page — current + at a glance across
// the top, then the two strips full width.
const DEFAULT_ORDER = ['current', 'glance', 'hourly', 'week']
const WIDGET_NAMES = {
  current: 'Current weather',
  glance: 'At a glance',
  hourly: 'Next hours',
  week: 'Week ahead',
}

// The width where .web-today-grid still has two tracks — WebApp.css folds it to
// one column at 1279px. Below that nothing sits beside anything, so the pairing
// rule switches off and every widget renders at full size.
const PAIR_MQ = '(min-width: 1280px)'

// Hours in the strip. Thirteen tiles is a full-width row; sharing a row with the
// current card leaves about two thirds of that, which is nine tiles at the same
// size rather than thirteen squeezed ones. The heading counts from whichever is
// in play, so it never promises hours that aren't drawn.
const FULL_HOURS = 13
const COMPACT_HOURS = 9

function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const onChange = () => setMatches(mq.matches)
    onChange() // the width may have changed between the first render and this effect
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [query])
  return matches
}

// Corrupted or stale storage must never crash the page or, worse, hand dnd-kit a
// list with a duplicate id in it. Unknown ids are dropped and missing ones are
// appended, so a saved order survives the widget set changing.
function loadOrder() {
  let saved
  try { saved = JSON.parse(localStorage.getItem(TODAY_ORDER_KEY) ?? 'null') }
  catch { /* corrupted storage falls through to the default */ }
  if (!Array.isArray(saved)) return DEFAULT_ORDER
  const kept = [...new Set(saved.filter(id => DEFAULT_ORDER.includes(id)))]
  if (!kept.length) return DEFAULT_ORDER
  return [...kept, ...DEFAULT_ORDER.filter(id => !kept.includes(id))]
}

// The order flattened into rows. The current card is the only narrow widget, so
// it is the only one that can share a row — with whatever was dropped directly
// after it. Below the two-track width every widget gets its own row.
function buildRows(order, paired) {
  if (!paired) return order.map(id => [id])
  const rows = []
  for (let i = 0; i < order.length; i++) {
    if (order[i] === 'current' && i + 1 < order.length) {
      rows.push([order[i], order[i + 1]])
      i++
    } else {
      rows.push([order[i]])
    }
  }
  return rows
}

// One draggable slot in the grid. `full` spans both tracks — it is what the
// widget's own styles key off to decide how much they can spread out, so the
// sizing follows the drop rather than needing a second source of truth.
function SortableWidget({ id, name, full, children }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  return (
    <div
      ref={setNodeRef}
      className={`web-widget${full ? ' web-widget--full' : ''}${isDragging ? ' web-widget--dragging' : ''}`}
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      {/* Above the card's top edge rather than inside it: every corner of these
          four cards is already spoken for — the location line, the section
          label, the save button, the Outlook link. */}
      <button
        type="button"
        className="web-widget-handle"
        aria-label={`Move ${name}`}
        title="Drag to move"
        {...attributes}
        {...listeners}
      >
        <GripHorizontal size={14} />
      </button>
      {children}
    </div>
  )
}

function GlanceTile({ icon: Icon, label, value, sub, color }) {
  return (
    <div className="web-glance-tile">
      <Icon size={17} className="web-glance-icon" style={color ? { color } : undefined} aria-hidden="true" />
      <div className="web-glance-label">{label}</div>
      <div className="web-glance-value" style={color ? { color } : undefined}>{value}</div>
      {sub && <div className="web-glance-sub">{sub}</div>}
    </div>
  )
}

// The two preview cards at the bottom of the page are deliberately read-only
// summaries: they say enough to answer "do I need to open that tab", and hand
// off to the real page rather than duplicating it.
// The open link is optional. The hours strip has nowhere to go now that the
// Hourly page is retired — it is the whole of the hourly forecast rather than a
// preview of a fuller one — so it renders as a plain titled card, and the head
// keeps its row so both cards' titles still sit on the same line.
function PreviewCard({ title, onOpen, openLabel, className, children }) {
  return (
    <div className={`card web-preview${className ? ` ${className}` : ''}`}>
      <div className="web-preview-head">
        <span className="section-label">{title}</span>
        {onOpen && (
          <button className="web-link-btn" onClick={onOpen}>
            {openLabel}
            <ArrowRight size={14} />
          </button>
        )}
      </div>
      {children}
    </div>
  )
}

// The weather-overview card (insight / conditions / clothing / AQI) is off on
// the desktop layout for now. WebLayout still spreads its props through, so
// restoring it is a matter of pulling `airQuality`, `overviewParts`,
// `showOverview` and `hasActiveAlert` back out of the props and rendering
// <WeatherOverview> again.
export function TodayPage({
  weather, location, alerts, unit, units, radarClear, lastUpdated, loading,
  colorCoding, nowcastMode,
  saved, onSave, onRemove, isHome, hasHome, onGoHome, onSetHome, onUnsetHome, onRefresh,
  onNavigate,
}) {
  const { current, hourly, daily, timezone } = weather
  const paired = useMediaQuery(PAIR_MQ)
  const [order, setOrder] = useState(loadOrder)

  // A few pixels of travel before a drag starts, so a click on the handle stays
  // a click; the keyboard sensor makes the same moves reachable without one.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return
    setOrder(prev => {
      const next = arrayMove(prev, prev.indexOf(active.id), prev.indexOf(over.id))
      localStorage.setItem(TODAY_ORDER_KEY, JSON.stringify(next))
      return next
    })
  }

  const uv = getUVLabel(current.uv_index ?? 0)
  const windDir = getWindDirection(current.wind_direction_10m)
  const rainToday = daily.precipitation_probability_max?.[0]

  const renderWidget = (id, compact) => {
    switch (id) {
      case 'current':
        return (
          <CurrentWeather
            current={current}
            minutely={weather.minutely_15}
            radarClear={radarClear}
            location={location}
            timezone={timezone}
            unit={unit}
            saved={saved}
            onSave={onSave}
            onRemove={onRemove}
            isHome={isHome}
            hasHome={hasHome}
            onGoHome={onGoHome}
            onSetHome={onSetHome}
            onUnsetHome={onUnsetHome}
            lastUpdated={lastUpdated}
            onRefresh={onRefresh}
            loading={loading}
            colorCoding={colorCoding.current}
            glow={colorCoding.glow}
            frost={colorCoding.frost}
          />
        )

      case 'glance':
        return (
          <div className="card web-glance">
            <div className="section-label">AT A GLANCE</div>
            <div className="web-glance-grid">
              <GlanceTile
                icon={Thermometer}
                label="High / Low"
                value={
                  <>
                    <span style={tempStyle(daily.temperature_2m_max[0], colorCoding.daily, 0.3, colorCoding.glow, colorCoding.frost)}>
                      {toTemp(daily.temperature_2m_max[0], unit)}°
                    </span>
                    <span className="web-glance-sep"> / </span>
                    <span style={tempStyle(daily.temperature_2m_min[0], colorCoding.daily, 0.3, colorCoding.glow, colorCoding.frost)}>
                      {toTemp(daily.temperature_2m_min[0], unit)}°
                    </span>
                  </>
                }
                sub="Today"
              />
              <GlanceTile
                icon={CloudRain}
                label="Precipitation"
                value={rainToday != null ? `${rainToday}%` : '—'}
                sub={daily.precipitation_sum?.[0] != null ? `${formatPrecip(daily.precipitation_sum[0], units)} expected` : 'Chance today'}
              />
              <GlanceTile
                icon={Wind}
                label="Wind"
                value={formatWind(current.wind_speed_10m, units)}
                sub={`${windDir}${current.wind_gusts_10m != null ? ` · gusts ${Math.round(current.wind_gusts_10m)}` : ''}`}
              />
              <GlanceTile
                icon={Droplets}
                label="Humidity"
                value={`${Math.round(current.relative_humidity_2m)}%`}
                sub={current.dew_point_2m != null ? `Dew point ${toTemp(current.dew_point_2m, unit)}°` : null}
              />
              <GlanceTile
                icon={Sunrise}
                label="Sunrise"
                value={formatTime(daily.sunrise[0], timezone)}
                sub="Local time"
              />
              <GlanceTile
                icon={Sunset}
                label="Sunset"
                value={formatTime(daily.sunset[0], timezone)}
                sub="Local time"
              />
              <GlanceTile
                icon={Eye}
                label="Visibility"
                value={formatVisibility(current.visibility, units)}
                sub="Ground level"
              />
              <GlanceTile
                icon={Sun}
                label="UV index"
                value={Math.round(current.uv_index ?? 0)}
                sub={uv.label}
                color={colorCoding.details ? uv.color : undefined}
              />
            </div>
          </div>
        )

      case 'hourly': {
        const count = compact ? COMPACT_HOURS : FULL_HOURS
        const start = currentHourIndex(hourly, timezone)
        const next = sliceHourly(hourly, start, count)
        return (
          <PreviewCard title={`NEXT ${count - 1} HOURS`} className="web-strip">
            <div className="web-mini-hours">
              {next.time.map((time, i) => {
                const code = i === 0
                  ? (liveWeatherCode(current, weather.minutely_15, radarClear) ?? next.code[i])
                  : nowcastHourlyCode(next.code[i], weather.minutely_15, time, current)
                const info = getWeatherInfo(code, !next.isDay[i])
                const chance = displayPrecipChance(code, precipTier(code) === 0 ? 0 : next.precip[i])
                return (
                  <div key={time} className={`web-mini-hour${i === 0 ? ' web-mini-hour--now' : ''}`}>
                    <span className="web-mini-time">{i === 0 ? 'Now' : formatHour(time, timezone)}</span>
                    <span className="web-mini-icon"><WeatherIcon id={info.icon} alt={info.label} /></span>
                    <span
                      className="web-mini-temp"
                      style={tempStyle(next.temp[i], colorCoding.hourly, 0.35, colorCoding.glow, colorCoding.frost)}
                    >
                      {toTemp(next.temp[i], unit)}°
                    </span>
                    <span className={`web-mini-precip${chance >= 30 ? ' web-mini-precip--high' : chance > 0 ? '' : ' web-mini-precip--zero'}`}>
                      {chance}%
                    </span>
                  </div>
                )
              })}
            </div>
          </PreviewCard>
        )
      }

      case 'week':
        return (
          <PreviewCard title="WEEK AHEAD" onOpen={() => onNavigate('daily')} openLabel="Outlook" className="web-week">
            <div className="web-week-days">
              {daily.time.map((date, i) => {
                const info = getWeatherInfo(daily.weather_code[i], false)
                const chance = displayPrecipChance(
                  daily.weather_code[i],
                  precipTier(daily.weather_code[i]) === 0 ? 0 : daily.precipitation_probability_max?.[i],
                )
                return (
                  <div key={date} className={`web-week-day${i === 0 ? ' web-week-day--today' : ''}`}>
                    <span className="web-week-dayname">{i === 0 ? 'Today' : weekdayLabel(date, timezone)}</span>
                    <span className="web-week-icon"><WeatherIcon id={info.icon} alt={info.label} /></span>
                    <span className="web-week-cond">{info.label}</span>
                    <span className="web-week-temps">
                      <span
                        className="web-week-high"
                        style={tempStyle(daily.temperature_2m_max[i], colorCoding.daily, 0.35, colorCoding.glow, colorCoding.frost)}
                      >
                        {toTemp(daily.temperature_2m_max[i], unit)}°
                      </span>
                      <span
                        className="web-week-low"
                        style={tempStyle(daily.temperature_2m_min[i], colorCoding.daily, 0.35, colorCoding.glow, colorCoding.frost)}
                      >
                        {toTemp(daily.temperature_2m_min[i], unit)}°
                      </span>
                    </span>
                    <span className={`web-week-precip${chance >= 30 ? ' web-mini-precip--high' : chance > 0 ? '' : ' web-mini-precip--zero'}`}>
                      {chance}%
                    </span>
                  </div>
                )
              })}
            </div>
          </PreviewCard>
        )

      default:
        return null
    }
  }

  // One flat child list rather than a wrapper per row: the widgets keep their
  // keys at the top level, so a drop moves the DOM node instead of unmounting it
  // out of one row and remounting it in the next.
  const rows = buildRows(order, paired)
  const items = []
  rows.forEach((row, r) => {
    row.forEach(id => {
      items.push(
        <SortableWidget key={id} id={id} name={WIDGET_NAMES[id]} full={row.length === 1}>
          {renderWidget(id, row.length > 1 && id !== 'current')}
        </SortableWidget>,
      )
    })
    // The nowcast isn't part of the sortable set — it keeps the place it has
    // always had, under the first row. `wide` draws the chart in real pixels at
    // a fixed height, so it fills the page's width without its height chasing
    // it. It renders nothing when there is no rain to plot, which is why it sits
    // in the grid directly: an empty wrapper would still open a row of gaps.
    if (r === 0) {
      items.push(
        <PrecipNowcast
          key="nowcast"
          minutely={weather.minutely_15}
          currentTime={current.time}
          mode={nowcastMode}
          current={current}
          radarClear={radarClear}
          wide
        />,
      )
    }
  })

  return (
    <div className="web-page">
      <WeatherAlerts alerts={alerts} />

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={order} strategy={rectSortingStrategy}>
          <div className="web-today-grid">{items}</div>
        </SortableContext>
      </DndContext>
    </div>
  )
}
