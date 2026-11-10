// Air-quality reference data shared by the phone Details cover (WeatherDetails)
// and the web Details page (web/AirQualityCard).

// Concentration each pollutant reaches when it alone would push the AQI to the
// "unhealthy for sensitive groups" boundary — the point where its bar is full.
// All values µg/m³, matching what Open-Meteo returns.
export const POLLUTANTS = [
  { key: 'pm2_5',            name: 'PM2.5', full: 35.4,  desc: 'Fine particles' },
  { key: 'pm10',             name: 'PM10',  full: 154,   desc: 'Coarse particles' },
  { key: 'ozone',            name: 'O₃',    full: 140,   desc: 'Ground-level ozone' },
  { key: 'nitrogen_dioxide', name: 'NO₂',   full: 100,   desc: 'Traffic emissions' },
  { key: 'sulphur_dioxide',  name: 'SO₂',   full: 75,    desc: 'Industrial burning' },
  { key: 'carbon_monoxide',  name: 'CO',    full: 10000, desc: 'Combustion gas' },
]

// The pollutant closest to its own concern level — the one actually driving
// the index, which the single AQI number hides. null when none are reported.
export function aqiDriver(airQuality) {
  const top = POLLUTANTS
    .map((p) => ({ ...p, value: airQuality?.[p.key], ratio: airQuality?.[p.key] != null ? airQuality[p.key] / p.full : -1 }))
    .sort((a, b) => b.ratio - a.ratio)[0]
  return top && top.ratio >= 0 ? top : null
}

// A category name short enough for a narrow timeline column.
export function shortAQILabel(aqi) {
  if (aqi <= 50)  return 'Good'
  if (aqi <= 100) return 'Moderate'
  if (aqi <= 150) return 'Sensitive'
  if (aqi <= 200) return 'Unhealthy'
  if (aqi <= 300) return 'Very bad'
  return 'Hazardous'
}

// Pollen (CAMS Europe; null everywhere else), in grains/m³. The bands are a
// general guide across species, not a per-species index.
export const POLLENS = [
  { key: 'grass_pollen',   name: 'Grass' },
  { key: 'birch_pollen',   name: 'Birch' },
  { key: 'alder_pollen',   name: 'Alder' },
  { key: 'olive_pollen',   name: 'Olive' },
  { key: 'mugwort_pollen', name: 'Mugwort' },
  { key: 'ragweed_pollen', name: 'Ragweed' },
]

export function pollenLevel(v) {
  if (v < 10)  return { label: 'Low',       color: 'var(--cond-green)' }
  if (v < 50)  return { label: 'Moderate',  color: 'var(--cond-yellow)' }
  if (v < 200) return { label: 'High',      color: 'var(--cond-orange)' }
  return              { label: 'Very high', color: 'var(--cond-red)' }
}
