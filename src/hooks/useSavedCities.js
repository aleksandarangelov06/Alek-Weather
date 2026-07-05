import { useState, useCallback } from 'react'
import { sameCity } from '../utils/location'

const KEY = 'alek-weather-saved'

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) ?? [] }
  catch { return [] }
}

export function useSavedCities() {
  const [cities, setCities] = useState(load)

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

  return { cities, save, remove, isSaved }
}
