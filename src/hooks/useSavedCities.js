import { useState, useCallback } from 'react'
import { sameCity } from '../utils/location'

const KEY = 'alek-weather-saved'
const HOME_KEY = 'alek-weather-home'
// The home that was replaced when a new home was assigned over an existing one.
// Lets an accidental home change be undone by untapping (see unsetHome).
const PREV_HOME_KEY = 'alek-weather-prev-home'

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

  // Home is a single-slot favourite. Passing a city assigns it; assigning over
  // a *different* existing home stashes the old one so unsetHome() can undo an
  // accidental change. Passing null hard-clears the slot (and the stash).
  const setHome = useCallback((city) => {
    const currentHome = loadSlot(HOME_KEY)
    if (city) {
      if (currentHome && !sameCity(currentHome, city)) {
        localStorage.setItem(PREV_HOME_KEY, JSON.stringify(currentHome))
      } else {
        localStorage.removeItem(PREV_HOME_KEY)
      }
      localStorage.setItem(HOME_KEY, JSON.stringify(city))
      setHomeState(city)
    } else {
      localStorage.removeItem(PREV_HOME_KEY)
      localStorage.removeItem(HOME_KEY)
      setHomeState(null)
    }
  }, [])

  // Toggle-off from the weather card: if the current home replaced a previous
  // one, restore that (undoing an accidental tap); otherwise just clear it.
  const unsetHome = useCallback(() => {
    const prev = loadSlot(PREV_HOME_KEY)
    localStorage.removeItem(PREV_HOME_KEY)
    if (prev) {
      localStorage.setItem(HOME_KEY, JSON.stringify(prev))
      setHomeState(prev)
    } else {
      localStorage.removeItem(HOME_KEY)
      setHomeState(null)
    }
  }, [])

  const isHome = useCallback((city) => home != null && sameCity(home, city), [home])

  return { cities, save, remove, isSaved, home, setHome, unsetHome, isHome }
}
