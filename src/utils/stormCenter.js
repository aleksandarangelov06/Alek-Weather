import { precipTier, SNOW_CODES, THUNDER_CODES } from './weatherCodes'
import { stormHour, stormLevel } from './stormRisk'

// The reading behind the web app's Storm Center page: one threat level for
// right now, the four hazards that make it up, the next 24 hours of storm risk,
// and the alerts in force, ranked. Built on stormRisk.js so the page agrees
// with the Storm risk tile everywhere else in the app, with active NWS alerts
// laid over the forecast: a forecaster's warning outranks a model's hunch.

export const FREEZING_RAIN_CODES = new Set([56, 57, 66, 67])
const FREEZING_CODES = FREEZING_RAIN_CODES

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

// ── Impact, not amount ──────────────────────────────────────────────────────
//
// The same snow means very different things in different places: 2 inches
// shuts Atlanta down and goes unnoticed in Bozeman. So snow is scored against
// how used to it a place is, a multiplier on the amounts each level takes.
// There is no snow climatology to hand, so it comes from what drives one:
// latitude, and elevation (the forecast's own, from Open-Meteo). Around 1 for
// a mid-latitude lowland city (Washington, Chicago is a little over), about
// half in the Deep South, about 2 in Montana's valleys, more in the mountains.
// The NWS sets its own warning criteria the same way, by place.
export function snowTolerance(latitude, elevation) {
  const lat = Number.isFinite(latitude) ? Math.abs(latitude) : 40
  const byLat = scale([[28, 0.35], [34, 0.6], [38, 0.85], [42, 1.1], [46, 1.45], [55, 1.8]], lat)
  const byElev = Number.isFinite(elevation)
    ? scale([[300, 0], [1000, 0.35], [1500, 0.7], [2500, 1.2], [3500, 1.5]], elevation)
    : 0
  return byLat + byElev
}

// Inches, for a place of tolerance 1; multiplied by the place's tolerance.
// The 24-hour total sets the snow hazard (Low from half an inch, Moderate
// from 2, High from 5, Extreme from 10); six hours of it sets an hour's
// score on the timeline, so a burst reads as worse than the same snow spread
// over a day.
const SNOW_DAY = [[0, 0], [0.5, 20], [2, 40], [5, 60], [10, 80], [18, 100]]
const SNOW_6H = [[0, 0], [0.3, 20], [1.2, 40], [3, 60], [6, 80], [10, 100]]
const snowScore = (table, inches, tolerance) => scale(table.map(([x, y]) => [x * tolerance, y]), inches)

// How far an alert on its own lifts a hazard and the headline threat (0-100).
//
// Storm-based warnings (tornado, severe thunderstorm, flash flood) are drawn
// as a polygon around the storm itself, minutes to an hour ahead: being in one
// means the danger is here. Everything else (winter storm, wind, heat, river
// flood, every watch and advisory) is issued for whole forecast zones, often
// a county or more of very different ground. A Winter Storm Warning for
// Gallatin County is mostly about its mountains; the valley may see 2 inches.
// So a zone alert only says "something is up around here" (Low), and the
// forecast for this point decides how bad it is. Anything the NWS itself
// rates Extreme is Extreme.
const POINT_WARNING = /tornado|severe thunderstorm|flash flood|extreme wind|snow squall|dust storm/i
const ZONE_FLOOR = [30, 22, 20, 0]

export function isPointAlert(props) {
  return alertTier(props) === 0 && POINT_WARNING.test(props?.event ?? '')
}

export function alertFloor(props) {
  let floor = ZONE_FLOOR[alertTier(props)]
  if (isPointAlert(props)) floor = /tornado/i.test(props.event) ? 85 : 70
  if (props?.severity === 'Extreme') floor = Math.max(floor, 80)
  return floor
}

// Warning (happening or imminent), Watch (be ready), Advisory, anything else.
export function alertTier(props) {
  const event = (props?.event ?? '').trim()
  if (/warning$/i.test(event)) return 0
  if (/watch$/i.test(event)) return 1
  if (/advisory$/i.test(event)) return 2
  return 3
}

// Alerts for a storm: violent weather that is happening or about to. Everything
// else the NWS warns about (coastal and river flooding, heat, freeze, fire
// weather, surf, air quality) can be serious, but it can be issued under a
// clear sky, and the Storm Center opening with an Extreme threat on a sunny day
// for a tidal flood read as a false alarm. Those still show in the alert list.
const STORM_EVENTS = /tornado|severe thunderstorm|flash flood|hurricane|tropical storm|storm surge|typhoon|extreme wind|high wind|blizzard|ice storm|winter storm|snow squall|dust storm/i
export const isStormAlert = (a) => STORM_EVENTS.test(a?.properties?.event ?? '')

// The alert that switches the Storm Center on by itself, or null. Only a
// warning drawn around the storm itself (isPointAlert), a tropical one (a
// hurricane is coming whatever the sky looks like yet), or a storm alert the
// NWS rates Extreme. Zone-wide warnings (winter storm, high wind, blizzard)
// cover a county or more, and opened it with a red LIVE banner over a dial
// that, rightly, read Low for this spot. Those still open it once the weather
// here turns (brandEvent in App.jsx), and are listed on the page either way.
const TROPICAL_WARNING = /hurricane|tropical storm|storm surge|typhoon/i
export function stormCenterAlert(alerts) {
  return sortAlerts(alerts).find((a) => {
    const p = a.properties
    if (!isStormAlert(a)) return false
    if (isPointAlert(p) || p?.severity === 'Extreme') return true
    return alertTier(p) === 0 && TROPICAL_WARNING.test(p?.event ?? '')
  }) ?? null
}

// The colour the Storm Center is tinted with: the top alert's, by tier (the
// same red / orange / yellow the alert chips use), else the Storm Center tab glow's
// colour for what is happening. Fixed hexes rather than the --cond-* theme
// colours, because the page is dark in every theme.
const TIER_TINT = ['#ff3b30', '#ff8a1f', '#ffc533']
export const EVENT_TINT = { rain: '#3b9cff', snow: '#bfe6ff', storm: '#ffc533', extreme: '#ff3b30' }
export const CALM_TINT = '#8fa3c4'

export function stormTint(topAlert, eventKind) {
  const tier = topAlert ? alertTier(topAlert.properties) : 3
  return TIER_TINT[tier] ?? EVENT_TINT[eventKind] ?? CALM_TINT
}

const SEVERITY_RANK = { Extreme: 0, Severe: 1, Moderate: 2, Minor: 3 }

// Most urgent first: by tier, then by NWS severity.
export function sortAlerts(alerts) {
  return [...(alerts ?? [])].sort((a, b) =>
    alertTier(a.properties) - alertTier(b.properties)
    || (SEVERITY_RANK[a.properties?.severity] ?? 4) - (SEVERITY_RANK[b.properties?.severity] ?? 4))
}

// Which hazards an alert speaks to, by its event name. Only storm alerts are
// matched (see the loop in analyzeStorm), and the patterns name the storm
// events themselves: a bare /wind/ caught Wind Chill Warnings, and /freezing/
// Freezing Fog Advisories, and lifted Wind and Snow and ice for them.
const HAZARD_ALERTS = {
  thunder: /thunderstorm|tornado|lightning/i,
  // Not coastal or lakeshore flooding: that is the tide, not rain.
  rain: /(?<!coastal |lakeshore )flood|heavy rain|hydrologic|hurricane|tropical storm|storm surge|typhoon/i,
  wind: /high wind|extreme wind|wind advisory|tornado|hurricane|tropical storm|typhoon|severe thunderstorm|dust storm/i,
  snow: /winter storm|winter weather|snow squall|heavy snow|blizzard|ice storm|freezing rain|lake effect/i,
}

export const HAZARDS = ['thunder', 'rain', 'wind', 'snow']

// The window the hazard tiles and the headline threat look across.
const HAZARD_HOURS = 12
// A score under this is "Minimal": the line the timeline calls calm.
const CALM = 20

// `start` is the index of the current hour in `weather.hourly`. `liveCode` is
// the app's live condition (radar and nowcast included), which stands in for
// the forecast's code for the current hour.
export function analyzeStorm({ weather, alerts, liveCode, start, count = 24 }) {
  const { hourly, current, daily } = weather
  const ranked = sortAlerts(alerts)
  const tolerance = snowTolerance(weather.latitude, weather.elevation)
  const snowAt = (i) => (Number.isFinite(hourly.snowfall?.[i]) ? hourly.snowfall[i] : 0)
  const severeNow = ranked.some((a) =>
    /(severe thunderstorm|tornado) warning/i.test(a.properties?.event ?? ''))

  const end = Math.min(hourly.time.length, start + count)
  const hours = []
  for (let i = start; i < end; i++) {
    const k = i - start
    const code = k === 0 && liveCode != null ? liveCode : hourly.weather_code?.[i]
    const hourGust = hourly.wind_gusts_10m?.[i]
    const gust = k === 0 && Number.isFinite(current.wind_gusts_10m)
      ? Math.max(current.wind_gusts_10m, Number.isFinite(hourGust) ? hourGust : 0)
      : hourGust
    const pop = hourly.precipitation_probability?.[i]
    let h = stormHour({ cape: hourly.cape?.[i], code, pop, gust, severe: severeNow && k === 0 })
    const freezing = FREEZING_CODES.has(code)
    // Snow is scored by how much falls over the next six hours here, against
    // what this place is used to (see snowTolerance), instead of by the
    // chance of it. Freezing rain keeps the forecast's own score: a glaze of
    // ice is dangerous anywhere.
    const snowy = !freezing && (SNOW_CODES.has(code) || snowAt(i) > 0)
    let snowPart = 0
    if (snowy) {
      let sixHours = 0
      for (let j = i; j < Math.min(hourly.time.length, i + 6); j++) sixHours += snowAt(j)
      snowPart = snowScore(SNOW_6H, sixHours, tolerance)
      // A snow code with no snowfall behind it (the live reading says it is
      // snowing, the model's amounts say nothing) scored 0, and the hour read
      // "Minimal, Calm" in the middle of a snowfall. Snow that is falling is at
      // least Low, and heavy snow at least Moderate, whatever the amounts say.
      if (SNOW_CODES.has(code)) snowPart = Math.max(snowPart, precipTier(code) >= 3 ? 40 : 20)
      const { thunder, wind } = h.parts
      let score = Math.max(thunder, snowPart, wind)
      // Snow and wind together is blowing snow, worse than either.
      if (snowPart >= 20 && wind >= 20) score = Math.min(100, score + 10)
      const kind = score <= 0 ? null
        : thunder >= snowPart && thunder >= wind ? 'thunder'
        : snowPart >= wind ? 'snow'
        : 'wind'
      h = { ...h, score, level: stormLevel(score), kind }
    }
    hours.push({
      ...h,
      // stormHour names the biggest part, so a thunderstorm with a high rain
      // chance reads as "rain". Here, thunder in the forecast is a thunderstorm.
      kind: h.thunderCode && h.score > 0 ? 'thunder' : h.kind,
      time: hourly.time[i],
      code,
      pop: Number.isFinite(pop) ? pop : null,
      gust: Number.isFinite(gust) ? gust : null,
      snowfall: hourly.snowfall?.[i] ?? 0,
      freezing,
      // The wet part belongs to the snow tile or the rain tile, never both.
      hazard: {
        thunder: h.parts.thunder,
        rain: snowy || freezing ? 0 : h.parts.wet,
        wind: h.parts.wind,
        snow: snowy ? snowPart : freezing ? h.parts.wet : 0,
      },
    })
  }

  const soon = hours.slice(0, HAZARD_HOURS)
  const snowTotal = hours.reduce((s, h) => s + (Number.isFinite(h.snowfall) ? h.snowfall : 0), 0)
  // The day's total, for this place: what the snow tile is rated on.
  const snowDay = snowScore(SNOW_DAY, snowTotal, tolerance)

  // Each hazard: the worst hour in the window, lifted by any alert for it.
  const hazards = {}
  for (const id of HAZARDS) {
    let score = 0
    let peak = -1
    soon.forEach((h, k) => {
      if (h.hazard[id] > score) { score = h.hazard[id]; peak = k }
    })
    if (id === 'snow') score = Math.max(score, snowDay)
    const alert = ranked.find((a) => isStormAlert(a) && HAZARD_ALERTS[id].test(a.properties?.event ?? '')) ?? null
    if (alert) score = Math.max(score, alertFloor(alert.properties))
    hazards[id] = { score, level: stormLevel(score), peak, alert, alertZone: alert ? !isPointAlert(alert.properties) : false }
  }

  // Detail for the tiles.
  const thunderAt = soon.findIndex((h) => THUNDER_CODES.has(h.code))
  const capeMax = Math.max(0, ...soon.map((h) => h.cape ?? 0))
  const popMax = Math.max(0, ...soon.map((h) => h.pop ?? 0))
  let gustMax = null
  let gustAt = -1
  soon.forEach((h, k) => {
    if (h.gust != null && (gustMax == null || h.gust > gustMax)) { gustMax = h.gust; gustAt = k }
  })
  const freezing = soon.some((h) => h.freezing)
  const todayIdx = daily.time.indexOf(hourly.time[start]?.slice(0, 10))
  const rainToday = todayIdx >= 0 ? daily.precipitation_sum?.[todayIdx] ?? null : null

  // The headline threat: the next few hours, the day's snow here, or what the
  // storm alerts in force lift it to (see alertFloor), whichever is worse.
  // Only storm alerts lift it (see isStormAlert): a Coastal Flood Warning on a
  // clear day is not a storm threat.
  const topAlert = ranked[0] ?? null
  const topStorm = ranked.find(isStormAlert) ?? null
  const near = Math.max(0, ...hours.slice(0, 3).map((h) => h.score))
  const alertLift = Math.max(0, ...ranked.filter(isStormAlert).map((a) => alertFloor(a.properties)))
  const snowLift = snowTotal > 0 && hours.slice(0, HAZARD_HOURS).some((h) => h.snowfall > 0) ? snowDay : 0
  const threatScore = Math.min(100, Math.max(near, alertLift, snowLift))

  const now = hours[0] ?? null
  const peakIdx = hours.reduce((best, h, k) => (best < 0 || h.score > hours[best].score ? k : best), -1)
  const peak = peakIdx >= 0 ? hours[peakIdx] : null

  // When it settles: the first hour, from the peak on, that is calm and stays
  // calm the hour after. Null when it doesn't within the forecast shown, and
  // 'quiet' when nothing ever rises above calm.
  let calmIdx = null
  if (!peak || peak.score < CALM) calmIdx = 'quiet'
  else {
    for (let k = Math.max(peakIdx, 0); k < hours.length; k++) {
      if (hours[k].score < CALM && (hours[k + 1]?.score ?? 0) < CALM) { calmIdx = k; break }
    }
  }

  return {
    hours,
    now,
    peak,
    peakIdx,
    calmIdx,
    threat: { score: threatScore, level: stormLevel(threatScore) },
    hazards,
    detail: { thunderAt, capeMax, popMax, gustMax, gustAt, snowTotal, freezing, rainToday, snowTolerance: tolerance, snowDay: stormLevel(snowDay) },
    alerts: ranked,
    topAlert,
    // The alert the page leads with (banner, countdown, ticker tag): the most
    // urgent storm alert, else the most urgent of any. A Coastal Flood Warning
    // outranks a Severe Thunderstorm Watch by tier, but on a page about the
    // storm it shouldn't be the banner over it.
    leadAlert: topStorm ?? topAlert,
    dominant: dominantHazard(topStorm, hazards, thunderAt >= 0),
  }
}

// The hazard the page leads with (its ring is highlighted): the top alert's
// hazard if there is one, then a
// thunderstorm in the forecast (lightning is the danger, whatever else scores
// higher), else the hazard scoring highest.
function dominantHazard(topAlert, hazards, thunderSoon) {
  const event = topAlert?.properties?.event ?? ''
  if (/tornado/i.test(event)) return 'tornado'
  if (/flood/i.test(event)) return 'flood'
  if (/thunderstorm/i.test(event)) return 'thunder'
  if (HAZARD_ALERTS.snow.test(event)) return 'snow'
  if (/wind|hurricane|tropical/i.test(event)) return 'wind'
  if (thunderSoon && hazards.thunder.score >= CALM) return 'thunder'
  const [best, h] = Object.entries(hazards).sort((a, b) => b[1].score - a[1].score)[0]
  if (h.score <= 0) return null
  if (best === 'rain' && h.score >= 60) return 'flood'
  return best
}

// The labelled parts of an NWS alert body. Zone alerts write them as
// "* WHAT...", "* WHERE...", "* WHEN..."; storm-based warnings as "HAZARD...",
// "SOURCE...", "IMPACT...". Each is its own paragraph either way.
const FACT_LABELS = {
  WHAT: 'What', WHERE: 'Where', WHEN: 'When', IMPACT: 'Impacts', IMPACTS: 'Impacts',
  HAZARD: 'Hazard', SOURCE: 'Source',
}

export function alertFacts(description, max = 4) {
  if (!description) return []
  const out = []
  for (const para of description.split(/\n\s*\n/)) {
    const m = para.match(/^\s*\*?\s*([A-Z]+)\.\.\.([\s\S]+)$/)
    if (!m || !FACT_LABELS[m[1]]) continue
    let text = m[2].replace(/\s+/g, ' ').trim()
    if (text.length > 240) text = `${text.slice(0, 237).replace(/\s+\S*$/, '')}...`
    out.push({ label: FACT_LABELS[m[1]], text })
    if (out.length >= max) break
  }
  return out
}
