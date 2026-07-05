import { useState, useRef } from 'react'
import { Wind, Droplets, Eye, Gauge, Sun, Sunrise, Sunset, Leaf, AlertTriangle, ShieldAlert, ChevronDown, ChevronUp, Navigation2 } from 'lucide-react'
import { getWindDirection, getUVLabel, formatTime } from '../utils/weatherCodes'

function getAQIInfo(aqi) {
  if (aqi <= 50)  return { label: 'Good',                          color: '#22c55e' }
  if (aqi <= 100) return { label: 'Moderate',                      color: '#eab308' }
  if (aqi <= 150) return { label: 'Unhealthy for Sensitive Groups', color: '#f97316' }
  if (aqi <= 200) return { label: 'Unhealthy',                     color: '#ef4444' }
  if (aqi <= 300) return { label: 'Very Unhealthy',                color: '#a855f7' }
  return                 { label: 'Hazardous',                     color: '#7c3aed' }
}

function getWindInfo(speed) {
  if (speed < 5)  return { color: '#22c55e', size: 13 }
  if (speed < 15) return { color: '#84cc16', size: 15 }
  if (speed < 25) return { color: '#eab308', size: 17 }
  if (speed < 35) return { color: '#f97316', size: 19 }
  if (speed < 45) return { color: '#ef4444', size: 21 }
  return               { color: '#a855f7',  size: 23 }
}

function getHumidityInfo(pct) {
  if (pct < 25) return { color: '#60a5fa', label: 'Dry'       }
  if (pct < 50) return { color: '#22c55e', label: 'Good'      }
  if (pct < 65) return { color: '#eab308', label: 'Fair'      }
  if (pct < 80) return { color: '#f97316', label: 'High'      }
  return              { color: '#ef4444',  label: 'Very High' }
}

function getPressureInfo(hpa) {
  if (hpa < 980)  return { color: '#ef4444', label: 'Stormy'   }
  if (hpa < 1000) return { color: '#f97316', label: 'Low'      }
  if (hpa < 1020) return { color: '#22c55e', label: 'Normal'   }
  if (hpa < 1030) return { color: '#60a5fa', label: 'High'     }
  return               { color: '#a855f7',  label: 'Very High' }
}

function getVisibilityInfo(miles) {
  if (miles < 0.5) return { color: '#ef4444', label: 'Dense Fog' }
  if (miles < 2)   return { color: '#f97316', label: 'Fog'       }
  if (miles < 5)   return { color: '#eab308', label: 'Haze'      }
  if (miles < 10)  return { color: '#84cc16', label: 'Fair'      }
  return                { color: '#22c55e',  label: 'Clear'     }
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

function DetailCard({ icon, label, value, sub, color, onClick, isExpanded, onDragStart, onDragEnter, onDragEnd, onDragOver, isDragging, isDragOver }) {
  const expandable = Boolean(onClick)
  return (
    <div
      className={`detail-card${expandable ? ' detail-expand-tile' : ''}${isExpanded ? ' detail-expand-tile--active' : ''}${isDragOver ? ' detail-card--drag-over' : ''}`}
      onClick={onClick}
      role={expandable ? 'button' : undefined}
      aria-expanded={expandable ? isExpanded : undefined}
      draggable
      onDragStart={onDragStart}
      onDragEnter={onDragEnter}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      style={{ opacity: isDragging ? 0.35 : 1, cursor: isDragging ? 'grabbing' : 'grab' }}
    >
      <div className="detail-icon" style={color ? { color } : undefined}>{icon}</div>
      <div className="detail-label">{label}</div>
      <div className="detail-value" style={color ? { color } : undefined}>{value}</div>
      {(sub != null || expandable) && (
        <div className={`detail-sub${expandable ? ' detail-sub--expand' : ''}`}>
          {sub}
          {expandable && (isExpanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />)}
        </div>
      )}
    </div>
  )
}

export function WeatherDetails({ current, daily, hourly, timezone, airQuality }) {
  const [expanded, setExpanded] = useState(null)
  const toggle = (key) => setExpanded(v => v === key ? null : key)

  const [cardOrder, setCardOrder] = useState(['humidity', 'wind', 'pressure', 'visibility', 'sunrise', 'sunset', 'uv', 'aqi'])
  const [draggingKey, setDraggingKey] = useState(null)
  const [dragOverKey, setDragOverKey] = useState(null)
  const dragSrc = useRef(null)
  const dragTarget = useRef(null)

  const handleDragStart = (key) => { dragSrc.current = key; setDraggingKey(key) }
  const handleDragEnter = (key) => { dragTarget.current = key; setDragOverKey(key) }
  const handleDragOver  = (e)   => e.preventDefault()
  const handleDragEnd   = ()    => {
    const src = dragSrc.current
    const tgt = dragTarget.current
    if (src && tgt && src !== tgt) {
      setCardOrder(prev => {
        const next = [...prev]
        const from = next.indexOf(src)
        const to   = next.indexOf(tgt)
        next.splice(from, 1)
        next.splice(to, 0, src)
        return next
      })
    }
    dragSrc.current = null
    dragTarget.current = null
    setDraggingKey(null)
    setDragOverKey(null)
  }

  const windDir = getWindDirection(current.wind_direction_10m)
  const visMi   = (current.visibility / 1609.34).toFixed(1)
  const sunrise = formatTime(daily.sunrise[0], timezone)
  const sunset  = formatTime(daily.sunset[0], timezone)

  const aqiInfo   = airQuality ? getAQIInfo(airQuality.us_aqi) : null
  const markerPct = airQuality ? Math.min((airQuality.us_aqi / 300) * 100, 100) : 0
  // AQI > 150 is "Unhealthy" or worse — swap the leaf for a warning symbol.
  // AQI > 200 is "Very Unhealthy"/"Hazardous" — advise wearing a mask outdoors.
  const aqiBad       = airQuality ? airQuality.us_aqi > 150 : false
  const aqiHazardous = airQuality ? airQuality.us_aqi > 200 : false

  const humInfo  = getHumidityInfo(current.relative_humidity_2m)
  const presInfo = getPressureInfo(current.surface_pressure)
  const visInfo  = getVisibilityInfo(parseFloat(visMi))
  const windInfo = getWindInfo(current.wind_speed_10m)

  // Hourly window
  const now = new Date()
  const currentHourStr = now.toLocaleString('en-CA', { hour: '2-digit', hour12: false, timeZone: timezone })
  const todayStr = now.toLocaleDateString('en-CA', { timeZone: timezone })
  const startIdx = hourly ? hourly.time.findIndex(t => t.startsWith(`${todayStr}T${currentHourStr}`)) : -1
  const hStart = startIdx === -1 ? 0 : startIdx

  const sliceNext = (arr, n) => (arr ?? []).slice(hStart, hStart + n)
  const hourlyTimes = hourly ? sliceNext(hourly.time, 24) : []

  const fmt = (time, i) => i === 0
    ? 'Now'
    : new Date(time).toLocaleTimeString('en-US', { hour: 'numeric', hour12: true, timeZone: timezone })

  // UV — daytime only
  const uvValues = hourly ? sliceNext(hourly.uv_index, 24) : []
  const uvIsDay  = hourly ? sliceNext(hourly.is_day, 24) : []
  const isCurrentDaytime = uvIsDay[0] === 1
  const uvDaytimeItems = hourlyTimes
    .map((time, i) => ({ time, uv: uvValues[i] ?? 0 }))
    .filter((_, i) => uvIsDay[i] === 1)
    .slice(0, 6)
  const uvCurrent = uvValues.length > 0 ? (uvValues[0] ?? current.uv_index) : current.uv_index
  const uv = getUVLabel(uvCurrent)
  // UV > 7 is "Very High"/"Extreme" — swap the sun for a warning symbol.
  const uvHigh = uvCurrent > 7

  // Wind
  const windSpeeds = hourly?.wind_speed_10m ? sliceNext(hourly.wind_speed_10m, 6) : []
  const windDirs   = hourly?.wind_direction_10m ? sliceNext(hourly.wind_direction_10m, 6) : []
  const windTimes  = windSpeeds.length > 0 ? sliceNext(hourly.time, 6) : []

  // Humidity
  const humValues = hourly?.relative_humidity_2m ? sliceNext(hourly.relative_humidity_2m, 6) : []
  const humTimes  = humValues.length > 0 ? sliceNext(hourly.time, 6) : []

  // Pressure
  const presValues = hourly?.surface_pressure ? sliceNext(hourly.surface_pressure, 6) : []
  const presTimes  = presValues.length > 0 ? sliceNext(hourly.time, 6) : []

  // Visibility
  const visValues = hourly?.visibility ? sliceNext(hourly.visibility, 6).map(v => v / 1609.34) : []
  const visTimes  = visValues.length > 0 ? sliceNext(hourly.time, 6) : []

  const cardDefs = {
    humidity:   {
      icon: <Droplets size={19} />, label: 'Humidity',
      value: `${current.relative_humidity_2m}%`,
      sub: <span style={{ color: humInfo.color, fontWeight: 600 }}>{humInfo.label}</span>,
      color: humInfo.color,
      onClick: () => toggle('humidity'), isExpanded: expanded === 'humidity',
    },
    wind: {
      icon: <Wind size={19} />, label: 'Wind',
      value: `${Math.round(current.wind_speed_10m)} mph`,
      sub: windDir,
      color: windInfo.color,
      onClick: () => toggle('wind'), isExpanded: expanded === 'wind',
    },
    pressure: {
      icon: <Gauge size={19} />, label: 'Pressure',
      value: `${Math.round(current.surface_pressure)} hPa`,
      sub: <span style={{ color: presInfo.color, fontWeight: 600 }}>{presInfo.label}</span>,
      color: presInfo.color,
      onClick: () => toggle('pressure'), isExpanded: expanded === 'pressure',
    },
    visibility: {
      icon: <Eye size={19} />, label: 'Visibility',
      value: `${visMi} mi`,
      sub: <span style={{ color: visInfo.color, fontWeight: 600 }}>{visInfo.label}</span>,
      color: visInfo.color,
      onClick: () => toggle('visibility'), isExpanded: expanded === 'visibility',
    },
    sunrise: { icon: <Sunrise size={19} />, label: 'Sunrise', value: sunrise },
    sunset:  { icon: <Sunset  size={19} />, label: 'Sunset',  value: sunset  },
    uv: {
      icon: uvHigh ? <AlertTriangle size={19} /> : <Sun size={19} />, label: 'UV Index',
      value: Math.round(uvCurrent),
      sub: <span style={{ color: uv.color, fontWeight: 600 }}>{uv.label}</span>,
      color: uv.color,
      onClick: () => toggle('uv'), isExpanded: expanded === 'uv',
    },
    aqi: airQuality ? {
      icon: aqiBad ? <AlertTriangle size={19} /> : <Leaf size={19} />, label: 'Air Quality',
      value: airQuality.us_aqi,
      sub: aqiInfo?.label,
      color: aqiInfo?.color,
      onClick: () => toggle('aqi'), isExpanded: expanded === 'aqi',
    } : null,
  }

  return (
    <div className="card">
      <div className="section-label">DETAILS</div>
      <div className="details-grid">
        {cardOrder
          .filter(key => cardDefs[key] != null)
          .map(key => (
            <DetailCard
              key={key}
              {...cardDefs[key]}
              onDragStart={() => handleDragStart(key)}
              onDragEnter={() => handleDragEnter(key)}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEnd}
              isDragging={draggingKey === key}
              isDragOver={dragOverKey === key && draggingKey !== key}
            />
          ))
        }
      </div>

      {expanded === 'humidity' && humTimes.length > 0 && (
        <div className="detail-expansion">
          <div className="uv-timeline">
            {humTimes.map((time, i) => {
              const val  = humValues[i] ?? 0
              const info = getHumidityInfo(val)
              return (
                <div key={i} className="uv-timeline-item">
                  <span className="uv-tl-time">{fmt(time, i)}</span>
                  <span className="uv-tl-val" style={{ color: info.color }}>{Math.round(val)}%</span>
                  <span className="uv-tl-lbl" style={{ color: info.color }}>{info.label}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {expanded === 'wind' && windTimes.length > 0 && (
        <div className="detail-expansion">
          <div className="uv-timeline">
            {windTimes.map((time, i) => {
              const speed   = windSpeeds[i] ?? 0
              const degrees = windDirs[i] ?? 0
              const wInfo   = getWindInfo(speed)
              return (
                <div key={i} className="uv-timeline-item">
                  <span className="uv-tl-time">{fmt(time, i)}</span>
                  <Navigation2
                    size={wInfo.size}
                    style={{ color: wInfo.color, transform: `rotate(${degrees}deg)`, flexShrink: 0 }}
                  />
                  <span className="uv-tl-val" style={{ color: wInfo.color }}>{Math.round(speed)}</span>
                  <span className="uv-tl-lbl" style={{ color: 'var(--text-secondary)' }}>{getWindDirection(degrees)}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {expanded === 'pressure' && presTimes.length > 0 && (
        <div className="detail-expansion">
          <div className="uv-timeline">
            {presTimes.map((time, i) => {
              const val  = presValues[i] ?? 0
              const info = getPressureInfo(val)
              return (
                <div key={i} className="uv-timeline-item">
                  <span className="uv-tl-time">{fmt(time, i)}</span>
                  <span className="uv-tl-val" style={{ color: info.color }}>{Math.round(val)}</span>
                  <span className="uv-tl-lbl" style={{ color: info.color }}>{info.label}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {expanded === 'visibility' && visTimes.length > 0 && (
        <div className="detail-expansion">
          <div className="uv-timeline">
            {visTimes.map((time, i) => {
              const val  = visValues[i] ?? 0
              const info = getVisibilityInfo(val)
              return (
                <div key={i} className="uv-timeline-item">
                  <span className="uv-tl-time">{fmt(time, i)}</span>
                  <span className="uv-tl-val" style={{ color: info.color }}>{val.toFixed(1)}</span>
                  <span className="uv-tl-lbl" style={{ color: info.color }}>{info.label}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {expanded === 'uv' && (
        <div className="detail-expansion">
          {uvDaytimeItems.length > 0 ? (
            <div className="uv-timeline">
              {uvDaytimeItems.map((item, i) => {
                const uvInfo = getUVLabel(item.uv)
                return (
                  <div key={i} className="uv-timeline-item">
                    <span className="uv-tl-time">{i === 0 && isCurrentDaytime ? 'Now' : new Date(item.time).toLocaleTimeString('en-US', { hour: 'numeric', hour12: true, timeZone: timezone })}</span>
                    <span className="uv-tl-val" style={{ color: uvInfo.color }}>{Math.round(item.uv)}</span>
                    <span className="uv-tl-lbl" style={{ color: uvInfo.color }}>{uvInfo.label}</span>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="uv-no-exposure">No UV exposure right now</div>
          )}
        </div>
      )}

      {expanded === 'aqi' && airQuality && (
        <div className="detail-expansion">
          <div className="aqi-main">
            <div className="aqi-number" style={{ color: aqiInfo.color }}>{airQuality.us_aqi}</div>
            <div className="aqi-info">
              <div className="aqi-status" style={{ color: aqiInfo.color }}>{aqiInfo.label}</div>
              <div className="aqi-sublabel">US AQI</div>
            </div>
            {aqiHazardous && (
              <ShieldAlert className="aqi-mask-icon" size={26} style={{ color: aqiInfo.color }} aria-label="Wear a mask outdoors">
                <title>Wear a mask outdoors</title>
              </ShieldAlert>
            )}
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
