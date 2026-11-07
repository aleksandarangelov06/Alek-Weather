import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  parseNWSIcon, pickMoreSevere, parseWindMph, nwsLocalKey,
  dedupeAlerts, collapseAlerts, distanceKm,
  obsToWmoCode, obsIsDry, preferForecastHour, confirmCurrentCode,
} from './useWeather'

const NOW = new Date('2026-07-16T18:00:00Z')
const minutesAgo = (m) => new Date(NOW.getTime() - m * 60000).toISOString()

describe('parseNWSIcon', () => {
  it('reads the condition out of an icon URL', () => {
    expect(parseNWSIcon('https://api.weather.gov/icons/land/day/rain,40?size=small')).toBe('rain')
  })
  it('picks the more severe of two conditions', () => {
    expect(parseNWSIcon('https://api.weather.gov/icons/land/day/ovc/tsra,60')).toBe('tsra')
  })
  it('returns null for nothing or garbage', () => {
    expect(parseNWSIcon(null)).toBeNull()
    expect(parseNWSIcon('not a url')).toBeNull()
  })
})

describe('pickMoreSevere', () => {
  it('ranks widespread storms above isolated ones (coverage, not intensity)', () => {
    expect(pickMoreSevere('tsra_hi', 'tsra')).toBe('tsra')
    expect(pickMoreSevere('rain_showers_hi', 'rain')).toBe('rain')
  })
  it('keeps the known code when the other is unknown or missing', () => {
    expect(pickMoreSevere('rain', 'mystery')).toBe('rain')
    expect(pickMoreSevere('rain', null)).toBe('rain')
  })
})

describe('parseWindMph', () => {
  it('takes the upper bound of a range', () => {
    expect(parseWindMph('10 to 15 mph')).toBe(15)
    expect(parseWindMph('5 mph')).toBe(5)
    expect(parseWindMph('')).toBeNull()
  })
})

describe('nwsLocalKey', () => {
  it('converts an offset timestamp to the local hour key Open-Meteo uses', () => {
    expect(nwsLocalKey('2026-07-16T18:00:00-04:00', 'America/New_York')).toBe('2026-07-16T18:00')
    expect(nwsLocalKey('2026-07-16T22:00:00Z', 'America/New_York')).toBe('2026-07-16T18:00')
  })
})

describe('distanceKm', () => {
  it('is close to the real distance at station ranges', () => {
    // Bel Air MD to Martin State Airport (KMTN) is ~23 km.
    const d = distanceKm(39.536, -76.348, 39.326, -76.414)
    expect(d).toBeGreaterThan(21)
    expect(d).toBeLessThan(25)
  })
})

describe('dedupeAlerts', () => {
  it('drops alerts superseded by an update', () => {
    const original = { id: 'a', properties: { id: 'a', event: 'Flood Warning', areaDesc: 'X', sent: '2026-07-16T10:00:00Z' } }
    const update = {
      id: 'b',
      properties: { id: 'b', event: 'Flood Warning', areaDesc: 'X', sent: '2026-07-16T12:00:00Z', references: [{ identifier: 'a' }] },
    }
    expect(dedupeAlerts([original, update]).map((f) => f.id)).toEqual(['b'])
  })
  it('keeps only the newest of the same event and area', () => {
    const older = { id: '1', properties: { event: 'Heat Advisory', areaDesc: 'Y', sent: '2026-07-16T08:00:00Z' } }
    const newer = { id: '2', properties: { event: 'Heat Advisory', areaDesc: 'Y', sent: '2026-07-16T09:00:00Z' } }
    expect(dedupeAlerts([older, newer]).map((f) => f.id)).toEqual(['2'])
  })
})

describe('collapseAlerts', () => {
  it('keeps the most urgent alert per hazard and keeps distinct hazards apart', () => {
    const watch = { id: 'w', properties: { event: 'Severe Thunderstorm Watch', severity: 'Severe' } }
    const warning = { id: 'W', properties: { event: 'Severe Thunderstorm Warning', severity: 'Severe' } }
    const flood = { id: 'f', properties: { event: 'Flood Warning', severity: 'Moderate' } }
    const ids = collapseAlerts([watch, warning, flood]).map((f) => f.id).sort()
    expect(ids).toEqual(['W', 'f'])
  })
})

describe('station observations', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW) })
  afterEach(() => { vi.useRealTimers() })

  it('reads measured rain by intensity', () => {
    const obs = { timestamp: minutesAgo(10), presentWeather: [{ weather: 'rain', intensity: 'heavy' }] }
    expect(obsToWmoCode(obs)).toBe(65)
  })
  it('retires a thunder claim after 25 minutes but keeps the rain under it', () => {
    const obs = {
      timestamp: minutesAgo(30),
      presentWeather: [{ weather: 'thunderstorms' }, { weather: 'rain', intensity: 'light' }],
    }
    expect(obsToWmoCode(obs)).toBe(61)
  })
  it('drops precipitation reports older than 45 minutes', () => {
    expect(obsToWmoCode({ timestamp: minutesAgo(50), textDescription: 'Light Rain' })).toBeNull()
  })
  it('lets fog stand for 75 minutes', () => {
    expect(obsToWmoCode({ timestamp: minutesAgo(60), textDescription: 'Fog/Mist' })).toBe(45)
  })
  it('ignores sky-cover-only reports', () => {
    expect(obsToWmoCode({ timestamp: minutesAgo(5), textDescription: 'Partly Cloudy' })).toBeNull()
  })
  it('treats a recent sky-only report as dry, and an empty one as no evidence', () => {
    expect(obsIsDry({ timestamp: minutesAgo(50), textDescription: 'Partly Cloudy' })).toBe(true)
    expect(obsIsDry({ timestamp: minutesAgo(5), textDescription: '' })).toBe(false)
    expect(obsIsDry({ timestamp: minutesAgo(5), textDescription: 'Rain' })).toBe(false)
  })
})

describe('preferForecastHour', () => {
  const base = () => ({ current: { nws_hourly: true, weather_code: 2, forecast_hour_code: 95, forecast_hour_pop: 70 } })

  it('promotes a confident convective forecast over the model', () => {
    const data = base()
    preferForecastHour(data)
    expect(data.current).toMatchObject({ weather_code: 95, model_weather_code: 2, weather_code_source: 'forecast' })
  })
  it('leaves a low-confidence hour alone', () => {
    const data = base()
    data.current.forecast_hour_pop = 30
    preferForecastHour(data)
    expect(data.current.weather_code).toBe(2)
  })
  it('never overrides a station measurement or a non-US reading', () => {
    const measured = base()
    measured.current.weather_code_confirmed = true
    preferForecastHour(measured)
    expect(measured.current.weather_code).toBe(2)

    const abroad = base()
    abroad.current.nws_hourly = false
    preferForecastHour(abroad)
    expect(abroad.current.weather_code).toBe(2)
  })
})

describe('confirmCurrentCode', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW) })
  afterEach(() => { vi.useRealTimers() })

  const warning = (event, extra = {}) => ({ properties: { event, severity: 'Severe', ...extra } })

  it('trusts the forecast storm code while a severe warning is active', () => {
    const data = { current: { weather_code: 1, forecast_hour_code: 95 } }
    confirmCurrentCode(data, [warning('Severe Thunderstorm Warning')])
    expect(data.current).toMatchObject({ weather_code: 95, weather_code_source: 'warning', severe_storm: true })
  })
  it('ignores watches and expired warnings', () => {
    const data = { current: { weather_code: 1, forecast_hour_code: 95 } }
    confirmCurrentCode(data, [
      warning('Severe Thunderstorm Watch'),
      warning('Severe Thunderstorm Warning', { expires: minutesAgo(5) }),
    ])
    expect(data.current.weather_code).toBe(1)
  })
})
