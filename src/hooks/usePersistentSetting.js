import { useCallback, useState } from 'react'

// A setting kept in localStorage under `key`. `read(raw)` turns the stored
// string (null when there is none) into the value; `write(value)` turns the
// value back into a string, String by default, and must be stable (a module
// level function). Returns [value, change]: change sets the state and stores
// it. Storage that is off or full keeps the change for this session only.
export function usePersistentSetting(key, read, write = String) {
  const [value, setValue] = useState(() => {
    let raw = null
    try { raw = localStorage.getItem(key) } catch { /* storage off */ }
    return read(raw)
  })
  const change = useCallback((next) => {
    setValue(next)
    try { localStorage.setItem(key, write(next)) } catch { /* storage off */ }
  }, [key, write])
  return [value, change]
}

// Readers for the common shapes.
// On unless explicitly turned off, so a setting added later starts on.
export const onByDefault = (raw) => raw !== 'false'
export const orDefault = (fallback) => (raw) => raw ?? fallback
