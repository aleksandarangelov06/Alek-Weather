import {
  CloudLightning, CloudRain, Droplets, Eye, Flower2, Gauge, Leaf, Moon, Snowflake,
  Sun, Sunrise, Sunset, TrendingDown, TrendingUp, Minus, Wind,
} from 'lucide-react'
import { AirQualityCard } from './AirQualityCard'
import { SunDial } from '../WeatherDetails'
import { WindTurbine } from '../WindTurbine'
import { formatHour, getUVLabel, getWindDirection, sunColor, toTemp, SUN_ORANGE } from '../../utils/weatherCodes'
import {
  getHumidityInfo, getHumidityNote, getPollenInfo, getPrecipInfo,
  getPressureInfo, getPressureTrend, getSnowInfo, getStormInfo, getStormNote,
  getUVNote, getVisibilityInfo, getVisibilityNote, getWindInfo, getWindNote,
} from '../../utils/conditions'
import { getMoonInfo } from '../../utils/moon'
import { formatMinutes, formatSpan, isoMinutes, sunTimes } from '../../utils/sunTimes'
import { useMeasure } from './chartUtils'
import { Sparkline } from './Sparkline'
import { currentHourIndex, METERS_PER_MILE, weekdayLabel } from './webData'
import { formatPrecip, formatUnitDelta, unitSuffix, unitText } from '../../utils/units'
import { useEffect, useRef, useState } from 'react'

// The page is a fixed set of topics rather than a board of movable cards: each
// reading lives in the same place every visit, next to the readings it goes
// with, and the bar at the top jumps straight to a topic.
const SECTIONS = [
  { id: 'rain',       title: 'Rain & storms',     icon: CloudRain, cards: ['precip', 'snow', 'storm'] },
  { id: 'atmosphere', title: 'Wind & atmosphere', icon: Wind,      cards: ['wind', 'humidity', 'pressure', 'visibility'] },
  { id: 'sky',        title: 'Sun, UV & moon',    icon: Sun,       cards: ['sun', 'uv', 'moon'] },
  { id: 'air',        title: 'Air quality',       icon: Leaf,      cards: ['air', 'pollen'] },
]

// Cards that take their section's whole width rather than one cell.
const FULL = new Set(['air'])

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

// The month's cycle as a track: the four principal phases drawn along it, and
// a marker for tonight, so "waning crescent" reads as "nearly back to new".
const CYCLE_STOPS = [
  { at: 0, label: 'New' },
  { at: 0.25, label: 'First qtr' },
  { at: 0.5, label: 'Full' },
  { at: 0.75, label: 'Last qtr' },
  { at: 1, label: 'New' },
]
function MoonCycle({ phase, south }) {
  return (
    <div className="web-moon-cycle" role="img" aria-label={`${Math.round(phase * 100)}% of the way through the lunar cycle`}>
      <div className="web-moon-cycle-stops">
        {CYCLE_STOPS.map((s) => (
          <span key={s.at} className="web-moon-cycle-stop" style={{ left: `${s.at * 100}%` }}>
            <MoonGlyph phase={s.at % 1} south={south} size={18} />
          </span>
        ))}
      </div>
      <div className="web-moon-cycle-track">
        <span className="web-moon-cycle-fill" style={{ width: `${phase * 100}%` }} />
        <span className="web-moon-cycle-marker" style={{ left: `${phase * 100}%` }} />
      </div>
      <div className="web-moon-cycle-labels">
        {CYCLE_STOPS.map((s) => (
          <span key={s.at} style={{ left: `${s.at * 100}%` }}>{s.label}</span>
        ))}
      </div>
    </div>
  )
}

// The UV index's five exposure bands as a bar, with the current reading marked
// on it. The bands are drawn equal rather than to scale: Extreme is open-ended,
// and to scale Low alone would take a quarter of the bar. Like the AQI dial the
// bands keep their colours with colour coding off, since they are the legend.
const UV_BANDS = [
  { from: 0,  to: 3,  color: 'var(--cond-green)'  },
  { from: 3,  to: 6,  color: 'var(--cond-yellow)' },
  { from: 6,  to: 8,  color: 'var(--cond-orange)' },
  { from: 8,  to: 11, color: 'var(--cond-red)'    },
  { from: 11, to: 14, color: 'var(--cond-purple)' },
]
function UVScale({ value, label, color }) {
  const v = Math.min(Math.max(value, 0), 13)
  const i = UV_BANDS.findIndex((b) => v < b.to)
  const band = UV_BANDS[i]
  // Each whole number gets an equal cell of its band; the marker sits mid-cell.
  const pct = ((i + (v - band.from + 0.5) / (band.to - band.from)) / UV_BANDS.length) * 100
  return (
    <div className="web-uv-scale" role="img" aria-label={`UV index ${value}, ${label}`}>
      <div className="web-uv-scale-bar">
        {UV_BANDS.map((b) => (
          <span key={b.from} className="web-uv-scale-band" style={{ background: b.color }} />
        ))}
        <span className="web-uv-scale-marker" style={{ left: `${pct}%`, background: color }} />
      </div>
      <div className="web-uv-scale-ticks" aria-hidden="true">
        {UV_BANDS.map((b, j) => (
          <span key={b.from} style={{ left: `${(j / UV_BANDS.length) * 100}%` }}>
            {j === UV_BANDS.length - 1 ? `${b.from}+` : b.from}
          </span>
        ))}
      </div>
    </div>
  )
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

export function DetailsPage({ weather, unit, units, airQuality, colorCoding }) {
  const { current, daily, hourly, timezone } = weather
  const mono = !colorCoding.details
  const tint = (c) => (mono ? 'var(--text-primary)' : c)
  // The section in view, lit up in the jump bar. The one whose top most
  // recently crossed the upper part of the window wins, so it changes as you
  // scroll into a section rather than when its last card leaves.
  const sectionRefs = useRef({})
  const navRef = useRef(null)
  const [active, setActive] = useState(SECTIONS[0].id)
  useEffect(() => {
    const els = Object.values(sectionRefs.current).filter(Boolean)
    if (!els.length || !('IntersectionObserver' in window)) return
    // The band starts just under the jump bar, which sticks below the header.
    // A fixed share of the window would not clear it: after a jump, the end of
    // the section before still shows under the bar, and on a short window that
    // sliver sat inside the band and stole the highlight. The bar's stuck
    // offset is read from its CSS (it follows the measured header height), plus
    // its 48px height and a little air.
    const stuckAt = navRef.current ? parseFloat(getComputedStyle(navRef.current).top) || 104 : 104
    const bandTop = Math.round(stuckAt + 48 + 8)
    const io = new IntersectionObserver((entries) => {
      const visible = entries.filter(e => e.isIntersecting)
      if (!visible.length) return
      visible.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
      setActive(visible[0].target.id.replace('details-', ''))
    }, { rootMargin: `-${bandTop}px 0px -60% 0px` })
    els.forEach(el => io.observe(el))
    return () => io.disconnect()
  }, [])

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
  // The card shows the reading rounded, so its band is read off the rounded
  // value too: a raw 2.4 shows as "2" and should say Low, not Moderate.
  const uvNow = Math.round(uvCurrent)
  const uv = getUVLabel(uvNow)

  // Highest reading still ahead in the 24 hours the chart covers, which at
  // night is tomorrow's midday rather than anything today.
  const uvPeak = uvSeries.reduce((best, value, i) => {
    if (value == null || !Number.isFinite(value)) return best
    return !best || value > best.value ? { value, time: times[i] } : best
  }, null)

  // The hours with UV 3 or more, when sun protection is advised: the stretch
  // under way now, or else the next one to start in the 24 hours ahead. Its end
  // is looked for a day further on, so a stretch that starts late in the
  // window (tomorrow morning, seen from this afternoon) still gets one.
  const uvAhead = (hourly.uv_index ?? []).slice(hStart, hStart + 48)
  const uvAheadTimes = (hourly.time ?? []).slice(hStart, hStart + 48)
  const protectFrom = uvAhead.findIndex((v, i) => i < 24 && v != null && Math.round(v) >= 3)
  const protectTo = protectFrom < 0 ? -1
    : uvAhead.findIndex((v, i) => i > protectFrom && (v == null || Math.round(v) < 3))
  const uvHourAt = (i) => formatHour(uvAheadTimes[i], timezone)
  const protectTomorrow = protectFrom > 0
    && uvAheadTimes[protectFrom].slice(0, 10) !== uvAheadTimes[0].slice(0, 10)
  const protection = protectFrom < 0 ? { label: 'Sun protection', value: 'Not needed' }
    : protectFrom === 0
      ? { label: 'Protection today', value: protectTo > 0 ? `Until ${uvHourAt(protectTo)}` : 'All day' }
      : {
          label: protectTomorrow ? 'Protection tomorrow' : 'Protection today',
          value: protectTo > 0 ? `${uvHourAt(protectFrom)} – ${uvHourAt(protectTo)}` : `From ${uvHourAt(protectFrom)}`,
        }

  // UV is zero at night, but "Low risk" reads oddly then; say why it's low and
  // when it stops being.
  const sunUp = uvNow > 0 || (hourly.is_day?.[hStart] ?? current.is_day ?? 1) === 1
  const protectStart = protectFrom > 0 ? `${uvHourAt(protectFrom)}${protectTomorrow ? ' tomorrow' : ''}` : null
  const uvNote = uvNow >= 3 ? getUVNote(uvNow)
    : protectStart
      ? `${sunUp ? 'Low for now' : 'No UV until morning'}; protection needed from ${protectStart}.`
      : sunUp ? getUVNote(uvNow) : 'No UV while the sun is down.'

  // Roughly how long fair skin (type II, which reddens after about 250 J/m²)
  // takes to burn unprotected. One point of UV index is 25 mW/m² of
  // sunburn-weighted sunlight, so the time falls off as 1/UV.
  const burnMins = uvNow > 0 ? 250 / (uvNow * 0.025) / 60 : null
  const burnText = burnMins == null ? 'None now'
    : burnMins >= 60 ? 'Over an hour'
    : `~${Math.round(burnMins / 5) * 5} min`

  const uvDayMax = (i) => {
    const v = daily.uv_index_max?.[i]
    if (v == null) return null
    const info = getUVLabel(Math.round(v))
    return { value: `${Math.round(v)} · ${info.label}`, color: tint(info.color) }
  }

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

  // Everything the Sun card says beyond the arc: what's next and how long until
  // it, twilight, solar noon, golden hour, and how the day is changing. All in
  // minutes after the location's midnight, like the arc above.
  const sun = sunTimes(daily.sunrise[0], daily.sunset[0], weather.latitude)
  const nowMin = (() => {
    const t = new Date().toLocaleString('sv', { timeZone: timezone })
    return +t.slice(11, 13) * 60 + +t.slice(14, 16)
  })()
  const riseTomorrow = daily.sunrise[1] ? isoMinutes(daily.sunrise[1]) : sun.rise
  const sunNext = nowMin < sun.rise ? { mins: sun.rise - nowMin, label: 'until sunrise' }
    : nowMin < sun.set ? { mins: sun.set - nowMin, label: 'until sunset' }
    : { mins: 1440 - nowMin + riseTomorrow, label: 'until sunrise' }
  const dayLen = sun.set - sun.rise
  const dayDelta = daily.sunrise[1] && daily.sunset[1]
    ? (isoMinutes(daily.sunset[1]) - isoMinutes(daily.sunrise[1])) - dayLen
    : null
  const sunNote = sun.goldenEvening != null && nowMin >= sun.goldenEvening && nowMin < sun.set
    ? 'Golden hour: the low, warm light lasts until sunset.'
    : sun.goldenMorning != null && nowMin >= sun.rise && nowMin < sun.goldenMorning
      ? `Morning golden hour, until ${formatMinutes(sun.goldenMorning)}.`
      : sun.dawn != null && nowMin >= sun.dawn && nowMin < sun.rise
        ? 'Dawn twilight: the sky is getting light.'
        : sun.dusk != null && nowMin >= sun.set && nowMin < sun.dusk
          ? `Dusk twilight; dark by ${formatMinutes(sun.dusk)}.`
          : nowMin >= sun.rise && nowMin < sun.noon
            ? `The sun is highest at ${formatMinutes(sun.noon)}.`
            : nowMin >= sun.noon && nowMin < sun.set && sun.goldenEvening != null
              ? `Golden hour starts at ${formatMinutes(sun.goldenEvening)}.`
              : sun.dawn != null
                ? `First light around ${formatMinutes(sun.dawn)}.`
                : 'The sun is below the horizon.'
  const dayTrend = dayDelta == null ? null
    : dayDelta === 0 ? 'About the same'
    : `${Math.abs(dayDelta)} min ${dayDelta < 0 ? 'shorter' : 'longer'}`

  const TrendIcon = presTrend?.label === 'Rising' ? TrendingUp
    : presTrend?.label === 'Falling' ? TrendingDown : Minus

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
  const moonAge = Math.round(moon.phase * 29.53)
  const daysText = (n) => (n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`)
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

    // The moon as it looks tonight beside its phase and brightness, then where
    // tonight sits in the month's cycle, then the dates that matter next.
    moon: (
      <div className="card web-detail">
        <div className="web-detail-head">
          <span className="web-detail-head-icon"><Moon size={18} /></span>
          <span className="section-label">MOON</span>
        </div>
        <div className="web-moon-main">
          <div className="web-moon-art">
            <MoonGlyph phase={moon.phase} south={weather.latitude < 0} size={104} />
          </div>
          <div className="web-moon-copy">
            <div className="web-moon-name">{moon.name}</div>
            <div className="web-moon-pct">
              <span className="web-detail-value">{Math.round(moon.illumination * 100)}<span className="web-detail-unit">%</span></span>
              <span className="web-moon-pct-label">illuminated</span>
            </div>
            <p className="web-detail-note">{moonNote}</p>
          </div>
        </div>
        <MoonCycle phase={moon.phase} south={weather.latitude < 0} />
        <StatRow
          items={[
            { label: 'Next full moon', value: `${moonDate(moon.nextFull)} · ${daysText(moon.daysToFull)}` },
            { label: 'Next new moon', value: `${moonDate(moon.nextNew)} · ${daysText(moon.daysToNew)}` },
            { label: 'Moon age', value: `${moonAge} ${moonAge === 1 ? 'day' : 'days'}` },
          ]}
        />
      </div>
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
        value={unitText('visibility', current.visibility, units) ?? '-'}
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
        <div className="web-detail-hero">
          <span className="web-detail-value">{formatSpan(sunNext.mins)}</span>
          <span className="web-detail-status">{sunNext.label}</span>
        </div>
        <p className="web-detail-note">{sunNote}</p>
        <div className="web-sun-arc">
          <SunDial progress={sunProgress} sunFill={sunTint} wide />
          <div className="web-sun-times">
            <span className="web-sun-time">
              <Sunrise size={15} style={{ color: mono ? undefined : SUN_ORANGE }} aria-hidden="true" />
              {formatMinutes(sun.rise)}
            </span>
            <span className="web-sun-daylight">{formatSpan(dayLen)} of daylight</span>
            <span className="web-sun-time">
              <Sunset size={15} style={{ color: mono ? undefined : SUN_ORANGE }} aria-hidden="true" />
              {formatMinutes(sun.set)}
            </span>
          </div>
        </div>
        <StatRow
          items={[
            { label: 'First light', value: sun.dawn != null ? formatMinutes(sun.dawn) : null },
            { label: 'Solar noon', value: formatMinutes(sun.noon) },
            { label: 'Last light', value: sun.dusk != null ? formatMinutes(sun.dusk) : null },
            {
              label: 'Golden hour',
              value: sun.goldenEvening != null ? `${formatMinutes(sun.goldenEvening)}` : null,
              color: mono ? undefined : SUN_ORANGE,
            },
            { label: 'Daylight tomorrow', value: dayTrend },
          ]}
        />
      </div>
    ),

    uv: (
      <Panel
        icon={<Sun size={18} />}
        title="UV INDEX"
        value={uvNow}
        status={uv.label}
        note={uvNote}
        color={tint(uv.color)}
      >
        <UVScale value={uvNow} label={uv.label} color={tint(uv.color)} />
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
              color: uvPeak ? tint(getUVLabel(Math.round(uvPeak.value)).color) : undefined,
            },
            { label: protection.label, value: protection.value },
            { label: 'Burn time · fair skin', value: burnText },
            { label: 'Today’s max', ...uvDayMax(0) },
            { label: 'Tomorrow’s max', ...uvDayMax(1) },
          ]}
        />
      </Panel>
    ),

    // Everything the old Air Quality tab showed, as one full-width card.
    air: <AirQualityCard airQuality={airQuality} timezone={timezone} tint={tint} />,
  }

  // Only the sections with something to show. A section drops a card that has
  // nothing to say (no snow in the forecast), and a whole section goes if all
  // of its cards do.
  const sections = SECTIONS
    .map(s => ({ ...s, ids: s.cards.filter(id => panels[id]) }))
    .filter(s => s.ids.length)

  return (
    <div className="web-page web-details">
      <nav className="card web-details-nav" aria-label="Details sections" ref={navRef}>
        {sections.map(s => (
          <a
            key={s.id}
            href={`#details-${s.id}`}
            className={`web-details-chip${active === s.id ? ' web-details-chip--active' : ''}`}
            aria-current={active === s.id ? 'true' : undefined}
            onClick={(e) => {
              e.preventDefault()
              document.getElementById(`details-${s.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }}
          >
            <s.icon size={15} aria-hidden="true" />
            {s.title}
          </a>
        ))}
      </nav>

      {sections.map(s => (
        <section
          key={s.id}
          id={`details-${s.id}`}
          className="web-details-section"
          aria-labelledby={`details-${s.id}-title`}
          ref={(el) => { sectionRefs.current[s.id] = el }}
        >
          <h2 className="web-details-heading" id={`details-${s.id}-title`}>
            <s.icon size={18} aria-hidden="true" />
            {s.title}
          </h2>
          <div className={`web-detail-grid web-detail-grid--${s.id}`}>
            {s.ids.map(id => (
              <div key={id} className={`web-detail-slot${FULL.has(id) ? ' web-detail-slot--full' : ''}`}>
                {panels[id]}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
