import { useState } from 'react'
import { Wind, Droplets, Eye, Gauge, Sun, Sunrise, Sunset, Leaf, ChevronDown, ChevronUp } from 'lucide-react'
import { getWindDirection, getUVLabel, formatTime } from '../utils/weatherCodes'

function getAQIInfo(aqi) {
  if (aqi <= 50)  return { label: 'Good',                          color: '#22c55e' }
  if (aqi <= 100) return { label: 'Moderate',                      color: '#eab308' }
  if (aqi <= 150) return { label: 'Unhealthy for Sensitive Groups', color: '#f97316' }
  if (aqi <= 200) return { label: 'Unhealthy',                     color: '#ef4444' }
  if (aqi <= 300) return { label: 'Very Unhealthy',                color: '#a855f7' }
  return                 { label: 'Hazardous',                     color: '#7c3aed' }
}

function Pollutant({ name, value, unit }) {
  if (value == null) return null
  return (
    <div className="aqi-pollutant">
      <span className="aqi-poll-name">{name}</span>
      <span className="aqi-poll-val">{value.toFixed(1)}</span>
      <span className="aqi-poll-unit">{unit}</span>
    </div>
  )
}

function DetailCard({ icon, label, value, sub }) {
  return (
    <div className="detail-card">
      <div className="detail-icon">{icon}</div>
      <div className="detail-label">{label}</div>
      <div className="detail-value">{value}</div>
      {sub != null && <div className="detail-sub">{sub}</div>}
    </div>
  )
}

export function WeatherDetails({ current, daily, timezone, unit, airQuality }) {
  const [aqiExpanded, setAqiExpanded] = useState(false)

  const uv      = getUVLabel(current.uv_index)
  const windDir = getWindDirection(current.wind_direction_10m)
  const visMi   = (current.visibility / 1609.34).toFixed(1)
  const sunrise = formatTime(daily.sunrise[0], timezone)
  const sunset  = formatTime(daily.sunset[0], timezone)

  const aqiInfo   = airQuality ? getAQIInfo(airQuality.us_aqi) : null
  const markerPct = airQuality ? Math.min((airQuality.us_aqi / 300) * 100, 100) : 0

  return (
    <div className="card">
      <div className="section-label">DETAILS</div>
      <div className="details-grid">
        <DetailCard icon={<Droplets size={19} />} label="Humidity"   value={`${current.relative_humidity_2m}%`} />
        <DetailCard icon={<Wind size={19} />}     label="Wind"       value={`${Math.round(current.wind_speed_10m)} mph`} sub={windDir} />
        <DetailCard icon={<Sun size={19} />}      label="UV Index"   value={Math.round(current.uv_index)} sub={<span style={{ color: uv.color, fontWeight: 600 }}>{uv.label}</span>} />
        <DetailCard icon={<Gauge size={19} />}    label="Pressure"   value={`${Math.round(current.surface_pressure)} hPa`} />
        <DetailCard icon={<Eye size={19} />}      label="Visibility" value={`${visMi} mi`} />
        <DetailCard icon={<Sunrise size={19} />}  label="Sunrise"    value={sunrise} />
        <DetailCard icon={<Sunset size={19} />}   label="Sunset"     value={sunset} />

        {airQuality && (
          <div
            className={`detail-card detail-aqi-tile${aqiExpanded ? ' detail-aqi-tile--active' : ''}`}
            onClick={() => setAqiExpanded(v => !v)}
            role="button"
            aria-expanded={aqiExpanded}
          >
            <div className="detail-icon" style={{ color: aqiInfo.color }}><Leaf size={19} /></div>
            <div className="detail-label">Air Quality</div>
            <div className="detail-value" style={{ color: aqiInfo.color }}>{airQuality.us_aqi}</div>
            <div className="detail-sub detail-aqi-sub">
              {aqiInfo.label}
              {aqiExpanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
            </div>
          </div>
        )}
      </div>

      {aqiExpanded && airQuality && (
        <div className="detail-aqi-expansion">
          <div className="aqi-main">
            <div className="aqi-number" style={{ color: aqiInfo.color }}>{airQuality.us_aqi}</div>
            <div className="aqi-info">
              <div className="aqi-status" style={{ color: aqiInfo.color }}>{aqiInfo.label}</div>
              <div className="aqi-sublabel">US AQI</div>
            </div>
          </div>
          <div className="aqi-scale">
            <div className="aqi-gradient-bar">
              <div className="aqi-marker" style={{ left: `${markerPct}%`, borderColor: aqiInfo.color }} />
            </div>
          </div>
          <div className="aqi-pollutants">
            <Pollutant name="PM2.5" value={airQuality.pm2_5}            unit="µg/m³" />
            <Pollutant name="PM10"  value={airQuality.pm10}             unit="µg/m³" />
            <Pollutant name="O₃"   value={airQuality.ozone}            unit="µg/m³" />
            <Pollutant name="NO₂"  value={airQuality.nitrogen_dioxide} unit="µg/m³" />
          </div>
        </div>
      )}
    </div>
  )
}
