import { useCallback, useEffect, useRef } from 'react'

// How old a reading may be before the app quietly refetches it. A radar sweep
// lands every ~6 minutes and minutely_15 steps every 15, so ten minutes is about
// the point past which the current condition can be describing weather that has
// already moved on. The check runs every minute; nothing is fetched until the
// reading is actually stale.
export const STALE_MS = 10 * 60 * 1000
const STALE_CHECK_MS = 60 * 1000

// Keeps the reading on screen current, silently: on launch, while the app is
// open, and when a saved reading is put back on screen.
//
// Weather used to be fetched exactly once per location — on mount, or when one
// was picked — and never again without a tap on refresh. A tab left open or a
// PWA resumed from the background therefore kept showing the sky as it was when
// it was last opened, with no indication beyond the "Updated N min ago" line.
// That is the inconsistency between the cards and the radar: WeatherRadar
// fetches its own frames every time it mounts, so the map was live while the
// condition card was hours old — over Bel Air MD it read "Slight Rain" (a
// station report from a shower that had since passed) beside a radar showing
// nothing at all.
//
// Returns refreshIfStale(city, updatedMs), for a caller that has just restored
// a saved reading and wants it brought up to date the same way.
export function useStaleRefresh({ initialCity, location, weather, lastUpdated, fetchWeather }) {
  // Guards against overlap: a fetch slower than STALE_CHECK_MS would otherwise
  // have a second one firing on top of it.
  const refreshingRef = useRef(false)

  const refreshIfStale = useCallback((city, updatedMs) => {
    if (!city || refreshingRef.current) return
    if (Date.now() - (updatedMs ?? 0) < STALE_MS) return
    refreshingRef.current = true
    Promise.resolve(fetchWeather(city, { silent: true }))
      .finally(() => { refreshingRef.current = false })
  }, [fetchWeather])

  // Auto-load the home city on mount (falling back to the first saved city).
  // When useWeather already opened on the cached reading for it, refresh that in
  // place instead — the app is on screen at once and updates when the network
  // answers. Mount only: later readings are the poll's business.
  useEffect(() => {
    if (!initialCity) return
    if (!weather) { fetchWeather(initialCity); return }
    refreshIfStale(initialCity, lastUpdated?.getTime())
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Refetch once the reading is older than STALE_MS, on whichever comes first:
  // the app coming back to the foreground, or the poll. Both check staleness
  // rather than acting outright, so switching tabs a dozen times costs nothing.
  useEffect(() => {
    if (!location || !weather) return
    const check = () => {
      if (document.hidden) return
      refreshIfStale(location, lastUpdated?.getTime())
    }
    const timer = setInterval(check, STALE_CHECK_MS)
    document.addEventListener('visibilitychange', check)
    window.addEventListener('focus', check)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', check)
      window.removeEventListener('focus', check)
    }
  }, [location, weather, lastUpdated, refreshIfStale])

  return refreshIfStale
}
