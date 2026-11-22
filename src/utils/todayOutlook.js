// The Today card's reading of the day: how it compares with yesterday, and
// 1–10 ratings for being outside, driving and exercise.
// Pure functions over the forecast arrays, so they can be tested without a
// component. Every temperature in here is °F and every wind speed mph, the
// units the forecast is fetched in; the card converts for display.

import { RAIN_CODES, SNOW_CODES, THUNDER_CODES } from './weatherCodes'

const FREEZING_CODES = new Set([56, 57, 66, 67])
const HEAVY_SNOW_CODES = new Set([75, 86])
const HEAVY_RAIN_CODES = new Set([65, 82])
const MODERATE_RAIN_CODES = new Set([55, 63, 81])
const FOG_CODES = new Set([45, 48])

// ── Time window ────────────────────────────────────────────────────────────

function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const dateMinusOne = (dateStr) => addDays(dateStr, -1)

// From 9pm the day is as good as over, so the card turns to tomorrow.
const TOMORROW_FROM_HOUR = 21
// "Tomorrow" is rated over its waking hours: the small hours would only drag
// every score down for being dark and cold while nobody is out.
const TOMORROW_HOURS = ['06', '22']

export function showsTomorrow(hourStr) {
  return Number(hourStr) >= TOMORROW_FROM_HOUR
}

// The hours the ratings cover: from the current hour to the end of today. In
// the evening that is only a few hours, so it stretches to the next 12 and
// says so, rather than rating the day on one or two hours; from 9pm it is
// tomorrow's day instead.
export function outlookWindow(hourly, todayStr, hourStr) {
  if (showsTomorrow(hourStr)) {
    const win = tomorrowWindow(hourly, todayStr)
    if (win) return win
  }
  return todayWindow(hourly, todayStr, hourStr)
}

// Today from the current hour, whatever the time: what the At a Glance card's
// first tab shows.
export function todayWindow(hourly, todayStr, hourStr) {
  return restOfToday(hourly?.time ?? [], todayStr, hourStr)
}

// Tomorrow's waking hours, whatever the time now. `leadStart` is tomorrow's
// midnight: rain, snow, ice or fog in the small hours still shapes the morning
// (wet or icy roads on the way in), so dayHazards looks from there for those.
export function tomorrowWindow(hourly, todayStr) {
  const times = hourly?.time ?? []
  const tomorrow = addDays(todayStr, 1)
  const start = times.findIndex(t => t.startsWith(`${tomorrow}T${TOMORROW_HOURS[0]}`))
  const end = times.findIndex(t => t.startsWith(`${tomorrow}T${TOMORROW_HOURS[1]}`))
  if (start === -1 || end <= start) return null
  const midnight = times.findIndex(t => t.startsWith(`${tomorrow}T00`))
  return { start, end, leadStart: midnight === -1 || midnight > start ? start : midnight, label: 'Tomorrow', tomorrow: true }
}

function restOfToday(times, todayStr, hourStr) {
  const start = times.findIndex(t => t.startsWith(`${todayStr}T${hourStr}`))
  if (start === -1) return null
  let end = start
  while (end < times.length && times[end].startsWith(todayStr)) end++
  if (end - start >= 6) return { start, end, label: 'Rest of today' }
  return { start, end: Math.min(times.length, start + 12), label: 'Next 12 hours' }
}

// The hours a day in the 7-day forecast is rated over: its waking hours, the
// same span tomorrow gets above. Today is rated from now on, exactly as the
// Today card rates it before 9pm, so the two never show different scores for
// the same day. A day the hourly series doesn't reach (or only clips) is null.
export function dayWindow(hourly, dateStr, todayStr, hourStr) {
  const times = hourly?.time ?? []
  if (dateStr === todayStr) {
    const win = restOfToday(times, todayStr, hourStr)
    if (win) return win
  }
  let start = -1, end = -1
  for (let i = 0; i < times.length; i++) {
    if (!times[i].startsWith(dateStr)) {
      if (start !== -1) break
      continue
    }
    const h = times[i].slice(11, 13)
    if (start === -1 && h >= TOMORROW_HOURS[0]) start = i
    if (start !== -1 && h < TOMORROW_HOURS[1]) end = i + 1
  }
  if (start === -1 || end - start < 6) return null
  return { start, end, label: 'Daytime' }
}

// ── Yesterday ──────────────────────────────────────────────────────────────

// diffF is today minus yesterday, so negative means colder. Under 2°F either way
// reads as "about the same": that is inside the forecast's own noise.
export function compareWithYesterday({ hourly, daily, yesterday, current, todayStr, hourStr }) {
  let now = null
  const nowF = current?.temperature_2m
  if (nowF != null && hourly?.time) {
    const i = hourly.time.findIndex(t => t.startsWith(`${dateMinusOne(todayStr)}T${hourStr}`))
    const thenF = i === -1 ? null : hourly.temperature_2m?.[i]
    if (thenF != null) now = { today: nowF, yesterday: thenF, diffF: nowF - thenF }
  }
  let high = null
  const todayHigh = daily?.temperature_2m_max?.[0]
  if (todayHigh != null && yesterday?.max != null) {
    high = { today: todayHigh, yesterday: yesterday.max, diffF: todayHigh - yesterday.max }
  }
  if (!now && !high) return null
  // The headline compares right now with the same hour yesterday; the day's
  // high is the fallback (and the second line) when that hour is missing.
  const lead = now ?? high
  return { now, high, basis: now ? 'now' : 'high', diffF: lead.diffF, direction: direction(lead.diffF) }
}

// Tomorrow's day against today's: the highs lead, the lows are the second line.
// daily[0] is today and daily[1] tomorrow.
export function compareTomorrowWithToday(daily) {
  const hi = daily?.temperature_2m_max, lo = daily?.temperature_2m_min
  const high = hi?.[0] != null && hi?.[1] != null ? { tomorrow: hi[1], today: hi[0], diffF: hi[1] - hi[0] } : null
  const low = lo?.[0] != null && lo?.[1] != null ? { tomorrow: lo[1], today: lo[0], diffF: lo[1] - lo[0] } : null
  if (!high) return null
  return { high, low, diffF: high.diffF, direction: direction(high.diffF) }
}

export function direction(diffF) {
  if (Math.abs(diffF) < 2) return 'same'
  return diffF < 0 ? 'colder' : 'warmer'
}

// ── Per-hour conditions ────────────────────────────────────────────────────

function precipKind(code) {
  if (code == null) return null
  if (THUNDER_CODES.has(code)) return 'thunder'
  if (FREEZING_CODES.has(code)) return 'freezing'
  if (HEAVY_SNOW_CODES.has(code)) return 'heavySnow'
  if (SNOW_CODES.has(code)) return 'snow'
  if (HEAVY_RAIN_CODES.has(code)) return 'heavyRain'
  if (MODERATE_RAIN_CODES.has(code)) return 'rain'
  if (RAIN_CODES.has(code)) return 'lightRain'
  return null
}

const KIND_LABEL = {
  thunder: 'Thunderstorms', freezing: 'Freezing rain', heavySnow: 'Heavy snow',
  snow: 'Snow', heavyRain: 'Heavy rain', rain: 'Rain', lightRain: 'Light rain',
}

// How much each kind of precipitation costs each activity, out of 10, when it
// is certain. Scaled by how likely it is in that hour.
const WET_COST = {
  outside:  { thunder: 8, freezing: 7, heavySnow: 6, snow: 3.5, heavyRain: 7, rain: 5, lightRain: 3 },
  driving:  { thunder: 4, freezing: 8, heavySnow: 7, snow: 5, heavyRain: 4, rain: 2.5, lightRain: 1.5 },
  exercise: { thunder: 9, freezing: 7, heavySnow: 6, snow: 4, heavyRain: 7, rain: 5, lightRain: 3 },
}

function hourAt(hourly, i, aqiByHour) {
  return {
    aqi: aqiByHour?.get(hourly.time?.[i]?.slice(0, 13)) ?? null,
    temp: hourly.temperature_2m?.[i],
    feels: hourly.apparent_temperature?.[i] ?? hourly.temperature_2m?.[i],
    pop: hourly.precipitation_probability?.[i] ?? 0,
    code: hourly.weather_code?.[i],
    isDay: hourly.is_day?.[i] !== 0,
    uv: hourly.uv_index?.[i] ?? 0,
    gust: hourly.wind_gusts_10m?.[i] ?? hourly.wind_speed_10m?.[i] ?? 0,
    humidity: hourly.relative_humidity_2m?.[i],
    visibility: hourly.visibility?.[i],
  }
}

// Everything that makes an hour worse for each activity, as [cost, reason].
function hourCosts(h) {
  const kind = precipKind(h.code)
  // A wet weather code means the model is putting precipitation in that hour,
  // whatever the probability field says; without one, the probability alone
  // counts at half weight, as rain that may or may not land.
  const likelihood = kind ? Math.max(h.pop / 100, 0.6) : (h.pop / 100) * 0.5
  const wetKind = kind ?? 'lightRain'
  const wetReason = kind ? KIND_LABEL[kind] : 'Chance of rain'
  const out = { outside: [], driving: [], exercise: [] }
  for (const act of Object.keys(out)) {
    const c = WET_COST[act][wetKind] * likelihood
    if (c > 0.2) out[act].push([c, wetReason])
  }

  const f = h.feels
  if (f != null) {
    if (f < 55) out.outside.push([Math.min(6, (55 - f) / 6), f < 32 ? 'Freezing' : f < 45 ? 'Cold' : 'Chilly'])
    if (f > 80) out.outside.push([Math.min(6, (f - 80) / 3.5), 'Hot'])
    if (f < 40) out.exercise.push([Math.min(5, (40 - f) / 6), f < 25 ? 'Freezing' : 'Cold'])
    if (f > 72) out.exercise.push([Math.min(7, (f - 72) / 3), 'Hot'])
    if (f > 70 && h.humidity > 75) out.exercise.push([1.5, 'Humid'])
  }

  if (h.gust > 20) {
    const c = Math.min(4, (h.gust - 20) / 6)
    out.outside.push([c, 'Windy'])
    out.exercise.push([c, 'Windy'])
  }
  if (h.gust > 35) out.driving.push([Math.min(3, (h.gust - 35) / 8), 'Strong gusts'])

  // UV, on the WHO scale. Moderate (3-5) costs a little, enough to tip a
  // borderline hour; from high (6+) it climbs steeply, since that is where
  // unprotected skin burns inside half an hour. Exertion is hit a bit harder:
  // more time in the sun, and sweat washes sunscreen off.
  if (h.isDay && h.uv >= 3) {
    const c = h.uv < 6 ? (h.uv - 2) * 0.25 : Math.min(3.5, 0.75 + (h.uv - 5) * 0.55)
    const why = h.uv >= 8 ? 'Very high UV' : h.uv >= 6 ? 'High UV' : 'Moderate UV'
    out.outside.push([c, why])
    out.exercise.push([c * 1.2, why])
  }

  let sight = 0
  if (FOG_CODES.has(h.code)) sight = 3.5
  if (h.visibility != null) {
    if (h.visibility < 1000) sight = Math.max(sight, 4)
    else if (h.visibility < 3000) sight = Math.max(sight, 2)
  }
  if (sight) out.driving.push([sight, FOG_CODES.has(h.code) ? 'Fog' : 'Low visibility'])

  // Air quality, on the US AQI scale. Moderate air (up to 100) costs nothing;
  // past that, exertion is hit hardest (deeper, faster breathing), time
  // outside less so, and driving only once the air is thick enough with smoke
  // or smog to haze the road (very unhealthy, 200+).
  if (h.aqi != null && h.aqi > 100) {
    const why = h.aqi > 200 ? 'Very unhealthy air' : h.aqi > 150 ? 'Unhealthy air' : 'Poor air quality'
    out.exercise.push([Math.min(9, 1 + (h.aqi - 100) / 20), why])
    out.outside.push([Math.min(7, 0.5 + (h.aqi - 100) / 30), why])
    if (h.aqi > 200) out.driving.push([Math.min(3, (h.aqi - 200) / 40), 'Heavy smog'])
  }

  // Below freezing with anything falling, the road surface is the problem, on
  // top of the precipitation itself.
  if (h.temp != null && h.temp <= 32 && likelihood >= 0.3) out.driving.push([2, 'Icy roads'])

  if (!h.isDay) {
    out.outside.push([0.75, 'Dark'])
    out.driving.push([0.5, 'Dark'])
    out.exercise.push([0.75, 'Dark'])
  }
  return out
}

const GOOD_REASON = { outside: 'Pleasant', driving: 'Clear roads', exercise: 'Good conditions' }

// An hour-by-hour score, then a blend of the average and the worst hour: a
// mostly fine day with one storm should not rate as fine, but nor should one
// bad hour sink an otherwise good day.
// `aqHourly` is the air-quality forecast ({ time, us_aqi }), on its own time
// axis; it is matched to the weather hours by "YYYY-MM-DDTHH" (both are local).
export function rateActivities(hourly, win, aqHourly) {
  if (!win || win.end <= win.start) return null
  let aqiByHour = null
  if (aqHourly?.time && aqHourly.us_aqi) {
    aqiByHour = new Map()
    aqHourly.time.forEach((t, j) => {
      if (aqHourly.us_aqi[j] != null) aqiByHour.set(t.slice(0, 13), aqHourly.us_aqi[j])
    })
  }
  const acts = ['outside', 'driving', 'exercise']
  const scores = Object.fromEntries(acts.map(a => [a, []]))
  const reasons = Object.fromEntries(acts.map(a => [a, new Map()]))
  const peaks = Object.fromEntries(acts.map(a => [a, new Map()]))
  for (let i = win.start; i < win.end; i++) {
    const costs = hourCosts(hourAt(hourly, i, aqiByHour))
    for (const a of acts) {
      let total = 0
      for (const [c, why] of costs[a]) {
        total += c
        reasons[a].set(why, (reasons[a].get(why) ?? 0) + c)
        peaks[a].set(why, Math.max(peaks[a].get(why) ?? 0, c))
      }
      scores[a].push(Math.max(1, 10 - total))
    }
  }
  const hours = win.end - win.start
  const result = {}
  for (const a of acts) {
    const s = scores[a]
    const mean = s.reduce((x, y) => x + y, 0) / s.length
    const score = clampScore(mean * 0.6 + Math.min(...s) * 0.4)
    // The reason given is whatever cost the most across the window, as long as
    // it amounts to something: steady through the window, or strong in some
    // hour (rain this evening is worth naming on an otherwise clear day).
    // Darkness alone is never the headline reason.
    const top = [...reasons[a]].filter(([why]) => why !== 'Dark')
      .filter(([why, total]) => total / hours >= 0.4 || peaks[a].get(why) >= 1.5)
      .sort((x, y) => y[1] - x[1])[0]
    const reason = top ? (score >= 7 ? `${top[0]} at times` : top[0]) : score >= 7 ? GOOD_REASON[a] : 'Mixed conditions'
    result[a] = { score, reason }
  }
  result.overall = clampScore((result.outside.score + result.driving.score + result.exercise.score) / 3)
  return result
}

function clampScore(x) {
  return Math.max(1, Math.min(10, Math.round(x)))
}

// ── What to expect ─────────────────────────────────────────────────────────
// The At a Glance card's list of things to plan around: storms, ice, snow,
// rain, wind, heat or cold, UV, fog and bad air, each with when it happens and
// a line on how much. A window with no rain or snow gets a "Dry" line instead,
// since knowing you can leave the umbrella is part of preparing too.
//
// Precipitation and fog are looked for from `win.leadStart` when the window has
// one (tomorrow's midnight), so overnight snow still shows on tomorrow's list;
// the rest only count over the waking hours the window rates.

// Most pressing first. The card maps each level to a colour.
export const HAZARD_LEVELS = ['severe', 'warning', 'caution', 'info', 'good']

const STRONG_STORM_CODES = new Set([96, 99])
const SHOWER_CODES = new Set([80, 81, 82])

// Canonical units in, display text out. The card passes its own so wind and
// snow read in the units chosen in Settings.
const DEFAULT_FMT = {
  temp: (f) => `${Math.round(f)}°`,
  wind: (mph) => `${Math.round(mph)} mph`,
  snow: (inches) => `${inches < 1 ? inches.toFixed(1) : Math.round(inches)} in`,
}

function hourLabel(iso) {
  const h = Number(iso.slice(11, 13))
  if (h === 0) return 'midnight'
  if (h === 12) return 'noon'
  return `${h % 12} ${h < 12 ? 'AM' : 'PM'}`
}

// "2 to 6 PM", "11 AM to 2 PM", "10 PM to 2 AM".
function rangeLabel(fromIso, toIso) {
  const a = hourLabel(fromIso), b = hourLabel(toIso)
  const sameHalf = /PM$/.test(a) && /PM$/.test(b) || /AM$/.test(a) && /AM$/.test(b)
  return sameHalf ? `${a.replace(/ (AM|PM)$/, '')} to ${b}` : `${a} to ${b}`
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1)

const WHOLE_WINDOW = { 'Rest of today': 'Rest of the day', 'Next 12 hours': 'Next 12 hours', Tomorrow: 'All day' }

// When a set of hours (indices into the hourly arrays, in order) falls inside
// [from, to): "All day", "Until 3 PM", "From 6 PM", "2 to 6 PM", "Around 4 PM".
// `scattered` marks hours spread thin across their span (showers on and off).
function whenOf(times, hits, from, to, win) {
  const first = hits[0], last = hits[hits.length - 1]
  const span = last - first + 1
  const scattered = span >= 4 && hits.length < span * 0.6
  if (hits.length >= (to - from) * 0.8) return { when: WHOLE_WINDOW[win.label] ?? 'All day', scattered: false }
  const endIso = times[last + 1] ?? times[last]
  const atStart = first === from && !win.tomorrow
  if (hits.length === 1) return { when: atStart ? 'This hour' : `Around ${hourLabel(times[first])}`, scattered }
  if (atStart) return { when: `Until ${hourLabel(endIso)}`, scattered }
  if (last === to - 1) return { when: `From ${hourLabel(times[first])}`, scattered }
  return { when: cap(rangeLabel(times[first], endIso)), scattered }
}

const hitsWhere = (from, to, test) => {
  const out = []
  for (let i = from; i < to; i++) if (test(i)) out.push(i)
  return out
}
const maxOver = (hits, arr) => hits.reduce((m, i) => Math.max(m, arr?.[i] ?? 0), 0)

// One step down the levels, for a precipitation type the forecast puts in an
// hour but gives only a low chance of.
const softer = (level) => HAZARD_LEVELS[Math.min(HAZARD_LEVELS.indexOf(level) + 1, HAZARD_LEVELS.indexOf('info'))]

export function dayHazards(hourly, win, { aqHourly, fmt: fmtIn } = {}) {
  if (!win || win.end <= win.start || !hourly?.time) return []
  const fmt = { ...DEFAULT_FMT, ...fmtIn }
  const times = hourly.time
  const code = hourly.weather_code ?? []
  const pop = hourly.precipitation_probability ?? []
  const lead = win.leadStart ?? win.start
  const { start, end } = win
  const out = []
  const add = (item, hits, from, to) => {
    const { when, scattered } = whenOf(times, hits, from, to, win)
    out.push({ ...item, when, scattered, first: hits[0] })
  }
  // "Up to 60% chance", unless the probability field has nothing to say.
  const chanceText = (p) => (p > 0 ? `Up to ${Math.round(p)}% chance` : null)
  const join = (...parts) => parts.filter(Boolean).join(' · ')

  // Thunderstorms.
  const storm = hitsWhere(lead, end, i => THUNDER_CODES.has(code[i]))
  if (storm.length) {
    const p = maxOver(storm, pop)
    const strong = storm.some(i => STRONG_STORM_CODES.has(code[i]))
    const likely = p === 0 || p >= 35
    add({
      id: 'storm',
      level: strong ? 'severe' : likely ? 'warning' : 'caution',
      label: strong ? 'Strong storms' : likely ? 'Thunderstorms' : 'Storms possible',
      detail: join(chanceText(p), strong ? 'Heavy downpours, lightning' : 'Lightning, stay near shelter'),
    }, storm, lead, end)
  }

  // Freezing rain and drizzle: a glaze on every surface, at any intensity.
  const ice = hitsWhere(lead, end, i => FREEZING_CODES.has(code[i]))
  if (ice.length) {
    add({
      id: 'ice', level: 'severe', label: 'Freezing rain',
      detail: 'Icy roads and walkways likely',
    }, ice, lead, end)
  }

  // Snow, by how much is forecast to fall.
  const snowfall = hourly.snowfall ?? []
  const temp = hourly.temperature_2m ?? []
  // A good chance with no code at all is snow when it's below freezing, rain otherwise.
  const chancy = (i) => (pop[i] ?? 0) >= 40 && !RAIN_CODES.has(code[i]) && !SNOW_CODES.has(code[i])
  const snow = hitsWhere(lead, end, i => SNOW_CODES.has(code[i]) || (snowfall[i] ?? 0) >= 0.05 ||
    (chancy(i) && temp[i] != null && temp[i] <= 32))
  if (snow.length) {
    const total = snow.reduce((s, i) => s + (snowfall[i] ?? 0), 0)
    const p = maxOver(snow, pop)
    const heavyCode = snow.some(i => HEAVY_SNOW_CODES.has(code[i]))
    let level, label
    if (total >= 4 || (heavyCode && total >= 2)) { level = 'severe'; label = 'Heavy snow' }
    else if (total >= 1) { level = 'warning'; label = 'Snow' }
    else if (total >= 0.1) { level = 'caution'; label = 'Light snow' }
    else { level = 'info'; label = 'Flurries' }
    if (p > 0 && p < 35 && total < 1) { level = softer(level); label = 'Snow possible' }
    const amount = total >= 0.1 ? `About ${fmt.snow(total)}` : 'Little or no accumulation'
    add({
      id: 'snow', level, label,
      detail: join(amount, total >= 1 ? 'allow extra travel time' : null),
    }, snow, lead, end)
  }

  // Rain and showers: a rain code, or a good chance without one. Storm and ice
  // hours are already covered above.
  const rainy = (i) => !THUNDER_CODES.has(code[i]) && !FREEZING_CODES.has(code[i]) &&
    (RAIN_CODES.has(code[i]) || (chancy(i) && (temp[i] == null || temp[i] > 32)))
  const rain = hitsWhere(lead, end, rainy)
  if (rain.length) {
    const p = maxOver(rain, pop)
    const coded = rain.some(i => RAIN_CODES.has(code[i]))
    const showers = rain.filter(i => SHOWER_CODES.has(code[i])).length > rain.length / 2
    const heavy = rain.some(i => HEAVY_RAIN_CODES.has(code[i]))
    const moderate = rain.some(i => MODERATE_RAIN_CODES.has(code[i]))
    let level = heavy ? 'warning' : moderate ? 'caution' : 'info'
    let label = heavy ? (showers ? 'Heavy showers' : 'Heavy rain') : showers ? 'Showers' : moderate ? 'Rain' : 'Light rain'
    if (!coded || (p > 0 && p < 35)) {
      if (coded) level = softer(level)
      label = showers ? 'Chance of showers' : 'Chance of rain'
    }
    add({
      id: 'rain', level, label,
      detail: join(chanceText(p), p >= 50 || heavy ? 'bring an umbrella' : null),
    }, rain, lead, end)
  }

  // Wind: gusts of 30 mph or a steady 20 make it a windy day.
  const gustAt = (i) => hourly.wind_gusts_10m?.[i] ?? hourly.wind_speed_10m?.[i] ?? 0
  const windy = hitsWhere(start, end, i => gustAt(i) >= 30 || (hourly.wind_speed_10m?.[i] ?? 0) >= 20)
  if (windy.length) {
    const g = windy.reduce((m, i) => Math.max(m, gustAt(i)), 0)
    const level = g >= 58 ? 'severe' : g >= 45 ? 'warning' : 'caution'
    add({
      id: 'wind', level,
      label: g >= 58 ? 'Damaging winds' : g >= 45 ? 'Very windy' : 'Windy',
      detail: join(`Gusts to ${fmt.wind(g)}`, g >= 45 ? 'secure loose items' : null),
    }, windy, start, end)
  }

  // Heat and cold, on the feels-like temperature.
  const feels = (i) => hourly.apparent_temperature?.[i] ?? hourly.temperature_2m?.[i]
  const valid = hitsWhere(start, end, i => feels(i) != null)
  if (valid.length) {
    const hi = Math.max(...valid.map(feels))
    const lo = Math.min(...valid.map(feels))
    if (hi >= 88) {
      const level = hi >= 105 ? 'severe' : hi >= 95 ? 'warning' : 'caution'
      add({
        id: 'heat', level,
        label: hi >= 105 ? 'Dangerous heat' : hi >= 95 ? 'Very hot' : 'Hot',
        detail: join(`Feels like ${fmt.temp(hi)}`, 'stay hydrated'),
      }, valid.filter(i => feels(i) >= 88), start, end)
    }
    const air = (i) => hourly.temperature_2m?.[i]
    const freezing = valid.filter(i => feels(i) <= 10 || (air(i) != null && air(i) <= 32))
    if (freezing.length) {
      const level = lo <= -15 ? 'severe' : lo <= 10 ? 'warning' : 'info'
      add({
        id: 'cold', level,
        label: lo <= -15 ? 'Dangerous cold' : lo <= 10 ? 'Bitter cold' : 'Below freezing',
        detail: join(`Feels like ${fmt.temp(lo)}`, lo <= -15 ? 'frostbite risk' : lo <= 10 ? 'bundle up' : 'dress warmly'),
      }, freezing, start, end)
    }
  }

  // Fog, from the weather code or the visibility itself.
  const vis = hourly.visibility ?? []
  const fog = hitsWhere(lead, end, i => FOG_CODES.has(code[i]) || (vis[i] != null && vis[i] < 1000))
  if (fog.length) {
    const dense = fog.some(i => vis[i] != null && vis[i] < 400)
    add({
      id: 'fog', level: dense ? 'warning' : 'caution', label: dense ? 'Dense fog' : 'Fog',
      detail: 'Low visibility, leave extra time',
    }, fog, lead, end)
  }

  // UV in the daylight hours, on the WHO scale.
  const uvAt = (i) => (hourly.is_day?.[i] !== 0 ? hourly.uv_index?.[i] ?? 0 : 0)
  const sunny = hitsWhere(start, end, i => uvAt(i) >= 6)
  if (sunny.length) {
    const u = Math.round(sunny.reduce((m, i) => Math.max(m, uvAt(i)), 0))
    add({
      id: 'uv', level: u >= 11 ? 'severe' : u >= 8 ? 'warning' : 'caution',
      label: u >= 11 ? 'Extreme UV' : u >= 8 ? 'Very high UV' : 'High UV',
      detail: join(`UV ${u}`, 'wear sunscreen'),
    }, sunny, start, end)
  }

  // Air quality, on the US AQI, matched to the weather hours as in rateActivities.
  if (aqHourly?.time && aqHourly.us_aqi) {
    const aqi = new Map()
    aqHourly.time.forEach((t, j) => { if (aqHourly.us_aqi[j] != null) aqi.set(t.slice(0, 13), aqHourly.us_aqi[j]) })
    const aqiAt = (i) => aqi.get(times[i]?.slice(0, 13)) ?? 0
    const poor = hitsWhere(start, end, i => aqiAt(i) > 100)
    if (poor.length) {
      const a = Math.round(poor.reduce((m, i) => Math.max(m, aqiAt(i)), 0))
      add({
        id: 'air', level: a > 200 ? 'severe' : a > 150 ? 'warning' : 'caution',
        label: a > 200 ? 'Very unhealthy air' : a > 150 ? 'Unhealthy air' : 'Poor air quality',
        detail: join(`AQI ${a}`, a > 150 ? 'limit time outdoors' : 'sensitive groups take care'),
      }, poor, start, end)
    }
  }

  // Nothing falling: say so, with what the sky is doing.
  const wet = out.some(h => ['storm', 'ice', 'snow', 'rain'].includes(h.id))
  if (!wet) {
    const sky = skyOf(code, hourly.is_day, start, end)
    const alone = out.length === 0
    out.push({
      id: 'dry', level: 'good', sky: sky.id,
      label: alone ? 'Nothing to plan around' : 'Dry',
      detail: alone ? `${sky.text} and dry` : `${sky.text}, no rain or snow`,
      when: WHOLE_WINDOW[win.label] ?? 'All day', scattered: false, first: start,
    })
  }

  return out.sort((a, b) => HAZARD_LEVELS.indexOf(a.level) - HAZARD_LEVELS.indexOf(b.level) || a.first - b.first)
}

// The sky over a dry window, from the clear/cloud codes (0 clear, 1 mainly
// clear, 2 partly cloudy, 3 overcast); fog counts as cloud.
function skyOf(code, isDay, start, end) {
  let sum = 0, n = 0, day = 0
  for (let i = start; i < end; i++) {
    const c = code[i]
    if (c == null) continue
    sum += c <= 3 ? c : 3
    n++
    if (isDay?.[i] !== 0) day++
  }
  const avg = n ? sum / n : 1.5
  const night = day < n / 2
  if (avg < 1.2) return { id: 'clear', text: night ? 'Mostly clear' : 'Mostly sunny' }
  if (avg < 2.3) return { id: 'partly', text: 'Partly cloudy' }
  return { id: 'cloudy', text: 'Mostly cloudy' }
}

// The same severity palette the rest of the app uses for readings, so a 3/10
// reads as the same orange as a poor air quality.
export function scoreColor(score) {
  if (score >= 9) return 'var(--cond-green)'
  if (score >= 7) return 'var(--cond-lime)'
  if (score >= 5) return 'var(--cond-yellow)'
  if (score >= 3) return 'var(--cond-orange)'
  return 'var(--cond-red)'
}

export function scoreLabel(score) {
  if (score >= 9) return 'Great'
  if (score >= 7) return 'Good'
  if (score >= 5) return 'Fair'
  if (score >= 3) return 'Poor'
  return 'Bad'
}
