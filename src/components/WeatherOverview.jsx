import { getWeatherInfo, liveWeatherCode, livePrecipRate } from '../utils/weatherCodes'

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

function timeDesc(slotIndex, currentMinute) {
  if (slotIndex === 0) return 'right now'
  const mins = (60 - currentMinute) + (slotIndex - 1) * 60
  if (mins < 25) return 'in a few minutes'
  if (mins < 70) return 'within the hour'
  const hours = Math.round(mins / 60)
  return hours === 1 ? 'in about 1 hour' : `in about ${hours} hours`
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

export function WeatherOverview({ hourly, daily, current, minutely, timezone, yesterdayTemps }) {
  const now = new Date()
  const currentMinute = parseInt(
    now.toLocaleString('en-CA', { minute: '2-digit', timeZone: timezone }),
    10
  )
  const currentHourStr = now.toLocaleString('en-CA', {
    hour: '2-digit', hour12: false, timeZone: timezone,
  })

  const startIdx = hourly.time.findIndex(t => t.includes(`T${currentHourStr}:`))
  const start = startIdx === -1 ? 0 : startIdx
  const LOOK_AHEAD = 12

  const codes = hourly.weather_code.slice(start, start + LOOK_AHEAD)

  // Slot 0 is "right now". The hourly weather_code is coarse and the real-time
  // current.weather_code lags after a downpour, so re-derive the present slot from
  // the live 15-min nowcast (same source the Current Conditions card uses) to keep
  // the two sections consistent. slice() returns a fresh array — safe to mutate.
  if (codes.length > 0) {
    const live = liveWeatherCode(current, minutely)
    if (live != null) codes[0] = live
  }

  // Precipitation probability (%) for a slot within the look-ahead window.
  const probAt = (slotIndex) => hourly.precipitation_probability?.[start + slotIndex]

  // Indefinite article for a condition label; "" for plurals (e.g. "showers")
  // since "a showers" is wrong.
  const article = (lower) =>
    lower.endsWith('s') ? '' : (/^[aeiou]/.test(lower) ? 'an ' : 'a ')

  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1)

  // Is precipitation *actually* falling right now? The hourly weather_code is a
  // coarse summary that sometimes flags rain/thunder for the current hour when
  // the real-time and minute-level data show nothing — which contradicts the
  // Precipitation tile. We trust the observed/minutely data for "right now" so
  // the two sections stay consistent.
  const precipNow = (() => {
    if ((current?.precipitation ?? 0) > 0.001) return true
    const times = minutely?.time, precip = minutely?.precipitation
    if (times?.length && precip?.length && current?.time) {
      let si = times.findIndex(t => t >= current.time)
      if (si < 0) si = 0
      if ((precip[si] ?? 0) > 0.001) return true
    }
    return false
  })()

  let firstSevere = -1, firstHeavy = -1, firstModerate = -1, firstLight = -1, firstFog = -1
  for (let i = 0; i < codes.length; i++) {
    const cat = classify(codes[i])
    // Don't let the current hour's coarse code claim active precipitation when
    // nothing is actually falling — defer to the next slot that genuinely has it.
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
    const noun = SNOW_CODES.has(codes[hourOffset]) ? 'snow' : 'rain'
    const when = mins >= 60 ? 'within the hour' : `in about ${mins} minutes`
    const p = probAt(hourOffset)
    const pct = p != null ? ` (${p}% chance)` : ''

    if (peak >= 0.08) return { level: 'warning', text: `Heavy ${noun} expected ${when}${pct}.` }
    if (peak >= 0.04) return { level: 'info', text: `${cap(noun)} moving in ${when}${pct}.` }
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

  // Emit a single precipitation insight for the most significant condition in
  // the window so the user never sees two overlapping "rain coming" messages.
  // Append "(X% chance)" for upcoming precipitation. Skipped for "right now"
  // (slot 0) since it's already falling, not a forecast, and when the API has no
  // probability for the slot.
  const chance = (slotIndex) => {
    const p = probAt(slotIndex)
    return slotIndex > 0 && p != null ? ` (${p}% chance)` : ''
  }

  if (firstSevere !== -1) {
    const when = timeDesc(firstSevere, currentMinute)
    const isThunder = [95, 96, 99].includes(codes[firstSevere])
    insights.push({
      level: 'severe',
      text: isThunder
        ? `Thunderstorm ${when}${chance(firstSevere)}. Seek shelter!`
        : `Violent rain showers ${when}${chance(firstSevere)}. Stay indoors!`,
    })
  } else if (precipNowInsight) {
    insights.push(precipNowInsight)
  } else if (nowcastInsight) {
    insights.push(nowcastInsight)
  } else if (firstHeavy !== -1) {
    const when = timeDesc(firstHeavy, currentMinute)
    const isSnow = [75, 86].includes(codes[firstHeavy])
    insights.push({
      level: 'warning',
      text: isSnow
        ? `Heavy snow arriving ${when}${chance(firstHeavy)}.`
        : `Heavy rain expected ${when}${chance(firstHeavy)}.`,
    })
  } else if (firstModerate !== -1) {
    const when = timeDesc(firstModerate, currentMinute)
    const isSnow = codes[firstModerate] === 73
    insights.push({
      level: 'info',
      text: isSnow
        ? `Moderate snow on the way ${when}${chance(firstModerate)}.`
        : `Rain moving in ${when}${chance(firstModerate)}.`,
    })
  } else if (firstLight !== -1) {
    const info = getWeatherInfo(codes[firstLight])
    const when = timeDesc(firstLight, currentMinute)
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
    const when = timeDesc(firstFog, currentMinute)
    insights.push({ level: 'notice', text: `Foggy conditions expected ${when}.` })
  }

  if (insights.length === 0) {
    const allClear = codes.every(c => classify(c) === 'clear')
    insights.push({
      level: 'good',
      text: allClear
        ? 'Clear skies for the next 12 hours.'
        : 'No significant weather in the next 12 hours.',
    })
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

    // The previous day for comparison: today (when looking at tomorrow) or yesterday (when looking at today).
    const prevAvg = baseIdx === 1
      ? avgAt(0)
      : (yesterdayTemps ? (yesterdayTemps.max + yesterdayTemps.min) / 2 : null)
    const prevLabel = baseIdx === 1 ? 'today' : 'yesterday'
    const diffPrev = prevAvg !== null ? baseAvg - prevAvg : null

    let comparison = ''
    if (diffWeek !== null && diffWeek > 8)
      comparison = 'notably warmer than the rest of the week'
    else if (diffWeek !== null && diffWeek > 3)
      comparison = 'warmer than the rest of the week'
    else if (diffWeek !== null && diffWeek < -8)
      comparison = 'notably cooler than the rest of the week'
    else if (diffWeek !== null && diffWeek < -3)
      comparison = 'cooler than the rest of the week'
    else if (diffPrev !== null && diffPrev > 6)
      comparison = `a good bit warmer than ${prevLabel}`
    else if (diffPrev !== null && diffPrev < -6)
      comparison = `a good bit cooler than ${prevLabel}`
    else if (diffPrev !== null && Math.abs(diffPrev) <= 2)
      comparison = `about the same temperature as ${prevLabel}`
    else if (diffWeek !== null)
      comparison = 'about the same temperature as the rest of the week'

    // Skip clothing advice during severe weather: the headline insight tells the
    // user to seek shelter, so "wear a t-shirt" would be tone-deaf and unsafe.
    const clothing = (current?.apparent_temperature != null && firstSevere === -1)
      ? clothingAdvice(current.apparent_temperature, codes)
      : null

    // Combine the temperature comparison and clothing advice into a single line,
    // e.g. "Today will be about the same temperature as yesterday, light layers
    // are perfect."
    if (comparison && clothing) {
      const lower = clothing.charAt(0).toLowerCase() + clothing.slice(1)
      insights.push({ level: 'neutral', text: `${dayLabel} will be ${comparison}, ${lower}.` })
    } else if (comparison) {
      insights.push({ level: 'neutral', text: `${dayLabel} will be ${comparison}.` })
    } else if (clothing) {
      insights.push({ level: 'neutral', text: `${clothing}.` })
    }
  }

  return (
    <div className="card">
      <div className="section-label">WEATHER OVERVIEW</div>
      <div className="overview-list">
        {insights.map((item, i) => (
          <div key={i} className={`overview-item overview-${item.level}`}>
            <span className="overview-dot" />
            <span className="overview-text">{item.text}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
