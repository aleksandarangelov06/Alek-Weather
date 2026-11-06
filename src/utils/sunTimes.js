// Twilight and golden-hour times around the API's sunrise and sunset.
//
// The forecast gives sunrise and sunset but not when the sky starts to light
// (civil dawn, sun 6° below the horizon) or when the low warm light begins
// (golden hour, sun 6° above). Those come from the sun's hour angle at each
// altitude, and are anchored to the API's own sunrise and sunset: only the
// *gap* between, say, sunset and dusk is computed here, so everything stays
// consistent with the times printed beside it.
//
// All times are minutes after local midnight; the API's sunrise and sunset are
// naive local wall-clock strings ("2026-11-06T06:39"), read as such.

const RAD = Math.PI / 180
const SUNRISE_ALT = -0.833 // the disc's top edge on the horizon, with refraction

export const isoMinutes = (iso) => +iso.slice(11, 13) * 60 + +iso.slice(14, 16)

// Solar declination (radians) for a date, NOAA's fractional-year series.
function declination(dateIso) {
  const d = new Date(`${dateIso.slice(0, 10)}T12:00:00Z`)
  const start = Date.UTC(d.getUTCFullYear(), 0, 1)
  const doy = Math.floor((d - start) / 86400000) + 1
  const g = (2 * Math.PI / 365) * (doy - 1)
  return 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g)
    - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g)
    - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g)
}

// Half the time (minutes) the sun spends above `alt` degrees, or null if it
// never crosses that altitude that day (polar day or night).
function halfArc(latDeg, dec, alt) {
  const phi = latDeg * RAD
  const c = (Math.sin(alt * RAD) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec))
  if (c < -1 || c > 1) return null
  return (Math.acos(c) / RAD) * 4 // degrees of hour angle → minutes
}

export function sunTimes(sunriseIso, sunsetIso, latitude) {
  const rise = isoMinutes(sunriseIso)
  const set = isoMinutes(sunsetIso)
  const dec = declination(sunriseIso)
  const base = halfArc(latitude, dec, SUNRISE_ALT)
  const offset = (alt) => {
    const h = halfArc(latitude, dec, alt)
    return base == null || h == null ? null : h - base
  }
  const twilight = offset(-6) // > 0: dawn comes before sunrise by this much
  const golden = offset(6)    // < 0: the sun is above 6° this much after sunrise
  return {
    rise,
    set,
    noon: (rise + set) / 2,
    dawn: twilight == null ? null : rise - twilight,
    dusk: twilight == null ? null : set + twilight,
    // The evening golden hour runs from when the sun drops below 6° to sunset;
    // the morning one mirrors it after sunrise.
    goldenEvening: golden == null ? null : set + golden,
    goldenMorning: golden == null ? null : rise - golden,
  }
}

// "6:39 AM" from minutes after midnight.
export function formatMinutes(mins) {
  const m = Math.round(((mins % 1440) + 1440) % 1440)
  const h = Math.floor(m / 60)
  const mm = String(m % 60).padStart(2, '0')
  return `${h % 12 || 12}:${mm} ${h < 12 ? 'AM' : 'PM'}`
}

// "2h 14m", "45m".
export function formatSpan(mins) {
  const m = Math.max(0, Math.round(mins))
  const h = Math.floor(m / 60)
  return h ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`
}
