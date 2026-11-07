import { useSyncExternalStore } from 'react'
import {
  createLucideIcon, Sun, Cloud, CloudSun, CloudFog, CloudRain, CloudSnow, CloudLightning,
  CloudSunRain, Snowflake, Thermometer,
} from 'lucide-react'

// Which drawing WeatherIcon uses, from Settings → Appearance → Icons.
//   'color'  the inline Fluent-derived glyphs (weatherGlyphs.jsx), the default
//   'line'   Lucide line icons, the set Weather Insight and the detail cards use
//
// A module store rather than a prop or context: WeatherIcon is rendered from a
// dozen places across both layouts, and threading one more prop through every
// one of them for a value that is the same everywhere would be all cost. App
// owns the setting the same way it owns the others; it just writes it here.
export const ICON_SET_KEY = 'alek-weather-icon-set'
export const ICON_SETS = ['color', 'line']
const DEFAULT_ICON_SET = 'color'

function readStored() {
  try {
    const v = localStorage.getItem(ICON_SET_KEY)
    return ICON_SETS.includes(v) ? v : DEFAULT_ICON_SET
  } catch {
    return DEFAULT_ICON_SET
  }
}

let current = readStored()
const listeners = new Set()

export function getIconSet() {
  return current
}

export function setIconSet(value) {
  if (!ICON_SETS.includes(value) || value === current) return
  current = value
  try { localStorage.setItem(ICON_SET_KEY, value) } catch { /* not remembered, that's all */ }
  listeners.forEach(l => l())
}

function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useIconSet() {
  return useSyncExternalStore(subscribe, getIconSet, getIconSet)
}

// The moon as a clean crescent: Lucide's current Moon has a notched, lumpy
// tip that looks clumsy at hero size. This is the classic Lucide crescent
// path, built with createLucideIcon so it renders exactly like the others
// (same classes, stroke and sizing props).
const CrescentMoon = createLucideIcon('crescent-moon', [
  ['path', { d: 'M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z', key: 'crescent' }],
])

// Icon id from weatherCodes.js → Lucide line icon. Shared with the Weather
// Overview's current-conditions line so the two never disagree about what a
// condition looks like.
export const LINE_ICON_FOR_ID = {
  sun: Sun, moon: CrescentMoon, sunSmall: Sun, sunCloud: CloudSun, cloud: Cloud,
  fog: CloudFog, sunRain: CloudSunRain, rain: CloudRain, snow: CloudSnow,
  snowflake: Snowflake, storm: CloudLightning, stormStrong: CloudLightning, therm: Thermometer,
}
