const codes = {
  0:  { label: 'Clear Sky',               icon: '☀️'  },
  1:  { label: 'Mainly Clear',            icon: '🌤️'  },
  2:  { label: 'Partly Cloudy',           icon: '⛅'  },
  3:  { label: 'Overcast',               icon: '☁️'  },
  45: { label: 'Foggy',                  icon: '🌫️'  },
  48: { label: 'Rime Fog',              icon: '🌫️'  },
  51: { label: 'Light Drizzle',          icon: '🌦️'  },
  53: { label: 'Moderate Drizzle',       icon: '🌦️'  },
  55: { label: 'Heavy Drizzle',          icon: '🌧️'  },
  61: { label: 'Slight Rain',            icon: '🌧️'  },
  63: { label: 'Moderate Rain',          icon: '🌧️'  },
  65: { label: 'Heavy Rain',             icon: '🌧️'  },
  71: { label: 'Slight Snow',            icon: '🌨️'  },
  73: { label: 'Moderate Snow',          icon: '❄️'  },
  75: { label: 'Heavy Snow',             icon: '❄️'  },
  77: { label: 'Snow Grains',            icon: '🌨️'  },
  80: { label: 'Slight Showers',         icon: '🌦️'  },
  81: { label: 'Moderate Showers',       icon: '🌧️'  },
  82: { label: 'Violent Showers',        icon: '⛈️'  },
  85: { label: 'Slight Snow Showers',    icon: '🌨️'  },
  86: { label: 'Heavy Snow Showers',     icon: '❄️'  },
  95: { label: 'Thunderstorm',           icon: '⛈️'  },
  96: { label: 'T-Storm w/ Hail',        icon: '⛈️'  },
  99: { label: 'T-Storm w/ Heavy Hail',  icon: '⛈️'  },
}

export function getWeatherInfo(code) {
  return codes[code] ?? { label: 'Unknown', icon: '🌡️' }
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
