import { useState, useCallback } from 'react'
import { getPermission, requestPermission } from '../utils/notifications'

const NOTIFY_KEY = 'alek-weather-notify'
const NOTIFY_TYPES_KEY = 'alek-weather-notify-types'
export const DEFAULT_TYPES = ['rain', 'alerts', 'tomorrow']

export function useNotifications() {
  const [notifyEnabled, setNotifyEnabled] = useState(() =>
    localStorage.getItem(NOTIFY_KEY) === 'on'
  )
  const [notifyTypes, setNotifyTypes] = useState(() => {
    try {
      const stored = localStorage.getItem(NOTIFY_TYPES_KEY)
      return stored ? JSON.parse(stored) : DEFAULT_TYPES
    } catch { return DEFAULT_TYPES }
  })
  const [permission, setPermission] = useState(() => getPermission())

  const toggleNotifyEnabled = useCallback(async (enabled) => {
    if (enabled) {
      const perm = await requestPermission()
      setPermission(perm)
      if (perm === 'granted') {
        setNotifyEnabled(true)
        localStorage.setItem(NOTIFY_KEY, 'on')
      }
    } else {
      setNotifyEnabled(false)
      localStorage.setItem(NOTIFY_KEY, 'off')
    }
  }, [])

  const toggleType = useCallback((type) => {
    setNotifyTypes(prev => {
      const next = prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
      localStorage.setItem(NOTIFY_TYPES_KEY, JSON.stringify(next))
      return next
    })
  }, [])

  return { notifyEnabled, notifyTypes, permission, toggleNotifyEnabled, toggleType }
}
