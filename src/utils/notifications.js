const SEEN_ALERTS_KEY = 'alek-weather-seen-alerts'
const NOTIFIED_DATES_KEY = 'alek-weather-notified-dates'

const SEVERE_CODES   = new Set([95, 96, 99, 82])
const HEAVY_CODES    = new Set([65, 75, 86])
const MODERATE_CODES = new Set([63, 73, 81, 55])
const LIGHT_CODES    = new Set([51, 53, 61, 71, 77, 80, 85])
const RAIN_CODES     = new Set([51, 53, 55, 61, 63, 65, 80, 81, 82, 95, 96, 99])
const SNOW_CODES     = new Set([71, 73, 75, 77, 85, 86])

// Notifications are APK-only. An Android WebView exposes no Web Notifications
// API, so the native shell (MainActivity) injects a `window.AndroidNotify`
// bridge instead: permission() -> 'granted' | 'denied' | 'default', it opens
// the OS prompt on requestPermission() and reports the outcome back as an
// `aleknotifpermission` CustomEvent, and notify(tag, title, body) posts a system
// notification. With no bridge (any plain browser) every entry point below
// no-ops, so the feature is simply absent off-APK.
function bridge() {
  return (typeof window !== 'undefined' && window.AndroidNotify) || null
}

export function getPermission() {
  const b = bridge()
  if (!b) return 'unsupported'
  try { return b.permission() } catch { return 'unsupported' }
}

export function requestPermission() {
  const b = bridge()
  if (!b) return Promise.resolve('unsupported')
  let current = 'default'
  try { current = b.permission() } catch { /* treat as default */ }
  // Already decided — nothing to prompt for.
  if (current === 'granted' || current === 'denied') return Promise.resolve(current)
  // 'default': the native request is async; the shell fires an
  // aleknotifpermission event once the user answers the system dialog.
  return new Promise((resolve) => {
    const onResult = (e) => {
      window.removeEventListener('aleknotifpermission', onResult)
      resolve(typeof e.detail === 'string' ? e.detail : getPermission())
    }
    window.addEventListener('aleknotifpermission', onResult)
    try {
      b.requestPermission()
    } catch {
      window.removeEventListener('aleknotifpermission', onResult)
      resolve('unsupported')
    }
  })
}

function canNotify() {
  const b = bridge()
  if (!b) return false
  try { return b.permission() === 'granted' } catch { return false }
}

function showNotification(title, options = {}) {
  const b = bridge()
  if (!b) return
  // The native side supplies the app icon; only tag/title/body cross the bridge.
  try { b.notify(options.tag || title, title, options.body || '') } catch { /* ignore */ }
}

// ── NOAA Alerts ──────────────────────────────────────────────────────────────

function getSeenAlertIds() {
  try { return JSON.parse(localStorage.getItem(SEEN_ALERTS_KEY) ?? '[]') }
  catch { return [] }
}

function markAlertsSeen(ids) {
  const existing = getSeenAlertIds()
  const merged = [...new Set([...existing, ...ids])].slice(-200)
  localStorage.setItem(SEEN_ALERTS_KEY, JSON.stringify(merged))
}

export function fireAlertNotifications(alerts) {
  if (!canNotify()) return
  const seen = getSeenAlertIds()
  const toNotify = alerts.filter(a => !seen.includes(a.id))
  toNotify.forEach(alert => {
    const p = alert.properties
    showNotification(p.event || 'Weather Alert', {
      body: p.headline || p.areaDesc?.split(';')[0] || '',
      icon: '/pwa-icon.svg',
      tag: alert.id,
    })
  })
  if (toNotify.length > 0) markAlertsSeen(toNotify.map(a => a.id))
}

// ── Date-based dedup (once per day per type) ──────────────────────────────────

function todayStr(timezone) {
  return new Date().toLocaleDateString('en-CA', { timeZone: timezone })
}

function getNotifiedDate(type) {
  try {
    return JSON.parse(localStorage.getItem(NOTIFIED_DATES_KEY) ?? '{}')[type] ?? null
  } catch { return null }
}

function markNotifiedDate(type, date) {
  try {
    const dates = JSON.parse(localStorage.getItem(NOTIFIED_DATES_KEY) ?? '{}')
    dates[type] = date
    localStorage.setItem(NOTIFIED_DATES_KEY, JSON.stringify(dates))
  } catch { /* storage unavailable */ }
}

// ── Rain / Storm ──────────────────────────────────────────────────────────────

function classifyCode(code) {
  if (SEVERE_CODES.has(code))   return 'severe'
  if (HEAVY_CODES.has(code))    return 'heavy'
  if (MODERATE_CODES.has(code)) return 'moderate'
  if (LIGHT_CODES.has(code))    return 'light'
  return 'clear'
}

export function fireRainNotification(hourly, timezone) {
  if (!canNotify()) return
  const today = todayStr(timezone)
  if (getNotifiedDate('rain') === today) return

  const currentHourStr = new Date().toLocaleString('en-CA', {
    hour: '2-digit', hour12: false, timeZone: timezone,
  })
  // If the current hour isn't in the array, bail — falling back to index 0
  // would scan yesterday's hours (past_days=1) and notify about past weather.
  const start = hourly.time.findIndex(t => t.startsWith(`${today}T${currentHourStr}`))
  if (start === -1) return
  const codes = hourly.weather_code.slice(start, start + 12)

  let worstLevel = 'clear', worstCode = null
  for (const code of codes) {
    const level = classifyCode(code)
    if (level === 'severe') { worstLevel = 'severe'; worstCode = code; break }
    if (level === 'heavy'    && worstLevel !== 'severe')                        { worstLevel = 'heavy';    worstCode = code }
    if (level === 'moderate' && !['severe','heavy'].includes(worstLevel))       { worstLevel = 'moderate'; worstCode = code }
    if (level === 'light'    && worstLevel === 'clear')                         { worstLevel = 'light';    worstCode = code }
  }
  if (worstLevel === 'clear') return

  const isThunder = worstCode && [95, 96, 99].includes(worstCode)
  const isSnow    = worstCode && SNOW_CODES.has(worstCode)

  const titles = {
    severe:   isThunder ? 'Thunderstorm Ahead'  : 'Violent Rain Ahead',
    heavy:    isSnow    ? 'Heavy Snow Ahead'     : 'Heavy Rain Ahead',
    moderate: isSnow    ? 'Snow Expected'        : 'Rain Expected',
    light:                'Light Rain Expected',
  }
  const bodies = {
    severe:   isThunder ? 'Thunderstorms expected in the next 12 hours.' : 'Violent rain showers expected in the next 12 hours.',
    heavy:    isSnow    ? 'Heavy snowfall expected in the next 12 hours.' : 'Heavy rain expected in the next 12 hours.',
    moderate: isSnow    ? 'Moderate snow on the way in the next 12 hours.' : 'Rain moving in over the next 12 hours.',
    light:                'Light rain or drizzle expected in the next 12 hours.',
  }

  showNotification(titles[worstLevel], { body: bodies[worstLevel], icon: '/pwa-icon.svg', tag: 'rain-forecast' })
  markNotifiedDate('rain', today)
}

// ── Weather Tomorrow ──────────────────────────────────────────────────────────

function fmtTemp(fahrenheit) {
  const unit = localStorage.getItem('alek-weather-unit') ?? 'F'
  if (unit === 'C') return `${Math.round((fahrenheit - 32) * 5 / 9)}°`
  return `${Math.round(fahrenheit)}°`
}

export function fireTomorrowNotification(daily, timezone) {
  if (!canNotify()) return
  const today = todayStr(timezone)
  if (getNotifiedDate('tomorrow') === today) return

  // daily[0]=today, daily[1]=tomorrow, daily[2..]=rest of week
  if (!daily.temperature_2m_max?.[1]) return

  const tHigh = daily.temperature_2m_max[1]
  const tLow  = daily.temperature_2m_min[1]
  const tAvg  = (tHigh + tLow) / 2

  // Compare tomorrow to days 2-4 (rest of the week, same logic as WeatherOverview)
  const compareCount = Math.min(3, (daily.temperature_2m_max.length ?? 0) - 2)
  let weekContext = ''
  if (compareCount >= 2) {
    let sum = 0
    for (let i = 2; i <= compareCount + 1; i++) {
      sum += (daily.temperature_2m_max[i] + daily.temperature_2m_min[i]) / 2
    }
    const diff = tAvg - sum / compareCount
    if (diff > 8)       weekContext = ', notably warmer than the rest of the week'
    else if (diff > 3)  weekContext = ', warmer than the rest of the week'
    else if (diff < -8) weekContext = ', notably cooler than the rest of the week'
    else if (diff < -3) weekContext = ', cooler than the rest of the week'
    else                weekContext = ', about the same as the rest of the week'
  }

  const code = daily.weather_code?.[1]
  const conditionNote = RAIN_CODES.has(code) ? ' with rain' : SNOW_CODES.has(code) ? ' with snow' : ''

  showNotification("Tomorrow's Weather", {
    body: `High ${fmtTemp(tHigh)}, Low ${fmtTemp(tLow)}${conditionNote}${weekContext}.`,
    icon: '/pwa-icon.svg',
    tag: 'tomorrow-weather',
  })
  markNotifiedDate('tomorrow', today)
}
