import { describe, it, expect } from 'vitest'
import { wetBulbC, precipIsSnow, codeForDbz, liveWeatherCode, liveWeatherSource } from './weatherCodes'

describe('wet-bulb rain or snow', () => {
  it('matches a saturated wet-bulb to the air temperature', () => {
    expect(wetBulbC({ temperature_2m: 50, relative_humidity_2m: 99 })).toBeCloseTo(10, 0)
  })

  it('calls snow above freezing when the air is dry enough', () => {
    // 35°F at 60%: wet-bulb about -0.5°C. Air temperature alone said rain.
    expect(precipIsSnow({ temperature_2m: 35, relative_humidity_2m: 60 })).toBe(true)
    // 35°F nearly saturated: wet-bulb about 1.5°C, rain.
    expect(precipIsSnow({ temperature_2m: 35, relative_humidity_2m: 98 })).toBe(false)
  })

  it('works from the dew point when humidity is missing', () => {
    expect(precipIsSnow({ temperature_2m: 35, dew_point_2m: 23 })).toBe(true)
  })

  it('falls back to the air temperature without either', () => {
    expect(precipIsSnow({ temperature_2m: 33 })).toBe(true)
    expect(precipIsSnow({ temperature_2m: 34 })).toBe(false)
  })
})

describe('codeForDbz', () => {
  it('grades rain by strength within its own family', () => {
    expect(codeForDbz(65, 24)).toBe(61)
    expect(codeForDbz(61, 34)).toBe(63)
    expect(codeForDbz(61, 44)).toBe(65)
    expect(codeForDbz(82, 25)).toBe(80)
  })

  it('turns drizzle with a rain-strength echo into rain', () => {
    expect(codeForDbz(51, 22)).toBe(51)
    expect(codeForDbz(55, 34)).toBe(63)
  })

  it('grades snow on its own, lower lines', () => {
    expect(codeForDbz(75, 16)).toBe(71)
    expect(codeForDbz(71, 24)).toBe(73)
    expect(codeForDbz(71, 30)).toBe(75)
  })

  it('leaves thunder and codes without a strength alone', () => {
    expect(codeForDbz(95, 50)).toBe(95)
    expect(codeForDbz(63, null)).toBe(63)
  })
})

describe('liveWeatherCode with radar strength', () => {
  const base = { time: '2026-07-16T18:00', cloud_cover: 90, temperature_2m: 70, relative_humidity_2m: 80 }

  it("grades a model's heavy rain down to what the radar sees", () => {
    const current = { ...base, weather_code: 65, radar_dbz: 24 }
    expect(liveWeatherCode(current, null, false)).toBe(61)
    expect(liveWeatherSource(current, null, false)).toBe('radar')
  })

  it("keeps a station's own report of how hard it is falling", () => {
    const current = { ...base, weather_code: 65, radar_dbz: 24, weather_code_confirmed: true, weather_code_source: 'station' }
    expect(liveWeatherCode(current, null, false)).toBe(65)
  })

  it("takes the forecast's type and the radar's strength under a dry code", () => {
    const current = { ...base, weather_code: 2, forecast_hour_code: 65, radar_dbz: 33 }
    expect(liveWeatherCode(current, null, false)).toBe(63)
  })

  it('calls snow by wet-bulb when nothing says the type', () => {
    const current = { ...base, weather_code: 3, temperature_2m: 35, relative_humidity_2m: 60, radar_dbz: 18 }
    expect(liveWeatherCode(current, null, false)).toBe(71)
  })

  it('ignores the strength when the setting is off', () => {
    const current = { ...base, weather_code: 65, radar_dbz: 24 }
    expect(liveWeatherCode(current, null, null)).toBe(65)
  })
})
