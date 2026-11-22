import { precipTier, SNOW_CODES, THUNDER_CODES } from './weatherCodes'

// Storm risk for an hour, 0–100, from everything that makes weather stormy
// rather than from thunderstorm fuel alone. CAPE (the old measure) only says
// whether the air *could* feed a thunderstorm, so a wet, windy day with stable
// air read "Minimal" right beside a "Likely" rain card. The score is the worst
// of three parts:
//
//   thunder  CAPE, raised to a floor when the forecast itself has thunder (and
//            higher still under a severe thunderstorm warning)
//   wet      the chance of rain or snow, weighted by how heavy the forecast
//            hour's precipitation is
//   wind     the gusts
//
// with a small bump when rain and strong gusts come together. The bands are a
// fifth of the scale each, labelled as the CAPE bands were, and CAPE maps onto
// the scale so that its old thresholds land on the same band edges.

const LEVELS = [
  { label: 'Minimal',  color: 'var(--cond-green)' },
  { label: 'Low',      color: 'var(--cond-lime)' },
  { label: 'Moderate', color: 'var(--cond-yellow)' },
  { label: 'High',     color: 'var(--cond-orange)' },
  { label: 'Extreme',  color: 'var(--cond-red)' },
]

// [value, score] points, joined by straight lines and flat past either end.
function scale(points, v) {
  if (v <= points[0][0]) return points[0][1]
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i]
    if (v <= x1) {
      const [x0, y0] = points[i - 1]
      return y0 + ((v - x0) / (x1 - x0)) * (y1 - y0)
    }
  }
  return points[points.length - 1][1]
}

// J/kg. 300 / 1,000 / 2,500 / 4,000 were the Low → Extreme edges before.
const CAPE_SCALE = [[0, 0], [300, 20], [1000, 40], [2500, 60], [4000, 80], [6000, 100]]
// mph (the forecast is requested in mph whatever the display unit). 40 mph is
// gusty, ~50 is wind-advisory strength, 58 is the severe-thunderstorm gust.
const GUST_SCALE = [[30, 0], [40, 22], [50, 42], [58, 62], [75, 85], [100, 100]]
// By precipitation tier (weatherCodes.precipTier): [floor, per percent, cap].
// Light rain or a bare chance of it tops out at Low however certain it is;
// it takes a heavier forecast to reach Moderate and beyond. Rain at 50% or
// more (the precipitation card's "Likely") always reaches Low.
const WET_SCALE = [
  [0,  0.4,  39],  // no precipitation in the hour's code, only a chance of it
  [0,  0.45, 39],  // light
  [15, 0.45, 59],  // moderate
  [25, 0.5,  79],  // heavy
  [35, 0.55, 100], // violent showers
]

export function stormLevel(score) {
  const index = Math.min(LEVELS.length - 1, Math.max(0, Math.floor(score / 20)))
  return { index, ...LEVELS[index] }
}

export function stormHour({ cape, code, pop, gust, severe = false }) {
  const p = Number.isFinite(pop) ? pop : 0
  const thunderCode = THUNDER_CODES.has(code)

  let thunder = Number.isFinite(cape) ? scale(CAPE_SCALE, cape) : 0
  if (code === 95) thunder = Math.max(thunder, 50)
  if (code === 96 || code === 99) thunder = Math.max(thunder, 70)
  if (severe) thunder = Math.max(thunder, 80)

  // A thunderstorm hour's rain counts as moderate; the thunder part covers the rest.
  const tier = thunderCode ? 2 : precipTier(code)
  const [floor, perPct, cap] = WET_SCALE[tier]
  const wet = tier === 0 && p === 0 ? 0 : Math.min(floor + p * perPct, cap)

  const wind = Number.isFinite(gust) ? scale(GUST_SCALE, gust) : 0

  let score = Math.max(thunder, wet, wind)
  if (wet >= 20 && wind >= 20) score = Math.min(100, score + 10)

  const kind = score <= 0 ? null
    : thunder >= wet && thunder >= wind ? 'thunder'
    : wet >= wind ? (SNOW_CODES.has(code) ? 'snow' : 'rain')
    : 'wind'

  return { score, level: stormLevel(score), kind, thunderCode, cape: Number.isFinite(cape) ? cape : null }
}

// Every hour from `from` on (at most `count`), each with its time. `severeNow`
// is an active severe thunderstorm warning, which applies to the first hour.
export function stormHours(hourly, from, count = Infinity, severeNow = false) {
  const times = hourly?.time ?? []
  const start = Math.max(0, from)
  const end = Math.min(times.length, start + count)
  const out = []
  for (let i = start; i < end; i++) {
    out.push({
      time: times[i],
      ...stormHour({
        cape: hourly.cape?.[i],
        code: hourly.weather_code?.[i],
        pop: hourly.precipitation_probability?.[i],
        gust: hourly.wind_gusts_10m?.[i],
        severe: severeNow && i === start,
      }),
    })
  }
  return out
}

// The highest-scoring hour (the first of any tie), or null.
export function stormPeak(hours) {
  return hours.reduce((best, h) => (!best || h.score > best.score ? h : best), null)
}

export const STORM_KIND_NAME = { thunder: 'Thunder', rain: 'Rain', snow: 'Snow', wind: 'Wind' }

// What the weather is doing now, by kind and level (index 1–4).
const NOW_NOTES = {
  // CAPE alone: fuel, not a forecast, so these say "if".
  thunder: [
    null,
    'Some instability; a stray thunderstorm is possible.',
    'Enough energy for thunderstorms if they form.',
    'Strong storms are possible if anything sets them off.',
    'Explosive instability; severe storms are possible.',
  ],
  // Thunder in the forecast itself.
  thunderForecast: [
    null,
    'Thunderstorms are forecast.',
    'Thunderstorms are forecast.',
    'Strong thunderstorms are forecast.',
    'Severe thunderstorms are forecast; stay weather aware.',
  ],
  rain: [
    null,
    'Rain is likely, but it should stay light.',
    'Steady, heavy rain is likely.',
    'Downpours are likely; expect stormy weather.',
    'Torrential rain is likely; watch for flooding.',
  ],
  snow: [
    null,
    'Snow is likely, but it should stay light.',
    'Steady snow is likely.',
    'Heavy snow is likely; travel may be slow.',
    'Heavy snow and wind; travel could be dangerous.',
  ],
  wind: [
    null,
    'Gusty at times, but nothing stormy.',
    'Strong gusts; secure anything loose outdoors.',
    'Damaging gusts are possible.',
    'Dangerous winds; stay indoors if you can.',
  ],
}

// The same, later in the day, to follow "Quiet for now; ".
const LATER_NOTES = {
  thunder: [null, 'a stray thunderstorm is possible', 'thunderstorms are possible', 'strong thunderstorms are possible', 'severe thunderstorms are possible'],
  rain: [null, 'rain is likely', 'heavy rain is likely', 'downpours are likely', 'torrential rain is likely'],
  snow: [null, 'snow is likely', 'steady snow is likely', 'heavy snow is likely', 'heavy snow and wind are likely'],
  wind: [null, 'gusty winds are likely', 'strong gusts are likely', 'damaging gusts are possible', 'dangerous winds are possible'],
}

// One line for the current hour; when that is quiet, the worst of the next
// day (`peak`) and when it comes (`peakTime`, already formatted).
export function stormNote(now, peak, peakTime) {
  if (now && now.level.index > 0) {
    const notes = now.kind === 'thunder' && now.thunderCode ? NOW_NOTES.thunderForecast : NOW_NOTES[now.kind]
    return notes[now.level.index]
  }
  if (peak && peak.level.index > 0) {
    return `Quiet for now; ${LATER_NOTES[peak.kind][peak.level.index]} around ${peakTime}.`
  }
  return 'No storms expected in the next 24 hours.'
}
