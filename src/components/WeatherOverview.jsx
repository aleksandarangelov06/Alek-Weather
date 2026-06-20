import { getWeatherInfo } from '../utils/weatherCodes'

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

  const insights = []

  // Emit a single precipitation insight for the most significant condition in
  // the window so the user never sees two overlapping "rain coming" messages.
  if (firstSevere !== -1) {
    const when = timeDesc(firstSevere, currentMinute)
    const isThunder = [95, 96, 99].includes(codes[firstSevere])
    insights.push({
      level: 'severe',
      text: isThunder
        ? `Thunderstorm ${when}. Seek shelter!`
        : `Violent rain showers ${when}. Stay safe!`,
    })
  } else if (firstHeavy !== -1) {
    const when = timeDesc(firstHeavy, currentMinute)
    const isSnow = [75, 86].includes(codes[firstHeavy])
    insights.push({
      level: 'warning',
      text: isSnow ? `Heavy snow arriving ${when}.` : `Heavy rain expected ${when}.`,
    })
  } else if (firstModerate !== -1) {
    const when = timeDesc(firstModerate, currentMinute)
    const isSnow = codes[firstModerate] === 73
    insights.push({
      level: 'info',
      text: isSnow ? `Moderate snow on the way ${when}.` : `Rain moving in ${when}.`,
    })
  } else if (firstLight !== -1) {
    const info = getWeatherInfo(codes[firstLight])
    const when = timeDesc(firstLight, currentMinute)
    insights.push({ level: 'notice', text: `${info.label} ${when}.` })
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
