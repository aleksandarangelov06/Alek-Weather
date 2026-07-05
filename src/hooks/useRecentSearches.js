import { useState, useCallback } from 'react'
import { sameCity } from '../utils/location'

const KEY = 'alek-weather-recent-searches'
const MAX = 7

export function useRecentSearches() {
  const [recents, setRecents] = useState(() => {
    try { return JSON.parse(localStorage.getItem(KEY)) ?? [] }
    catch { return [] }
  })

  const addRecent = useCallback((city) => {
    setRecents(prev => {
      const filtered = prev.filter(c => !sameCity(c, city))
      const next = [city, ...filtered].slice(0, MAX)
      localStorage.setItem(KEY, JSON.stringify(next))
      return next
    })
  }, [])

  const removeRecent = useCallback((city) => {
    setRecents(prev => {
      const next = prev.filter(c => !sameCity(c, city))
      localStorage.setItem(KEY, JSON.stringify(next))
      return next
    })
  }, [])

  const clearRecents = useCallback(() => {
    localStorage.removeItem(KEY)
    setRecents([])
  }, [])

  return { recents, addRecent, removeRecent, clearRecents }
}
