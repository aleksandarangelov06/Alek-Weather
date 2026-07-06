import { useState, useCallback } from 'react'
import { sameCity } from '../utils/location'

const KEY = 'alek-weather-saved'
const HOME_KEY = 'alek-weather-home'

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) ?? [] }
  catch { return [] }
}

function loadSlot(key) {
  try { return JSON.parse(localStorage.getItem(key)) ?? null }
  catch { return null }
}

export function useSavedCities() {
  const [cities, setCities] = useState(load)
  const [home, setHomeState] = useState(() => loadSlot(HOME_KEY))

  const save = useCallback((city) => {
    setCities(prev => {
      if (prev.some(c => sameCity(c, city))) return prev
      const next = [...prev, city]
      localStorage.setItem(KEY, JSON.stringify(next))
      return next
    })
  }, [])

  const remove = useCallback((city) => {
    setCities(prev => {
      const next = prev.filter(c => !sameCity(c, city))
      localStorage.setItem(KEY, JSON.stringify(next))
      return next
    })
  }, [])

  const isSaved = useCallback((city) => {
    return cities.some(c => sameCity(c, city))
  }, [cities])

  // Home is a single-slot favourite. Passing a city assigns it (replacing
  // whatever was there); passing null clears the slot.
  const setHome = useCallback((city) => {
    if (city) localStorage.setItem(HOME_KEY, JSON.stringify(city))
    else localStorage.removeItem(HOME_KEY)
    setHomeState(city ?? null)
  }, [])

  const isHome = useCallback((city) => home != null && sameCity(home, city), [home])

  return { cities, save, remove, isSaved, home, setHome, isHome }
}
