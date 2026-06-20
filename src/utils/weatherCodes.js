const codes = {
  0:  { label: 'Clear Sky',               icon: 'sun',       nightIcon: 'moon'     },
  1:  { label: 'Mainly Clear',            icon: 'sunSmall',  nightIcon: 'moon'     },
  2:  { label: 'Partly Cloudy',           icon: 'sunCloud',  nightIcon: 'cloud'    },
  3:  { label: 'Overcast',               icon: 'cloud'                             },
  45: { label: 'Foggy',                  icon: 'fog'                               },
  48: { label: 'Rime Fog',              icon: 'fog'                               },
  51: { label: 'Light Drizzle',          icon: 'sunRain',   nightIcon: 'rain'     },
  53: { label: 'Moderate Drizzle',       icon: 'sunRain',   nightIcon: 'rain'     },
  55: { label: 'Heavy Drizzle',          icon: 'rain'                              },
  61: { label: 'Slight Rain',            icon: 'rain'                              },
  63: { label: 'Moderate Rain',          icon: 'rain'                              },
  65: { label: 'Heavy Rain',             icon: 'rain'                              },
  71: { label: 'Slight Snow',            icon: 'snow'                              },
  73: { label: 'Moderate Snow',          icon: 'snowflake'                         },
  75: { label: 'Heavy Snow',             icon: 'snowflake'                         },
  77: { label: 'Snow Grains',            icon: 'snow'                              },
  80: { label: 'Slight Showers',         icon: 'sunRain',   nightIcon: 'rain'     },
  81: { label: 'Moderate Showers',       icon: 'rain'                              },
  82: { label: 'Violent Showers',        icon: 'storm'                             },
  85: { label: 'Slight Snow Showers',    icon: 'snow'                              },
  86: { label: 'Heavy Snow Showers',     icon: 'snowflake'                         },
  95: { label: 'Thunderstorm',           icon: 'storm'                             },
  96: { label: 'T-Storm w/ Hail',        icon: 'storm'                             },
  99: { label: 'T-Storm w/ Heavy Hail',  icon: 'storm'                             },
}

export function getWeatherInfo(code, isNight = false) {
  const entry = codes[code] ?? { label: 'Unknown', icon: 'therm' }
  return { label: entry.label, icon: isNight && entry.nightIcon ? entry.nightIcon : entry.icon }
}

// ── Live "right now" condition from the 15-min nowcast ──────────────────────
// Open-Meteo's current.weather_code is a categorical, often-lagging snapshot: a
// brief downpour can leave it reading "Violent Showers" (82) while the live
// minutely_15 trend already shows light, tapering rain (observed in Montreal).
// These helpers re-derive the present condition from the *measured* precip rate
// so the headline matches what's actually falling.

// Inches per 15 min. Matches PrecipNowcast's chart thresholds.
const PRECIP_RATE = { TRACE: 0.004, LIGHT: 0.02, HEAVY: 0.08 }

// Same-family intensity ladders, indexed by tier [light, moderate, heavy/violent].
const FAMILY = {
  drizzle: [51, 53, 55],
  rain:    [61, 63, 65],
  showers: [80, 81, 82],
  snow:    [71, 73, 75],
}
const CODE_FAMILY = {
  51: 'drizzle', 53: 'drizzle', 55: 'drizzle',
  61: 'rain',    63: 'rain',    65: 'rain',
  80: 'showers', 81: 'showers', 82: 'showers',
  71: 'snow',    73: 'snow',    75: 'snow',
}
// Fog and thunder aren't characterized by precip rate alone — never downgrade them.
const NO_RATE_OVERRIDE = new Set([45, 48, 95, 96, 99])

function rateTier(rate) {
  if (rate >= PRECIP_RATE.HEAVY) return 2
  if (rate >= PRECIP_RATE.LIGHT) return 1
  return 0
}

// Sky condition when nothing is falling, from cloud cover (%).
function skyCode(cloudCover) {
  if (cloudCover == null) return 3
  if (cloudCover >= 85) return 3 // overcast
  if (cloudCover >= 40) return 2 // partly cloudy
  if (cloudCover >= 15) return 1 // mainly clear
  return 0                       // clear
}

// Measured precip rate (inches/15min) at the current time from minutely_15.
export function livePrecipRate(current, minutely) {
  const times = minutely?.time, precip = minutely?.precipitation
  if (!times?.length || !precip?.length || !current?.time) return null
  let i = times.findIndex(t => t >= current.time)
  if (i < 0) i = times.length - 1
  return precip[i] ?? null
}

// Best estimate of the current weather code, corrected against the live nowcast.
// Falls back to the API's weather_code whenever minutely data is unavailable.
export function liveWeatherCode(current, minutely) {
  const code = current?.weather_code
  if (code == null || NO_RATE_OVERRIDE.has(code)) return code
  const rate = livePrecipRate(current, minutely)
  if (rate == null) return code
  const fam = CODE_FAMILY[code]
  if (fam) {
    // Code claims precipitation: if essentially nothing is falling, show the sky.
    if (rate < PRECIP_RATE.TRACE) return skyCode(current.cloud_cover)
    return FAMILY[fam][rateTier(rate)]
  }
  // Code says clear/cloudy but the nowcast shows real precip → upgrade to rain/snow.
  if (rate >= PRECIP_RATE.LIGHT) {
    const snow = current.temperature_2m != null && current.temperature_2m <= 32 // °F
    return FAMILY[snow ? 'snow' : 'rain'][rateTier(rate)]
  }
  return code
}

export function getWindDirection(degrees) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  return dirs[Math.round(degrees / 45) % 8]
}

export function getUVLabel(uv) {
  if (uv <= 2)  return { label: 'Low',       color: '#22c55e' }
  if (uv <= 5)  return { label: 'Moderate',  color: '#eab308' }
  if (uv <= 7)  return { label: 'High',      color: '#f97316' }
  if (uv <= 10) return { label: 'Very High', color: '#ef4444' }
  return              { label: 'Extreme',   color: '#a855f7' }
}

export function formatTime(isoString, timezone) {
  return new Date(isoString).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timezone,
    hour12: true,
  })
}

export function toTemp(fahrenheit, unit) {
  if (unit === 'C') return Math.round((fahrenheit - 32) * 5 / 9)
  return Math.round(fahrenheit)
}

// Color stops: [°F, [r, g, b]]
const TEMP_STOPS = [
  [10,  [94,  184, 255]],  // icy blue
  [32,  [116, 192, 252]],  // freezing blue
  [45,  [169, 227,  75]],  // cool light green
  [60,  [ 81, 207, 102]],  // mild green
  [75,  [255, 212,  59]],  // warm yellow
  [85,  [255, 146,  43]],  // hot orange
  [95,  [250,  82,  82]],  // very hot red
  [110, [204,  93, 232]],  // extreme purple
]

export function tempColor(fahrenheit) {
  if (fahrenheit <= TEMP_STOPS[0][0]) return `rgb(${TEMP_STOPS[0][1].join(',')})`
  if (fahrenheit >= TEMP_STOPS[TEMP_STOPS.length - 1][0]) {
    return `rgb(${TEMP_STOPS[TEMP_STOPS.length - 1][1].join(',')})`
  }
  for (let i = 0; i < TEMP_STOPS.length - 1; i++) {
    const [t0, c0] = TEMP_STOPS[i]
    const [t1, c1] = TEMP_STOPS[i + 1]
    if (fahrenheit <= t1) {
      const t = (fahrenheit - t0) / (t1 - t0)
      const r = Math.round(c0[0] + t * (c1[0] - c0[0]))
      const g = Math.round(c0[1] + t * (c1[1] - c0[1]))
      const b = Math.round(c0[2] + t * (c1[2] - c0[2]))
      return `rgb(${r},${g},${b})`
    }
  }
}

// Color-coded temperature style: the text color plus a heat glow that starts
// subtly at 90°F and intensifies up to 110°F. `scale` tunes the glow's blur
// radius so it fits smaller temperature elements (hourly/daily) as well as the
// large current temperature. Returns undefined when color coding is off.
export function tempStyle(fahrenheit, colorCoding, scale = 1, glow = true) {
  if (!colorCoding) return undefined
  const style = { color: tempColor(fahrenheit) }
  if (glow && fahrenheit >= 90) {
    const t = Math.min((fahrenheit - 90) / 20, 1)
    style.textShadow = `0 0 ${(8 + t * 24) * scale}px currentColor`
  }
  return style
}

export function formatDay(dateString) {
  const date = new Date(dateString + 'T12:00:00')
  const today = new Date()
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)
  if (date.toDateString() === today.toDateString()) return 'Today'
  if (date.toDateString() === tomorrow.toDateString()) return 'Tomorrow'
  return date.toLocaleDateString('en-US', { weekday: 'short' })
}
