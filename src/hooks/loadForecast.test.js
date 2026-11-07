import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { loadForecast } from './useWeather'

// loadForecast against a fake network. Each test describes the servers as a
// list of [match, respond] pairs; `respond` returns a body, or HANG for a
// server that accepts the request and never answers (until the request's
// signal aborts it, which is what the time limits are for).

const NOW = new Date('2026-07-16T18:00:00Z')
const HANG = Symbol('hang')
// Inland Maryland, near Bel Air: inside the NWS and MRMS domains.
const LOC = { latitude: 39.536, longitude: -76.348, name: 'Bel Air' }

const openMeteo = () => ({
  timezone: 'UTC',
  current: { time: '2026-07-16T18:00', weather_code: 1, temperature_2m: 80 },
  hourly: { time: ['2026-07-16T18:00'], weather_code: [1] },
  daily: { time: ['2026-07-16'], weather_code: [1] },
  minutely_15: { time: [], precipitation: [] },
})

function fakeNetwork(routes) {
  return vi.fn((url, init = {}) => {
    const route = routes.find(([match]) => url.includes(match))
    const body = route ? route[1](url) : null
    if (body === HANG) {
      return new Promise((_, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal.reason))
      })
    }
    const ok = body != null
    return Promise.resolve({ ok, status: ok ? 200 : 404, json: async () => body })
  })
}

// AbortSignal.timeout runs on Node's internal timers, which fake timers can't
// reach; this stand-in uses setTimeout so the tests control the clock.
function timeoutOnFakeClock(ms) {
  const c = new AbortController()
  setTimeout(() => c.abort(new DOMException('timed out', 'TimeoutError')), ms)
  return c.signal
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  vi.spyOn(AbortSignal, 'timeout').mockImplementation(timeoutOnFakeClock)
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('loadForecast', () => {
  it('shows the Open-Meteo forecast when every NWS request stalls', async () => {
    vi.stubGlobal('fetch', fakeNetwork([
      ['api.open-meteo.com', openMeteo],
      ['air-quality-api', () => ({ current: { us_aqi: 20 } })],
      ['api.weather.gov', () => HANG],
      ['mapservices.weather.noaa.gov', () => HANG],
      ['rainviewer', () => HANG],
    ]))

    let settled = false
    const pending = loadForecast(LOC).then((r) => { settled = true; return r })

    // Well short of the limits, a stalled NWS still holds it up...
    await vi.advanceTimersByTimeAsync(3000)
    expect(settled).toBe(false)

    // ...and past them it gives up and keeps the Open-Meteo values.
    await vi.advanceTimersByTimeAsync(10000)
    const { data, alertFeatures } = await pending
    expect(data.current.weather_code).toBe(1)
    expect(alertFeatures).toEqual([])
    expect(data.radarClear).toBeNull()
  })

  it('fails outright when Open-Meteo itself never answers', async () => {
    vi.stubGlobal('fetch', fakeNetwork([
      ['api.open-meteo.com', () => HANG],
      ['air-quality-api', () => HANG],
      ['api.weather.gov', () => null],
      ['mapservices.weather.noaa.gov', () => null],
      ['rainviewer', () => null],
    ]))
    const pending = loadForecast(LOC)
    const assertion = expect(pending).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(16000)
    await assertion
  })

  it('reads stations in list order even when a farther one answers first', async () => {
    const stations = {
      features: [
        { properties: { stationIdentifier: 'K0W3' }, geometry: { coordinates: [-76.30, 39.55] } },
        { properties: { stationIdentifier: 'KAPG' }, geometry: { coordinates: [-76.25, 39.47] } },
        // Out of range (~23 km): never asked.
        { properties: { stationIdentifier: 'KMTN' }, geometry: { coordinates: [-76.414, 39.326] } },
      ],
    }
    const obs = {
      K0W3: { timestamp: NOW.toISOString(), presentWeather: [{ weather: 'rain', intensity: 'light' }] },
      KAPG: { timestamp: NOW.toISOString(), presentWeather: [{ weather: 'rain', intensity: 'heavy' }] },
    }
    const fetchMock = fakeNetwork([
      ['api.open-meteo.com', openMeteo],
      ['air-quality-api', () => null],
      ['/points/', () => ({ properties: { observationStations: 'https://api.weather.gov/gridpoints/LWX/1,1/stations' } })],
      ['/stations?', () => stations],
      ['/stations/K0W3/', () => ({ properties: obs.K0W3 })],
      ['/stations/KAPG/', () => ({ properties: obs.KAPG })],
      ['/alerts/', () => ({ features: [] })],
      ['mapservices.weather.noaa.gov', () => null],
      ['rainviewer', () => null],
    ])
    vi.stubGlobal('fetch', fetchMock)

    const { data } = await loadForecast(LOC)
    // The nearer station's light rain, not the farther station's heavy rain.
    expect(data.current.weather_code).toBe(61)
    expect(data.current.weather_code_source).toBe('station')
    expect(fetchMock.mock.calls.some(([u]) => u.includes('KMTN'))).toBe(false)
  })

  it('runs the NWS overlay on a lite load, which has no daily section', async () => {
    const { daily, ...lite } = openMeteo() // eslint-disable-line no-unused-vars
    lite.hourly = { ...lite.hourly, temperature_2m: [80], is_day: [1], precipitation_probability: [0] }
    const fetch = fakeNetwork([
      ['api.open-meteo.com', (url) => (url.includes('daily=') ? openMeteo() : lite)],
      ['/points/', () => ({ properties: { forecastHourly: 'https://api.weather.gov/hourly', forecast: 'https://api.weather.gov/daily' } })],
      ['api.weather.gov/hourly', () => ({ properties: { periods: [{
        startTime: '2026-07-16T18:00:00Z', icon: 'https://api.weather.gov/icons/land/day/ovc', temperature: 77,
      }] } })],
      ['api.weather.gov/alerts', () => ({ features: [] })],
    ])
    vi.stubGlobal('fetch', fetch)
    const pending = loadForecast(LOC, { lite: true })
    await vi.advanceTimersByTimeAsync(20000)
    const { data, aqiResult } = await pending
    expect(data.daily).toBeUndefined()
    expect(aqiResult.status).toBe('rejected')
    expect(data.current.temperature_2m).toBe(77) // NWS hour stamped onto current
    const urls = fetch.mock.calls.map(([u]) => u)
    expect(urls.some(u => u.includes('air-quality'))).toBe(false)
    expect(urls.some(u => u.includes('api.weather.gov/daily'))).toBe(false)
  })

  // Last: the stand-down it starts is module state and outlives the test.
  it('stands down after a 429 instead of asking again', async () => {
    const fetch = vi.fn(async () => ({
      ok: false, status: 429, json: async () => ({ reason: 'Hourly API request limit exceeded.' }),
    }))
    vi.stubGlobal('fetch', fetch)
    await expect(loadForecast(LOC)).rejects.toMatchObject({ status: 429 })
    const calls = fetch.mock.calls.length
    await expect(loadForecast(LOC)).rejects.toMatchObject({ status: 429 })
    expect(fetch.mock.calls.length).toBe(calls)
  })
})
