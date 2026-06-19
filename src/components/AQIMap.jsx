import { useEffect, useRef, useCallback } from 'react'
import { Minimize2, Navigation } from 'lucide-react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const BASE_TILE = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
const WAQI_TOKEN = import.meta.env.VITE_WAQI_TOKEN ?? ''
const AQI_TILE = `https://tiles.waqi.info/tiles/usepa-aqi/{z}/{x}/{y}.png?token=${WAQI_TOKEN}`

const LEGEND = [
  { range: '0–50',   color: '#009966' },
  { range: '51–100', color: '#ffde33' },
  { range: '101–150',color: '#ff9933' },
  { range: '151–200',color: '#cc0033' },
  { range: '201–300',color: '#660099' },
  { range: '301+',   color: '#7e0023' },
]

export function AQIMap({ location, onClose }) {
  const mapRef  = useRef(null)
  const mapInst = useRef(null)

  useEffect(() => {
    if (!mapRef.current || mapInst.current) return
    const map = L.map(mapRef.current, {
      zoomControl: false,
      attributionControl: false,
      maxZoom: 12,
    })
    map.setView([location.latitude, location.longitude], 8)
    L.tileLayer(BASE_TILE, { maxZoom: 20, detectRetina: true, crossOrigin: true, zIndex: 1 }).addTo(map)
    L.tileLayer(AQI_TILE,  { opacity: 0.75, zIndex: 2, maxNativeZoom: 10, crossOrigin: true }).addTo(map)
    L.circleMarker([location.latitude, location.longitude], {
      radius: 6, fillColor: '#3b82f6', color: '#fff', weight: 2, fillOpacity: 1,
    }).addTo(map)
    mapInst.current = map
    return () => { map.remove(); mapInst.current = null }
  }, [location.latitude, location.longitude])

  const handleLocate = useCallback(() => {
    mapInst.current?.setView([location.latitude, location.longitude], 8, { animate: true })
  }, [location.latitude, location.longitude])

  return (
    <div className="aqi-map-overlay">
      <div ref={mapRef} className="aqi-map-leaflet" />

      <button className="aqi-map-btn aqi-map-close" onClick={onClose} aria-label="Close AQI map">
        <Minimize2 size={20} />
      </button>
      <button className="aqi-map-btn aqi-map-locate" onClick={handleLocate} aria-label="Center on location">
        <Navigation size={15} />
      </button>

      <div className="aqi-map-legend">
        {LEGEND.map(({ range, color }) => (
          <div key={range} className="aqi-map-legend-item">
            <div className="aqi-map-legend-swatch" style={{ background: color }} />
            <span>{range}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
