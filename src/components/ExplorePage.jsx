import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft, ChevronRight, Compass, Flame, LoaderCircle, RefreshCw, Snowflake, Wind,
} from 'lucide-react'
import { WeatherIcon } from './WeatherIcon'
import { getWeatherInfo, toTemp } from '../utils/weatherCodes'
import { formatWind } from '../utils/units'
import { alertPlace, CATEGORIES, ExploreLimitError, fetchLiveConditions, fetchNotableAlerts, PLACES } from '../utils/explore'
import './ExplorePage.css'

// Explore the weather: the easter egg behind three taps on "Alek Studios" in
// Settings. Full screen over everything but Help. It sweeps a list of places
// around the world for anything happening right now (utils/explore.js), and
// lists the notable NWS alerts in force across the US. Any place on it opens
// that place's forecast (onGo).

const CAT = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]))
const ALERTS_SHOWN = 5

let regionNames = null
function countryName(code) {
  try {
    regionNames ??= new Intl.DisplayNames(['en'], { type: 'region' })
    return regionNames.of(code) ?? code
  } catch {
    return code
  }
}

const placeLine = (p) => (p.country_code === 'US' ? p.admin1 : countryName(p.country_code))

function endsText(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(+d)) return null
  const today = d.toDateString() === new Date().toDateString()
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return `Until ${today ? time : `${d.toLocaleDateString('en-US', { weekday: 'short' })} ${time}`}`
}

function areaText(areas) {
  if (!areas.length) return ''
  const shown = areas.slice(0, 2).join(', ')
  return areas.length > 2 ? `${shown} +${areas.length - 2} more` : shown
}

// One request's state: { status: 'loading' | 'ok' | 'error', data }.
// Starts loading on mount; `reload` marks it loading again (keeping what it
// had on screen) and fetches afresh.
function useLoad(load) {
  const [state, setState] = useState({ status: 'loading', data: null })
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let live = true
    load().then(
      (data) => { if (live) setState({ status: 'ok', data }) },
      (error) => { if (live) setState((s) => ({ status: 'error', data: s.data, error })) },
    )
    return () => { live = false }
  }, [load, tick])
  const reload = useCallback(() => {
    setState((s) => ({ status: 'loading', data: s.data }))
    setTick((t) => t + 1)
  }, [])
  return [state, reload]
}

function SectionError({ text, onRetry }) {
  return (
    <div className="explore-empty explore-empty--error" role="alert">
      <span>{text}</span>
      <button type="button" className="explore-retry" onClick={onRetry}>Try again</button>
    </div>
  )
}

function Skeleton({ rows = 4 }) {
  return (
    <div className="explore-skeleton" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => <span key={i} style={{ '--i': i }} />)}
    </div>
  )
}

// A place where something is happening now.
function EventCard({ reading, unit, units, onGo }) {
  const { place, current, event } = reading
  const info = getWeatherInfo(current.weather_code, !current.is_day)
  const cat = CAT[event.category]
  return (
    <button
      type="button"
      className="explore-card explore-event"
      style={{ '--tint': cat.tint }}
      onClick={() => onGo(place)}
    >
      <span className="explore-event-top">
        <span className="explore-badge">{event.label}</span>
        <span className="explore-event-temp">{toTemp(current.temperature_2m, unit)}°</span>
      </span>
      <span className="explore-event-icon"><WeatherIcon id={info.icon} alt="" /></span>
      <span className="explore-event-name">{place.name}</span>
      <span className="explore-event-where">{placeLine(place)}</span>
      {current.wind_gusts_10m != null && current.wind_gusts_10m >= 20 && (
        <span className="explore-event-meta">Gusts {formatWind(current.wind_gusts_10m, units)}</span>
      )}
    </button>
  )
}

const EXTREMES = [
  { key: 'hottest', label: 'Hottest', Icon: Flame, tint: '#ff6a3d', category: 'heat' },
  { key: 'coldest', label: 'Coldest', Icon: Snowflake, tint: '#8fd3ff', category: 'winter' },
  { key: 'windiest', label: 'Windiest', Icon: Wind, tint: '#5fd4b0', category: 'wind' },
]

function Extremes({ extremes, unit, units, filter, onGo }) {
  const shown = EXTREMES.filter((x) => extremes[x.key] && (filter === 'all' || filter === x.category))
  if (!shown.length) return null
  return (
    <div className="explore-extremes">
      {shown.map(({ key, label, Icon, tint }) => {
        const { place, current } = extremes[key]
        const value = key === 'windiest'
          ? formatWind(current.wind_gusts_10m, units)
          : `${toTemp(current.temperature_2m, unit)}°`
        return (
          <button key={key} type="button" className="explore-card explore-extreme" style={{ '--tint': tint }} onClick={() => onGo(place)}>
            <span className="explore-extreme-label"><Icon size={14} aria-hidden="true" />{label}</span>
            <span className="explore-extreme-value">{value}</span>
            <span className="explore-extreme-place">{place.name}, {placeLine(place)}</span>
          </button>
        )
      })}
    </div>
  )
}

function AlertRow({ alert, pending, onOpen }) {
  const ends = endsText(alert.ends)
  return (
    <li>
      <button type="button" className={`explore-alert explore-alert--t${alert.tier}`} onClick={() => onOpen(alert)} disabled={pending}>
        <span className="explore-alert-bar" aria-hidden="true" />
        <span className="explore-alert-text">
          <span className="explore-alert-event">{alert.event}</span>
          <span className="explore-alert-area">
            {areaText(alert.areas)}{alert.states.length ? ` · ${alert.states.join(', ')}` : ''}
          </span>
          {(ends || alert.office) && (
            <span className="explore-alert-meta">{[ends, alert.office].filter(Boolean).join(' · ')}</span>
          )}
        </span>
        {pending
          ? <LoaderCircle size={18} className="explore-spin" aria-label="Finding the place" />
          : <ChevronRight size={18} className="explore-chevron" aria-hidden="true" />}
      </button>
    </li>
  )
}

function AlertGroup({ category, alerts, pendingId, onOpen }) {
  const [all, setAll] = useState(false)
  const cat = CAT[category]
  const warnings = alerts.filter((a) => a.tier === 0).length
  const shown = all ? alerts : alerts.slice(0, ALERTS_SHOWN)
  return (
    <div className="explore-card explore-group" style={{ '--tint': cat.tint }}>
      <div className="explore-group-head">
        <span className="explore-dot" aria-hidden="true" />
        <span className="explore-group-name">{cat.label}</span>
        <span className="explore-group-count">
          {alerts.length} {alerts.length === 1 ? 'alert' : 'alerts'}
          {warnings > 0 && `, ${warnings} ${warnings === 1 ? 'warning' : 'warnings'}`}
        </span>
      </div>
      <ul className="explore-alerts">
        {shown.map((a) => <AlertRow key={a.id} alert={a} pending={pendingId === a.id} onOpen={onOpen} />)}
      </ul>
      {alerts.length > ALERTS_SHOWN && (
        <button type="button" className="explore-more" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all ${alerts.length}`}
        </button>
      )}
    </div>
  )
}

export function ExplorePage({ unit, units, onClose, onGo }) {
  const [live, reloadLive] = useLoad(fetchLiveConditions)
  const [nws, reloadNws] = useLoad(fetchNotableAlerts)
  const [filter, setFilter] = useState('all')
  const [pendingId, setPendingId] = useState(null)
  const [placeError, setPlaceError] = useState(null)

  const events = useMemo(() => live.data?.events ?? [], [live.data])
  const alerts = useMemo(() => nws.data ?? [], [nws.data])

  const counts = useMemo(() => {
    const c = Object.fromEntries(CATEGORIES.map((x) => [x.id, 0]))
    for (const e of events) c[e.event.category]++
    for (const a of alerts) c[a.category]++
    return c
  }, [events, alerts])

  const shownEvents = filter === 'all' ? events : events.filter((e) => e.event.category === filter)
  const groups = CATEGORIES
    .filter((c) => filter === 'all' || filter === c.id)
    .map((c) => [c.id, alerts.filter((a) => a.category === c.id)])
    .filter(([, list]) => list.length)

  const openAlert = async (alert) => {
    setPlaceError(null)
    setPendingId(alert.id)
    try {
      const place = await alertPlace(alert)
      if (place) onGo(place)
      else setPlaceError('That alert has no area on the map to open.')
    } catch {
      setPlaceError('Couldn’t find that alert’s area. Check your connection and try again.')
    } finally {
      setPendingId(null)
    }
  }

  const refreshing = live.status === 'loading' || nws.status === 'loading'
  const refresh = () => { reloadLive(); reloadNws() }
  const total = events.length + alerts.length

  return (
    <div className="explore" role="dialog" aria-modal="true" aria-label="Explore the weather">
      <header className="help-page-header explore-bar">
        <button type="button" className="back-btn help-back" onClick={onClose} aria-label="Back">
          <ArrowLeft size={18} aria-hidden="true" />
          <span>Back</span>
        </button>
        <span className="help-page-title">
          <Compass size={18} aria-hidden="true" />
          Explore
        </span>
        <button
          type="button"
          className={`header-icon-btn explore-refresh${refreshing ? ' is-spinning' : ''}`}
          onClick={refresh}
          disabled={refreshing}
          aria-label="Refresh"
        >
          <RefreshCw size={18} />
        </button>
      </header>

      <div className="explore-scroll">
        <div className="explore-inner">
          <p className="explore-lede">
            Storms, snow and extremes around the world right now, and the notable alerts in force
            across the US. Tap a place to open its forecast.
          </p>
          <div className="explore-chips" role="group" aria-label="Show">
            <button
              type="button"
              className={`explore-chip${filter === 'all' ? ' is-on' : ''}`}
              aria-pressed={filter === 'all'}
              onClick={() => setFilter('all')}
            >
              All <span className="explore-chip-count">{total}</span>
            </button>
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`explore-chip${filter === c.id ? ' is-on' : ''}${counts[c.id] ? '' : ' is-empty'}`}
                style={{ '--tint': c.tint }}
                aria-pressed={filter === c.id}
                onClick={() => setFilter(filter === c.id ? 'all' : c.id)}
              >
                <span className="explore-dot" aria-hidden="true" />
                {c.label}
                <span className="explore-chip-count">{counts[c.id]}</span>
              </button>
            ))}
          </div>

          <section className="explore-section" aria-labelledby="explore-now">
            <h2 id="explore-now" className="section-label explore-section-label">
              HAPPENING NOW
              <span>{live.data?.checked ?? PLACES.length} places checked</span>
            </h2>
            {live.status === 'loading' && !live.data ? (
              <Skeleton rows={6} />
            ) : live.status === 'error' && !live.data ? (
              live.error instanceof ExploreLimitError ? (
                <div className="explore-empty explore-empty--error" role="alert">
                  The free weather service&apos;s request limit is used up for now, so the world check is
                  resting. Your own forecasts aren&apos;t affected. Try again in about half an hour.
                </div>
              ) : (
                <SectionError text="Couldn’t check the world’s weather right now." onRetry={reloadLive} />
              )
            ) : (
              <>
                {shownEvents.length ? (
                  <div className="explore-events">
                    {shownEvents.map((r) => (
                      <EventCard key={r.place.name} reading={r} unit={unit} units={units} onGo={onGo} />
                    ))}
                  </div>
                ) : (
                  <div className="explore-empty">
                    {filter === 'all'
                      ? 'Quiet skies everywhere on the list right now. Check back in a bit.'
                      : `Nothing like that at any of the ${live.data.checked} places right now.`}
                  </div>
                )}
                <Extremes extremes={live.data.extremes} unit={unit} units={units} filter={filter} onGo={onGo} />
              </>
            )}
          </section>

          <section className="explore-section" aria-labelledby="explore-alerts">
            <h2 id="explore-alerts" className="section-label explore-section-label">
              US ALERTS
              <span>National Weather Service</span>
            </h2>
            {placeError && <div className="explore-empty explore-empty--error" role="alert">{placeError}</div>}
            {nws.status === 'loading' && !nws.data ? (
              <Skeleton rows={5} />
            ) : nws.status === 'error' && !nws.data ? (
              <SectionError text="Couldn’t reach the National Weather Service." onRetry={reloadNws} />
            ) : groups.length ? (
              groups.map(([id, list]) => (
                <AlertGroup key={id} category={id} alerts={list} pendingId={pendingId} onOpen={openAlert} />
              ))
            ) : (
              <div className="explore-empty">
                {filter === 'all' ? 'No notable alerts anywhere in the US right now.' : 'No alerts of that kind in force right now.'}
              </div>
            )}
          </section>

          <p className="explore-foot">
            Conditions from Open-Meteo, alerts from the National Weather Service. Alek Studios&#8482;
          </p>
        </div>
      </div>
    </div>
  )
}
