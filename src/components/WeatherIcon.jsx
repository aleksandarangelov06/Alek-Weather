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

// Strong thunderstorm: the stock Fluent storm emoji has a single orange bolt on
// the right. This layers a second, matching bolt on the lower-left so the icon
// reads as a more intense storm. The base cloud is the unchanged Fluent image;
// the extra bolt is the same bolt path (reused from cloud_with_lightning_and_
// rain) shifted left/down with the same orange→red gradient, plus a thin light
// outline so it stays legible where it crosses the cloud.
function StormStrongIcon({ alt }) {
  return (
    <span
      role="img" aria-label={alt || undefined} aria-hidden={alt ? undefined : true}
      style={{ position: 'relative', display: 'inline-block', width: '1em', height: '1em', verticalAlign: 'middle' }}
    >
      <img src={URLS.storm} alt="" style={{ width: '1em', height: '1em', display: 'block' }} />
      <svg
        viewBox="0 0 32 32" aria-hidden="true"
        style={{ position: 'absolute', inset: 0, width: '1em', height: '1em', pointerEvents: 'none', overflow: 'visible' }}
      >
        <defs>
          <linearGradient id="stormStrongBolt" x1="0" y1="12.6" x2="0" y2="25.8" gradientUnits="userSpaceOnUse">
            <stop offset="0.354" stopColor="#FF9B49" />
            <stop offset="1" stopColor="#FF4E4B" />
          </linearGradient>
        </defs>
        <g transform="translate(-6.4 1.5)">
          <path
            d="M19.5424 19.6248L14.6898 26.9037C14.4703 27.233 13.957 27.0776 13.957 26.6818L13.9569 21.4029C13.9569 21.182 13.7778 21.0029 13.5569 21.0029H12.6787C12.3645 21.0029 12.173 20.6573 12.3395 20.3909L16.2178 14.1856C16.4308 13.8448 16.957 13.9957 16.957 14.3976V18.6029C16.957 18.8238 17.1361 19.0029 17.357 19.0029H19.2096C19.5291 19.0029 19.7196 19.3589 19.5424 19.6248Z"
            fill="url(#stormStrongBolt)" stroke="#FFE0B0" strokeWidth="0.5" strokeLinejoin="round"
          />
        </g>
      </svg>
    </span>
  )
}

export function WeatherIcon({ id, alt = '' }) {
  if (id === 'fog') return <FogIcon alt={alt} />
  if (id === 'stormStrong') return <StormStrongIcon alt={alt} />
  const src = URLS[id]
  if (!src) return null
  return <img src={src} alt={alt} style={{ width: '1em', height: '1em', verticalAlign: 'middle' }} />
}
