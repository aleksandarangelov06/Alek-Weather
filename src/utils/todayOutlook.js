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
  const times = hourly?.time ?? []
  if (showsTomorrow(hourStr)) {
    const tomorrow = addDays(todayStr, 1)
    const start = times.findIndex(t => t.startsWith(`${tomorrow}T${TOMORROW_HOURS[0]}`))
    const end = times.findIndex(t => t.startsWith(`${tomorrow}T${TOMORROW_HOURS[1]}`))
    if (start !== -1 && end > start) return { start, end, label: 'Tomorrow', tomorrow: true }
  }
  const start = times.findIndex(t => t.startsWith(`${todayStr}T${hourStr}`))
  if (start === -1) return null
  let end = start
  while (end < times.length && times[end].startsWith(todayStr)) end++
  if (end - start >= 6) return { start, end, label: 'Rest of today' }
  return { start, end: Math.min(times.length, start + 12), label: 'Next 12 hours' }
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

function direction(diffF) {
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

  if (h.isDay && h.uv >= 8) {
    out.outside.push([1, 'Strong sun'])
    out.exercise.push([1.5, 'Strong sun'])
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

export function scoreLabel(score) {
  if (score >= 9) return 'Great'
  if (score >= 7) return 'Good'
  if (score >= 5) return 'Fair'
  if (score >= 3) return 'Poor'
  return 'Bad'
}
