import { describe, expect, it } from 'vitest'
import { alertFacts, analyzeStorm, sortAlerts, stormCenterAlert, stormPhases, stormPrecip } from './stormCenter'
import { preparedness } from './preparedness'

function forecast({ codes, gusts = [], pops = [], cape = [], snowfall = [] }) {
  const n = codes.length
  const time = Array.from({ length: n }, (_, i) => `2026-11-26T${String(i).padStart(2, '0')}:00`)
  return {
    current: { wind_gusts_10m: gusts[0] ?? 10, weather_code: codes[0] },
    hourly: {
      time,
      weather_code: codes,
      wind_gusts_10m: Array.from({ length: n }, (_, i) => gusts[i] ?? 10),
      precipitation_probability: Array.from({ length: n }, (_, i) => pops[i] ?? 0),
      cape: Array.from({ length: n }, (_, i) => cape[i] ?? 0),
      snowfall: Array.from({ length: n }, (_, i) => snowfall[i] ?? 0),
    },
    daily: { time: ['2026-11-26'], precipitation_sum: [0.8] },
  }
}

const alert = (event, severity = 'Severe', extra = {}) => ({ id: event, properties: { event, severity, ...extra } })

describe('analyzeStorm', () => {
  it('rates a thunderstorm now and finds when it calms', () => {
    const weather = forecast({ codes: [95, 95, 63, 3, 3, 3, 3, 3], pops: [90, 90, 70, 0, 0, 0, 0, 0], cape: [1500, 1200] })
    const s = analyzeStorm({ weather, alerts: [], liveCode: 95, start: 0 })
    expect(s.now.kind).toBe('thunder')
    expect(s.hazards.thunder.level.index).toBeGreaterThanOrEqual(2)
    expect(s.detail.thunderAt).toBe(0)
    expect(s.calmIdx).toBe(3)
    expect(s.dominant).toBe('thunder')
  })

  it('lets a warning lift the threat into the top band', () => {
    const weather = forecast({ codes: [3, 3, 3, 3] })
    const s = analyzeStorm({ weather, alerts: [alert('Tornado Warning', 'Extreme')], liveCode: 3, start: 0 })
    expect(s.threat.level.label).toBe('Extreme')
    expect(s.hazards.wind.alert?.properties.event).toBe('Tornado Warning')
    expect(s.dominant).toBe('tornado')
  })

  it('puts snow on the snow tile, not the rain tile', () => {
    const weather = forecast({ codes: [75, 75, 73], pops: [100, 100, 90], snowfall: [0.5, 0.6, 0.3] })
    const s = analyzeStorm({ weather, alerts: [], liveCode: 75, start: 0 })
    expect(s.hazards.snow.score).toBeGreaterThan(0)
    expect(s.hazards.rain.score).toBe(0)
    expect(s.detail.snowTotal).toBeCloseTo(1.4)
  })

  it('rates the same snow by what the place is used to', () => {
    const snow = { codes: Array(24).fill(73), pops: Array(24).fill(90), snowfall: Array(24).fill(2.3 / 24) }
    // Bozeman, Montana: 1,460 m, 45.7°N.
    const bozeman = { ...forecast(snow), latitude: 45.68, elevation: 1461 }
    // Atlanta, Georgia: 320 m, 33.7°N.
    const atlanta = { ...forecast(snow), latitude: 33.75, elevation: 320 }
    const b = analyzeStorm({ weather: bozeman, alerts: [], liveCode: 73, start: 0 })
    const a = analyzeStorm({ weather: atlanta, alerts: [], liveCode: 73, start: 0 })
    expect(b.hazards.snow.level.label).toBe('Low')
    expect(a.hazards.snow.level.index).toBeGreaterThanOrEqual(2)
    expect(a.hazards.snow.score).toBeGreaterThan(b.hazards.snow.score)
  })

  it('keeps a zone-wide winter warning from making light snow extreme', () => {
    const weather = {
      ...forecast({ codes: Array(24).fill(73), pops: Array(24).fill(90), snowfall: Array(24).fill(2.3 / 24) }),
      latitude: 45.68,
      elevation: 1461,
    }
    const s = analyzeStorm({ weather, alerts: [alert('Winter Storm Warning')], liveCode: 73, start: 0 })
    expect(s.hazards.snow.level.index).toBeLessThanOrEqual(1)
    expect(s.hazards.snow.alertZone).toBe(true)
    expect(s.threat.level.index).toBeLessThanOrEqual(1)
  })

  it('still rates heavy snow in the mountains as heavy', () => {
    const weather = {
      ...forecast({ codes: Array(24).fill(75), pops: Array(24).fill(100), snowfall: Array(24).fill(14 / 24) }),
      latitude: 45.68,
      elevation: 1461,
    }
    const s = analyzeStorm({ weather, alerts: [alert('Winter Storm Warning')], liveCode: 75, start: 0 })
    expect(s.hazards.snow.level.index).toBeGreaterThanOrEqual(3)
  })

  it('calls a calm day quiet', () => {
    const weather = forecast({ codes: [1, 1, 1] })
    const s = analyzeStorm({ weather, alerts: [], liveCode: 1, start: 0 })
    expect(s.calmIdx).toBe('quiet')
    expect(s.threat.score).toBe(0)
    expect(s.dominant).toBeNull()
  })
})

describe('sortAlerts', () => {
  it('puts warnings before watches before advisories', () => {
    const sorted = sortAlerts([
      alert('Wind Advisory', 'Moderate'), alert('Flood Watch'), alert('Severe Thunderstorm Warning'),
    ])
    expect(sorted.map((a) => a.properties.event)).toEqual([
      'Severe Thunderstorm Warning', 'Flood Watch', 'Wind Advisory',
    ])
  })
})

describe('alertFacts', () => {
  it('reads the WHAT / WHERE / WHEN paragraphs', () => {
    const facts = alertFacts('* WHAT...Heavy snow. Total snow\naccumulations of 6 to 10 inches.\n\n* WHERE...Garrett County.\n\n* WHEN...Until 7 AM Friday.')
    expect(facts).toEqual([
      { label: 'What', text: 'Heavy snow. Total snow accumulations of 6 to 10 inches.' },
      { label: 'Where', text: 'Garrett County.' },
      { label: 'When', text: 'Until 7 AM Friday.' },
    ])
  })

  it('reads storm-based warnings', () => {
    const facts = alertFacts('At 412 PM EST, a severe thunderstorm was located near Laurel.\n\nHAZARD...60 mph wind gusts.\n\nSOURCE...Radar indicated.')
    expect(facts.map((f) => f.label)).toEqual(['Hazard', 'Source'])
  })
})

describe('false alarms', () => {
  it('keeps non-storm alerts off the hazard tiles and the threat', () => {
    const weather = forecast({ codes: [0, 0, 0, 0] })
    const alerts = [alert('Wind Chill Warning', 'Extreme'), alert('Freezing Fog Advisory', 'Minor'), alert('Coastal Flood Warning')]
    const s = analyzeStorm({ weather, alerts, liveCode: 0, start: 0 })
    expect(s.hazards.wind.alert).toBeNull()
    expect(s.hazards.snow.alert).toBeNull()
    expect(s.hazards.rain.alert).toBeNull()
    expect(s.threat.level.index).toBe(0)
    expect(preparedness(s, 40).level.id).not.toBe('act')
  })

  it('opens the Storm Center for warnings around the storm, not zone-wide ones', () => {
    expect(stormCenterAlert([alert('Severe Thunderstorm Warning')])).not.toBeNull()
    expect(stormCenterAlert([alert('Hurricane Warning')])).not.toBeNull()
    expect(stormCenterAlert([alert('Winter Storm Warning')])).toBeNull()
    expect(stormCenterAlert([alert('High Wind Warning')])).toBeNull()
    expect(stormCenterAlert([alert('Coastal Flood Warning', 'Extreme')])).toBeNull()
  })

  it('leads with the storm alert over a higher-tier non-storm one', () => {
    const weather = forecast({ codes: [3, 3, 3] })
    const alerts = [alert('Coastal Flood Warning'), alert('Severe Thunderstorm Watch')]
    const s = analyzeStorm({ weather, alerts, liveCode: 3, start: 0 })
    expect(s.topAlert.properties.event).toBe('Coastal Flood Warning')
    expect(s.leadAlert.properties.event).toBe('Severe Thunderstorm Watch')
  })

  it('never reads calm while snow is falling', () => {
    const weather = forecast({ codes: [71, 71, 3, 3], pops: [60, 40] })
    const s = analyzeStorm({ weather, alerts: [], liveCode: 71, start: 0 })
    expect(s.now.level.index).toBeGreaterThanOrEqual(1)
    expect(s.now.kind).toBe('snow')
  })
})

describe('stormPrecip', () => {
  // Hourly slots stamped at the end of their hour, an hour apart from 0.
  const H = 3600000
  const hourly = (precipitation, snowfall = []) => ({
    time: precipitation.map((_, i) => `t${i + 1}`),
    precipitation,
    snowfall: precipitation.map((_, i) => snowfall[i] ?? 0),
  })
  const toMs = (t) => Number(t.slice(1)) * H

  it('splits a storm into what has fallen and what is to come', () => {
    const p = stormPrecip({ hourly: hourly([0.1, 0.2, 0.3, 0.4]), toMs, start: 0, end: 4 * H, now: 2 * H })
    expect(p.rain.total).toBeCloseTo(1.0)
    expect(p.rain.fallen).toBeCloseTo(0.3)
    expect(p.rain.frac).toBeCloseTo(0.3)
    expect(p.snow).toBeNull()
  })

  it('counts the share of an hour that now cuts through', () => {
    const p = stormPrecip({ hourly: hourly([0.2, 0.4]), toMs, start: 0, end: 2 * H, now: 1.5 * H })
    expect(p.rain.fallen).toBeCloseTo(0.4)
  })

  it('only counts hours inside the storm window', () => {
    const p = stormPrecip({ hourly: hourly([0.5, 0.1, 0.1, 0.5]), toMs, start: H, end: 3 * H, now: 0 })
    expect(p.rain.total).toBeCloseTo(0.2)
    expect(p.rain.fallen).toBe(0)
  })

  it('puts snowy hours on the snow gauge, not the rain one too', () => {
    const p = stormPrecip({ hourly: hourly([0.05, 0.1, 0.1], [0, 1.2, 0.8]), toMs, start: 0, end: 3 * H, now: 3 * H })
    expect(p.snow.total).toBeCloseTo(2.0)
    expect(p.snow.frac).toBe(1)
    // 0.05 in of rain is just enough for its own gauge.
    expect(p.rain.total).toBeCloseTo(0.05)
  })

  it('leaves out a gauge for a trace', () => {
    const p = stormPrecip({ hourly: hourly([0.01, 0.02]), toMs, start: 0, end: 2 * H, now: H })
    expect(p.rain).toBeNull()
  })
})

describe('stormPhases', () => {
  const H = 3600000
  // Hour i is stamped i, so it covers i to i + 1 hours.
  const hourly = (codes, { snowfall = [], gusts = [] } = {}) => ({
    time: codes.map((_, i) => `t${i}`),
    weather_code: codes,
    snowfall: codes.map((_, i) => snowfall[i] ?? 0),
    wind_gusts_10m: codes.map((_, i) => gusts[i] ?? 10),
  })
  const toMs = (t) => Number(t.slice(1)) * H
  const lane = (phases, id) => phases.find((l) => l.id === id)

  it('joins hours of the same weather into spans', () => {
    const p = stormPhases({ hourly: hourly([3, 71, 73, 75, 3, 71]), start: 0, toMs, window: { start: 0, end: 6 * H } })
    const snow = lane(p, 'snow')
    expect(snow.spans.map((s) => [s.from / H, s.to / H])).toEqual([[1, 4], [5, 6]])
    expect(snow.spans[0].level).toBe(3)
  })

  it('takes the live reading for the current hour', () => {
    // The model has snow from 2; the radar says it is snowing now (hour 0).
    const p = stormPhases({ hourly: hourly([3, 3, 71, 71]), liveCode: 71, start: 0, toMs, window: { start: 0, end: 4 * H } })
    expect(lane(p, 'snow').spans.map((s) => s.from / H)).toEqual([0, 2])
  })

  it('counts snowfall the code does not show, and strong gusts', () => {
    const p = stormPhases({
      hourly: hourly([3, 3, 3], { snowfall: [0, 0, 0.3], gusts: [10, 45, 62] }),
      start: 0, toMs, window: { start: 0, end: 3 * H },
    })
    expect(lane(p, 'snow').spans[0].from / H).toBe(1)
    expect(lane(p, 'wind').spans[0].level).toBe(4)
  })

  it('gives storm alerts their own lane, leaving out the one that set the window', () => {
    const at = (h) => new Date(h * H).toISOString()
    const winter = alert('Winter Storm Warning', 'Severe', { onset: at(0), ends: at(10) })
    const tornado = alert('Tornado Warning', 'Extreme', { onset: at(3), ends: at(4) })
    const p = stormPhases({
      hourly: hourly([3, 3]), start: 0, toMs, window: { start: 0, end: 10 * H },
      alerts: [winter, tornado], windowAlert: winter,
    })
    expect(p[0].id).toBe('Tornado Warning')
    expect([p[0].spans[0].from / H, p[0].spans[0].to / H]).toEqual([3, 4])
    expect(p.some((l) => l.id === 'Winter Storm Warning')).toBe(false)
  })
})
