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

export function formatDay(dateString) {
  const date = new Date(dateString + 'T12:00:00')
  const today = new Date()
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)
  if (date.toDateString() === today.toDateString()) return 'Today'
  if (date.toDateString() === tomorrow.toDateString()) return 'Tomorrow'
  return date.toLocaleDateString('en-US', { weekday: 'short' })
}
