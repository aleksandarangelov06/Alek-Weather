import { ArrowRight, Droplets, Eye, Gauge, Leaf, Sun, Sunrise, Sunset, TrendingDown, TrendingUp, Minus } from 'lucide-react'
import { SunDial } from '../WeatherDetails'
import { WindTurbine } from '../WindTurbine'
import { formatHour, formatTime, getUVLabel, getWindDirection, sunColor, toTemp, SUN_ORANGE } from '../../utils/weatherCodes'
import {
  getAQIInfo, getAQINote, getHumidityInfo, getHumidityNote, getPressureInfo, getPressureTrend,
  getUVNote, getVisibilityInfo, getVisibilityNote, getWindInfo, getWindNote,
} from '../../utils/conditions'
import { useMeasure } from './chartUtils'
import { Sparkline } from './Sparkline'
import { currentHourIndex, daylightLength, HPA_PER_INHG, METERS_PER_MILE } from './webData'

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
          <span className="web-detail-chart-range">
            {format(Math.min(...clean))} – {format(Math.max(...clean))}
          </span>
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

export function DetailsPage({ weather, unit, airQuality, colorCoding, onNavigate }) {
  const { current, daily, hourly, timezone } = weather
  const mono = !colorCoding.details
  const tint = (c) => (mono ? 'var(--text-primary)' : c)

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

  return (
    <div className="web-page">
      <div className="web-page-head">
        <div>
          <h2 className="web-page-title">Conditions in detail</h2>
          <p className="web-page-sub">Every current reading, what it means, and how it moves over the next 24 hours.</p>
        </div>
      </div>

      <div className="web-detail-grid">
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

        <Panel
          icon={<WindTurbine size={19} style={{ color: tint(windInfo.color) }} />}
          title="WIND"
          value={Math.round(windSpeed)}
          unit=" mph"
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
            format={(v) => `${Math.round(v)} mph`}
          />
          <StatRow
            items={[
              { label: 'Gusts', value: current.wind_gusts_10m != null ? `${Math.round(current.wind_gusts_10m)} mph` : null },
              { label: 'Direction', value: `${windDir} · ${Math.round(current.wind_direction_10m)}°` },
            ]}
          />
        </Panel>

        <Panel
          icon={<Gauge size={18} />}
          title="PRESSURE"
          value={(pressure / HPA_PER_INHG).toFixed(2)}
          unit=" inHg"
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
            format={(v) => (v / HPA_PER_INHG).toFixed(2)}
          />
          <StatRow
            items={[
              {
                label: '3-hour trend',
                value: presTrend ? (
                  <span className="web-detail-trend">
                    <TrendIcon size={14} aria-hidden="true" />
                    {presTrend.label} {presTrend.delta > 0 ? '+' : ''}{presTrend.delta.toFixed(1)} hPa
                  </span>
                ) : null,
              },
              { label: 'Absolute', value: `${Math.round(pressure)} hPa` },
            ]}
          />
        </Panel>

        <Panel
          icon={<Eye size={18} />}
          title="VISIBILITY"
          value={visMi != null ? visMi.toFixed(1) : '—'}
          unit=" mi"
          status={visInfo?.label}
          note={visMi != null ? getVisibilityNote(visMi) : 'No visibility reading available here.'}
          color={visInfo ? tint(visInfo.color) : undefined}
        >
          <PanelChart
            values={nextDay(hourly.visibility).map((v) => (v == null ? null : v / METERS_PER_MILE))}
            times={times}
            timezone={timezone}
            color={visInfo ? tint(visInfo.color) : 'var(--accent)'}
            step={2}
            format={(v) => `${v.toFixed(1)} mi`}
          />
          <StatRow
            items={[
              { label: 'Cloud cover', value: current.cloud_cover != null ? `${Math.round(current.cloud_cover)}%` : null },
            ]}
          />
        </Panel>

        <div className="card web-detail web-detail--wide">
          <div className="web-detail-head">
            <span className="web-detail-head-icon" style={{ color: sunTint }}><Sun size={18} /></span>
            <span className="section-label">SUN &amp; UV</span>
          </div>
          <div className="web-sun-layout">
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
            <div className="web-sun-uv">
              <div className="web-detail-hero">
                <span className="web-detail-value" style={{ color: tint(uv.color) }}>
                  {Math.round(uvCurrent)}
                  <span className="web-detail-unit"> UV</span>
                </span>
                <span className="web-detail-status" style={{ color: tint(uv.color) }}>{uv.label}</span>
              </div>
              <p className="web-detail-note">{getUVNote(uvCurrent)}</p>
              <PanelChart
                values={uvSeries}
                times={times}
                timezone={timezone}
                color={tint(uv.color)}
                step={2}
                format={(v) => Math.round(v)}
              />
            </div>
          </div>
        </div>

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
      </div>
    </div>
  )
}
