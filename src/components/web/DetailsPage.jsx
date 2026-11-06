import { useState } from 'react'
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import {
  ArrowRight, CloudLightning, CloudRain, Droplets, Eye, Flower2, Gauge, Leaf, Moon, Snowflake,
  Sun, Sunrise, Sunset, TrendingDown, TrendingUp, Minus,
} from 'lucide-react'
import { SunDial } from '../WeatherDetails'
import { WindTurbine } from '../WindTurbine'
import { formatHour, formatTime, getUVLabel, getWindDirection, sunColor, toTemp, SUN_ORANGE } from '../../utils/weatherCodes'
import {
  getAQIInfo, getAQINote, getHumidityInfo, getHumidityNote, getPollenInfo, getPrecipInfo,
  getPressureInfo, getPressureTrend, getSnowInfo, getStormInfo, getStormNote,
  getUVNote, getVisibilityInfo, getVisibilityNote, getWindInfo, getWindNote,
} from '../../utils/conditions'
import { getMoonInfo } from '../../utils/moon'
import { useMeasure } from './chartUtils'
import { Sparkline } from './Sparkline'
import { currentHourIndex, daylightLength, METERS_PER_MILE, weekdayLabel } from './webData'
import { formatPrecip, formatUnitDelta, unitSuffix, unitText } from '../../utils/units'
import { SortableWidget } from './TodayPage'

const DETAILS_ORDER_KEY = 'alek-weather-details-order'
const DEFAULT_ORDER = [
  'precip', 'snow', 'humidity', 'wind', 'pressure', 'visibility',
  'storm', 'uv', 'sun', 'moon', 'air', 'pollen',
]
const PANEL_NAMES = {
  precip: 'Precipitation',
  snow: 'Snow',
  humidity: 'Humidity',
  wind: 'Wind',
  pressure: 'Pressure',
  visibility: 'Visibility',
  storm: 'Thunderstorm potential',
  uv: 'UV index',
  sun: 'Sun',
  moon: 'Moon',
  air: 'Air quality',
  pollen: 'Pollen',
}

// The moon as it looks tonight: a dark disc with the lit part laid over it.
// The lit part is a half disc on the sunward side closed by the terminator, an
// ellipse whose width follows cos(phase) — bulging away from the lit side for a
// crescent, past the centre line for a gibbous. Mirrored south of the equator,
// where the moon waxes from the left.
function MoonGlyph({ phase, south, size = 84 }) {
  const r = size / 2 - 2
  const c = size / 2
  const rx = Math.abs(Math.cos(2 * Math.PI * phase)) * r
  const waxing = phase < 0.5
  const limbSweep = waxing ? 1 : 0
  const termSweep = waxing ? (phase < 0.25 ? 0 : 1) : (phase > 0.75 ? 1 : 0)
  const lit = `M ${c} ${c - r} A ${r} ${r} 0 0 ${limbSweep} ${c} ${c + r} A ${rx} ${r} 0 0 ${termSweep} ${c} ${c - r} Z`
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="web-moon-glyph"
      style={south ? { transform: 'scaleX(-1)' } : undefined}
      aria-hidden="true"
    >
      <circle cx={c} cy={c} r={r} className="web-moon-dark" />
      <path d={lit} className="web-moon-lit" />
    </svg>
  )
}

// Same guard as the Today page: unknown ids are dropped and missing ones are
// appended, so a saved order survives the panel set changing.
function loadOrder() {
  let saved
  try { saved = JSON.parse(localStorage.getItem(DETAILS_ORDER_KEY) ?? 'null') }
  catch { /* corrupted storage falls through to the default */ }
  if (!Array.isArray(saved)) return DEFAULT_ORDER
  const kept = [...new Set(saved.filter(id => DEFAULT_ORDER.includes(id)))]
  if (!kept.length) return DEFAULT_ORDER
  return [...kept, ...DEFAULT_ORDER.filter(id => !kept.includes(id))]
}

// A panel's 24-hour history strip: the sparkline plus the two end labels, which
// are what make it a chart rather than a decoration.
function PanelChart({ values, times, timezone, color, step, format }) {
  const [ref, width] = useMeasure()
  const clean = values.filter((v) => v != null && Number.isFinite(v))
  return (
    <div className="web-detail-chart" ref={ref}>
      {clean.length >= 2 && <Sparkline values={values} width={width} height={58} color={color} step={step} />}
      {clean.length >= 2 && (
        <div className="web-detail-chart-axis">
          <span>Now</span>
          {format && (
            <span className="web-detail-chart-range">
              {format(Math.min(...clean))} – {format(Math.max(...clean))}
            </span>
          )}
          <span>{times.length ? formatHour(times[times.length - 1], timezone) : ''}</span>
        </div>
      )}
    </div>
  )
}

function Panel({ icon, title, value, unit, status, note, color, children, footer }) {
  return (
    <div className="card web-detail">
      <div className="web-detail-head">
        <span className="web-detail-head-icon" style={color ? { color } : undefined}>{icon}</span>
        <span className="section-label">{title}</span>
      </div>
      <div className="web-detail-hero">
        <span className="web-detail-value" style={color ? { color } : undefined}>
          {value}
          {unit && <span className="web-detail-unit">{unit}</span>}
        </span>
        {status && <span className="web-detail-status" style={color ? { color } : undefined}>{status}</span>}
      </div>
      {note && <p className="web-detail-note">{note}</p>}
      {children}
      {footer}
    </div>
  )
}

function StatRow({ items }) {
  const shown = items.filter((it) => it && it.value != null)
  if (!shown.length) return null
  return (
    <div className="web-detail-stats">
      {shown.map((it) => (
        <div key={it.label} className="web-detail-stat">
          <span className="web-detail-stat-label">{it.label}</span>
          <span className="web-detail-stat-value" style={it.color ? { color: it.color } : undefined}>{it.value}</span>
        </div>
      ))}
    </div>
  )
}

export function DetailsPage({ weather, unit, units, airQuality, colorCoding, onNavigate }) {
  const { current, daily, hourly, timezone } = weather
  const mono = !colorCoding.details
  const tint = (c) => (mono ? 'var(--text-primary)' : c)
  const [order, setOrder] = useState(loadOrder)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return
    setOrder(prev => {
      const next = arrayMove(prev, prev.indexOf(active.id), prev.indexOf(over.id))
      localStorage.setItem(DETAILS_ORDER_KEY, JSON.stringify(next))
      return next
    })
  }

  const hStart = currentHourIndex(hourly, timezone)
  const nextDay = (arr) => (arr ?? []).slice(hStart, hStart + 24)
  const times = nextDay(hourly.time)

  const humidity = current.relative_humidity_2m
  const humInfo = getHumidityInfo(humidity)
  const windSpeed = current.wind_speed_10m
  const windInfo = getWindInfo(windSpeed)
  const windDir = getWindDirection(current.wind_direction_10m)
  const pressure = current.surface_pressure
  const presInfo = getPressureInfo(pressure)
  const presTrend = getPressureTrend(hourly, hStart)
  const visMi = current.visibility != null ? current.visibility / METERS_PER_MILE : null
  const visInfo = visMi != null ? getVisibilityInfo(visMi) : null

  const uvSeries = nextDay(hourly.uv_index)
  const uvCurrent = uvSeries[0] ?? current.uv_index ?? 0
  const uv = getUVLabel(uvCurrent)

  // Highest reading still ahead in the 24 hours the chart covers, which at
  // night is tomorrow's midday rather than anything today.
  const uvPeak = uvSeries.reduce((best, value, i) => {
    if (value == null || !Number.isFinite(value)) return best
    return !best || value > best.value ? { value, time: times[i] } : best
  }, null)

  // Wall-clock comparison in the location's own timezone — the API's sunrise and
  // sunset are naive local times, so parsing them as Dates would shift them into
  // the browser's zone. Matches the mobile details card.
  const sunProgress = (() => {
    const toMinutes = (iso) => +iso.slice(11, 13) * 60 + +iso.slice(14, 16)
    const localNow = new Date().toLocaleString('sv', { timeZone: timezone })
    const nowMinutes = +localNow.slice(11, 13) * 60 + +localNow.slice(14, 16)
    const rise = toMinutes(daily.sunrise[0])
    const set = toMinutes(daily.sunset[0])
    if (set <= rise) return 0
    return (nowMinutes - rise) / (set - rise)
  })()
  const sunTint = mono ? 'var(--text-primary)' : sunColor(sunProgress)

  const TrendIcon = presTrend?.label === 'Rising' ? TrendingUp
    : presTrend?.label === 'Falling' ? TrendingDown : Minus

  const aqiInfo = airQuality ? getAQIInfo(airQuality.us_aqi) : null

  // First hour in the window where `test` holds, as an index into `times`.
  const firstHour = (series, test) => series.findIndex((v) => v != null && test(v))

  const popSeries = nextDay(hourly.precipitation_probability)
  const popNow = popSeries[0] ?? 0
  const popInfo = getPrecipInfo(popNow)
  const popPeak = Math.max(0, ...popSeries.filter((v) => v != null))
  const rainAt = firstHour(popSeries, (v) => v >= 50)
  const precipNote = rainAt === 0 ? 'Rain is likely right now.'
    : rainAt > 0 ? `Rain likely from around ${formatHour(times[rainAt], timezone)}.`
    : popPeak >= 20 ? `A slight chance of showers; up to ${popPeak}% later.`
    : 'No rain expected in the next 24 hours.'

  const capeSeries = nextDay(hourly.cape)
  const capeNow = capeSeries[0]
  const capePeak = capeSeries.reduce((best, value, i) => {
    if (value == null || !Number.isFinite(value)) return best
    return !best || value > best.value ? { value, time: times[i] } : best
  }, null)

  // Snow arrives in inches (precipitation_unit=inch) and its depth in feet; the
  // card follows the precipitation unit, as centimetres rather than millimetres
  // since nobody measures snow in mm.
  const metricSnow = units.precip === 'mm'
  const snowNumber = (inches) => (metricSnow ? inches * 2.54 : inches).toFixed(1)
  const snowText = (inches) => `${snowNumber(inches)} ${metricSnow ? 'cm' : 'in'}`
  const snowSeries = nextDay(hourly.snowfall)
  const snowDay = snowSeries.reduce((sum, v) => sum + (v ?? 0), 0)
  const snowWeek = (daily.snowfall_sum ?? []).reduce((sum, v) => sum + (v ?? 0), 0)
  const snowDepthIn = current.snow_depth != null ? current.snow_depth * 12 : 0
  const snowInfo = getSnowInfo(snowDay)
  const snowStart = firstHour(snowSeries, (v) => v > 0)
  // From tomorrow on: today's total may be snow that has already fallen.
  const snowDayIdx = (daily.snowfall_sum ?? []).findIndex((v, i) => i > 0 && v > 0)
  const snowNote = snowStart === 0 ? 'Snow is falling now.'
    : snowStart > 0 ? `Snow starting around ${formatHour(times[snowStart], timezone)}.`
    : snowDayIdx > 0 ? `None in the next 24 hours; some expected ${weekdayLabel(daily.time[snowDayIdx], timezone)}.`
    : 'No more snow in the forecast.'

  const moon = getMoonInfo()
  const moonDate = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: timezone })
  const moonNote = moon.name === 'Full Moon' ? 'Full moon tonight.'
    : moon.name === 'New Moon' ? 'New moon; the darkest skies of the month.'
    : moon.waxing ? `Waxing; full moon in ${moon.daysToFull} days.`
    : `Waning; new moon in ${moon.daysToNew} days.`

  const pollen = getPollenInfo(airQuality)

  // A card that has nothing to say is null and left out of the grid: snow only
  // while there is some in the forecast or on the ground, pollen only where the
  // feed covers it.
  const panels = {
    precip: (
      <Panel
        icon={<CloudRain size={18} />}
        title="PRECIPITATION"
        value={Math.round(popNow)}
        unit="%"
        status={popInfo.label}
        note={precipNote}
        color={tint(popInfo.color)}
      >
        <PanelChart
          values={popSeries}
          times={times}
          timezone={timezone}
          color={tint(popInfo.color)}
          step={10}
          format={(v) => `${Math.round(v)}%`}
        />
        <StatRow
          items={[
            { label: 'Today’s total', value: daily.precipitation_sum?.[0] != null ? formatPrecip(daily.precipitation_sum[0], units) : null },
            { label: 'Today’s chance', value: daily.precipitation_probability_max?.[0] != null ? `${daily.precipitation_probability_max[0]}%` : null },
          ]}
        />
      </Panel>
    ),

    snow: snowWeek > 0 || snowDepthIn > 0 ? (
      <Panel
        icon={<Snowflake size={18} />}
        title="SNOW"
        value={snowNumber(snowDay)}
        unit={` ${metricSnow ? 'cm' : 'in'}`}
        status={snowDay > 0 ? `${snowInfo.label} · next 24h` : 'Next 24h'}
        note={snowNote}
        color={tint(snowInfo.color)}
      >
        <PanelChart
          values={snowSeries}
          times={times}
          timezone={timezone}
          color={tint(snowDay > 0 ? snowInfo.color : 'var(--cond-blue)')}
          step={0.5}
          format={snowText}
        />
        <StatRow
          items={[
            { label: 'On the ground', value: current.snow_depth != null ? snowText(snowDepthIn) : null },
            { label: 'Next 7 days', value: snowText(snowWeek) },
          ]}
        />
      </Panel>
    ) : null,

    storm: capeNow != null ? (
      <Panel
        icon={<CloudLightning size={18} />}
        title="THUNDERSTORM POTENTIAL"
        value={Math.round(capeNow).toLocaleString('en-US')}
        unit=" J/kg"
        status={getStormInfo(capeNow).label}
        note={getStormNote(capeNow)}
        color={tint(getStormInfo(capeNow).color)}
      >
        <PanelChart
          values={capeSeries}
          times={times}
          timezone={timezone}
          color={tint(getStormInfo(capeNow).color)}
          step={500}
        />
        <StatRow
          items={[
            {
              label: 'Peak next 24h',
              value: capePeak
                ? `${getStormInfo(capePeak.value).label} ${capePeak.time === times[0] ? 'now' : `at ${formatHour(capePeak.time, timezone)}`}`
                : null,
              color: capePeak ? tint(getStormInfo(capePeak.value).color) : undefined,
            },
          ]}
        />
      </Panel>
    ) : null,

    moon: (
      <Panel
        icon={<Moon size={18} />}
        title="MOON"
        value={Math.round(moon.illumination * 100)}
        unit="% lit"
        status={moon.name}
        note={moonNote}
      >
        <div className="web-moon">
          <MoonGlyph phase={moon.phase} south={weather.latitude < 0} />
        </div>
        <StatRow
          items={[
            { label: 'Next full moon', value: moonDate(moon.nextFull) },
            { label: 'Next new moon', value: moonDate(moon.nextNew) },
          ]}
        />
      </Panel>
    ),

    pollen: pollen ? (
      <Panel
        icon={<Flower2 size={18} />}
        title="POLLEN"
        value={Math.round(pollen.worst.count)}
        unit=" grains/m³"
        status={pollen.worst.level > 0 ? `${pollen.worst.label} · ${pollen.worst.name}` : pollen.worst.label}
        note={pollen.note}
        color={tint(pollen.worst.color)}
      >
        <StatRow
          items={pollen.groups.map((g) => ({
            label: g.name,
            value: g.label,
            color: tint(g.color),
          }))}
        />
      </Panel>
    ) : null,

    humidity: (
      <Panel
        icon={<Droplets size={18} />}
        title="HUMIDITY"
        value={Math.round(humidity)}
        unit="%"
        status={humInfo.label}
        note={getHumidityNote(humidity)}
        color={tint(humInfo.color)}
      >
        <PanelChart
          values={nextDay(hourly.relative_humidity_2m)}
          times={times}
          timezone={timezone}
          color={tint(humInfo.color)}
          step={10}
          format={(v) => `${Math.round(v)}%`}
        />
        <StatRow
          items={[
            { label: 'Dew point', value: current.dew_point_2m != null ? `${toTemp(current.dew_point_2m, unit)}°${unit}` : null },
            { label: 'Feels like', value: `${toTemp(current.apparent_temperature, unit)}°${unit}` },
          ]}
        />
      </Panel>
    ),

    wind: (
      <Panel
        icon={<WindTurbine size={19} style={{ color: tint(windInfo.color) }} />}
        title="WIND"
        value={unitText('wind', windSpeed, units)}
        unit={` ${unitSuffix('wind', units)}`}
        status={`From the ${windDir}`}
        note={getWindNote(windSpeed)}
        color={tint(windInfo.color)}
      >
        <PanelChart
          values={nextDay(hourly.wind_speed_10m)}
          times={times}
          timezone={timezone}
          color={tint(windInfo.color)}
          step={5}
          format={(v) => `${unitText('wind', v, units)} ${unitSuffix('wind', units)}`}
        />
        <StatRow
          items={[
            { label: 'Gusts', value: current.wind_gusts_10m != null ? `${unitText('wind', current.wind_gusts_10m, units)} ${unitSuffix('wind', units)}` : null },
            { label: 'Direction', value: `${windDir} · ${Math.round(current.wind_direction_10m)}°` },
          ]}
        />
      </Panel>
    ),

    pressure: (
      <Panel
        icon={<Gauge size={18} />}
        title="PRESSURE"
        value={unitText('pressure', pressure, units)}
        unit={` ${unitSuffix('pressure', units)}`}
        status={presInfo.label}
        note={presTrend?.note ?? 'Surface pressure at your location.'}
        color={tint(presInfo.color)}
      >
        <PanelChart
          values={nextDay(hourly.surface_pressure)}
          times={times}
          timezone={timezone}
          color={tint(presInfo.color)}
          step={2}
          format={(v) => unitText('pressure', v, units)}
        />
        <StatRow
          items={[
            {
              label: '3-hour trend',
              value: presTrend ? (
                <span className="web-detail-trend">
                  <TrendIcon size={14} aria-hidden="true" />
                  {presTrend.label} {formatUnitDelta('pressure', presTrend.delta, units)}
                </span>
              ) : null,
            },
            units.pressure === 'hPa'
              ? null
              : { label: 'Absolute', value: `${Math.round(pressure)} hPa` },
          ]}
        />
      </Panel>
    ),

    visibility: (
      <Panel
        icon={<Eye size={18} />}
        title="VISIBILITY"
        value={unitText('visibility', current.visibility, units) ?? '—'}
        unit={` ${unitSuffix('visibility', units)}`}
        status={visInfo?.label}
        note={visMi != null ? getVisibilityNote(visMi) : 'No visibility reading available here.'}
        color={visInfo ? tint(visInfo.color) : undefined}
      >
        <PanelChart
          values={nextDay(hourly.visibility)}
          times={times}
          timezone={timezone}
          color={visInfo ? tint(visInfo.color) : 'var(--accent)'}
          step={METERS_PER_MILE}
          format={(v) => `${unitText('visibility', v, units)} ${unitSuffix('visibility', units)}`}
        />
        <StatRow
          items={[
            { label: 'Cloud cover', value: current.cloud_cover != null ? `${Math.round(current.cloud_cover)}%` : null },
          ]}
        />
      </Panel>
    ),

    // Sun and UV used to share one double-width card. They are two different
    // readings — where the sun is now, and how strong it is — so each takes an
    // ordinary cell in the grid.
    sun: (
      <div className="card web-detail">
        <div className="web-detail-head">
          <span className="web-detail-head-icon" style={{ color: sunTint }}><Sun size={18} /></span>
          <span className="section-label">SUN</span>
        </div>
        <div className="web-sun-arc">
          <SunDial progress={sunProgress} sunFill={sunTint} wide />
          <div className="web-sun-times">
            <span className="web-sun-time">
              <Sunrise size={15} style={{ color: mono ? undefined : SUN_ORANGE }} aria-hidden="true" />
              {formatTime(daily.sunrise[0], timezone)}
            </span>
            <span className="web-sun-daylight">{daylightLength(daily.sunrise[0], daily.sunset[0]) ?? ''} of daylight</span>
            <span className="web-sun-time">
              <Sunset size={15} style={{ color: mono ? undefined : SUN_ORANGE }} aria-hidden="true" />
              {formatTime(daily.sunset[0], timezone)}
            </span>
          </div>
        </div>
      </div>
    ),

    uv: (
      <Panel
        icon={<Sun size={18} />}
        title="UV INDEX"
        value={Math.round(uvCurrent)}
        status={uv.label}
        note={getUVNote(uvCurrent)}
        color={tint(uv.color)}
      >
        <PanelChart
          values={uvSeries}
          times={times}
          timezone={timezone}
          color={tint(uv.color)}
          step={2}
          format={(v) => Math.round(v)}
        />
        <StatRow
          items={[
            {
              label: 'Peak next 24h',
              value: uvPeak ? `${Math.round(uvPeak.value)} at ${formatHour(uvPeak.time, timezone)}` : null,
              color: uvPeak ? tint(getUVLabel(uvPeak.value).color) : undefined,
            },
            { label: 'Today’s max', value: daily.uv_index_max?.[0] != null ? Math.round(daily.uv_index_max[0]) : null },
          ]}
        />
      </Panel>
    ),

    air: (
      <div className="card web-detail">
        <div className="web-detail-head">
          <span className="web-detail-head-icon" style={aqiInfo ? { color: tint(aqiInfo.color) } : undefined}>
            <Leaf size={18} />
          </span>
          <span className="section-label">AIR QUALITY</span>
        </div>
        {aqiInfo ? (
          <>
            <div className="web-detail-hero">
              <span className="web-detail-value" style={{ color: tint(aqiInfo.color) }}>
                {airQuality.us_aqi}
                <span className="web-detail-unit"> AQI</span>
              </span>
              <span className="web-detail-status" style={{ color: tint(aqiInfo.color) }}>{aqiInfo.label}</span>
            </div>
            <p className="web-detail-note">{getAQINote(airQuality.us_aqi)}</p>
            <div className="aqi-scale">
              <div className="aqi-gradient-bar">
                <div
                  className="aqi-marker"
                  style={{ left: `${Math.min((airQuality.us_aqi / 300) * 100, 100)}%`, background: tint(aqiInfo.color) }}
                />
              </div>
            </div>
            <button className="web-link-btn web-link-btn--block" onClick={() => onNavigate('air')}>
              Pollutants and 5-day outlook
              <ArrowRight size={14} />
            </button>
          </>
        ) : (
          <p className="web-detail-note">No air quality data for this location.</p>
        )}
      </div>
    ),
  }

  const shown = order.filter(id => panels[id])

  return (
    <div className="web-page">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={shown} strategy={rectSortingStrategy}>
          <div className="web-detail-grid">
            {shown.map(id => (
              <SortableWidget key={id} id={id} name={PANEL_NAMES[id]}>
                {panels[id]}
              </SortableWidget>
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  )
}
