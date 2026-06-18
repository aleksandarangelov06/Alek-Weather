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

export function AirQuality({ data }) {
  if (!data) return null

  const aqi = data.us_aqi
  const info = getAQIInfo(aqi)
  // marker position: 0–300 maps to 0–100%, capped
  const markerPct = Math.min((aqi / 300) * 100, 100)

  return (
    <div className="card">
      <div className="section-label">AIR QUALITY</div>

      <div className="aqi-main">
        <div className="aqi-number" style={{ color: info.color }}>{aqi}</div>
        <div className="aqi-info">
          <div className="aqi-status" style={{ color: info.color }}>{info.label}</div>
          <div className="aqi-sublabel">US AQI</div>
        </div>
      </div>

      <div className="aqi-scale">
        <div className="aqi-gradient-bar" />
        <div
          className="aqi-marker"
          style={{ left: `${markerPct}%`, borderColor: info.color }}
        />
      </div>

      <div className="aqi-pollutants">
        <Pollutant name="PM2.5" value={data.pm2_5}           unit="µg/m³" />
        <Pollutant name="PM10"  value={data.pm10}            unit="µg/m³" />
        <Pollutant name="O₃"   value={data.ozone}           unit="µg/m³" />
        <Pollutant name="NO₂"  value={data.nitrogen_dioxide} unit="µg/m³" />
      </div>
    </div>
  )
}
