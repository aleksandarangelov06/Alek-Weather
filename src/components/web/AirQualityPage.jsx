import { Leaf, Wind } from 'lucide-react'
import { getAQIInfo, getAQINote } from '../../utils/conditions'
import { smoothPath, useMeasure } from './chartUtils'
import { weekdayLabel } from './webData'

// The US AQI category breakpoints, as the fraction of the 0–300 dial each one
// spans. Everything above 300 is "Hazardous" and pins to the end of the scale.
const BANDS = [
  { to: 50,  label: 'Good',      color: 'var(--cond-green)'  },
  { to: 100, label: 'Moderate',  color: 'var(--cond-yellow)' },
  { to: 150, label: 'Sensitive', color: 'var(--cond-orange)' },
  { to: 200, label: 'Unhealthy', color: 'var(--cond-red)'    },
  { to: 300, label: 'Very bad',  color: 'var(--cond-purple)' },
]
const SCALE_MAX = 300

// Concentration each pollutant reaches when it alone would push the AQI to the
// "unhealthy for sensitive groups" boundary — the point where the bar is full.
// All values µg/m³, matching what Open-Meteo returns.
const POLLUTANTS = [
  { key: 'pm2_5',            name: 'PM2.5', full: 35.4,  desc: 'Fine particles' },
  { key: 'pm10',             name: 'PM10',  full: 154,   desc: 'Coarse particles' },
  { key: 'ozone',            name: 'O₃',    full: 140,   desc: 'Ground-level ozone' },
  { key: 'nitrogen_dioxide', name: 'NO₂',   full: 100,   desc: 'Traffic emissions' },
  { key: 'sulphur_dioxide',  name: 'SO₂',   full: 75,    desc: 'Industrial burning' },
  { key: 'carbon_monoxide',  name: 'CO',    full: 10000, desc: 'Combustion gas' },
]

const polar = (cx, cy, r, frac) => {
  const rad = (Math.PI * (1 - Math.min(Math.max(frac, 0), 1)))
  return [cx + r * Math.cos(rad), cy - r * Math.sin(rad)]
}

function arcPath(cx, cy, r, from, to) {
  const [x1, y1] = polar(cx, cy, r, from)
  const [x2, y2] = polar(cx, cy, r, to)
  return `M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`
}

// Half-dial reading of the current AQI. The coloured track is the scale itself,
// so the number never has to be interpreted against a separate legend.
function AqiDial({ aqi, info }) {
  const frac = Math.min(aqi / SCALE_MAX, 1)
  const [dotX, dotY] = polar(120, 120, 92, frac)
  return (
    <svg className="web-aqi-dial" viewBox="0 0 240 148" role="img" aria-label={`Air quality index ${aqi}, ${info.label}`}>
      {BANDS.map((b, i) => (
        <path
          key={b.to}
          className="web-aqi-band"
          d={arcPath(120, 120, 92, (i === 0 ? 0 : BANDS[i - 1].to) / SCALE_MAX, b.to / SCALE_MAX)}
          stroke={b.color}
        />
      ))}
      <circle className="web-aqi-dot" cx={dotX} cy={dotY} r="9" style={{ fill: info.color }} />
      <text className="web-aqi-dial-num" x="120" y="112" style={{ fill: info.color }}>{aqi}</text>
      <text className="web-aqi-dial-cap" x="120" y="136">US AQI</text>
    </svg>
  )
}

// AQI over the whole air-quality forecast window, with the category bands drawn
// behind the line so a spike's severity is readable without a legend lookup.
function AqiForecast({ hourly, timezone }) {
  const [ref, width] = useMeasure()
  const times = hourly?.time ?? []
  const values = hourly?.us_aqi ?? []
  if (!times.length || !values.length) return null

  // The air-quality feed starts at midnight today, so trim the hours already past.
  const nowKey = new Date().toLocaleString('sv', { timeZone: timezone }).slice(0, 13)
  const startAt = Math.max(0, times.findIndex((t) => t.slice(0, 13) >= nowKey))
  const t = times.slice(startAt)
  const v = values.slice(startAt)
  const pairs = t.map((time, i) => [time, v[i]]).filter(([, val]) => val != null)
  if (pairs.length < 2) return null

  const H = 210
  const TOP = 16
  const BASE = 168
  const maxVal = Math.max(SCALE_MAX / 2, ...pairs.map(([, val]) => val))
  const ceiling = Math.ceil(maxVal / 50) * 50
  const inner = Math.max(width - 24, 0)
  const x = (i) => 12 + (i / (pairs.length - 1)) * inner
  const y = (val) => TOP + (1 - val / ceiling) * (BASE - TOP)

  const pts = pairs.map(([, val], i) => [x(i), y(val)])
  const line = smoothPath(pts)
  const area = `${line} L ${pts[pts.length - 1][0]} ${BASE} L ${pts[0][0]} ${BASE} Z`

  const dayBreaks = []
  for (let i = 1; i < pairs.length; i++) {
    if (pairs[i][0].slice(0, 10) !== pairs[i - 1][0].slice(0, 10)) dayBreaks.push(i)
  }

  // Daily peaks, which is what actually decides whether a day is worth avoiding.
  const peaks = []
  for (const [time, val] of pairs) {
    const date = time.slice(0, 10)
    const last = peaks[peaks.length - 1]
    if (!last || last.date !== date) peaks.push({ date, peak: val })
    else last.peak = Math.max(last.peak, val)
  }

  return (
    <>
      <div className="web-chart" ref={ref}>
        {width > 0 && (
          <svg width={width} height={H} role="img" aria-label="Air quality index forecast">
            <defs>
              <linearGradient id="web-aqi-area" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--cond-orange)" stopOpacity="0.22" />
                <stop offset="100%" stopColor="var(--cond-green)" stopOpacity="0.04" />
              </linearGradient>
            </defs>

            {BANDS.filter((b) => b.to <= ceiling).map((b) => (
              <g key={b.to}>
                <line className="web-aqi-gridline" x1="12" y1={y(b.to)} x2={width - 12} y2={y(b.to)} stroke={b.color} />
                <text className="web-aqi-gridlabel" x={width - 12} y={y(b.to) - 4}>{b.to}</text>
              </g>
            ))}

            {dayBreaks.map((i) => (
              <g key={i}>
                <line className="web-chart-divider" x1={x(i)} y1={TOP} x2={x(i)} y2={BASE} />
                <text className="web-chart-dayname" x={x(i) + 6} y={TOP + 10}>
                  {weekdayLabel(pairs[i][0].slice(0, 10), timezone)}
                </text>
              </g>
            ))}

            <path d={area} fill="url(#web-aqi-area)" stroke="none" />
            <path d={line} fill="none" stroke="var(--graph-line)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx={pts[0][0]} cy={pts[0][1]} r="4" fill="var(--graph-line)" />
            <text className="web-chart-axis" x={x(0)} y={BASE + 22}>Now</text>
          </svg>
        )}
      </div>
      <div className="web-aqi-peaks">
        {peaks.map((p) => {
          const info = getAQIInfo(p.peak)
          return (
            <div key={p.date} className="web-aqi-peak">
              <span className="web-aqi-peak-day">{weekdayLabel(p.date, timezone)}</span>
              <span className="web-aqi-peak-val" style={{ color: info.color }}>{Math.round(p.peak)}</span>
              <span className="web-aqi-peak-label">{info.label}</span>
            </div>
          )
        })}
      </div>
    </>
  )
}

export function AirQualityPage({ airQuality, timezone }) {
  if (!airQuality || airQuality.us_aqi == null) {
    return (
      <div className="web-page">
        <div className="card web-empty">
          <Leaf size={34} aria-hidden="true" />
          <p>No air quality data is published for this location.</p>
        </div>
      </div>
    )
  }

  const info = getAQIInfo(airQuality.us_aqi)
  // The pollutant closest to its own concern level — the one actually driving
  // the index, which the single AQI number hides.
  const driver = POLLUTANTS
    .map((p) => ({ ...p, value: airQuality[p.key], ratio: airQuality[p.key] != null ? airQuality[p.key] / p.full : -1 }))
    .sort((a, b) => b.ratio - a.ratio)[0]

  return (
    <div className="web-page">
      <div className="web-page-head">
        <h2 className="web-page-title">Air quality</h2>
      </div>

      <div className="card web-aqi-hero">
        <AqiDial aqi={airQuality.us_aqi} info={info} />
        <div className="web-aqi-copy">
          <div className="web-aqi-status" style={{ color: info.color }}>{info.label}</div>
          <p className="web-aqi-note">{getAQINote(airQuality.us_aqi)}</p>
          {driver && driver.ratio >= 0 && (
            <p className="web-aqi-driver">
              <Wind size={15} aria-hidden="true" />
              Driven mainly by <strong>{driver.name}</strong> — {driver.desc.toLowerCase()} at {driver.value.toFixed(1)} µg/m³.
            </p>
          )}
          <div className="web-aqi-legend">
            {BANDS.map((b, i) => (
              <span key={b.to} className="web-aqi-legend-item">
                <span className="web-aqi-legend-swatch" style={{ background: b.color }} />
                {b.label}
                <span className="web-aqi-legend-range">{i === 0 ? 0 : BANDS[i - 1].to + 1}–{b.to}</span>
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="section-label">POLLUTANTS</div>
        <div className="web-poll-grid">
          {POLLUTANTS.map((p) => {
            const value = airQuality[p.key]
            if (value == null) return null
            const ratio = Math.min(value / p.full, 1)
            const barInfo = getAQIInfo(ratio * 150)
            return (
              <div key={p.key} className="web-poll">
                <div className="web-poll-top">
                  <span className="web-poll-name">{p.name}</span>
                  <span className="web-poll-value">
                    {value >= 1000 ? Math.round(value) : value.toFixed(1)}
                    <span className="web-poll-unit"> µg/m³</span>
                  </span>
                </div>
                <div className="web-poll-track">
                  <span className="web-poll-fill" style={{ width: `${Math.max(ratio * 100, 2)}%`, background: barInfo.color }} />
                </div>
                <div className="web-poll-desc">{p.desc}</div>
              </div>
            )
          })}
        </div>
      </div>

      {airQuality.hourly && (
        <div className="card">
          <div className="section-label">AQI OUTLOOK</div>
          <AqiForecast hourly={airQuality.hourly} timezone={timezone} />
        </div>
      )}
    </div>
  )
}
