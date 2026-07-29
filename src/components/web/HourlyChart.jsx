import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Droplet, Sunrise, Sunset } from 'lucide-react'
import { WeatherIcon } from '../WeatherIcon'
import {
  displayPrecipChance, getWeatherInfo, precipTier, tempColor, toTemp, RAIN_CODES, SNOW_CODES,
} from '../../utils/weatherCodes'
import { smoothPath } from './chartUtils'

// One hour per column, at a width that leaves the icon and both numbers room to
// breathe. The chart is wider than the card and scrolls, rather than squeezing
// a day and a half into whatever the window happens to be.
export const COL_W = 92
// Fixed so the degree scale in the left gutter, which sits outside the scroller
// and therefore can't measure the columns, can be offset to line up with the
// plot. Kept in sync with the height of .web-hcol in WebApp.css.
const HEAD_H = 96
const PLOT_H = 240
const PAD_TOP = 18
const BASE = 200      // temperature curve's zero line
const SUN_Y = 226     // the sunrise/sunset markers ride below the curve

// The API hands back naive local wall-clock strings ("2026-07-29T06:01") that
// are already in the location's timezone. Reading the digits straight out is
// both cheaper and, unlike passing them through Date, correct for a city in a
// different timezone from the browser.
function wallClock(iso) {
  const h = +iso.slice(11, 13)
  const m = iso.slice(14, 16)
  const suffix = h < 12 ? 'AM' : 'PM'
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${suffix}`
}

function hourLabel(iso) {
  const h = +iso.slice(11, 13)
  return `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`
}

function dayLabel(iso) {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`)
  return d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' })
}

// Gridline values every `step` degrees across the range, in display units.
function ticksFor(min, max, step) {
  const out = []
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) out.push(v)
  return out
}

// Contiguous runs of hours sharing a predicate, as [start, end) index pairs.
function runsOf(items, classify) {
  const runs = []
  items.forEach((item, i) => {
    const kind = classify(item, i)
    const last = runs[runs.length - 1]
    if (last && last.kind === kind) last.end = i + 1
    else runs.push({ kind, start: i, end: i + 1 })
  })
  return runs
}

// Falling particles for one precipitation band. Deterministic — derived from
// the index rather than Math.random — so a re-render doesn't reshuffle the rain
// mid-animation.
function Particles({ count, snow }) {
  const drops = useMemo(() => Array.from({ length: count }, (_, i) => ({
    left: ((i * 37) % 100) + ((i % 3) - 1) * 0.7,
    delay: -(((i * 41) % 100) / 100) * (snow ? 3.4 : 1.3),
    dur: snow ? 3 + ((i * 13) % 7) * 0.22 : 0.85 + ((i * 17) % 5) * 0.14,
    len: snow ? 0 : 7 + ((i * 7) % 4) * 3,
  })), [count, snow])

  return drops.map((d, i) => (
    <span
      key={i}
      className={snow ? 'web-fx-flake' : 'web-fx-drop'}
      style={{
        left: `${d.left}%`,
        animationDelay: `${d.delay}s`,
        animationDuration: `${d.dur}s`,
        ...(snow ? null : { height: `${d.len}px` }),
      }}
    />
  ))
}

export function HourlyChart({
  hours, codes, tempsF, feelsF, precip, isDay, sunEvents, unit, colorCoding, animate, showFeels,
}) {
  const scrollRef = useRef(null)
  const [edges, setEdges] = useState({ left: false, right: true })

  const trackW = hours.length * COL_W
  const x = (i) => i * COL_W + COL_W / 2

  const series = showFeels && feelsF.some((v) => v != null) ? feelsF : tempsF
  const display = series.map((t, i) => toTemp(t ?? tempsF[i], unit))
  const lo = Math.min(...display)
  const hi = Math.max(...display)
  const step = unit === 'C' ? 5 : 10
  // A quarter-step of air above and below, so the curve clears the edges without
  // the scale ballooning to twice the range the data actually covers.
  const min = Math.floor((lo - step * 0.25) / step) * step
  const max = Math.ceil((hi + step * 0.25) / step) * step
  const y = (t) => PAD_TOP + (1 - (t - min) / (max - min || 1)) * (BASE - PAD_TOP)
  const ticks = ticksFor(min, max, step)

  const pts = display.map((t, i) => [x(i), y(t)])
  const line = smoothPath(pts)
  const area = pts.length ? `${line} L ${x(hours.length - 1)} ${BASE} L ${x(0)} ${BASE} Z` : ''

  // Where precipitation actually falls, and as what. These bands replace the
  // old night shading: what the hour is doing matters more here than whether
  // the sun happens to be up.
  const wetRuns = runsOf(codes, (code) => {
    if (precipTier(code) === 0) return null
    if (SNOW_CODES.has(code)) return 'snow'
    return RAIN_CODES.has(code) ? 'rain' : null
  }).filter((r) => r.kind)

  const chanceAt = (i) => displayPrecipChance(codes[i], precipTier(codes[i]) === 0 ? 0 : precip[i])
  const chanceRuns = runsOf(hours, (_, i) => chanceAt(i) > 0)

  const syncEdges = () => {
    const el = scrollRef.current
    if (!el) return
    setEdges({
      left: el.scrollLeft > 4,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4,
    })
  }

  // Re-check which arrows are reachable whenever the window's worth of hours
  // changes (the 24/48/72 switch), not just on scroll.
  useEffect(syncEdges, [hours.length])

  const scrollBy = (dir) => {
    const el = scrollRef.current
    if (!el) return
    el.scrollBy({ left: dir * Math.max(el.clientWidth - COL_W, COL_W), behavior: 'smooth' })
  }

  return (
    <div className="web-hchart">
      <div className="web-hchart-frame">
        {/* Fixed gutter: the degree scale stays put while the hours scroll. */}
        <div className="web-hchart-yaxis" style={{ height: PLOT_H, marginTop: HEAD_H }} aria-hidden="true">
          {ticks.map((t) => (
            <span key={t} className="web-hchart-ytick" style={{ top: y(t) }}>{t}°</span>
          ))}
        </div>

        <div className="web-hchart-scroll" ref={scrollRef} onScroll={syncEdges}>
          <div className="web-hchart-track" style={{ width: trackW }}>
            <div className="web-hchart-cols">
              {hours.map((iso, i) => {
                const info = getWeatherInfo(codes[i], !isDay[i])
                const newDay = i > 0 && iso.slice(0, 10) !== hours[i - 1].slice(0, 10)
                return (
                  <div key={iso} className={`web-hcol${i === 0 ? ' web-hcol--now' : ''}`} style={{ width: COL_W }}>
                    <span className="web-hcol-day">{newDay ? dayLabel(iso) : ''}</span>
                    <span className="web-hcol-time">{i === 0 ? 'Now' : hourLabel(iso)}</span>
                    <span className="web-hcol-icon"><WeatherIcon id={info.icon} alt={info.label} /></span>
                    <span className="web-hcol-temp">{toTemp(series[i] ?? tempsF[i], unit)}°</span>
                  </div>
                )
              })}
            </div>

            <div className="web-hchart-plot" style={{ height: PLOT_H }}>
              <svg width={trackW} height={PLOT_H} aria-label="Hourly temperature">
                <defs>
                  {/* Hue comes from the temperature at each hour, running left
                      to right; the fade to transparent comes from the mask
                      below. Kept as two passes because one gradient can't run
                      in two directions at once. */}
                  <linearGradient id="web-hchart-fill" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={trackW} y2="0">
                    {display.map((t, i) => (
                      <stop
                        key={i}
                        offset={`${(i / (display.length - 1 || 1)) * 100}%`}
                        stopColor={colorCoding ? tempColor(series[i] ?? tempsF[i]) : 'var(--graph-line)'}
                      />
                    ))}
                  </linearGradient>
                  <linearGradient id="web-hchart-fade" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#fff" stopOpacity="0.85" />
                    <stop offset="100%" stopColor="#fff" stopOpacity="0.06" />
                  </linearGradient>
                  <mask id="web-hchart-mask">
                    <rect x="0" y="0" width={trackW} height={PLOT_H} fill="url(#web-hchart-fade)" />
                  </mask>
                </defs>

                {ticks.map((t) => (
                  <line key={t} className="web-hchart-grid" x1="0" y1={y(t)} x2={trackW} y2={y(t)} />
                ))}
                {/* One tick per hour, and a full-height rule where the date
                    rolls over — the day break is structure, the hourly marks
                    are just a ruler, so they are drawn at different weights. */}
                {hours.map((iso, i) => (
                  i > 0 && iso.slice(0, 10) !== hours[i - 1].slice(0, 10) ? (
                    <line key={iso} className="web-hchart-daybreak" x1={i * COL_W} y1="0" x2={i * COL_W} y2={BASE} />
                  ) : (
                    <line key={iso} className="web-hchart-vgrid" x1={i * COL_W} y1={BASE - 6} x2={i * COL_W} y2={BASE} />
                  )
                ))}

                <path d={area} fill="url(#web-hchart-fill)" mask="url(#web-hchart-mask)" stroke="none" />
                {/* Same gradient as the fill, so the curve is the saturated
                    edge of its own band rather than a grey line laid over it. */}
                <path
                  className="web-hchart-line"
                  d={line}
                  fill="none"
                  stroke={colorCoding ? 'url(#web-hchart-fill)' : 'var(--graph-line)'}
                />

                {sunEvents.map((e) => (
                  <line
                    key={`${e.type}-${e.iso}`}
                    className="web-hchart-sunline"
                    x1={e.x} y1={PAD_TOP - 10} x2={e.x} y2={BASE}
                  />
                ))}
              </svg>

              {/* Rain and snow, drawn over the hours they fall in. */}
              <div className="web-hchart-fx" aria-hidden="true">
                {wetRuns.map((run) => (
                  <div
                    key={`${run.kind}-${run.start}`}
                    className={`web-fx-band web-fx-band--${run.kind}`}
                    style={{ left: run.start * COL_W, width: (run.end - run.start) * COL_W, height: BASE }}
                  >
                    {animate && (
                      <Particles
                        count={Math.min(Math.round((run.end - run.start) * (run.kind === 'snow' ? 5 : 7)), 60)}
                        snow={run.kind === 'snow'}
                      />
                    )}
                  </div>
                ))}
              </div>

              {sunEvents.map((e) => (
                <span key={`${e.type}-lbl-${e.iso}`} className="web-hchart-sun" style={{ left: e.x, top: SUN_Y }}>
                  {e.type === 'sunrise' ? <Sunrise size={14} /> : <Sunset size={14} />}
                  {wallClock(e.iso)}
                </span>
              ))}
            </div>

            {/* Chance of precipitation: a solid band across the hours where any
                is expected, hatched where none is, with a reading every other
                column so the numbers don't collide. */}
            <div className="web-hchart-precip">
              {chanceRuns.map((run) => (
                <div
                  key={run.start}
                  className={`web-pband${run.kind ? ' web-pband--wet' : ''}`}
                  style={{ left: run.start * COL_W, width: (run.end - run.start) * COL_W }}
                />
              ))}
              {hours.map((iso, i) => (
                i % 2 === 0 ? (
                  <span key={iso} className="web-pchip" style={{ left: x(i) }}>
                    <Droplet size={11} />
                    {chanceAt(i)}%
                  </span>
                ) : null
              ))}
            </div>
          </div>
        </div>

        <button
          className={`web-hchart-nav web-hchart-nav--left${edges.left ? '' : ' web-hchart-nav--hidden'}`}
          onClick={() => scrollBy(-1)}
          aria-label="Scroll to earlier hours"
        >
          <ChevronLeft size={18} />
        </button>
        <button
          className={`web-hchart-nav web-hchart-nav--right${edges.right ? '' : ' web-hchart-nav--hidden'}`}
          onClick={() => scrollBy(1)}
          aria-label="Scroll to later hours"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      <div className="web-hchart-legend">
        <span className="web-hchart-legend-item">
          <span className="web-hchart-legend-temp" />
          {showFeels ? 'Feels like' : 'Temperature'}
        </span>
        <span className="web-hchart-legend-item">
          <span className="web-hchart-legend-precip" />
          Chance of precipitation
        </span>
      </div>
    </div>
  )
}
