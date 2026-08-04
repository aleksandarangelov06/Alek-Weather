// How an alert is coloured. Its own module rather than a export from
// WeatherAlerts.jsx: the alerts card and the web app's header pill both need
// it, and a component file that also exports helpers breaks fast refresh.

// Colors are the --cond-* variables so they lighten on dark and sky-tinted
// surfaces; withAlpha uses color-mix because the values are no longer raw hex.
const SEVERITY_CONFIG = {
  Extreme:  { color: 'var(--cond-red)',    bg: withAlpha('var(--cond-red)', 0.12),    label: 'Extreme'  },
  Severe:   { color: 'var(--cond-orange)', bg: withAlpha('var(--cond-orange)', 0.12), label: 'Severe'   },
  Moderate: { color: 'var(--cond-yellow)', bg: withAlpha('var(--cond-yellow)', 0.12), label: 'Moderate' },
  Minor:    { color: 'var(--cond-info)',   bg: withAlpha('var(--cond-info)', 0.10),   label: 'Minor'    },
  Unknown:  { color: '#8b949e',            bg: 'rgba(139,148,158,0.10)',              label: 'Alert'    },
}

// Air Quality "Code <colour>" levels, matching the US AQI scale.
const AQI_CODE_COLORS = {
  green: 'var(--cond-green)', yellow: 'var(--cond-yellow)', orange: 'var(--cond-orange)',
  red: 'var(--cond-red)', purple: 'var(--cond-purple)', maroon: 'var(--cond-violet)',
}

function withAlpha(color, a) {
  return `color-mix(in srgb, ${color} ${a * 100}%, transparent)`
}

// Colour an alert by the action it demands rather than by NWS severity alone:
// Warnings (hazard happening/imminent) are red, Watches (be prepared) orange,
// Advisories yellow. Air Quality Alerts are coloured by their announced
// "Code <colour>" level, so a Code Red shows red, Code Orange orange, etc.
// Falls back to the severity palette for anything that fits none of these.
export function resolveStyle(props) {
  const base = SEVERITY_CONFIG[props.severity] ?? SEVERITY_CONFIG.Unknown
  const event = (props.event ?? '').trim()

  if (/air quality/i.test(event)) {
    const haystack = `${event} ${props.headline ?? ''} ${props.description ?? ''}`
    const m = haystack.match(/code\s+(green|yellow|orange|red|purple|maroon)/i)
    if (m) {
      const color = AQI_CODE_COLORS[m[1].toLowerCase()]
      return { ...base, color, bg: withAlpha(color, 0.12) }
    }
  }

  let color
  if (/warning$/i.test(event))       color = 'var(--cond-red)'
  else if (/watch$/i.test(event))    color = 'var(--cond-orange)'
  else if (/advisory$/i.test(event)) color = 'var(--cond-yellow)'
  return color ? { ...base, color, bg: withAlpha(color, 0.12) } : base
}
