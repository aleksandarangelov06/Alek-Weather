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
// mid-tone (see .weather-icon-fog in App.css) that reads clearly in both. The
// glyph is straight mist lines with drifting dots, alternating dot–line and
// line–dot per row to read as haze rather than water.
function FogIcon({ alt }) {
  return (
    <svg
      className="weather-icon-fog" viewBox="0 0 32 32"
      role="img" aria-label={alt || undefined} aria-hidden={alt ? undefined : true}
      fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"
      style={{ width: '1em', height: '1em', verticalAlign: 'middle' }}
    >
      <line x1="11" y1="7"  x2="26" y2="7"  opacity="0.85" />
      <circle cx="6"  cy="7"  r="1.4" fill="currentColor" stroke="none" opacity="0.85" />
      <line x1="6"  y1="13" x2="21" y2="13" />
      <circle cx="26" cy="13" r="1.4" fill="currentColor" stroke="none" />
      <line x1="11" y1="19" x2="26" y2="19" opacity="0.9" />
      <circle cx="6"  cy="19" r="1.4" fill="currentColor" stroke="none" opacity="0.9" />
      <line x1="6"  y1="25" x2="21" y2="25" opacity="0.95" />
      <circle cx="26" cy="25" r="1.4" fill="currentColor" stroke="none" opacity="0.95" />
    </svg>
  )
}

export function WeatherIcon({ id, alt = '' }) {
  if (id === 'fog') return <FogIcon alt={alt} />
  const src = URLS[id]
  if (!src) return null
  return <img src={src} alt={alt} style={{ width: '1em', height: '1em', verticalAlign: 'middle' }} />
}
