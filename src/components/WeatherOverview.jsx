import { getWeatherInfo, liveWeatherCode, nowcastHourlyCode, displayPrecipChance, precipTier } from '../utils/weatherCodes'

const SEVERE_CODES   = new Set([95, 96, 99, 82])
const ICE_CODES      = new Set([66, 67]) // freezing rain/drizzle — hazardous at any intensity
const HEAVY_CODES    = new Set([65, 75, 86])
const MODERATE_CODES = new Set([63, 73, 81, 55])
const LIGHT_CODES    = new Set([51, 53, 61, 71, 77, 80, 85])
const FOG_CODES      = new Set([45, 48])
const SNOW_CODES     = new Set([71, 73, 75, 77, 85, 86])
const RAIN_CODES     = new Set([51, 53, 55, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99])

function classify(code) {
  if (SEVERE_CODES.has(code))   return 'severe'
  if (ICE_CODES.has(code))      return 'ice'
  if (HEAVY_CODES.has(code))    return 'heavy'
  if (MODERATE_CODES.has(code)) return 'moderate'
  if (LIGHT_CODES.has(code))    return 'light'
  if (FOG_CODES.has(code))      return 'fog'
  return 'clear'
}

// ── Narrative helpers ─────────────────────────────────────────────────────
// Shared by the today day-arc and the tomorrow summary. classifyExt splits
// 'clear' by cloudiness so transitions like "sunny → overcast" are visible.
function classifyExt(code) {
  const base = classify(code)
  if (base !== 'clear') return base
  if (code === 3) return 'overcast'
  if (code === 2) return 'pcloudy'
  return 'sunny'
}
const RANK = { severe: 0, ice: 1, heavy: 2, moderate: 3, light: 4, fog: 5, overcast: 6, pcloudy: 7, sunny: 8 }
const isPrecipCat = (cat) => RANK[cat] <= RANK.light
const isGoodCat   = (cat) => cat === 'sunny' || cat === 'pcloudy'
const worstOf     = (list) => list.reduce((acc, c) => {
  const cat = classifyExt(c); return RANK[cat] < RANK[acc] ? cat : acc
}, 'sunny')
const worstCodeOf = (list) => list.reduce(
  (acc, c) => RANK[classifyExt(c)] < RANK[classifyExt(acc)] ? c : acc, list[0]
)

function precipPhrase(cat, code) {
  if (cat === 'severe')   return [95, 96, 99].includes(code) ? 'a thunderstorm' : 'violent showers'
  if (cat === 'ice')      return 'freezing rain'
  if (cat === 'heavy')    return SNOW_CODES.has(code) ? 'heavy snow' : 'heavy rain'
  if (cat === 'moderate') return SNOW_CODES.has(code) ? 'moderate snow' : 'rain'
  if (cat === 'light')    return SNOW_CODES.has(code) ? 'light snow' : 'showers'
  return 'rain'
}

function timeDesc(slotIndex, currentMinute, hourlyTimes, start, timezone) {
  if (slotIndex === 0) return 'right now'
  const slotTimeStr = hourlyTimes?.[start + slotIndex]
  const slotHour = slotTimeStr ? parseInt(slotTimeStr.slice(11, 13), 10) : -1

  if (slotTimeStr) {
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: timezone })
    if (!slotTimeStr.startsWith(todayStr)) {
      if (slotHour < 6)  return 'overnight'
      if (slotHour < 12) return 'tomorrow morning'
      if (slotHour < 17) return 'tomorrow afternoon'
      if (slotHour < 21) return 'tomorrow evening'
      return 'tomorrow night'
    }
  }

  const mins = (60 - currentMinute) + (slotIndex - 1) * 60
  if (mins < 25) return 'in a few minutes'
  if (mins < 70) return 'within the hour'
  const hours = Math.round(mins / 60)
  if (hours <= 1) return 'in about 1 hour'
  if (hours <= 5) return `in about ${hours} hours`
  if (slotHour >= 0 && slotHour < 6) return 'tonight'
  return 'later today'
}

function clothingAdvice(apparentTempF, codes) {
  const hasRain = codes.some(c => RAIN_CODES.has(c))
  const hasSnow = codes.some(c => SNOW_CODES.has(c))

  let base
  if (apparentTempF >= 85)      base = 'Wear shorts and a t-shirt'
  else if (apparentTempF >= 75) base = 'Wear light, breathable clothing'
  else if (apparentTempF >= 65) base = 'Light layers are perfect'
  else if (apparentTempF >= 55) base = 'Wear a light jacket'
  else if (apparentTempF >= 45) base = 'Wear a jacket'
  else if (apparentTempF >= 35) base = 'Wear a warm coat'
  else if (apparentTempF >= 20) base = 'Wear a heavy coat, hat, and gloves'
  else                           base = 'Bundle up'

  if (hasSnow && hasRain) return `${base} and bring waterproof boots and an umbrella`
  if (hasSnow)            return `${base} and bring waterproof boots`
  if (hasRain)            return `${base} and bring an umbrella`
  return base
}

export function WeatherOverview({ hourly, daily, current, minutely, timezone, hasActiveAlert, unit }) {
  const now = new Date()
  const currentMinute = parseInt(
    now.toLocaleString('en-CA', { minute: '2-digit', timeZone: timezone }),
    10
  )
  const currentHourStr = now.toLocaleString('en-CA', {
    hour: '2-digit', hour12: false, timeZone: timezone,
  })

  const todayStr = now.toLocaleDateString('en-CA', { timeZone: timezone })
  const startIdx = hourly.time.findIndex(t => t.startsWith(`${todayStr}T${currentHourStr}`))
  const start = startIdx === -1 ? 0 : startIdx
  const LOOK_AHEAD = 24

  const codes = hourly.weather_code.slice(start, start + LOOK_AHEAD)

  // Slot 0 is "right now". Re-derive from the live 15-min nowcast to match the
  // Current Conditions card, but only accept a downgrade when the raw hourly code
  // wasn't already precipitation (minutely under-reports at the very start of rain).
  const rawNowIsPrecip = codes.length > 0 && precipTier(codes[0]) > 0
  if (codes.length > 0) {
    const live = liveWeatherCode(current, minutely)
    if (live != null && (precipTier(live) > 0 || !rawNowIsPrecip)) codes[0] = live
  }

  // Slots 1+ (future hours): apply the same nowcast correction used by HourlyForecast
  // so that all three forecast views agree. nowcastHourlyCode only downgrades a
  // precipitation code when the minutely data covers that hour AND shows < TRACE
  // precipitation — slots beyond the nowcast window are left unchanged.
  for (let i = 1; i < codes.length; i++) {
    const slotTime = hourly.time[start + i]
    if (slotTime) codes[i] = nowcastHourlyCode(codes[i], minutely, slotTime, current?.cloud_cover)
  }

  // Precipitation chance (%) for a slot, floored to the slot's own condition so an
  // upcoming "rain" insight never appends a contradictory "(0% chance)".
  const probAt = (slotIndex) => {
    const code = codes[slotIndex]
    const raw = hourly.precipitation_probability?.[start + slotIndex]
    return code != null && precipTier(code) > 0 ? displayPrecipChance(code, raw) : raw
  }

  // Indefinite article for a condition label; "" for plurals (e.g. "showers")
  // since "a showers" is wrong.
  const article = (lower) =>
    lower.endsWith('s') ? '' : (/^[aeiou]/.test(lower) ? 'an ' : 'a ')

  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1)

  // Date (YYYY-MM-DD) of a look-ahead slot. Used to build a "tier:date" dedupe
  // key so an hourly headline and the daily "tomorrow" summary describing the
  // same storm collapse into one insight instead of appearing twice.
  const slotDateStr = (i) => hourly.time?.[start + i]?.slice(0, 10)

  // Is precipitation *measurably* falling right now, per observed/minutely data?
  // (Used to decide whether we can estimate an "ending in X" time below.)
  const precipMeasuredNow = (() => {
    if ((current?.precipitation ?? 0) > 0.001) return true
    const times = minutely?.time, precip = minutely?.precipitation
    if (times?.length && precip?.length && current?.time) {
      let si = times.findIndex(t => t >= current.time)
      if (si < 0) si = 0
      if ((precip[si] ?? 0) > 0.001) return true
    }
    return false
  })()

  // precipNow is true only when precipitation is actually observed — not when the
  // hourly forecast slot merely predicts it. With NWS data, codes[0] reflects the
  // full current-hour forecast window (e.g. a storm arriving in 15 min), so
  // relying on precipTier(codes[0]) would produce "right now" text for imminent
  // but not-yet-started events. precipMeasuredNow checks both current.precipitation
  // (last-hour total) and the live minutely rate, covering the brief window where
  // minutely underreports at the very start of a storm.
  const precipNow = precipMeasuredNow

  let firstSevere = -1, firstIce = -1, firstHeavy = -1, firstModerate = -1, firstLight = -1, firstFog = -1
  for (let i = 0; i < codes.length; i++) {
    const cat = classify(codes[i])
    // Skip a current-hour precip claim only when neither the live nowcast nor the
    // forecast backs it (precipNow) — i.e. truly nothing falling; otherwise defer
    // to the next slot that genuinely has precipitation.
    if (i === 0 && isPrecipCat(cat) && !precipNow) continue
    if (cat === 'severe'   && firstSevere   === -1) firstSevere   = i
    if (cat === 'ice'      && firstIce      === -1) firstIce      = i
    if (cat === 'heavy'    && firstHeavy    === -1) firstHeavy    = i
    if (cat === 'moderate' && firstModerate === -1) firstModerate = i
    if (cat === 'light'    && firstLight    === -1) firstLight    = i
    if (cat === 'fog'      && firstFog      === -1) firstFog      = i
  }

  // How much longer an ongoing event lasts, per the hourly codes: walk the
  // consecutive slots still matching `pred` and phrase the end in day-part
  // terms ("through the night"). Returns null when it ends within ~2 hours —
  // the minutely "ending in X" estimate is more precise at that range.
  const spanPhrase = (pred) => {
    let end = 0
    while (end + 1 < codes.length && pred(codes[end + 1])) end++
    if (end < 2) return null
    const t = hourly.time?.[start + end]
    if (!t) return null
    const h = parseInt(t.slice(11, 13), 10)
    if (!t.startsWith(todayStr)) return h >= 12 ? 'into tomorrow' : 'through the night'
    if (h < 12) return 'through the morning'
    if (h < 17) return 'through the afternoon'
    if (h < 21) return 'into the evening'
    return 'through the night'
  }

  // Near-term precipitation from the 15-min nowcast (minutely_15.precipitation,
  // inches/15min — the same data the PRECIPITATION card draws). The hourly
  // weather_code is a coarse, often-lagging summary: in Montreal it flagged only
  // a light-drizzle code ~3h out while the nowcast and probability already showed
  // heavy rain within the hour. For the next 60 minutes we trust the nowcast so
  // all three sections agree; beyond that we fall back to weather_code below.
  // Thresholds match PrecipNowcast: LIGHT 0.02, MED 0.08, HEAVY 0.12 in/15min.
  const nowcastInsight = (() => {
    const times = minutely?.time, precip = minutely?.precipitation
    if (!times?.length || !precip?.length || !current?.time) return null
    let si = times.findIndex(t => t >= current.time)
    if (si < 0) return null

    const N = Math.min(5, times.length - si) // 0–60 min, five 15-min slots
    let onset = -1, peak = 0
    for (let i = 0; i < N; i++) {
      const p = precip[si + i] ?? 0
      if (p >= 0.02 && onset === -1) onset = i
      if (onset !== -1) peak = Math.max(peak, p)
    }
    if (onset === -1) return null

    const mins = onset * 15
    if (mins === 0) return null // already falling — handled by current conditions

    const hourOffset = Math.min(codes.length - 1, Math.floor((currentMinute + mins) / 60))
    const isSevereOnset = SEVERE_CODES.has(codes[hourOffset])
    const noun = isSevereOnset ? 'thunderstorm'
      : ICE_CODES.has(codes[hourOffset]) ? 'freezing rain'
      : SNOW_CODES.has(codes[hourOffset]) ? 'snow' : 'rain'
    const article = isSevereOnset ? 'a ' : ''
    const when = mins >= 60 ? 'within the hour' : `in about ${mins} minutes`
    const p = probAt(hourOffset)

    if (isSevereOnset) return {
      level: 'warning',
      text: p != null ? `${p}% chance of a thunderstorm ${when}.` : `Thunderstorm expected ${when}.`,
    }
    if (peak >= 0.08) return { level: 'warning', text: p != null ? `${p}% chance of heavy ${noun} starting ${when}.` : `Heavy ${noun} starting ${when}.` }
    if (peak >= 0.04) return { level: 'info',    text: p != null ? `${p}% chance of ${article}${noun} moving in ${when}.` : `${cap(noun)} moving in ${when}.` }
    return {
      level: 'notice',
      text: p != null ? `${p}% chance of light ${noun} ${when}.` : `Light ${noun} ${when}.`,
    }
  })()

  // When rain/snow is falling right now, describe it and — if the 15-min nowcast
  // shows it tapering below the light threshold and staying there — say when it
  // ends, mirroring "rain ending in X min" from AccuWeather/Google. Uses the
  // measured minutely trend, not the lagging weather_code.
  const precipNowInsight = (() => {
    if (!precipNow) return null
    const noun = ICE_CODES.has(codes[0]) ? 'freezing rain'
      : SNOW_CODES.has(codes[0]) ? 'snow' : 'rain'

    // We're here on the forecast's word but the live nowcast shows nothing
    // measurable — there's no trend to estimate an end time from, so state it
    // plainly instead of computing a bogus "ending shortly".
    if (!precipMeasuredNow) {
      const cat = classify(codes[0])
      const heavy = cat === 'heavy' || cat === 'severe'
      const adj = heavy ? 'Heavy ' : cat === 'light' ? 'Light ' : ''
      return {
        level: heavy ? 'warning' : 'info',
        text: adj ? `${adj}${noun} right now.` : `${cap(noun)} right now.`,
      }
    }

    // Find the first slot where the nowcast drops below the light threshold AND
    // stays there for ~30 min, so a momentary dip mid-storm doesn't read as "ending".
    let endSlot = -1
    const times = minutely?.time, precip = minutely?.precipitation
    if (times?.length && precip?.length && current?.time) {
      const si = times.findIndex(t => t >= current.time)
      if (si >= 0) {
        const LIGHT = 0.02 // in/15min — same as elsewhere
        const HORIZON = Math.min(12, times.length - si) // look up to ~3h ahead
        for (let i = 0; i < HORIZON; i++) {
          if ((precip[si + i] ?? 0) >= LIGHT) continue
          let stays = true
          for (let j = i + 1; j < Math.min(i + 2, HORIZON); j++) {
            if ((precip[si + j] ?? 0) >= LIGHT) { stays = false; break }
          }
          if (stays) { endSlot = i; break }
        }
      }
    }

    if (endSlot === 0) return { level: 'info', text: `${cap(noun)} ending shortly.` }
    if (endSlot > 0) {
      const mins = endSlot * 15
      const when = mins <= 20 ? 'shortly'
        : mins < 75 ? 'within the hour'
        : `in about ${Math.round(mins / 60)} hours`
      return { level: 'info', text: `${cap(noun)} ending ${when}.` }
    }
    // Falling now with no end within the minutely horizon: say how long the
    // hourly forecast keeps it going ("Rain continuing through the night.").
    const span = spanPhrase(c => precipTier(c) > 0)
    return { level: 'info', text: span ? `${cap(noun)} continuing ${span}.` : `${cap(noun)} expected to continue.` }
  })()

  // ── Day-arc narrative ─────────────────────────────────────────────────────
  // Generates sentences like "Some sun this morning, then a thunderstorm this
  // afternoon." Fires when the remaining day transitions between meaningfully
  // different weather categories.
  const dayArcInsight = (() => {
    const currentHour = parseInt(currentHourStr, 10)
    if (currentHour >= 18) return null

    const todayStr = now.toLocaleDateString('en-CA', { timeZone: timezone })

    const PERIODS = [
      { lo: 6,  hi: 11, label: 'this morning'  },
      { lo: 12, hi: 16, label: 'this afternoon' },
      { lo: 17, hi: 20, label: 'this evening'   },
    ]

    const periods = PERIODS.map(p => {
      const slots = []
      for (let i = 1; i < codes.length; i++) {
        const t = hourly.time?.[start + i]
        if (!t || !t.startsWith(todayStr)) break
        const h = parseInt(t.slice(11, 13), 10)
        if (h >= p.lo && h <= p.hi && h > currentHour) slots.push(codes[i])
      }
      if (!slots.length) return null
      return { ...p, cat: worstOf(slots), repCode: worstCodeOf(slots) }
    }).filter(Boolean)

    if (periods.length < 2) return null
    const first = periods[0]
    const last  = periods[periods.length - 1]
    const mid   = periods.length >= 3 ? periods[1] : null

    let text = null

    // Three-period patterns take priority (more specific)
    if (mid) {
      if (isGoodCat(first.cat) && isPrecipCat(mid.cat) && isGoodCat(last.cat)) {
        text = `Sunny ${first.label}, then ${precipPhrase(mid.cat, mid.repCode)} ${mid.label}, clearing ${last.label}.`
      } else if (isPrecipCat(first.cat) && isGoodCat(mid.cat) && isPrecipCat(last.cat)) {
        const noun = SNOW_CODES.has(first.repCode) ? 'snow' : 'rain'
        text = `${cap(noun)} ${first.label} with a break ${mid.label}, then more ${noun} ${last.label}.`
      } else if (isGoodCat(first.cat) && mid.cat === 'overcast' && isPrecipCat(last.cat)) {
        text = `Sunny ${first.label}, clouding over ${mid.label}, then ${precipPhrase(last.cat, last.repCode)} ${last.label}.`
      }
    }

    if (!text && first.cat !== last.cat) {
      if (isGoodCat(first.cat) && isPrecipCat(last.cat)) {
        const open = first.cat === 'sunny' ? 'Some sun' : 'Partly cloudy'
        text = last.cat === 'severe'
          ? `${open} ${first.label}, then turning stormy ${last.label}.`
          : `${open} ${first.label}, then ${precipPhrase(last.cat, last.repCode)} developing ${last.label}.`
      } else if (isPrecipCat(first.cat) && isGoodCat(last.cat)) {
        const noun = [95, 96, 99].includes(first.repCode) ? 'Storms'
          : SNOW_CODES.has(first.repCode) ? 'Snow' : 'Rain'
        const clearing = last.cat === 'sunny' ? 'clearing to sunshine' : 'improving to partly cloudy'
        text = `${noun} ${first.label}, then ${clearing} ${last.label}.`
      } else if (first.cat === 'overcast' && isGoodCat(last.cat)) {
        const ending = last.cat === 'sunny' ? 'sunshine breaking through' : 'some clearing'
        text = `Overcast ${first.label} with ${ending} ${last.label}.`
      } else if (isGoodCat(first.cat) && last.cat === 'overcast') {
        const open = first.cat === 'sunny' ? 'Sunny' : 'Partly cloudy'
        text = `${open} ${first.label}, then increasing clouds ${last.label}.`
      }
    }

    return text ? { level: 'neutral', text } : null
  })()

  const insights = []

  // Max display probability across all future slots matching a given category.
  // Mirrors daily.precipitation_probability_max: reports the peak chance for
  // the look-ahead window instead of the probability of the first occurrence.
  const maxProbFor = (cat) => {
    let max = null
    for (let i = 1; i < codes.length; i++) {
      if (classify(codes[i]) !== cat) continue
      const p = probAt(i)
      if (p != null) max = max == null ? p : Math.max(max, p)
    }
    return max
  }

  // Suppress alarming insights for future slots whose probability is too low.
  // Uses the raw API probability, not the display-floored value from probAt,
  // so a 2% raw chance on a thunderstorm code isn't inflated to 75% and let through.
  // Slot 0 (happening right now) is always shown regardless of probability.
  const aboveThreshold = (slotIndex, min) => {
    if (slotIndex === 0) return true
    const raw = hourly.precipitation_probability?.[start + slotIndex]
    return raw == null || raw >= min
  }

  // Compute severe show-ccondition up front so the else-if chain falls through to
  // nowcastInsight when a severe code exists but the probability threshold isn't met.
  const severeP = firstSevere > 0 ? maxProbFor('severe') : null
  const showSevere = firstSevere !== -1 &&
    (hasActiveAlert || firstSevere === 0 || aboveThreshold(firstSevere, 30))

  if (showSevere) {
    const when = timeDesc(firstSevere, currentMinute, hourly.time, start, timezone)
    const isThunder = [95, 96, 99].includes(codes[firstSevere])
    // A storm already overhead that the forecast keeps going for hours reads
    // better as a duration ("continuing through the night") than as "right now".
    const stormSpan = firstSevere === 0 ? spanPhrase(c => SEVERE_CODES.has(c)) : null
    const stormNoun = isThunder ? 'Thunderstorms' : 'Violent showers'
    insights.push({
      level: 'severe',
      // Only a severe event happening today earns the pulsing dot; a storm that's
      // still a day out (e.g. "tomorrow morning") shows a steady dot instead.
      immediate: firstSevere === 0 || slotDateStr(firstSevere) === todayStr,
      dedupeKey: `severe:${slotDateStr(firstSevere)}`,
      text: stormSpan
        ? (hasActiveAlert
            ? `${stormNoun} continuing ${stormSpan}. Stay indoors!`
            : `${stormNoun} continuing ${stormSpan}, take precautions.`)
        : hasActiveAlert
        ? (isThunder
            ? (severeP != null ? `${severeP}% chance of a thunderstorm ${when}. Stay indoors!` : `Thunderstorm ${when}. Stay indoors!`)
            : (severeP != null ? `${severeP}% chance of violent rain showers ${when}. Stay indoors!` : `Violent rain showers ${when}. Stay indoors!`))
        : (isThunder
            ? (severeP != null ? `${severeP}% chance of a possible thunderstorm ${when}, take precautions.` : `Possible thunderstorm ${when}, take precautions.`)
            : (severeP != null ? `${severeP}% chance of possible violent rain showers ${when}, take precautions.` : `Possible violent rain showers ${when}, take precautions.`)),
    })
  } else if (precipNowInsight) {
    insights.push(precipNowInsight)
  } else if (nowcastInsight) {
    insights.push(nowcastInsight)
  } else if (firstIce !== -1 && aboveThreshold(firstIce, 30)) {
    // Freezing rain outranks heavy rain: even light glaze ices roads. Lower
    // probability threshold for the same reason.
    const when = timeDesc(firstIce, currentMinute, hourly.time, start, timezone)
    const p = maxProbFor('ice')
    insights.push({
      level: 'warning',
      dedupeKey: `ice:${slotDateStr(firstIce)}`,
      text: p != null
        ? `${p}% chance of freezing rain ${when} — roads may be icy.`
        : `Freezing rain expected ${when} — roads may be icy.`,
    })
  } else if (firstHeavy !== -1 && aboveThreshold(firstHeavy, 50)) {
    const when = timeDesc(firstHeavy, currentMinute, hourly.time, start, timezone)
    const isSnow = [75, 86].includes(codes[firstHeavy])
    const p = maxProbFor('heavy')
    insights.push({
      level: 'warning',
      dedupeKey: `heavy:${slotDateStr(firstHeavy)}`,
      text: isSnow
        ? (p != null ? `${p}% chance of heavy snow ${when}.` : `Heavy snow arriving ${when}.`)
        : (p != null ? `${p}% chance of heavy rain ${when}.` : `Heavy rain expected ${when}.`),
    })
  } else if (firstModerate !== -1 && aboveThreshold(firstModerate, 40)) {
    const when = timeDesc(firstModerate, currentMinute, hourly.time, start, timezone)
    const isSnow = codes[firstModerate] === 73
    const p = maxProbFor('moderate')
    insights.push({
      level: 'info',
      dedupeKey: `moderate:${slotDateStr(firstModerate)}`,
      text: isSnow
        ? (p != null ? `${p}% chance of moderate snow ${when}.` : `Moderate snow on the way ${when}.`)
        : (p != null ? `${p}% chance of rain ${when}.` : `Rain moving in ${when}.`),
    })
  } else if (firstLight !== -1) {
    const info = getWeatherInfo(codes[firstLight])
    const when = timeDesc(firstLight, currentMinute, hourly.time, start, timezone)
    const prob = firstLight > 0 ? maxProbFor('light') : null
    const label = info.label.toLowerCase()
    // Phrase upcoming light precip as a chance, e.g. "30% chance of a light drizzle
    // within the hour."; keep the plain label when it's already happening now.
    insights.push({
      level: 'notice',
      dedupeKey: `light:${slotDateStr(firstLight)}`,
      text: prob != null
        ? `${prob}% chance of ${article(label)}${label} ${when}.`
        : `${info.label} ${when}.`,
    })
  }

  // Fog is independent of rain, so it can accompany a precipitation insight.
  if (firstFog !== -1 && insights.length < 2) {
    const when = timeDesc(firstFog, currentMinute, hourly.time, start, timezone)
    insights.push({ level: 'notice', dedupeKey: `fog:${slotDateStr(firstFog)}`, text: `Foggy conditions expected ${when}.` })
  }

  // Day-arc narrative: on dry days it replaces the generic "mostly sunny" fallback;
  // on precipitation days it prepends the morning-context ("some sun this morning, then...").
  if (dayArcInsight) {
    if (insights.length === 0) {
      insights.push(dayArcInsight)
    } else if (insights.length === 1 && insights[0].level !== 'severe') {
      insights.unshift(dayArcInsight)
    }
  }

  if (insights.length === 0) {
    const allClear = codes.every(c => classify(c) === 'clear')
    const currentHour = parseInt(currentHourStr, 10)
    let noWeatherText
    if (allClear) {
      if (currentHour < 10)      noWeatherText = 'Clear skies all day, a great day to be outside.'
      else if (currentHour < 16) noWeatherText = 'Clear skies for the rest of the day.'
      else                       noWeatherText = 'Clear and calm for the rest of the evening.'
    } else {
      const cc = current?.cloud_cover ?? 50
      if (cc <= 25) {
        noWeatherText = currentHour < 12
          ? 'A sunny morning with no rain expected.'
          : 'Mostly sunny and staying dry.'
      } else if (cc <= 50) {
        noWeatherText = currentHour < 14
          ? 'Partly cloudy this afternoon, staying dry.'
          : 'Partly cloudy, staying dry.'
      } else if (cc <= 75) {
        noWeatherText = 'Mostly cloudy, but dry for the rest of the day.'
      } else {
        noWeatherText = 'Overcast but dry for the rest of the day.'
      }
    }
    insights.push({ level: 'good', text: noWeatherText })
  }

  if (daily?.temperature_2m_max?.[0] != null) {
    // All temps are in °F from the API.
    // In the evening, most people care about tomorrow rather than the day that's ending.
    const currentHour = parseInt(currentHourStr, 10)
    const eveningMode = currentHour >= 20
    const baseIdx = eveningMode && daily.temperature_2m_max.length > 1 ? 1 : 0
    const dayLabel = baseIdx === 1 ? 'Tomorrow' : 'Today'

    const avgAt = (i) => (daily.temperature_2m_max[i] + daily.temperature_2m_min[i]) / 2
    const baseAvg = avgAt(baseIdx)

    const compareCount = Math.min(4, (daily.temperature_2m_max.length ?? 0) - 1 - baseIdx)
    let diffWeek = null
    if (compareCount >= 2) {
      let sum = 0
      for (let i = baseIdx + 1; i <= baseIdx + compareCount; i++) {
        sum += avgAt(i)
      }
      diffWeek = baseAvg - sum / compareCount
    }

    let comparison = ''
    if (diffWeek !== null && diffWeek > 8)
      comparison = 'notably warmer than the rest of the week'
    else if (diffWeek !== null && diffWeek > 3)
      comparison = 'warmer than the rest of the week'
    else if (diffWeek !== null && diffWeek < -8)
      comparison = 'notably cooler than the rest of the week'
    else if (diffWeek !== null && diffWeek < -3)
      comparison = 'cooler than the rest of the week'

    // Skip clothing advice during severe weather: the headline insight tells the
    // user to seek shelter, so "wear a t-shirt" would be tone-deaf and unsafe.
    const clothing = (current?.apparent_temperature != null && firstSevere === -1)
      ? clothingAdvice(current.apparent_temperature, codes)
      : null

    // Build the temperature/clothing text, then either merge it into the single
    // precipitation insight already in the list (so the user sees one combined
    // bullet instead of two) or push it as its own neutral insight.
    let tempText = null
    if (comparison && clothing) {
      const lower = clothing.charAt(0).toLowerCase() + clothing.slice(1)
      tempText = `${dayLabel} will be ${comparison}, ${lower}.`
    } else if (comparison) {
      tempText = `${dayLabel} will be ${comparison}.`
    } else if (clothing) {
      tempText = `${clothing}.`
    }

    if (tempText) {
      if (insights.length === 1 && insights[0].level !== 'severe') {
        const base = insights[0].text.replace(/\.$/, '')
        insights[0] = { ...insights[0], text: `${base}. ${tempText}` }
      } else {
        insights.push({ level: 'neutral', text: tempText })
      }
    }

    // Concrete tomorrow-vs-today change, high vs high in the display unit:
    // "10 degrees warmer tomorrow than today." Only for jumps big enough to
    // plan around (~7°F / 4°C).
    if (daily.temperature_2m_max?.[1] != null) {
      const dF = daily.temperature_2m_max[1] - daily.temperature_2m_max[0]
      const deg = Math.round(unit === 'C' ? dF * 5 / 9 : dF)
      if (Math.abs(deg) >= (unit === 'C' ? 4 : 7)) {
        insights.push({
          level: 'neutral',
          text: `${Math.abs(deg)} degrees ${deg > 0 ? 'warmer' : 'cooler'} tomorrow than today.`,
        })
      }
    }

    // When showing tomorrow's forecast (evening mode), add an insight for any
    // notable weather event so the user knows what to prepare for.
    if (baseIdx === 1 && daily?.weather_code?.[1] != null) {
      // Prefer a narrative built from tomorrow's hourly codes: it can place
      // events in a part of the day and combine two of them ("Foggy conditions
      // tomorrow morning with a shower later in the day."). Falls back to the
      // coarse daily code when hourly data is missing, and always defers to
      // the alert-aware phrasing below for severe weather.
      const tomorrowArc = (() => {
        const dateStr = daily.time?.[1]
        if (!dateStr || !hourly?.time || !hourly.weather_code) return null

        const periods = [
          { lo: 5,  hi: 11, label: 'tomorrow morning'   },
          { lo: 12, hi: 17, label: 'tomorrow afternoon' },
          { lo: 18, hi: 23, label: 'tomorrow evening'   },
        ].map(p => {
          const list = []
          for (let j = 0; j < hourly.time.length; j++) {
            const t = hourly.time[j]
            if (!t.startsWith(dateStr)) continue
            const h = parseInt(t.slice(11, 13), 10)
            if (h >= p.lo && h <= p.hi) list.push(hourly.weather_code[j])
          }
          if (!list.length) return null
          return { ...p, cat: worstOf(list), repCode: worstCodeOf(list) }
        }).filter(Boolean)

        const events = periods.filter(p => RANK[p.cat] <= RANK.fog)
        if (!events.length || events.some(e => e.cat === 'severe')) return null

        const phrase = (e) => e.cat === 'fog' ? 'foggy conditions'
          : e.cat === 'light' && !SNOW_CODES.has(e.repCode) ? 'a shower'
          : precipPhrase(e.cat, e.repCode)
        const worst = events.reduce((a, e) => RANK[e.cat] < RANK[a.cat] ? e : a)
        const level = worst.cat === 'ice' || worst.cat === 'heavy' ? 'warning'
          : worst.cat === 'moderate' ? 'info' : 'notice'

        // First occurrence of each distinct condition, in day order.
        const distinct = []
        for (const e of events) if (!distinct.some(d => d.cat === e.cat)) distinct.push(e)

        let text
        if (distinct.length >= 2) {
          text = `${cap(phrase(distinct[0]))} ${distinct[0].label} with ${phrase(distinct[1])} later in the day.`
        } else if (events.length === periods.length && periods.length > 1) {
          text = `${cap(phrase(events[0]))} for much of tomorrow.`
        } else if (events.length === 2) {
          const part = events[1].label.replace('tomorrow ', '')
          const adjacent = periods.indexOf(events[1]) - periods.indexOf(events[0]) === 1
          text = adjacent
            ? `${cap(phrase(events[0]))} ${events[0].label}, continuing into the ${part}.`
            : `${cap(phrase(events[0]))} ${events[0].label}, returning in the ${part}.`
        } else {
          text = `${cap(phrase(events[0]))} ${events[0].label}.`
        }
        return { level, dedupeKey: `${worst.cat}:${dateStr}`, text }
      })()

      const tCode = daily.weather_code[1]
      const tCat = classify(tCode)
      const tRawProb = daily.precipitation_probability_max?.[1]
      const tProb = tRawProb != null ? displayPrecipChance(tCode, tRawProb) : null
      const isSnow = SNOW_CODES.has(tCode)
      const isThunder = [95, 96, 99].includes(tCode)
      // Same tier + same date (tomorrow) as an hourly headline collapses to one.
      const tKey = (tier) => `${tier}:${daily.time?.[1]}`

      if (tomorrowArc) {
        insights.push(tomorrowArc)
      } else if (tCat === 'severe') {
        insights.push({
          level: 'severe',
          dedupeKey: tKey('severe'),
          text: hasActiveAlert
            ? (isThunder
                ? (tProb != null ? `${tProb}% chance of thunderstorms tomorrow. Plan to avoid open areas.` : `Thunderstorms forecast tomorrow. Plan to avoid open areas.`)
                : (tProb != null ? `${tProb}% chance of severe weather tomorrow. Plan ahead and check forecasts frequently.` : `Severe weather tomorrow. Plan ahead and check forecasts frequently.`))
            : (isThunder
                ? (tProb != null ? `${tProb}% chance of possible thunderstorms tomorrow, take precautions.` : `Possible thunderstorms tomorrow, take precautions.`)
                : (tProb != null ? `${tProb}% chance of possible severe weather tomorrow, take precautions.` : `Possible severe weather tomorrow, take precautions.`)),
        })
      } else if (tCat === 'ice') {
        insights.push({
          level: 'warning',
          dedupeKey: tKey('ice'),
          text: tProb != null
            ? `${tProb}% chance of freezing rain tomorrow — roads may be icy.`
            : `Freezing rain tomorrow — roads may be icy.`,
        })
      } else if (tCat === 'heavy') {
        insights.push({
          level: 'warning',
          dedupeKey: tKey('heavy'),
          text: isSnow
            ? (tProb != null ? `${tProb}% chance of heavy snow tomorrow. Avoid travelling and dress warmly.` : `Heavy snow tomorrow. Avoid travelling and dress warmly.`)
            : (tProb != null ? `${tProb}% chance of heavy rain tomorrow. Bring a waterproof jacket and umbrella.` : `Heavy rain tomorrow. Bring a waterproof jacket and umbrella.`),
        })
      } else if (tCat === 'moderate') {
        insights.push({
          level: 'info',
          dedupeKey: tKey('moderate'),
          text: isSnow
            ? (tProb != null ? `${tProb}% chance of moderate snow tomorrow. Pack boots and a warm coat, avoid travel if possible.` : `Moderate snow tomorrow. Pack boots and a warm coat, avoid travel if possible.`)
            : (tProb != null ? `${tProb}% chance of rain tomorrow. Don't forget an umbrella.` : `Rain expected tomorrow. Don't forget an umbrella.`),
        })
      } else if (tCat === 'light') {
        insights.push({
          level: 'notice',
          dedupeKey: tKey('light'),
          text: isSnow
            ? (tProb != null ? `${tProb}% chance of light snow tomorrow.` : `Light snow possible tomorrow.`)
            : (tProb != null ? `${tProb}% chance of light rain tomorrow.` : `Light rain possible tomorrow.`),
        })
      } else if (tCat === 'fog') {
        insights.push({
          level: 'notice',
          dedupeKey: tKey('fog'),
          text: `Foggy conditions expected tomorrow.`,
        })
      }
    }
  }

  // ── Beyond precipitation: wind, freeze, UV, heat ──────────────────────────
  // Single-sentence callouts. They only earn a visible slot when nothing
  // urgent owns the card (the declutter pass drops notice/neutral lines
  // behind warnings), so thresholds err toward genuinely notable.
  {
    const hr = parseInt(currentHourStr, 10)

    // Windy: peak sustained wind over the next 12 hours (hourly is mph).
    if (hourly.wind_speed_10m && insights.length < 4) {
      let peak = 0, peakIdx = 0
      for (let i = 0; i < Math.min(12, codes.length); i++) {
        const s = hourly.wind_speed_10m[start + i] ?? 0
        if (s > peak) { peak = s; peakIdx = i }
      }
      if (peak >= 24) {
        const when = timeDesc(peakIdx, currentMinute, hourly.time, start, timezone)
        const mph = Math.round(peak / 5) * 5
        insights.push(peak >= 35
          ? { level: 'warning', text: `Very windy ${when}, with winds up to ${mph} mph.` }
          : { level: 'notice',  text: `Windy ${when}, with winds around ${mph} mph.` })
      }
    }

    // Crossing below freezing tonight (only when it isn't freezing already).
    // Uses the hourly curve — the daily minimum is the calendar-day min, which
    // by afternoon is usually this morning's already-past low.
    if (hr >= 15 && (current?.temperature_2m ?? 0) > 32 && insights.length < 4) {
      let low = null
      for (let i = 1; i < codes.length; i++) {
        const t = hourly.time?.[start + i]
        if (!t) break
        const h = parseInt(t.slice(11, 13), 10)
        if (!t.startsWith(todayStr) && h > 8) break // past tomorrow morning
        if (t.startsWith(todayStr) && h < 19) continue
        const temp = hourly.temperature_2m?.[start + i]
        if (temp != null) low = low == null ? temp : Math.min(low, temp)
      }
      if (low != null && low <= 32) {
        insights.push({ level: 'notice', text: 'Temperatures dropping below freezing tonight.' })
      }
    }

    // Sun safety while it's still actionable (morning/midday).
    const uv = daily?.uv_index_max?.[0]
    if (hr < 15 && uv != null && uv >= 8 && insights.length < 4) {
      insights.push({
        level: 'notice',
        text: uv >= 11 ? 'Extreme UV today — avoid the midday sun.' : 'Very high UV today — wear sunscreen.',
      })
    }

    // Extreme heat (thresholds in °F; wording stays unit-free).
    const hi = daily?.temperature_2m_max?.[0]
    if (hr < 18 && hi != null && insights.length < 4) {
      if (hi >= 100)     insights.push({ level: 'warning', text: 'Dangerous heat today — limit time outside and stay hydrated.' })
      else if (hi >= 95) insights.push({ level: 'notice',  text: 'Very hot today — stay hydrated.' })
    }
  }

  // ── Week ahead ────────────────────────────────────────────────────────────
  // Look past tomorrow for anything worth planning around: the most severe
  // precipitation event of the week and any large temperature swing. Days that
  // far out get weekday names — exact hours would be false precision. Today
  // and tomorrow are already covered by the hourly insights above.
  if (daily?.time?.length > 2 && daily.weather_code) {
    const dayName = (i) =>
      new Date(`${daily.time[i]}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long' })

    const EVENT_RANK = { severe: 3, ice: 2, heavy: 2, moderate: 1 }
    let evDay = -1, evRank = 0
    for (let i = 2; i < daily.time.length; i++) {
      const rank = EVENT_RANK[classify(daily.weather_code[i])] ?? 0
      if (rank === 0) continue
      const raw = daily.precipitation_probability_max?.[i]
      if (raw != null && raw < 30) continue // too unlikely to plan around
      if (rank > evRank) { evRank = rank; evDay = i }
    }

    if (evDay !== -1 && insights.length < 4) {
      const code = daily.weather_code[evDay]
      const raw = daily.precipitation_probability_max?.[evDay]
      const p = raw != null ? displayPrecipChance(code, raw) : null
      const day = dayName(evDay)
      const isSnow = SNOW_CODES.has(code)
      const isThunder = [95, 96, 99].includes(code)

      if (evRank === 3) {
        insights.push({
          level: 'warning',
          text: isThunder
            ? (p != null ? `${p}% chance of thunderstorms ${day}.` : `Thunderstorms possible ${day}.`)
            : (p != null ? `${p}% chance of violent showers ${day}.` : `Violent showers possible ${day}.`),
        })
      } else if (evRank === 2) {
        const isIce = ICE_CODES.has(code)
        insights.push({
          level: 'info',
          text: isIce
            ? (p != null ? `${p}% chance of freezing rain ${day}.` : `Freezing rain possible ${day}.`)
            : isSnow
              ? (p != null ? `${p}% chance of heavy snow ${day}.` : `Heavy snow possible ${day}.`)
              : (p != null ? `${p}% chance of heavy rain ${day}.` : `Heavy rain possible ${day}.`),
        })
      } else {
        insights.push({
          level: 'notice',
          text: isSnow
            ? (p != null ? `${p}% chance of snow ${day}.` : `Snow possible ${day}.`)
            : (p != null ? `${p}% chance of rain ${day}.` : `Rain expected ${day}.`),
        })
      }
    }

    // Largest temperature swing versus today. Phrased without numbers since
    // this component doesn't know the user's display unit.
    if (daily.temperature_2m_max?.[0] != null && daily.temperature_2m_min?.[0] != null && insights.length < 4) {
      const dayAvg = (i) => (daily.temperature_2m_max[i] + daily.temperature_2m_min[i]) / 2
      const todayAvg = dayAvg(0)
      let swingDay = -1, swingDiff = 0
      for (let i = 2; i < daily.temperature_2m_max.length; i++) {
        const diff = dayAvg(i) - todayAvg // °F
        if (Math.abs(diff) >= 10 && Math.abs(diff) > Math.abs(swingDiff)) {
          swingDay = i
          swingDiff = diff
        }
      }
      if (swingDay !== -1) {
        const much = Math.abs(swingDiff) >= 15 ? 'much ' : ''
        insights.push({
          level: 'neutral',
          text: swingDiff > 0
            ? `Turning ${much}warmer by ${dayName(swingDay)}.`
            : `Turning ${much}cooler by ${dayName(swingDay)}.`,
        })
      }
    }
  }

  // Collapse insights that describe the same event on the same day — e.g. the
  // hourly "thunderstorm tomorrow morning" headline and the daily "thunderstorm
  // tomorrow" summary. Keeps the first (more specific, time-of-day) one.
  const seenKeys = new Set()
  const deduped = insights.filter(it => {
    if (!it.dedupeKey) return true
    if (seenKeys.has(it.dedupeKey)) return false
    seenKeys.add(it.dedupeKey)
    return true
  })

  // ── Declutter by priority ─────────────────────────────────────────────────
  // A major event should own the card: context lines like "warmer than the
  // rest of the week" or "thunderstorms Monday" only earn a slot when nothing
  // urgent is happening. Order within the array already puts "now" first.
  let visible
  if (deduped.some(i => i.level === 'severe')) {
    visible = deduped.filter(i => i.level === 'severe').slice(0, 2)
  } else if (deduped.some(i => i.level === 'warning')) {
    visible = deduped.filter(i => i.level === 'warning' || i.level === 'info').slice(0, 2)
  } else {
    visible = deduped.slice(0, 3)
  }

  return (
    <div className="card">
      <div className="section-label">WEATHER OVERVIEW</div>
      <div className="overview-list">
        {visible.map((item, i) => (
          <div key={i} className={`overview-item overview-${item.level}`}>
            <span className={`overview-dot${hasActiveAlert && item.level === 'severe' && item.immediate ? ' overview-dot--alert' : ''}${item.level === 'severe' && !item.immediate ? ' overview-dot--soft' : ''}`} />
            <span className="overview-text">{item.text}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
