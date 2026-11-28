import { useEffect, useMemo, useState } from 'react'
import { activeAlerts, stormCenterState } from '../utils/stormCenter'
import { currentHourIndex } from '../components/web/webData'

// The Storm Center's state for the place on screen (stormCenterState), held
// steady: once it is on, a lull of one radar frame or one nowcast cycle no
// longer flips the whole web Home page back and forth. It stays at its
// strongest for HOLD_MS after the weather eases, then follows the forecast.
const HOLD_MS = 45 * 60 * 1000
const rank = (s) => (s?.mode === 'live' ? 2 : s ? 1 : 0)

// Re-renders every minute, so alerts drop off when they end and the hour
// moves on without waiting for the next refresh.
function useMinuteClock() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60000)
    return () => clearInterval(id)
  }, [])
  return now
}

// { state, alerts }: the state (null when there is nothing), and the alerts
// still in effect, which the page should be given in place of the raw feed.
export function useStormCenter({ weather, alerts, liveCode, placeKey }) {
  const now = useMinuteClock()
  const current = useMemo(() => activeAlerts(alerts, now), [alerts, now])
  const raw = useMemo(() => (weather
    ? stormCenterState({ weather, alerts: current, liveCode, start: currentHourIndex(weather.hourly, weather.timezone) })
    : null), [weather, current, liveCode])

  // { state, key, droppedAt }: the strongest state lately, and when (by the
  // minute clock) the weather fell below it, null while it hasn't. Adjusted
  // during render whenever the reading changes, so there is no frame where
  // the page drops out before the hold catches it.
  const [held, setHeld] = useState(null)
  const [seen, setSeen] = useState(null)
  const live = (h) => h && h.key === placeKey && (h.droppedAt == null || now - h.droppedAt < HOLD_MS)
  const sig = `${placeKey}#${raw ? `${raw.mode}|${raw.kind}|${raw.label}|${raw.level.index}` : ''}`
  if (sig !== seen) {
    setSeen(sig)
    const h = live(held) ? held : null
    if (raw && (!h || rank(raw) >= rank(h.state))) setHeld({ state: raw, key: placeKey, droppedAt: null })
    else if (h && h.droppedAt == null) setHeld({ ...h, droppedAt: now })
    else if (!h) setHeld(null)
  }

  // The minute clock lets go of it once the hold is up.
  const holding = live(held) && rank(held.state) > rank(raw)
  return { state: holding ? held.state : raw, alerts: current }
}

// Whether the Storm Center page is the one showing on the web Home. Live
// storms open it, storms ahead offer it (a banner over the forecast), and
// either can be switched. The choice lasts until the storm gets worse: a
// higher mode or level brings the default back.
export function useStormView(state, placeKey) {
  const [choice, setChoice] = useState(null) // { key, rank, level, open }
  const r = rank(state)
  const level = state?.level.index ?? 0
  const applies = !!choice && choice.key === placeKey && r <= choice.rank && level <= choice.level
  const open = !!state && (applies ? choice.open : state.mode === 'live')
  const setOpen = (value) => setChoice({ key: placeKey, rank: r, level, open: value })
  return [open, setOpen]
}
