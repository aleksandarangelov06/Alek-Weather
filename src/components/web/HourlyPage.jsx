import { useState } from 'react'
import { Navigation2 } from 'lucide-react'
import { WeatherIcon } from '../WeatherIcon'
import {
  displayPrecipChance, formatHour, getUVLabel, getWeatherInfo, getWindDirection, liveWeatherCode,
  nowcastHourlyCode, precipTier, tempColor, tempStyle, toTemp,
} from '../../utils/weatherCodes'
import { WebTabs } from './WebTabs'
import { currentHourIndex, shortDate, sliceHourly, weekdayLabel } from './webData'

// The longest window the table offers. The API returns a week of hours, which
// is more rows than anyone scrolls; three days is where the old 24/48/72 range
// control topped out, so it is the span this page was already designed around.
const MAX_HOURS = 72

// The readings the menu offers. `overview` is the full table — every column at
// once, which is what this page has always shown. Every other entry narrows the
// table to Time, Conditions and that one reading, which then gets the room the
// other five columns were using: a larger number, its unit, and a bar giving
// the shape of the series at a glance.
//
// `field` names the array on the sliced hourly data. `scale` is how the bar is
// normalised: 'percent' pins it to 0–100 so two locations are comparable,
// 'zero' runs 0 to the window's high (right for wind, where zero is meaningful),
// and 'span' fits the window's own low-to-high (right for temperature, where a
// bar from absolute zero would be a flat line).
const METRICS = [
  { key: 'overview', label: 'Overview' },
  { key: 'temp',     label: 'Temperature',  field: 'temp',     scale: 'span' },
  { key: 'feels',    label: 'Feels Like',   field: 'feels',    scale: 'span' },
  { key: 'precip',   label: 'Precipitation', field: 'precip',  scale: 'percent' },
  { key: 'wind',     label: 'Wind',         field: 'wind',     scale: 'zero' },
  { key: 'gust',     label: 'Wind Gust',    field: 'gust',     scale: 'zero' },
  { key: 'humidity', label: 'Humidity',     field: 'humidity', scale: 'percent' },
]

export function HourlyPage({ weather, unit, radarClear, colorCoding }) {
  const [metric, setMetric] = useState('overview')
  const { current, hourly, daily, timezone } = weather
  const start = currentHourIndex(hourly, timezone)
  const count = Math.min(MAX_HOURS, hourly.time.length - start)
  const h = sliceHourly(hourly, start, count)

  // Every hour's code, corrected the same way the mobile strip corrects it, so
  // the table and the current conditions card never disagree.
  const codes = h.time.map((t, i) => (
    i === 0
      ? (liveWeatherCode(current, weather.minutely_15, radarClear) ?? h.code[i])
      : nowcastHourlyCode(h.code[i], weather.minutely_15, t, current.cloud_cover)
  ))

  // Table rows, split into one group per calendar day.
  const groups = []
  h.time.forEach((t, i) => {
    const date = t.slice(0, 10)
    if (!groups.length || groups[groups.length - 1].date !== date) groups.push({ date, rows: [] })
    groups[groups.length - 1].rows.push(i)
  })

  const active = METRICS.find((m) => m.key === metric) ?? METRICS[0]
  const focus = active.key !== 'overview'
  const values = focus ? h[active.field] ?? [] : []

  // A location with no data for a series (gusts are often missing) would give a
  // column of dashes, so its pill is offered but disabled rather than hidden —
  // the menu keeps the same shape everywhere, which makes it learnable.
  const hasData = (m) => !m.field || (h[m.field] ?? []).some((v) => v != null)

  // Bar bounds for the focused reading, from the whole visible window so every
  // row is measured against the same scale.
  const nums = values.filter((v) => v != null)
  const hi = nums.length ? Math.max(...nums) : 0
  const lo = nums.length ? Math.min(...nums) : 0
  const barPct = (v) => {
    if (v == null) return 0
    if (active.scale === 'percent') return Math.max(0, Math.min(100, v))
    if (active.scale === 'zero') return hi > 0 ? (v / hi) * 100 : 0
    // 'span': a floor of 6% so the coldest hour still reads as a bar rather
    // than an empty cell that looks like missing data.
    return hi === lo ? 100 : 6 + ((v - lo) / (hi - lo)) * 94
  }

  // That day's low and high, for the "out of" figure beside each temperature
  // and the small low at the bar's left end. Temperature reads them from the
  // daily forecast, so "today" means the whole day rather than the hours still
  // to come — the window starts at the current hour, and a low already passed
  // this morning would otherwise be missing. Feels Like has no daily series to
  // read (the API returns apparent temperature hourly only), so its figures are
  // the day's range across the hours in view.
  const dayRange = new Map()
  if (active.scale === 'span') {
    if (active.key === 'temp') {
      (daily?.time ?? []).forEach((date, i) => {
        const min = daily.temperature_2m_min?.[i]
        const max = daily.temperature_2m_max?.[i]
        if (min != null && max != null) dayRange.set(date, { min, max })
      })
    } else {
      h.time.forEach((t, i) => {
        const v = values[i]
        if (v == null) return
        const date = t.slice(0, 10)
        const seen = dayRange.get(date)
        if (!seen) dayRange.set(date, { min: v, max: v })
        else dayRange.set(date, { min: Math.min(seen.min, v), max: Math.max(seen.max, v) })
      })
    }
  }

  // The focused reading for one hour: what it prints, and how the bar is tinted.
  const focusCell = (i) => {
    const v = values[i]
    switch (active.key) {
      case 'precip': {
        const chance = displayPrecipChance(codes[i], precipTier(codes[i]) === 0 ? 0 : h.precip[i])
        return { text: `${chance}%`, pct: chance, zero: chance === 0 }
      }
      case 'humidity':
        return { text: v != null ? `${Math.round(v)}%` : '—', pct: barPct(v) }
      case 'wind':
      case 'gust':
        return {
          text: v != null ? `${Math.round(v)}` : '—',
          unit: v != null ? ` mph${active.key === 'wind' && h.windDir[i] != null ? ` ${getWindDirection(h.windDir[i])}` : ''}` : '',
          pct: barPct(v),
        }
      default: {
        if (v == null) return { text: '—', pct: 0 }
        const day = dayRange.get(h.time[i].slice(0, 10))
        return {
          text: `${toTemp(v, unit)}°`,
          pct: barPct(v),
          style: tempStyle(v, colorCoding.hourly, 0.35, colorCoding.glow, colorCoding.frost),
          // A gradient rather than a flat fill, so the bar carries the same
          // warm-to-cool reading the number does: cool at the scale's floor,
          // this hour's own colour at its right end.
          barBg: colorCoding.hourly
            ? `linear-gradient(90deg, ${tempColor(lo)}, ${tempColor(v)})`
            : 'var(--graph-line)',
          // "85° / 91°" — the hour against the day it belongs to — and the
          // day's low sitting small at the bar's left end.
          maxText: day ? `${toTemp(day.max, unit)}°` : null,
          lowText: day ? `${toTemp(day.min, unit)}°` : null,
          lowStyle: day ? tempStyle(day.min, colorCoding.hourly, 0.35, colorCoding.glow, colorCoding.frost) : undefined,
        }
      }
    }
  }

  return (
    <div className="web-page">
      <div id="hourly-table" className={`card web-table-card${focus ? ' web-table-card--focus' : ''}`}>
        {/* The menu and the column head stick as one element rather than two.
            Pinned separately they had to agree on an offset — the head parked
            below the menu's measured height — and any disagreement showed as a
            band of rows scrolling between them. One box cannot have a gap in
            the middle of itself.

            The menu is inside the card because it and the table are one object;
            a bar floating above the card read as a second navigation. It is
            still the same control as the page navigation, down to the sliding
            pill: the same component, which is what keeps the two identical
            rather than merely similar. */}
        <div className="web-table-stick">
          <div className="web-table-menu">
            <WebTabs
              tabs={METRICS.map((m) => ({ id: m.key, label: m.label, disabled: !hasData(m) }))}
              active={metric}
              onChange={setMetric}
              idPrefix="hourly-reading"
              controls="hourly-table"
              label="Hourly reading"
              className="web-tabs-wrap--inline"
            />
          </div>
          <div className="web-table-head">
            <span>Time</span>
            <span>Conditions</span>
            {focus ? (
              <span className="web-num">{active.label}</span>
            ) : (
              <>
                <span className="web-num">Temp</span>
                <span className="web-num">Precip</span>
                <span className="web-num">Wind</span>
                <span className="web-num">Humidity</span>
                <span className="web-num">UV</span>
              </>
            )}
          </div>
        </div>
        {groups.map((g) => (
          <div key={g.date} className="web-table-group">
            <div className="web-table-day">
              <span className="web-table-dayname">{weekdayLabel(g.date, timezone)}</span>
              <span className="web-table-daydate">{shortDate(g.date)}</span>
            </div>
            {g.rows.map((i) => {
              const info = getWeatherInfo(codes[i], !h.isDay[i])
              const chance = displayPrecipChance(codes[i], precipTier(codes[i]) === 0 ? 0 : h.precip[i])
              const uv = getUVLabel(h.uv[i] ?? 0)
              const cell = focus ? focusCell(i) : null
              return (
                <div key={h.time[i]} className={`web-table-row${i === 0 ? ' web-table-row--now' : ''}`}>
                  <span className="web-table-time">{i === 0 ? 'Now' : formatHour(h.time[i], timezone)}</span>
                  <span className="web-table-cond">
                    <span className="web-table-icon"><WeatherIcon id={info.icon} alt="" /></span>
                    {info.label}
                  </span>
                  {focus ? (
                    <span className={`web-focus-cell${cell.unit ? ' web-focus-cell--wide' : ''}${cell.lowText ? ' web-focus-cell--range' : ''}`}>
                      {cell.lowText && (
                        <span className="web-focus-low" style={cell.lowStyle}>{cell.lowText}</span>
                      )}
                      <span className="web-focus-track" aria-hidden="true">
                        <span
                          className={`web-focus-bar web-focus-bar--${active.key}`}
                          style={{ width: `${cell.pct}%`, background: cell.barBg }}
                        />
                      </span>
                      <span className={`web-num web-focus-value${cell.zero ? ' web-focus-value--zero' : ''}`} style={cell.style}>
                        {cell.text}
                        {cell.maxText && <span className="web-focus-max"> / {cell.maxText}</span>}
                        {cell.unit && <span className="web-unit">{cell.unit}</span>}
                      </span>
                    </span>
                  ) : (
                    <>
                      <span
                        className="web-num web-table-temp"
                        style={tempStyle(h.temp[i], colorCoding.hourly, 0.35, colorCoding.glow, colorCoding.frost)}
                      >
                        {toTemp(h.temp[i], unit)}°
                      </span>
                      <span className={`web-num web-table-precip${chance >= 30 ? ' web-table-precip--high' : chance > 0 ? '' : ' web-table-precip--zero'}`}>
                        {chance}%
                      </span>
                      <span className="web-num web-table-wind">
                        {h.windDir[i] != null && (
                          <Navigation2
                            size={12}
                            className="web-wind-arrow"
                            style={{ transform: `rotate(${h.windDir[i] + 180}deg)` }}
                            aria-hidden="true"
                          />
                        )}
                        {h.wind[i] != null ? `${Math.round(h.wind[i])}` : '—'}
                        <span className="web-unit"> mph {h.windDir[i] != null ? getWindDirection(h.windDir[i]) : ''}</span>
                      </span>
                      <span className="web-num">{h.humidity[i] != null ? `${Math.round(h.humidity[i])}%` : '—'}</span>
                      <span className="web-num" style={colorCoding.details && h.uv[i] != null ? { color: uv.color } : undefined}>
                        {h.uv[i] != null ? Math.round(h.uv[i]) : '—'}
                      </span>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
