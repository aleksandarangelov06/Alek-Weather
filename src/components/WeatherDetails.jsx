import { Wind, Droplets, Eye, Thermometer, Gauge, Sun, Sunrise, Sunset } from 'lucide-react'
import { getWindDirection, getUVLabel, formatTime } from '../utils/weatherCodes'

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

export function WeatherDetails({ current, daily, timezone }) {
  const uv = getUVLabel(current.uv_index)
  const windDir = getWindDirection(current.wind_direction_10m)
  const visibilityMi = (current.visibility / 1609.34).toFixed(1)
  const sunrise = formatTime(daily.sunrise[0], timezone)
  const sunset = formatTime(daily.sunset[0], timezone)

  return (
    <div className="card">
      <div className="section-label">DETAILS</div>
      <div className="details-grid">
        <DetailCard
          icon={<Thermometer size={19} />}
          label="Feels Like"
          value={`${Math.round(current.apparent_temperature)}°F`}
        />
        <DetailCard
          icon={<Droplets size={19} />}
          label="Humidity"
          value={`${current.relative_humidity_2m}%`}
        />
        <DetailCard
          icon={<Wind size={19} />}
          label="Wind"
          value={`${Math.round(current.wind_speed_10m)} mph`}
          sub={windDir}
        />
        <DetailCard
          icon={<Sun size={19} />}
          label="UV Index"
          value={Math.round(current.uv_index)}
          sub={<span style={{ color: uv.color, fontWeight: 600 }}>{uv.label}</span>}
        />
        <DetailCard
          icon={<Gauge size={19} />}
          label="Pressure"
          value={`${Math.round(current.surface_pressure)} hPa`}
        />
        <DetailCard
          icon={<Eye size={19} />}
          label="Visibility"
          value={`${visibilityMi} mi`}
        />
        <DetailCard
          icon={<Sunrise size={19} />}
          label="Sunrise"
          value={sunrise}
        />
        <DetailCard
          icon={<Sunset size={19} />}
          label="Sunset"
          value={sunset}
        />
      </div>
    </div>
  )
}
