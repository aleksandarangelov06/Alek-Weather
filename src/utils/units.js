// Display units for the measures the app shows.
//
// Everything the API hands back is fetched in one fixed set of units — see
// PARAMS in hooks/useWeather.js, which pins temperature to fahrenheit, wind to
// mph and precipitation to inch, with pressure in hPa and visibility in metres
// as Open-Meteo's own defaults. Those are the *canonical* values, and they are
// what the app stores, compares and reasons about: the thresholds in
// conditions.js, the colour ramps, the nowcast's rate bands. Only the last step
// before the screen converts. That is what makes switching a unit instant and
// offline — nothing is refetched, and no cached reading is left in the old
// scale — and it keeps one number, not four, flowing through the logic.
//
// Temperature is the exception and stays where it was, in weatherCodes.toTemp:
// it is threaded everywhere as a bare `unit` string and colour-coded off raw
// °F, and folding it in here would touch far more than it would tidy.

// group -> the canonical unit its values arrive in, the localStorage key, and
// the options offered for it. `from` converts a canonical value; `decimals` is
// how many places that option is worth showing (m/s and mmHg move in smaller
// steps than mph and hPa, so a rounded integer would hide real change).
export const UNIT_GROUPS = {
  wind: {
    label: 'Wind',
    storageKey: 'alek-weather-unit-wind',
    fallback: 'mph',
    canonical: 'mph',
    options: [
      { value: 'mph', label: 'mph',  suffix: 'mph',  decimals: 0, from: (v) => v },
      { value: 'kmh', label: 'km/h', suffix: 'km/h', decimals: 0, from: (v) => v * 1.609344 },
      { value: 'ms',  label: 'm/s',  suffix: 'm/s',  decimals: 1, from: (v) => v * 0.44704 },
      { value: 'kn',  label: 'kn',   suffix: 'kn',   decimals: 0, from: (v) => v * 0.868976 },
    ],
  },
  pressure: {
    label: 'Pressure',
    storageKey: 'alek-weather-unit-pressure',
    fallback: 'inHg',
    canonical: 'hPa',
    options: [
      { value: 'inHg', label: 'inHg', suffix: 'inHg', decimals: 2, from: (v) => v / 33.8639 },
      { value: 'hPa',  label: 'hPa',  suffix: 'hPa',  decimals: 0, from: (v) => v },
      { value: 'mmHg', label: 'mmHg', suffix: 'mmHg', decimals: 0, from: (v) => v * 0.750062 },
    ],
  },
  visibility: {
    label: 'Visibility',
    storageKey: 'alek-weather-unit-visibility',
    fallback: 'mi',
    canonical: 'm',
    options: [
      { value: 'mi', label: 'mi', suffix: 'mi', decimals: 1, from: (v) => v / 1609.34 },
      { value: 'km', label: 'km', suffix: 'km', decimals: 1, from: (v) => v / 1000 },
    ],
  },
  precip: {
    label: 'Precipitation',
    storageKey: 'alek-weather-unit-precip',
    fallback: 'in',
    canonical: 'in',
    options: [
      { value: 'in', label: 'in', suffix: 'in', decimals: 2, from: (v) => v },
      { value: 'mm', label: 'mm', suffix: 'mm', decimals: 1, from: (v) => v * 25.4 },
    ],
  },
}

export const UNIT_GROUP_KEYS = Object.keys(UNIT_GROUPS)

export const DEFAULT_UNITS = Object.fromEntries(
  UNIT_GROUP_KEYS.map((g) => [g, UNIT_GROUPS[g].fallback]),
)

// Read every group out of localStorage at once, falling back per group. A value
// that is no longer offered (a renamed option, a hand-edited key) falls back
// rather than propagating as an unmatched string.
export function loadUnits() {
  const out = { ...DEFAULT_UNITS }
  for (const g of UNIT_GROUP_KEYS) {
    const saved = localStorage.getItem(UNIT_GROUPS[g].storageKey)
    if (saved && UNIT_GROUPS[g].options.some((o) => o.value === saved)) out[g] = saved
  }
  return out
}

export function saveUnit(group, value) {
  localStorage.setItem(UNIT_GROUPS[group].storageKey, value)
}

// The chosen option for a group, never undefined: an unknown unit resolves to
// the group's first option, so a bad value renders in a real scale rather than
// throwing halfway down a render.
function optionFor(group, units) {
  const g = UNIT_GROUPS[group]
  return g.options.find((o) => o.value === units?.[group]) ?? g.options[0]
}

// The number alone, converted and rounded for the chosen unit. Returns null for
// a missing reading so callers can fall through to their own em-dash.
export function unitValue(group, canonical, units) {
  if (canonical == null || !Number.isFinite(canonical)) return null
  const opt = optionFor(group, units)
  return Number(opt.from(canonical).toFixed(opt.decimals))
}

// The number as it should read, keeping trailing zeros the rounding implies —
// pressure in inHg is "29.90", not "29.9".
export function unitText(group, canonical, units) {
  if (canonical == null || !Number.isFinite(canonical)) return null
  const opt = optionFor(group, units)
  return opt.from(canonical).toFixed(opt.decimals)
}

export function unitSuffix(group, units) {
  return optionFor(group, units).suffix
}

// Value and suffix together, the common case: "10 mph", "29.90 inHg".
export function formatUnit(group, canonical, units, fallback = '—') {
  const text = unitText(group, canonical, units)
  return text == null ? fallback : `${text} ${unitSuffix(group, units)}`
}

// Named wrappers, so call sites read as what they are showing rather than as a
// lookup. Each takes the canonical value documented on its group above.
export const formatWind       = (mph, units, fallback)    => formatUnit('wind', mph, units, fallback)
export const formatPressure   = (hpa, units, fallback)    => formatUnit('pressure', hpa, units, fallback)
export const formatVisibility = (metres, units, fallback) => formatUnit('visibility', metres, units, fallback)
export const formatPrecip     = (inches, units, fallback) => formatUnit('precip', inches, units, fallback)

// A signed delta in the chosen unit, for trends ("+0.04 inHg"). The sign is set
// from the canonical value and the magnitude converted, so a unit whose scale
// runs the same direction can't disagree with the arrow beside it.
export function formatUnitDelta(group, canonicalDelta, units) {
  if (canonicalDelta == null || !Number.isFinite(canonicalDelta)) return null
  const opt = optionFor(group, units)
  const magnitude = Math.abs(opt.from(canonicalDelta)).toFixed(opt.decimals)
  return `${canonicalDelta > 0 ? '+' : '−'}${magnitude} ${opt.suffix}`
}
