const BASE = 'https://cdn.jsdelivr.net/gh/microsoft/fluentui-emoji@main/assets'

const URLS = {
  sun:       `${BASE}/Sun/Color/sun_color.svg`,
  moon:      `${BASE}/Crescent%20moon/Color/crescent_moon_color.svg`,
  sunSmall:  `${BASE}/Sun%20behind%20small%20cloud/Color/sun_behind_small_cloud_color.svg`,
  sunCloud:  `${BASE}/Sun%20behind%20cloud/Color/sun_behind_cloud_color.svg`,
  cloud:     `${BASE}/Cloud/Color/cloud_color.svg`,
  fog:       `${BASE}/Fog/Color/fog_color.svg`,
  sunRain:   `${BASE}/Sun%20behind%20rain%20cloud/Color/sun_behind_rain_cloud_color.svg`,
  rain:      `${BASE}/Cloud%20with%20rain/Color/cloud_with_rain_color.svg`,
  snow:      `${BASE}/Cloud%20with%20snow/Color/cloud_with_snow_color.svg`,
  snowflake: `${BASE}/Snowflake/Color/snowflake_color.svg`,
  storm:     `${BASE}/Cloud%20with%20lightning%20and%20rain/Color/cloud_with_lightning_and_rain_color.svg`,
  therm:     `${BASE}/Thermometer/Color/thermometer_color.svg`,
}

// Fog is drawn inline (not as a Fluent emoji) because the 🌫️ asset is fixed
// pale-gray mist lines: an invisible smudge on light backgrounds and a white
// blob on dark. This version uses currentColor so it can be given a theme-aware
// mid-tone (see .weather-icon-fog in App.css) that reads clearly in both.
function FogIcon({ alt }) {
  return (
    <svg
      className="weather-icon-fog" viewBox="0 0 32 32"
      role="img" aria-label={alt || undefined} aria-hidden={alt ? undefined : true}
      fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"
      style={{ width: '1em', height: '1em', verticalAlign: 'middle' }}
    >
      <path d="M8 8 q4 -2.6 8 0 t8 0"   opacity="0.85" />
      <path d="M6 14 q4.5 2.6 9 0 t9 0" opacity="1" />
      <path d="M8 20 q4 -2.6 8 0 t8 0"  opacity="0.8" />
      <path d="M5 26 q4.5 2.6 9 0 t9 0" opacity="0.95" />
    </svg>
  )
}

export function WeatherIcon({ id, alt = '' }) {
  if (id === 'fog') return <FogIcon alt={alt} />
  const src = URLS[id]
  if (!src) return null
  return <img src={src} alt={alt} style={{ width: '1em', height: '1em', verticalAlign: 'middle' }} />
}
