import { describe, it, expect } from 'vitest'
import { outlookWindow, compareWithYesterday, compareTomorrowWithToday, rateActivities } from './todayOutlook'

// Two days of hourly data (yesterday + today), every hour the same unless a
// test overrides it.
function makeHourly(over = {}, days = ['2026-11-07', '2026-11-08']) {
  const time = []
  for (const d of days) {
    for (let h = 0; h < 24; h++) time.push(`${d}T${String(h).padStart(2, '0')}:00`)
  }
  const fill = (v) => time.map(() => v)
  const base = {
    time,
    temperature_2m: fill(68),
    apparent_temperature: fill(68),
    precipitation_probability: fill(0),
    weather_code: fill(1),
    is_day: time.map(t => { const h = Number(t.slice(11, 13)); return h >= 7 && h < 18 ? 1 : 0 }),
    uv_index: fill(3),
    wind_speed_10m: fill(5),
    wind_gusts_10m: fill(8),
    relative_humidity_2m: fill(50),
    visibility: fill(20000),
  }
  for (const [k, fn] of Object.entries(over)) base[k] = time.map((t, i) => fn(t, i, base[k][i]))
  return base
}


describe('outlookWindow', () => {
  it('runs from now to the end of today', () => {
    const w = outlookWindow(makeHourly(), '2026-11-08', '09')
    expect(w.label).toBe('Rest of today')
    expect(w.end - w.start).toBe(15)
  })
  it('stretches to 12 hours late in the evening', () => {
    const hourly = makeHourly()
    // Only today's hours exist past 23:00 in this fixture, so it stops there.
    const w = outlookWindow(hourly, '2026-11-08', '19')
    expect(w.label).toBe('Next 12 hours')
  })
  it("turns to tomorrow's waking hours from 9pm", () => {
    const hourly = makeHourly({}, ['2026-11-07', '2026-11-08', '2026-11-09'])
    const w = outlookWindow(hourly, '2026-11-08', '21')
    expect(w.tomorrow).toBe(true)
    expect(w.label).toBe('Tomorrow')
    expect(hourly.time[w.start]).toBe('2026-11-09T06:00')
    expect(hourly.time[w.end]).toBe('2026-11-09T22:00')
  })
  it('stays on tonight when tomorrow has no hours', () => {
    const w = outlookWindow(makeHourly(), '2026-11-08', '22')
    expect(w.tomorrow).toBeUndefined()
    expect(w.label).toBe('Next 12 hours')
  })
})

describe('compareTomorrowWithToday', () => {
  it("compares tomorrow's high with today's", () => {
    const c = compareTomorrowWithToday({ temperature_2m_max: [50, 58], temperature_2m_min: [35, 40] })
    expect(c.direction).toBe('warmer')
    expect(c.diffF).toBe(8)
    expect(c.low.diffF).toBe(5)
  })
  it('returns null without tomorrow', () => {
    expect(compareTomorrowWithToday({ temperature_2m_max: [50] })).toBeNull()
  })
})

describe('compareWithYesterday', () => {
  it('leads with right now against the same hour yesterday', () => {
    const hourly = makeHourly({ temperature_2m: (t, _, v) => (t.startsWith('2026-11-07T09') ? 50 : v) })
    const c = compareWithYesterday({
      hourly, daily: { temperature_2m_max: [60] }, yesterday: { max: 57 },
      current: { temperature_2m: 45 }, todayStr: '2026-11-08', hourStr: '09',
    })
    expect(c.basis).toBe('now')
    expect(c.direction).toBe('colder')
    expect(c.diffF).toBe(-5)
    expect(c.high.diffF).toBe(3)
  })
  it('falls back to the high when the same hour yesterday is missing', () => {
    const c = compareWithYesterday({
      hourly: null, daily: { temperature_2m_max: [60] }, yesterday: { max: 52 },
      current: { temperature_2m: 45 }, todayStr: '2026-11-08', hourStr: '09',
    })
    expect(c.basis).toBe('high')
    expect(c.direction).toBe('warmer')
  })
  it('calls a small difference the same', () => {
    const c = compareWithYesterday({
      hourly: null, daily: { temperature_2m_max: [60] }, yesterday: { max: 59 },
      current: null, todayStr: '2026-11-08', hourStr: '09',
    })
    expect(c.direction).toBe('same')
  })
  it('returns null with nothing to compare', () => {
    expect(compareWithYesterday({ hourly: null, daily: null, yesterday: null, current: null, todayStr: '2026-11-08', hourStr: '09' })).toBeNull()
  })
})

describe('rateActivities', () => {
  it('rates a mild dry day highly', () => {
    const hourly = makeHourly()
    const r = rateActivities(hourly, outlookWindow(hourly, '2026-11-08', '09'))
    expect(r.outside.score).toBeGreaterThanOrEqual(8)
    expect(r.driving.score).toBeGreaterThanOrEqual(9)
    expect(r.driving.reason).toBe('Clear roads')
  })
  it('marks freezing rain as bad for driving', () => {
    const hourly = makeHourly({
      weather_code: () => 67, precipitation_probability: () => 90,
      temperature_2m: () => 30, apparent_temperature: () => 22,
    })
    const r = rateActivities(hourly, outlookWindow(hourly, '2026-11-08', '09'))
    expect(r.driving.score).toBeLessThanOrEqual(2)
    expect(r.driving.reason).toBe('Freezing rain')
    expect(r.outside.score).toBeLessThanOrEqual(2)
  })
  it('names the cold as the reason on a chilly dry day', () => {
    const hourly = makeHourly({ temperature_2m: () => 40, apparent_temperature: () => 36 })
    const r = rateActivities(hourly, outlookWindow(hourly, '2026-11-08', '09'))
    expect(r.outside.reason).toBe('Cold')
    expect(r.outside.score).toBeLessThan(r.driving.score)
  })
})

