import { describe, it, expect } from 'vitest'
import { usViewBounds } from './mrms'

describe('usViewBounds', () => {
  it('picks the region the location is in', () => {
    expect(usViewBounds(39.5, -76.3)?.[0]).toEqual([24.0, -125.5])   // Maryland: lower 48
    expect(usViewBounds(61.2, -149.9)?.[0]).toEqual([51.0, -179.9])  // Anchorage
    expect(usViewBounds(21.3, -157.9)?.[0]).toEqual([18.6, -160.6])  // Honolulu
  })
  it('keeps a location just past a region edge in that region', () => {
    expect(usViewBounds(48.99, -123.0)?.[0]).toEqual([24.0, -125.5]) // Point Roberts
    expect(usViewBounds(23.5, -81.8)?.[0]).toEqual([24.0, -125.5])   // south of Key West
  })
  it('gives nothing outside the US', () => {
    expect(usViewBounds(51.5, -0.1)).toBeNull()                       // London
  })
})
