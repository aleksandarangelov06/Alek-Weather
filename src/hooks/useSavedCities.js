import { useState, useCallback } from 'react'

const KEY = 'alek-weather-saved'

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) ?? [] }
  catch { return [] }
}

export function useSavedCities() {
  const [cities, setCities] = useState(load)

  const save = useCallback((city) => {
    setCities(prev => {
      if (prev.some(c => c.latitude === city.latitude)) return prev
      const next = [...prev, city]
      localStorage.setItem(KEY, JSON.stringify(next))
      return next
    })
  }, [])

  const remove = useCallback((city) => {
    setCities(prev => {
      const next = prev.filter(c => c.latitude !== city.latitude)
      localStorage.setItem(KEY, JSON.stringify(next))
      return next
    })
  }, [])

  const isSaved = useCallback((city) => {
    return city ? cities.some(c => c.latitude === city.latitude) : false
  }, [cities])

  return { cities, save, remove, isSaved }
}
