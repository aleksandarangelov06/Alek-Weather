import { getWeatherInfo, toTemp } from '../utils/weatherCodes'

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
  if (apparentTempF >= 85)      base = 'Shorts and a t-shirt'
  else if (apparentTempF >= 75) base = 'Light, breathable clothing'
  else if (apparentTempF >= 65) base = 'Light layers'
  else if (apparentTempF >= 55) base = 'Light jacket'
  else if (apparentTempF >= 45) base = 'Jacket recommended'
  else if (apparentTempF >= 35) base = 'Warm coat'
  else if (apparentTempF >= 20) base = 'Heavy coat, hat and gloves'
  else                           base = 'Bundle up — heavy coat, hat, gloves and scarf'

  if (hasSnow) return `${base}; waterproof boots recommended`
  if (hasRain) return `${base}; bring an umbrella`
  return base
}

export function WeatherOverview({ hourly, daily, current, unit, timezone }) {
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

  let firstSevere = -1, firstHeavy = -1, firstModerate = -1, firstLight = -1, firstFog = -1
  for (let i = 0; i < codes.length; i++) {
    const cat = classify(codes[i])
    if (cat === 'severe'   && firstSevere   === -1) firstSevere   = i
    if (cat === 'heavy'    && firstHeavy    === -1) firstHeavy    = i
    if (cat === 'moderate' && firstModerate === -1) firstModerate = i
    if (cat === 'light'    && firstLight    === -1) firstLight    = i
    if (cat === 'fog'      && firstFog      === -1) firstFog      = i
  }

  const insights = []

  if (firstSevere !== -1) {
    const when = timeDesc(firstSevere, currentMinute)
    const isThunder = [95, 96, 99].includes(codes[firstSevere])
    insights.push({
      level: 'severe',
      text: isThunder
        ? `Thunderstorm ${when} — seek shelter!`
        : `Violent rain showers ${when} — stay safe!`,
    })
  }

  if (firstHeavy !== -1) {
    const when = timeDesc(firstHeavy, currentMinute)
    const isSnow = [75, 86].includes(codes[firstHeavy])
    insights.push({
      level: 'warning',
      text: isSnow ? `Heavy snow arriving ${when}.` : `Heavy rain expected ${when}.`,
    })
  }

  if (firstModerate !== -1 && insights.length < 2) {
    const when = timeDesc(firstModerate, currentMinute)
    const isSnow = codes[firstModerate] === 73
    insights.push({
      level: 'info',
      text: isSnow ? `Moderate snow on the way ${when}.` : `Rain moving in ${when}.`,
    })
  }

  if (firstLight !== -1 && insights.length < 2) {
    const info = getWeatherInfo(codes[firstLight])
    const when = timeDesc(firstLight, currentMinute)
    insights.push({ level: 'notice', text: `${info.label} ${when}.` })
  }

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
    const hi = toTemp(daily.temperature_2m_max[0], unit)
    const lo = toTemp(daily.temperature_2m_min[0], unit)
    insights.push({ level: 'neutral', text: `Today's range: ${lo}°–${hi}°${unit}.` })
  }

  if (current?.apparent_temperature != null) {
    insights.push({
      level: 'neutral',
      text: clothingAdvice(current.apparent_temperature, codes),
    })
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
