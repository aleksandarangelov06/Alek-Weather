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
// Each hour's storm risk from `start` on, at most `count` of them. The part of
// analyzeStorm that looks at hours one at a time, apart so the outlook
// (stormOutlook) can read further ahead than the page's 24 hours.
// `live` is whether the first hour is the current one, which takes the live
// reading (code, gusts, a severe warning in force) over the forecast's.
function scoreHours({ weather, ranked, liveCode, start, count, live = true }) {
  const { hourly, current } = weather
  const tolerance = snowTolerance(weather.latitude, weather.elevation)
  const snowAt = (i) => (Number.isFinite(hourly.snowfall?.[i]) ? hourly.snowfall[i] : 0)
  const severeNow = ranked.some((a) =>
    /(severe thunderstorm|tornado) warning/i.test(a.properties?.event ?? ''))

  const end = Math.min(hourly.time.length, start + count)
  const hours = []
  for (let i = start; i < end; i++) {
    const k = live ? i - start : -1
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
  return hours
}

export function analyzeStorm({ weather, alerts, liveCode, start, count = 24 }) {
  const { hourly, daily } = weather
  const ranked = sortAlerts(alerts)
  const tolerance = snowTolerance(weather.latitude, weather.elevation)
  const hours = scoreHours({ weather, ranked, liveCode, start, count })

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

// ── Advance warning ─────────────────────────────────────────────────────────
//
// The Storm Center used to switch on only once the weather here had already
// turned, which is too late to buy groceries or fill the car. It now has two
// modes: 'live', when it is happening (or a storm-based warning is out), and
// 'ahead', when a significant storm is in the next three days, or a storm
// watch or warning is out before anything has started. Both come from the
// same scores the page shows, so the banner and the dial can't disagree.

// Alerts that have not ended yet. A cached feed can hold on to one past its
// end time, and it went on switching the Storm Center on.
export function activeAlerts(alerts, nowMs) {
  return (alerts ?? []).filter((a) => {
    const end = a?.properties?.ends ?? a?.properties?.expires
    if (!end) return true
    const t = +new Date(end)
    return !Number.isFinite(t) || t > nowMs
  })
}

const OUTLOOK_HOURS = 72
// Calm hours between two stormy spells that still make them one storm.
const EVENT_GAP = 3

// The first significant storm in the next three days, or null: a spell of
// stormy hours (Low or worse) that peaks High or worse, or brings snow or ice
// that is at least Moderate for this place (2 inches in Washington, more in
// Denver, see snowTolerance). CAPE alone is fuel rather than a forecast, so a
// thunder spell also needs thunder in the forecast or a real chance of rain.
export function stormOutlook({ weather, alerts, liveCode, start, count = OUTLOOK_HOURS }) {
  const ranked = sortAlerts(alerts)
  const hours = scoreHours({ weather, ranked, liveCode, start, count })
  const tolerance = snowTolerance(weather.latitude, weather.elevation)

  const runs = []
  let run = null
  let calm = 0
  hours.forEach((h, k) => {
    if (h.score >= CALM) {
      if (!run) run = { from: k, to: k }
      run.to = k
      calm = 0
    } else if (run && ++calm >= EVENT_GAP) {
      runs.push(run)
      run = null
      calm = 0
    }
  })
  if (run) runs.push(run)

  for (const r of runs) {
    const span = hours.slice(r.from, r.to + 1)
    const peakAt = span.reduce((best, h, k) => (h.score > span[best].score ? k : best), 0)
    const peak = span[peakAt]
    const snowTotal = span.reduce((s, h) => s + (Number.isFinite(h.snowfall) ? h.snowfall : 0), 0)
    const snowSeverity = snowScore(SNOW_DAY, snowTotal, tolerance)
    const freezing = span.some((h) => h.freezing)
    let severity = Math.max(peak.score, snowSeverity)
    // A glaze of ice is dangerous anywhere, however little falls.
    if (freezing) severity = Math.max(severity, 40)
    const kind = freezing ? 'ice'
      : peak.kind === 'snow' || (snowSeverity >= 20 && snowSeverity >= peak.score - 10) ? 'snow'
      : peak.kind ?? 'rain'
    const wintry = kind === 'snow' || kind === 'ice'
    if (kind === 'thunder' && !span.some((h) => h.thunderCode) && (peak.pop ?? 0) < 40) continue
    if (severity < (wintry ? 40 : 60)) continue

    let gustMax = null
    span.forEach((h) => { if (h.gust != null && (gustMax == null || h.gust > gustMax)) gustMax = h.gust })
    const end = r.to + 1 < hours.length ? r.to + 1 : null
    const capped = Math.min(100, severity)
    // A storm already under way began before this hour: walk back through the
    // forecast's earlier hours (the feed carries the day before) to its first
    // stormy one, allowing the same calm gaps a storm is joined across.
    let beganTime = null
    if (r.from === 0 && start > 0) {
      const back = Math.min(start, 24)
      const past = scoreHours({ weather, ranked, liveCode, start: start - back, count: back, live: false })
      let gap = 0
      for (let k = past.length - 1; k >= 0; k--) {
        if (past[k].score >= CALM) { beganTime = past[k].time; gap = 0 }
        else if (++gap >= EVENT_GAP) break
      }
    }
    return {
      kind,
      severity: capped,
      level: stormLevel(capped),
      startIdx: r.from,
      peakIdx: r.from + peakAt,
      endIdx: end,
      startTime: hours[r.from].time,
      // When a storm under way began, if before this hour (else null).
      beganTime,
      peakTime: peak.time,
      endTime: end != null ? hours[end].time : null,
      nowTime: hours[0]?.time ?? null,
      // The last hour looked at: where a storm still going (endTime null) runs off.
      lastTime: hours[hours.length - 1]?.time ?? null,
      snowTotal,
      snowLevel: stormLevel(snowSeverity),
      gustMax,
      freezing,
      thunder: span.some((h) => h.thunderCode),
    }
  }
  return null
}

// ── How much has fallen ─────────────────────────────────────────────────────
//
// A storm's rain and snow, split into what has already fallen and what is
// still to come, over the window the Storm progress bar shows (a warning's
// times, or the outlook's storm). The page fills a gauge with it.
//
// Open-Meteo's hourly amounts are each the total for the hour *ending* at that
// time, so the slot stamped 3 PM covers 2 to 3 PM. A slot the window's start,
// its end or now cuts through counts the share of it on that side. An hour
// with any snowfall counts toward snow (its precipitation is mostly that
// snow's water), every other hour toward rain, so neither is counted twice.
//
// The hours already gone are the model's account of them, not a gauge's: an
// estimate, and the page says so.
const HOUR_MS = 3600000
// Below these a gauge would be filling with nothing worth a gauge.
export const RAIN_GAUGE_MIN = 0.05
export const SNOW_GAUGE_MIN = 0.1

// `toMs` turns an hourly timestamp into ms since the epoch; `start`, `end` and
// `now` are ms too. Returns { rain, snow }, each { fallen, total, frac } in
// inches, or null when the storm brings too little of it.
export function stormPrecip({ hourly, toMs, start, end, now }) {
  const times = hourly?.time ?? []
  const amount = (v) => (Number.isFinite(v) && v > 0 ? v : 0)
  const rain = { fallen: 0, total: 0 }
  const snow = { fallen: 0, total: 0 }
  for (let i = 0; i < times.length; i++) {
    const slotEnd = toMs(times[i])
    const lo = Math.max(slotEnd - HOUR_MS, start)
    const hi = Math.min(slotEnd, end)
    if (!(hi > lo)) continue
    const snowfall = amount(hourly.snowfall?.[i])
    const [bucket, value] = snowfall > 0 ? [snow, snowfall] : [rain, amount(hourly.precipitation?.[i])]
    bucket.total += value * ((hi - lo) / HOUR_MS)
    const doneTo = Math.min(hi, now)
    if (doneTo > lo) bucket.fallen += value * ((doneTo - lo) / HOUR_MS)
  }
  const gauge = (b, min) => (b.total >= min
    ? { fallen: b.fallen, total: b.total, frac: Math.min(1, b.fallen / b.total) }
    : null)
  return { rain: gauge(rain, RAIN_GAUGE_MIN), snow: gauge(snow, SNOW_GAUGE_MIN) }
}

// ── What happens when ───────────────────────────────────────────────────────
//
// The storm's window broken into what is happening across it: a lane per kind
// of weather (snow, freezing rain, rain, thunder, strong winds) with the spans
// it is forecast for, and a lane per storm alert with the span it is in force.
// A tornado is never in a forecast, only in a warning, so alerts are how the
// page can say "Tornado Warning 3:10 to 3:45 AM".
//
// The weather lanes read the hourly codes the way the rest of the page does
// (the hour stamped 3 AM is 3 to 4 AM; scoreHours, the timeline), with the
// live reading standing in for the forecast's code in the current hour. So a
// snowfall the radar and stations see, and the model hasn't caught up with,
// is on the snow lane from now. Snow also counts any hour the model puts
// snowfall in, whatever its code says.
//
// `start` is the index of the current hour; `window` is { start, end } in ms
// (the progress bar's); `toMs` turns an hourly timestamp into ms;
// `windowAlert` is the alert that set the window, left out of the lanes since
// the bar itself is it. Spans carry `from` and `to` in ms, `fromIso` and
// `toIso` for their labels, and `level` (1 light to 4 extreme) to shade by.
const STRONG_GUST = 40
const DAMAGING_GUST = 58
const LANE_ORDER = ['thunder', 'snow', 'ice', 'rain', 'wind']

export function stormPhases({ hourly, liveCode, start, toMs, window: w, alerts = [], windowAlert = null }) {
  const times = hourly?.time ?? []
  const lanes = {}
  const add = (id, slot, level) => {
    const lane = (lanes[id] ??= [])
    const last = lane[lane.length - 1]
    if (last && last.endIndex === slot.i - 1) {
      last.endIndex = slot.i
      last.to = slot.to
      last.toIso = slot.toIso
      last.level = Math.max(last.level, level)
    } else {
      lane.push({ from: slot.from, to: slot.to, fromIso: slot.fromIso, toIso: slot.toIso, level, endIndex: slot.i })
    }
  }

  for (let i = 0; i < times.length; i++) {
    const t0 = toMs(times[i])
    const t1 = t0 + HOUR_MS
    if (t1 <= w.start || t0 >= w.end) continue
    const code = i === start && liveCode != null ? liveCode : hourly.weather_code?.[i]
    const tier = precipTier(code)
    // The amount stamped at the *next* hour is the one that fell in this one.
    const snowfall = hourly.snowfall?.[i + 1] ?? 0
    const gust = hourly.wind_gusts_10m?.[i]
    const slot = {
      i,
      from: Math.max(t0, w.start),
      to: Math.min(t1, w.end),
      fromIso: times[i],
      toIso: times[i + 1] ?? null,
    }
    if (THUNDER_CODES.has(code)) add('thunder', slot, tier)
    if (FREEZING_CODES.has(code)) add('ice', slot, Math.max(tier, 2))
    else if (SNOW_CODES.has(code) || snowfall >= 0.01) add('snow', slot, Math.max(tier, 1))
    else if (tier > 0) add('rain', slot, tier)
    if (Number.isFinite(gust) && gust >= STRONG_GUST) add('wind', slot, gust >= DAMAGING_GUST ? 4 : 2)
  }

  const weather = LANE_ORDER.filter((id) => lanes[id]).map((id) => ({
    id,
    kind: 'weather',
    spans: lanes[id].map((s) => ({ from: s.from, to: s.to, fromIso: s.fromIso, toIso: s.toIso, level: s.level })),
  }))

  // Storm alerts in force at some point in the window, most urgent first, one
  // lane each. Alert times are real instants, so they need no toMs.
  const alertLanes = sortAlerts(alerts)
    .filter((a) => a !== windowAlert && a.id !== windowAlert?.id && isStormAlert(a))
    .map((a) => {
      const p = a.properties
      const from = +new Date(p.onset ?? p.effective ?? p.sent)
      const to = +new Date(p.ends ?? p.expires)
      // No end on the alert: it runs to the end of the window.
      const end = Number.isFinite(to) ? to : w.end
      if (!Number.isFinite(from) || end <= w.start || from >= w.end) return null
      return {
        id: a.id,
        kind: 'alert',
        alert: a,
        spans: [{
          from: Math.max(from, w.start),
          to: Math.min(end, w.end),
          fromIso: null,
          toIso: null,
          fromInstant: p.onset ?? p.effective ?? p.sent,
          toInstant: p.ends ?? p.expires ?? null,
          level: 4,
        }],
      }
    })
    .filter(Boolean)

  return [...alertLanes, ...weather]
}

// What to call a storm in the outlook.
export function outlookName(o) {
  const s = o.severity
  switch (o.kind) {
    case 'ice': return s >= 60 ? 'Ice storm' : 'Freezing rain'
    case 'snow': return s >= 60 ? 'Winter storm' : 'Accumulating snow'
    case 'thunder': return s >= 80 ? 'Severe storms' : 'Strong storms'
    case 'wind': return s >= 80 ? 'Damaging winds' : 'High winds'
    default: return s >= 80 ? 'Flooding rain' : 'Heavy rain'
  }
}

const dayNumber = (date) => Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) / 86400000

// When a naive local hour falls, said the way a forecast says it, from the
// forecast's own current hour: "by 4 PM", "tonight", "tomorrow morning",
// "early Saturday", "Saturday afternoon".
export function whenText(iso, nowIso) {
  if (!iso || !nowIso) return ''
  const days = dayNumber(iso.slice(0, 10)) - dayNumber(nowIso.slice(0, 10))
  const h = +iso.slice(11, 13)
  const clock = `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`
  const part = h < 5 ? 'early' : h < 12 ? 'morning' : h < 17 ? 'afternoon' : h < 21 ? 'evening' : 'night'
  if (days <= 0) return h >= 18 && +nowIso.slice(11, 13) < 17 ? 'tonight' : `by ${clock}`
  if (days === 1) {
    if (part === 'early') return 'overnight'
    return part === 'night' ? 'tomorrow night' : `tomorrow ${part}`
  }
  const day = new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })
  return part === 'early' ? `early ${day}` : `${day} ${part}`
}

// The look the Storm Center takes (the tab glow, the banner's icon), by kind.
const OUTLOOK_LOOK = { thunder: 'storm', wind: 'storm', rain: 'rain', snow: 'snow', ice: 'snow' }
function alertLook(event) {
  if (HAZARD_ALERTS.snow.test(event)) return 'snow'
  if (/flood|rain/i.test(event)) return 'rain'
  return 'storm'
}

// What a phone or the web Home should show of the Storm Center right now, or
// null for nothing: { mode: 'live' | 'ahead', kind (its look), label, score
// (what the dial reads), level, alert, outlook }.
//
// Live: a storm-based warning (stormCenterAlert); weather here now that is at
// least Moderate, or freezing rain; or a significant storm (the outlook's)
// already under way. Ordinary rain no longer opens it over a Low dial.
// Ahead: a significant storm later in the next three days, or a storm watch
// or warning in effect before the weather has turned.
export function stormCenterState({ weather, alerts, liveCode, start }) {
  const ranked = sortAlerts(alerts)
  const storm = analyzeStorm({ weather, alerts: ranked, liveCode, start })
  const outlook = stormOutlook({ weather, alerts: ranked, liveCode, start })
  const now = storm.now
  const nowScore = now?.score ?? 0
  const make = (mode, kind, label, score, alert = null) => {
    const s = Math.min(100, Math.max(0, score))
    return { mode, kind, label, score: s, level: stormLevel(s), alert, outlook }
  }

  const lead = stormCenterAlert(ranked)
  if (lead) return make('live', 'extreme', lead.properties.event, storm.threat.score, lead)

  const freezingNow = FREEZING_CODES.has(liveCode) && nowScore >= 20
  const underway = !!outlook && outlook.startIdx === 0
  if (nowScore >= 40 || freezingNow || underway) {
    const tier = precipTier(liveCode)
    const label = liveCode >= 95 ? 'Thunderstorm now'
      : freezingNow ? 'Freezing rain now'
      : SNOW_CODES.has(liveCode) && tier >= 3 ? 'Heavy snow now'
      : underway ? `${outlookName(outlook)} under way`
      : now?.kind === 'wind' ? 'Strong winds now'
      : SNOW_CODES.has(liveCode) ? 'Snow now'
      : tier >= 3 ? 'Heavy rain now'
      : 'Stormy weather now'
    const kind = liveCode >= 95 || now?.kind === 'wind' || now?.kind === 'thunder' ? 'storm'
      : freezingNow || SNOW_CODES.has(liveCode) ? 'snow'
      : underway ? OUTLOOK_LOOK[outlook.kind]
      : 'rain'
    return make('live', kind, label, Math.max(storm.threat.score, underway ? outlook.severity : 0))
  }

  const watch = ranked.find((a) => isStormAlert(a) && alertTier(a.properties) <= 1) ?? null
  if (outlook) {
    const label = `${outlookName(outlook)} ${whenText(outlook.startTime, outlook.nowTime)}`
    return make('ahead', OUTLOOK_LOOK[outlook.kind], label, outlook.severity, watch)
  }
  if (watch) {
    const event = watch.properties.event
    return make('ahead', alertLook(event), event, Math.max(storm.threat.score, alertFloor(watch.properties)), watch)
  }
  return null
}

// A sentence or three on a storm that is coming: when, how bad, what it
// brings. `snowText` and `gustText` format amounts in the page's units.
export function outlookNote(o, { snowText, gustText } = {}) {
  const when = whenText(o.startTime, o.nowTime)
  const peak = o.peakIdx > o.startIdx
    ? `, at its worst ${whenText(o.peakTime, o.nowTime).replace(/^by /, 'around ')}`
    : ''
  const parts = [`${outlookName(o)} expected ${when}${peak}.`]
  if (o.kind === 'snow' && o.snowTotal >= 0.1 && snowText) parts.push(`About ${snowText(o.snowTotal)} in all.`)
  else if (o.kind === 'ice') parts.push('Roads and power lines could ice over.')
  else if (o.gustMax >= 40 && gustText) parts.push(`Gusts could reach ${gustText(o.gustMax)}.`)
  parts.push('Now is the time to get ready.')
  return parts.join(' ')
}
