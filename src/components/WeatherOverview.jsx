import { getWeatherInfo, liveWeatherCode, nowcastHourlyCode, displayPrecipChance, precipTier } from '../utils/weatherCodes'

const SEVERE_CODES   = new Set([95, 96, 99, 82])
const HEAVY_CODES    = new Set([65, 75, 86])
const MODERATE_CODES = new Set([63, 73, 81, 55])
const LIGHT_CODES    = new Set([51, 53, 61, 71, 77, 80, 85])
const FOG_CODES      = new Set([45, 48])
const SNOW_CODES     = new Set([71, 73, 75, 77, 85, 86])
const RAIN_CODES     = new Set([51, 53, 55, 61, 63, 65, 80, 81, 82, 95, 96, 99])

function classify(code) {
  if (SEVERE_CODES.has(code))   return 'severe'
  if (HEAVY_CODES.has(code))    return 'heavy'
  if (MODERATE_CODES.has(code)) return 'moderate'
  if (LIGHT_CODES.has(code))    return 'light'
  if (FOG_CODES.has(code))      return 'fog'
  return 'clear'
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

export function WeatherOverview({ hourly, daily, current, minutely, timezone, hasActiveAlert }) {
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

  let firstSevere = -1, firstHeavy = -1, firstModerate = -1, firstLight = -1, firstFog = -1
  for (let i = 0; i < codes.length; i++) {
    const cat = classify(codes[i])
    // Skip a current-hour precip claim only when neither the live nowcast nor the
    // forecast backs it (precipNow) — i.e. truly nothing falling; otherwise defer
    // to the next slot that genuinely has precipitation.
    const isPrecipCat = cat === 'severe' || cat === 'heavy' || cat === 'moderate' || cat === 'light'
    if (i === 0 && isPrecipCat && !precipNow) continue
    if (cat === 'severe'   && firstSevere   === -1) firstSevere   = i
    if (cat === 'heavy'    && firstHeavy    === -1) firstHeavy    = i
    if (cat === 'moderate' && firstModerate === -1) firstModerate = i
    if (cat === 'light'    && firstLight    === -1) firstLight    = i
    if (cat === 'fog'      && firstFog      === -1) firstFog      = i
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
    const noun = isSevereOnset ? 'thunderstorm' : SNOW_CODES.has(codes[hourOffset]) ? 'snow' : 'rain'
    const article = isSevereOnset ? 'a ' : ''
    const when = mins >= 60 ? 'within the hour' : `in about ${mins} minutes`
    const p = probAt(hourOffset)

    if (isSevereOnset) return {
      level: 'warning',
      text: p != null ? `${p}% chance of a thunderstorm ${when}.` : `Thunderstorm expected ${when}.`,
    }
    if (peak >= 0.08) return { level: 'warning', text: p != null ? `${p}% chance of heavy ${noun} ${when}.` : `Heavy ${noun} expected ${when}.` }
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
    const noun = SNOW_CODES.has(codes[0]) ? 'snow' : 'rain'

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
    // Falling now with no end within the look-ahead horizon.
    return { level: 'info', text: `${cap(noun)} expected to continue.` }
  })()

  const insights = []

  // Returns the display probability for a future slot, null for slot 0 ("right now")
  // or when no probability data exists. Used to build probability-first strings.
  const pctOf = (slotIndex) => {
    const p = probAt(slotIndex)
    return slotIndex > 0 && p != null ? p : null
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
  const severeP = firstSevere !== -1 ? pctOf(firstSevere) : null
  const showSevere = firstSevere !== -1 &&
    (hasActiveAlert || firstSevere === 0 || aboveThreshold(firstSevere, 30))

  if (showSevere) {
    const when = timeDesc(firstSevere, currentMinute, hourly.time, start, timezone)
    const isThunder = [95, 96, 99].includes(codes[firstSevere])
    insights.push({
      level: 'severe',
      text: hasActiveAlert
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
  } else if (firstHeavy !== -1 && aboveThreshold(firstHeavy, 50)) {
    const when = timeDesc(firstHeavy, currentMinute, hourly.time, start, timezone)
    const isSnow = [75, 86].includes(codes[firstHeavy])
    const p = pctOf(firstHeavy)
    insights.push({
      level: 'warning',
      text: isSnow
        ? (p != null ? `${p}% chance of heavy snow ${when}.` : `Heavy snow arriving ${when}.`)
        : (p != null ? `${p}% chance of heavy rain ${when}.` : `Heavy rain expected ${when}.`),
    })
  } else if (firstModerate !== -1 && aboveThreshold(firstModerate, 40)) {
    const when = timeDesc(firstModerate, currentMinute, hourly.time, start, timezone)
    const isSnow = codes[firstModerate] === 73
    const p = pctOf(firstModerate)
    insights.push({
      level: 'info',
      text: isSnow
        ? (p != null ? `${p}% chance of moderate snow ${when}.` : `Moderate snow on the way ${when}.`)
        : (p != null ? `${p}% chance of rain ${when}.` : `Rain moving in ${when}.`),
    })
  } else if (firstLight !== -1) {
    const info = getWeatherInfo(codes[firstLight])
    const when = timeDesc(firstLight, currentMinute, hourly.time, start, timezone)
    const prob = probAt(firstLight)
    const label = info.label.toLowerCase()
    // Phrase upcoming light precip as a chance, e.g. "30% chance of a light drizzle
    // within the hour."; keep the plain label when it's already happening now.
    insights.push({
      level: 'notice',
      text: prob != null && firstLight > 0
        ? `${prob}% chance of ${article(label)}${label} ${when}.`
        : `${info.label} ${when}.`,
    })
  }

  // Fog is independent of rain, so it can accompany a precipitation insight.
  if (firstFog !== -1 && insights.length < 2) {
    const when = timeDesc(firstFog, currentMinute, hourly.time, start, timezone)
    insights.push({ level: 'notice', text: `Foggy conditions expected ${when}.` })
  }

  if (insights.length === 0) {
    const allClear = codes.every(c => classify(c) === 'clear')
    let noWeatherText
    if (allClear) {
      noWeatherText = 'Clear skies for the rest of the day.'
    } else {
      const cc = current?.cloud_cover ?? 50
      if (cc <= 25)      noWeatherText = 'Mostly sunny with dry conditions.'
      else if (cc <= 50) noWeatherText = 'Partly cloudy, staying dry.'
      else if (cc <= 75) noWeatherText = 'Mostly cloudy, but dry for the rest of the day.'
      else               noWeatherText = 'Overcast but dry for the rest of the day.'
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
        const lower = tempText.charAt(0).toLowerCase() + tempText.slice(1)
        insights[0] = { ...insights[0], text: `${base}. ${tempText}` }
      } else {
        insights.push({ level: 'neutral', text: tempText })
      }
    }

    // When showing tomorrow's forecast (evening mode), add an insight for any
    // notable weather event so the user knows what to prepare for.
    if (baseIdx === 1 && daily?.weather_code?.[1] != null) {
      const tCode = daily.weather_code[1]
      const tCat = classify(tCode)
      const tProb = daily.precipitation_probability_max?.[1]
      const isSnow = SNOW_CODES.has(tCode)
      const isThunder = [95, 96, 99].includes(tCode)

      if (tCat === 'severe') {
        insights.push({
          level: 'severe',
          text: hasActiveAlert
            ? (isThunder
                ? (tProb != null ? `${tProb}% chance of thunderstorms tomorrow. Plan to avoid open areas.` : `Thunderstorms forecast tomorrow. Plan to avoid open areas.`)
                : (tProb != null ? `${tProb}% chance of severe weather tomorrow. Plan ahead and check forecasts frequently.` : `Severe weather tomorrow. Plan ahead and check forecasts frequently.`))
            : (isThunder
                ? (tProb != null ? `${tProb}% chance of possible thunderstorms tomorrow, take precautions.` : `Possible thunderstorms tomorrow, take precautions.`)
                : (tProb != null ? `${tProb}% chance of possible severe weather tomorrow, take precautions.` : `Possible severe weather tomorrow, take precautions.`)),
        })
      } else if (tCat === 'heavy') {
        insights.push({
          level: 'warning',
          text: isSnow
            ? (tProb != null ? `${tProb}% chance of heavy snow tomorrow. Avoid travelling and dress warmly.` : `Heavy snow tomorrow. Avoid travelling and dress warmly.`)
            : (tProb != null ? `${tProb}% chance of heavy rain tomorrow. Bring a waterproof jacket and umbrella.` : `Heavy rain tomorrow. Bring a waterproof jacket and umbrella.`),
        })
      } else if (tCat === 'moderate') {
        insights.push({
          level: 'info',
          text: isSnow
            ? (tProb != null ? `${tProb}% chance of moderate snow tomorrow. Pack boots and a warm coat, avoid travel if possible.` : `Moderate snow tomorrow. Pack boots and a warm coat, avoid travel if possible.`)
            : (tProb != null ? `${tProb}% chance of rain tomorrow. Don't forget an umbrella.` : `Rain expected tomorrow. Don't forget an umbrella.`),
        })
      } else if (tCat === 'light') {
        insights.push({
          level: 'notice',
          text: isSnow
            ? (tProb != null ? `${tProb}% chance of light snow tomorrow.` : `Light snow possible tomorrow.`)
            : (tProb != null ? `${tProb}% chance of light rain tomorrow.` : `Light rain possible tomorrow.`),
        })
      } else if (tCat === 'fog') {
        insights.push({
          level: 'notice',
          text: `Foggy conditions expected tomorrow.`,
        })
      }
    }
  }

  return (
    <div className="card">
      <div className="section-label">WEATHER OVERVIEW</div>
      <div className="overview-list">
        {insights.map((item, i) => (
          <div key={i} className={`overview-item overview-${item.level}`}>
            <span className={`overview-dot${hasActiveAlert && item.level === 'severe' ? ' overview-dot--alert' : ''}`} />
            <span className="overview-text">{item.text}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
