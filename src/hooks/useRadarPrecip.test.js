import { describe, it, expect } from 'vitest'
import { mrmsDbz, mrmsSweeps, sweepVerdict, radarVerdict, RAIN_DBZ, SNOW_DBZ, STRONG_DBZ } from './useRadarPrecip'

// The colours here are real ones. Each "band median" is the median MRMS colour
// of every pixel whose N0Q value fell in that 5 dBZ band, from the calibration
// run against the Iowa Environmental Mesonet's composite (2026-11-27 03:00Z;
// see MRMS_RAMP). The raw strings are values as getSamples returned them.
// If NOAA changes its colour ramp, these are what break.

const px = (r, g, b, a = 255) => `${r} ${g} ${b} ${a}`

describe('mrmsDbz', () => {
  it('reads calibration band medians back into their bands', () => {
    // [colour, band low, band high]: the pairing behind the medians blurs
    // across band edges, so a reading is allowed a couple of dBZ either side.
    const bands = [
      [px(83, 157, 173), 15, 20],
      [px(82, 185, 169), 20, 25],
      [px(70, 198, 148), 25, 30],
      [px(41, 194, 63), 30, 35],
      [px(14, 183, 20), 35, 40],
    ]
    for (const [colour, lo, hi] of bands) {
      const dbz = mrmsDbz(colour)
      expect(dbz, colour).toBeGreaterThanOrEqual(lo - 2.5)
      expect(dbz, colour).toBeLessThanOrEqual(hi + 2.5)
    }
  })

  it('puts the weak blue end below the rain line and teal above it', () => {
    expect(mrmsDbz(px(70, 96, 160))).toBeLessThan(RAIN_DBZ)   // dark blue
    expect(mrmsDbz(px(81, 134, 183))).toBeLessThan(RAIN_DBZ)  // light blue
    expect(mrmsDbz(px(87, 198, 180))).toBeGreaterThanOrEqual(RAIN_DBZ) // teal
  })

  it('orders the strong end: green, yellow, orange, red', () => {
    const green = mrmsDbz(px(0, 112, 0))
    const yellow = mrmsDbz(px(248, 232, 8))
    const orange = mrmsDbz(px(248, 184, 8))
    const red = mrmsDbz(px(248, 56, 8))
    expect(green).toBeGreaterThanOrEqual(38)
    expect(yellow).toBeGreaterThan(green)
    expect(orange).toBeGreaterThan(yellow)
    expect(red).toBeGreaterThan(orange)
  })

  it('tells no echo, no value and an unknown colour apart', () => {
    expect(mrmsDbz('0 0 0 0')).toBe(-Infinity)
    expect(mrmsDbz('NoData')).toBeNull()
    expect(mrmsDbz(undefined)).toBeNull()
    expect(mrmsDbz(px(255, 255, 255))).toBeNull() // white is not on the ramp
  })
})

// Five readings: centre, then N, S, E, W. -Infinity is no echo.
const NONE = -Infinity
const all = (v) => [v, v, v, v, v]

describe('sweepVerdict', () => {
  it('calls clear only with nothing over the point and nothing falling beside it', () => {
    expect(sweepVerdict(all(NONE), RAIN_DBZ).verdict).toBe(true)
    // A weak return next door doesn't stop a clear call...
    expect(sweepVerdict([NONE, 8, NONE, NONE, NONE], RAIN_DBZ).verdict).toBe(true)
    // ...rain next door does: the point is on a cell's rim.
    expect(sweepVerdict([NONE, 30, NONE, NONE, NONE], RAIN_DBZ).verdict).toBeNull()
  })

  it('calls precipitation from the middle reading, not the centre alone', () => {
    const inside = sweepVerdict([28, 26, 30, 24, 22], RAIN_DBZ)
    expect(inside.verdict).toBe(false)
    expect(inside.dbz).toBe(26)
    // A speck over the centre with the rest empty is an edge.
    expect(sweepVerdict([30, NONE, NONE, NONE, 25], RAIN_DBZ).verdict).toBeNull()
  })

  it('leaves weak echoes uncalled, and calls them in snow', () => {
    const light = all(17)
    expect(sweepVerdict(light, RAIN_DBZ).verdict).toBeNull()
    expect(sweepVerdict(light, SNOW_DBZ).verdict).toBe(false)
  })

  it('makes no call without a centre reading', () => {
    expect(sweepVerdict([null, 30, 30, 30, 30], RAIN_DBZ).verdict).toBeNull()
  })
})

const obs = (...sweeps) => ({ source: 'mrms', sampledAt: 0, sweeps: sweeps.map((points, i) => ({ time: -i, points })) })

describe('radarVerdict', () => {
  it('makes a call two sweeps agree on', () => {
    expect(radarVerdict(obs(all(NONE), all(NONE)))).toEqual({ clear: true, dbz: null, trend: null })
    expect(radarVerdict(obs(all(32), all(28)))).toEqual({ clear: false, dbz: 32, trend: null })
  })

  it('waits a sweep on a new echo, unless it is a strong core', () => {
    const weak = radarVerdict(obs(all(25), all(NONE)))
    expect(weak).toEqual({ clear: null, dbz: null, trend: 'starting' })
    const strong = radarVerdict(obs(all(STRONG_DBZ + 5), all(NONE)))
    expect(strong.clear).toBe(false)
    expect(strong.trend).toBe('starting')
  })

  it('waits a sweep on an echo that has just gone', () => {
    expect(radarVerdict(obs(all(NONE), all(30)))).toEqual({ clear: null, dbz: null, trend: 'ending' })
  })

  it('uses one sweep when there is no consecutive second', () => {
    expect(radarVerdict(obs(all(30))).clear).toBe(false)
  })

  it('takes the snow threshold when told it would be snow', () => {
    const lightSnow = obs(all(17), all(16))
    expect(radarVerdict(lightSnow).clear).toBeNull()
    expect(radarVerdict(lightSnow, { snowy: true }).clear).toBe(false)
  })

  it("passes RainViewer's own call through, and nothing for no observation", () => {
    expect(radarVerdict({ source: 'rainviewer', verdict: true })).toEqual({ clear: true, dbz: null, trend: null })
    expect(radarVerdict({ source: 'pending', sampledAt: 0 }).clear).toBeNull()
    expect(radarVerdict(null).clear).toBeNull()
  })
})

describe('mrmsSweeps', () => {
  const NOW = 1_800_000_000_000
  const sample = (t, id, value) => ({ locationId: id, value, attributes: { idp_validtime: t } })
  const sweep = (t, value) => [0, 1, 2, 3, 4].map(id => sample(t, id, value))

  it('picks the newest two sweeps out of an unordered response', () => {
    const t0 = NOW - 2 * 60e3, t1 = t0 - 6 * 60e3, t2 = t1 - 6 * 60e3
    const got = mrmsSweeps([...sweep(t1, '0 0 0 0'), ...sweep(t0, px(41, 194, 63)), ...sweep(t2, '0 0 0 0')], 5, NOW)
    expect(got.map(s => s.time)).toEqual([t0, t1])
    expect(got[0].points.every(v => v > 28)).toBe(true)
    expect(got[1].points.every(v => v === -Infinity)).toBe(true)
  })

  it('drops a second sweep too far behind to be consecutive', () => {
    const t0 = NOW - 60e3
    expect(mrmsSweeps([...sweep(t0, '0 0 0 0'), ...sweep(t0 - 30 * 60e3, '0 0 0 0')], 5, NOW)).toHaveLength(1)
  })

  it('has nothing to say when the newest sweep is stale', () => {
    expect(mrmsSweeps(sweep(NOW - 20 * 60e3, '0 0 0 0'), 5, NOW)).toBeNull()
    expect(mrmsSweeps([], 5, NOW)).toBeNull()
  })
})
