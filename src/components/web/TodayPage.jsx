import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowRight, CloudRain, Droplets, Eye, Sun, Sunrise, Sunset, Thermometer, Wind } from 'lucide-react'
import { DragHandle, DragLayer, ResetLayout } from './DragLayer'
import { useCardDrag } from './cardDrag'
import {
  applyDrop, HOURS_BY_SLOT, keyMove, PAIR_MQ, resolveToday, spans, useMediaQuery, useTodayLayout,
} from './todayLayout'
import { CurrentWeather } from '../CurrentWeather'
import { TodayCard } from '../TodayCard'
import { PrecipNowcast } from '../PrecipNowcast'
import { WeatherAlerts } from '../WeatherAlerts'
import { WeatherIcon } from '../WeatherIcon'
import {
  formatHour, formatTime, getUVLabel, SUN_ORANGE, getWeatherInfo, getWindDirection,
  liveWeatherCode, nowcastHourlyCode, tempStyle, toTemp,
} from '../../utils/weatherCodes'
import { currentHourIndex, METERS_PER_MILE, sliceHourly, weekdayLabel } from './webData'
import { getHumidityInfo, getPrecipInfo, getVisibilityInfo, getWindInfo } from '../../utils/conditions'
import { formatPrecip, formatVisibility, formatWind } from '../../utils/units'

// The layout itself (rows of one or two cards) lives in todayLayout.js.
const WIDGET_NAMES = {
  current: 'Current weather',
  glance: 'At a glance',
  nowcast: 'Precipitation',
  hourly: 'Next hours',
  week: 'Week ahead',
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
  const { rows, setRows, reset, isCustom } = useTodayLayout()
  const gridRef = useRef(null)

  // The precipitation chart draws nothing when there's no rain in the next
  // hour. It's still rendered (hidden) so it can be noticed the moment it has
  // something to show, but its row is left out until then, so the card it
  // shares a row with gets the whole width instead of half of an empty row.
  const [nowcastShown, setNowcastShown] = useState(false)
  // Checked after every render, since what the chart decides depends on props
  // it reads itself; the state only changes when the answer does, so it settles.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const has = !!gridRef.current?.querySelector('[data-widget="nowcast"] .nowcast-card')
    if (has !== nowcastShown) setNowcastShown(has)
  })
  const visRows = rows
    .map(row => row.filter(id => id !== 'nowcast' || nowcastShown))
    .filter(row => row.length)

  const { drag, start, markMoved } = useCardDrag({
    containerRef: gridRef,
    resolve: (id, x, y, cards) => resolveToday(rows, visRows, paired, id, x, y, cards),
    onDrop: (id, target) => setRows(applyDrop(rows, id, target)),
  })

  // Arrow keys on a grip move the card; focus follows it to its new place.
  const refocus = useRef(null)
  const onKeyMove = (id, dir) => {
    const next = keyMove(rows, visRows, id, dir)
    if (next === rows) return
    markMoved()
    refocus.current = id
    setRows(next)
  }
  useEffect(() => {
    if (!refocus.current) return
    gridRef.current?.querySelector(`[data-handle-for="${refocus.current}"]`)?.focus()
    refocus.current = null
  })

  const uv = getUVLabel(current.uv_index ?? 0)
  const windDir = getWindDirection(current.wind_direction_10m)
  const rainToday = daily.precipitation_probability_max?.[0]

  // The glance tiles use the Details page's colour scales (and its toggle), so
  // a reading wears the same colour on both pages.
  const cc = colorCoding.details
  const visMi = current.visibility != null ? current.visibility / METERS_PER_MILE : null
  const glanceColor = {
    precip: rainToday != null ? getPrecipInfo(rainToday).color : undefined,
    wind: getWindInfo(current.wind_speed_10m).color,
    humidity: getHumidityInfo(current.relative_humidity_2m).color,
    visibility: visMi != null ? getVisibilityInfo(visMi).color : undefined,
    sun: SUN_ORANGE,
  }
  const tone = (key) => (cc ? glanceColor[key] : undefined)

  const renderWidget = (id, slot) => {
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
          >
            {/* The phone's Today card (vs yesterday, and how good the rest of
                the day is for being out, driving and exercise), folded into the
                current card under the readings. */}
            <TodayCard
              embedded
              hourly={hourly}
              daily={daily}
              current={current}
              yesterday={weather.yesterday}
              timezone={timezone}
              unit={unit}
            />
          </CurrentWeather>
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
                color={tone('precip')}
                value={rainToday != null ? `${rainToday}%` : '—'}
                sub={daily.precipitation_sum?.[0] != null ? `${formatPrecip(daily.precipitation_sum[0], units)} expected` : 'Chance today'}
              />
              <GlanceTile
                icon={Wind}
                label="Wind"
                color={tone('wind')}
                value={formatWind(current.wind_speed_10m, units)}
                sub={`${windDir}${current.wind_gusts_10m != null ? ` · gusts ${Math.round(current.wind_gusts_10m)}` : ''}`}
              />
              <GlanceTile
                icon={Droplets}
                label="Humidity"
                color={tone('humidity')}
                value={`${Math.round(current.relative_humidity_2m)}%`}
                sub={current.dew_point_2m != null ? `Dew point ${toTemp(current.dew_point_2m, unit)}°` : null}
              />
              <GlanceTile
                icon={Sunrise}
                label="Sunrise"
                color={tone('sun')}
                value={formatTime(daily.sunrise[0], timezone)}
                sub="Local time"
              />
              <GlanceTile
                icon={Sunset}
                label="Sunset"
                color={tone('sun')}
                value={formatTime(daily.sunset[0], timezone)}
                sub="Local time"
              />
              <GlanceTile
                icon={Eye}
                label="Visibility"
                color={tone('visibility')}
                value={formatVisibility(current.visibility, units)}
                sub="Ground level"
              />
              <GlanceTile
                icon={Sun}
                label="UV index"
                value={Math.round(current.uv_index ?? 0)}
                sub={uv.label}
                color={cc ? uv.color : undefined}
              />
            </div>
          </div>
        )

      case 'hourly': {
        const count = HOURS_BY_SLOT[slot] ?? HOURS_BY_SLOT.full
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
                const chance = next.precip[i] ?? 0
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
                const chance = daily.precipitation_probability_max?.[i] ?? 0
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

      case 'nowcast':
        // `wide` draws the chart in real pixels at a fixed height, so it fills
        // whatever width its slot has without its height chasing it.
        return (
          <PrecipNowcast
            minutely={weather.minutely_15}
            currentTime={current.time}
            mode={nowcastMode}
            current={current}
            radarClear={radarClear}
            wide
          />
        )

      default:
        return null
    }
  }

  // One flat child list rather than a wrapper per row: the cards keep their
  // keys at the top level, so a drop moves the DOM node instead of unmounting it
  // out of one row and remounting it in the next. Each row's widths add up to
  // the grid's 12 columns, so the rows line up without any wrapper.
  const widget = (id, slot, span, hidden) => (
    <div
      key={id}
      data-widget={id}
      data-card-id={hidden ? undefined : id}
      className={[
        'web-widget',
        slot === 'full' && 'web-widget--full',
        `web-widget--${slot}`,
        hidden && 'web-widget--absent',
        drag?.id === id && 'web-widget--lifted',
      ].filter(Boolean).join(' ')}
      style={{ gridColumn: paired ? `span ${span}` : '1 / -1' }}
    >
      <DragHandle id={id} name={WIDGET_NAMES[id]} onStart={start} onKeyMove={onKeyMove} />
      {renderWidget(id, paired ? slot : 'full')}
    </div>
  )

  const items = []
  for (const row of visRows) {
    const s = spans(row)
    for (const id of row) items.push(widget(id, paired ? s[id].slot : 'full', s[id].span, false))
  }
  if (!nowcastShown) items.push(widget('nowcast', 'full', 12, true))

  return (
    <div className="web-page">
      <WeatherAlerts alerts={alerts} location={location} />

      <div className="web-today-grid" ref={gridRef}>{items}</div>
      <DragLayer drag={drag} names={WIDGET_NAMES} />

      <ResetLayout visible={isCustom} onReset={reset} />
    </div>
  )
}
