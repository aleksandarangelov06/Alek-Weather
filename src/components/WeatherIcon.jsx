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

export function WeatherIcon({ id, alt = '' }) {
  const src = URLS[id]
  if (!src) return null
  return <img src={src} alt={alt} style={{ width: '1em', height: '1em', verticalAlign: 'middle' }} />
}
