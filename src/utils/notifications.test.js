import { describe, it, expect } from 'vitest'
import { notificationPlace } from './notifications'

const HOME = { name: 'Home', latitude: 39.5, longitude: -76.3 }
const SAVED = { name: 'Saved', latitude: 40.7, longitude: -74.0 }
const BROWSED = { name: 'Browsed', latitude: 51.5, longitude: -0.1 }

describe('notificationPlace', () => {
  it('stays on Home while another city is on screen', () => {
    expect(notificationPlace({ home: HOME, cities: [SAVED], location: BROWSED })).toBe(HOME)
  })

  it('uses the first saved place when there is no Home', () => {
    expect(notificationPlace({ home: null, cities: [SAVED], location: BROWSED })).toBe(SAVED)
  })

  it('falls back to the place on screen with nothing saved', () => {
    expect(notificationPlace({ home: null, cities: [], location: BROWSED })).toBe(BROWSED)
  })

  it('is null on the splash with nothing saved, which the shell reads as "keep"', () => {
    expect(notificationPlace({ home: null, cities: [], location: null })).toBeNull()
  })
})
