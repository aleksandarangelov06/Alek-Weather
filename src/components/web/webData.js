// Data slicing shared by the web pages. The API arrays include `past_days=1`,
// so every page has to find "now" inside them before it can show anything —
// this keeps that one piece of arithmetic in one place.

// Index of the hour currently in progress at the location. Falls back to 0 when
// the timestamp can't be found, which is what the mobile cards do too.
export function currentHourIndex(hourly, timezone) {
  const now = new Date()
  const hour = now.toLocaleString('en-CA', { hour: '2-digit', hour12: false, timeZone: timezone })
  const day = now.toLocaleDateString('en-CA', { timeZone: timezone })
  const idx = hourly.time.findIndex((t) => t.startsWith(`${day}T${hour}`))
  return idx === -1 ? 0 : idx
}

// `count` hours of every series the web pages read, starting at `start`.
// Missing series (a field the API dropped) come back as arrays of nulls so
// callers can index them without a guard on every access.
export function sliceHourly(hourly, start, count) {
  const take = (arr) => (arr ? arr.slice(start, start + count) : new Array(count).fill(null))
  return {
    time: hourly.time.slice(start, start + count),
    temp: take(hourly.temperature_2m),
    feels: take(hourly.apparent_temperature),
    code: take(hourly.weather_code),
    precip: take(hourly.precipitation_probability),
    isDay: take(hourly.is_day),
    wind: take(hourly.wind_speed_10m),
    gust: take(hourly.wind_gusts_10m),
    windDir: take(hourly.wind_direction_10m),
    humidity: take(hourly.relative_humidity_2m),
    uv: take(hourly.uv_index),
    pressure: take(hourly.surface_pressure),
    visibility: take(hourly.visibility),
  }
}

// The indexes in `hourly` that fall on a given calendar date ("YYYY-MM-DD").
export function hourIndexesForDate(hourly, date) {
  const out = []
  for (let i = 0; i < hourly.time.length; i++) {
    if (hourly.time[i].startsWith(date)) out.push(i)
  }
  return out
}

// Average of a series over the given indexes, ignoring gaps. Null when the
// whole window is missing.
export function averageAt(series, indexes) {
  if (!series) return null
  let sum = 0, n = 0
  for (const i of indexes) {
    const v = series[i]
    if (v != null && Number.isFinite(v)) { sum += v; n++ }
  }
  return n ? sum / n : null
}

// "Mon", "Tue" … for a daily entry, or "Today" for the current date.
export function weekdayLabel(dateStr, timezone) {
  const date = new Date(`${dateStr}T12:00:00`)
  const today = new Date().toLocaleDateString('en-CA', { timeZone: timezone })
  if (dateStr === today) return 'Today'
  return date.toLocaleDateString('en-US', { weekday: 'short' })
}

// "Jul 28" for the secondary line under a weekday.
export function shortDate(dateStr) {
  return new Date(`${dateStr}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// Daylight span as "13h 42m", from the daily sunrise/sunset pair.
export function daylightLength(sunrise, sunset) {
  const ms = new Date(sunset) - new Date(sunrise)
  if (!Number.isFinite(ms) || ms <= 0) return null
  const mins = Math.round(ms / 60000)
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`
}

export const METERS_PER_MILE = 1609.34
export const HPA_PER_INHG = 33.8639
