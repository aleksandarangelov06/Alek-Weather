// Parsing for the NWS gridpoint forecast (api.weather.gov/gridpoints/{wfo}/{x},{y}).
//
// This is the raw grid behind the /forecast and /forecast/hourly text products,
// and it is the only NWS source for the fields those two don't publish:
// feels-like, gusts, visibility, sky cover, dew point and quantitative
// precipitation. Without it "use NWS" could only ever mean *most* of the
// forecast, with the rest of every row still coming from Open-Meteo.
//
// Each element is a list of `{ validTime, value }`, where validTime is an ISO
// instant joined to an ISO-8601 duration ("2026-08-22T17:00:00+00:00/PT3H"):
// one reading covering a span of hours, not a reading per hour. Both expanders
// below turn that into a per-hour lookup keyed the way Open-Meteo's local
// hourly array is ("YYYY-MM-DDTHH:00"), so merging is an index lookup.

// Values arrive in whatever unit the office publishes; these convert to the
// canonical set the whole app reasons in (see utils/units.js) so a merged NWS
// number is interchangeable with the Open-Meteo one it replaces. Anything not
// listed — percent, degrees, metres — is already canonical.
const UOM_TO_CANONICAL = {
  'wmoUnit:degC':   (v) => v * 9 / 5 + 32,  // → °F
  'wmoUnit:km_h-1': (v) => v * 0.621371,    // → mph
  'wmoUnit:mm':     (v) => v / 25.4,        // → inches
  'wmoUnit:Pa':     (v) => v / 100,         // → hPa
}

const DURATION_RE = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/

// A handful of elements carry one entry spanning the whole product ("P7DT13H",
// and windChill publishes a single null over the entire week). Nothing the app
// reads is meaningful at that resolution, and expanding one blindly would run
// the inner loop for hundreds of hours per entry, so cap what any single entry
// may cover at a fortnight.
const MAX_SPAN_HOURS = 24 * 14

function durationHours(iso) {
  const m = DURATION_RE.exec(iso ?? '')
  if (!m) return 0
  const [, days, hours, minutes] = m
  return Number(days ?? 0) * 24 + Number(hours ?? 0) + Number(minutes ?? 0) / 60
}

// "YYYY-MM-DDTHH:00" in the location's own zone. 'sv' is the shortest route to
// a zero-padded ISO-shaped local string, which is what the rest of the app and
// Open-Meteo's `hourly.time` both key on.
export function localHourKey(date, timezone) {
  return date.toLocaleString('sv', { timeZone: timezone })
    .replace(' ', 'T')
    .slice(0, 13) + ':00'
}

function eachHour(series, timezone, visit) {
  for (const entry of series?.values ?? []) {
    if (entry?.value == null) continue
    const [startIso, duration] = (entry.validTime ?? '').split('/')
    const start = new Date(startIso)
    if (Number.isNaN(start.getTime())) continue
    const span = Math.min(MAX_SPAN_HOURS, Math.max(1, Math.round(durationHours(duration))))
    for (let h = 0; h < span; h++) {
      visit(localHourKey(new Date(start.getTime() + h * 3600000), timezone), entry.value, span)
    }
  }
}

// A state value — temperature, wind, sky cover — holds for every hour its entry
// covers, so each hour in the span gets the value as published.
export function gridHourly(series, timezone) {
  const convert = UOM_TO_CANONICAL[series?.uom] ?? ((v) => v)
  const out = new Map()
  eachHour(series, timezone, (key, value) => out.set(key, convert(value)))
  return out
}

// How many hours the entry covering each hour actually spanned.
//
// NWS forecasts hour by hour for a while and then switches to six- and
// twelve-hour blocks. Both arrive through the same field and, once expanded
// above, are indistinguishable — a block is just six identical hours. Keeping
// the span lets a caller tell a real hourly forecast from one figure stretched
// across an afternoon, and hand the latter back to Open-Meteo.
export function gridHourlySpans(series, timezone) {
  const out = new Map()
  eachHour(series, timezone, (key, value, span) => out.set(key, span))
  return out
}

// An accumulation — precipitation, snowfall — is the *total* over its span, and
// NWS publishes it in six-hour blocks. Repeating the block total on each of its
// six hours and summing them would report six times the rain, so spread it.
export function gridHourlyAccum(series, timezone) {
  const convert = UOM_TO_CANONICAL[series?.uom] ?? ((v) => v)
  const out = new Map()
  eachHour(series, timezone, (key, value, span) => out.set(key, convert(value) / span))
  return out
}
