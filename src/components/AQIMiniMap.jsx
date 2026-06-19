import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const BASE_TILE  = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
const WAQI_TOKEN = import.meta.env.VITE_WAQI_TOKEN ?? ''
const AQI_TILE   = `https://tiles.waqi.info/tiles/usepa-aqi/{z}/{x}/{y}.png?token=${WAQI_TOKEN}`

export function AQIMiniMap({ location, onExpand }) {
  const mapRef  = useRef(null)
  const mapInst = useRef(null)

  useEffect(() => {
    if (!mapRef.current || mapInst.current) return
    const map = L.map(mapRef.current, {
      zoomControl: false, attributionControl: false,
      dragging: false, scrollWheelZoom: false,
      doubleClickZoom: false, touchZoom: false, boxZoom: false, keyboard: false,
      maxZoom: 10,
    })
    map.setView([location.latitude, location.longitude], 8)
    L.tileLayer(BASE_TILE, { maxZoom: 20, detectRetina: true, crossOrigin: true, zIndex: 1 }).addTo(map)
    L.tileLayer(AQI_TILE,  { opacity: 0.75, zIndex: 2, maxNativeZoom: 10, crossOrigin: true }).addTo(map)
    L.circleMarker([location.latitude, location.longitude], {
      radius: 5, fillColor: '#3b82f6', color: '#fff', weight: 2, fillOpacity: 1,
    }).addTo(map)
    mapInst.current = map
    return () => { map.remove(); mapInst.current = null }
  }, [location.latitude, location.longitude])

  return (
    <div className="aqi-mini-map-wrap">
      <div ref={mapRef} className="aqi-mini-map" />
      <div className="aqi-mini-map-tap" onClick={onExpand} role="button" aria-label="Open full AQI map" />
    </div>
  )
}
