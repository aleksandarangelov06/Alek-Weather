import { useEffect, useRef, useState } from 'react'
import { Bookmark, House, Navigation, Search, Trash2 } from 'lucide-react'
import { WeatherIcon } from './WeatherIcon'
import { useCityConditions, conditionKey } from '../hooks/useCityConditions'
import { getWeatherInfo, toTemp } from '../utils/weatherCodes'

// Two, where the desktop splash shows six: the phone splash is a poster with a
// centred wordmark, and these sit in the strip left between it and the version
// line. A second row would either crowd the wordmark or need scrolling, and the
// point of them is to be a glance, not a list.
const MAX_CARDS = 2

// Holding a card this long opens its menu. Close to the platform long-press
// (Android's is 400ms, iOS context menus about 500ms): long enough that a slow
// tap still opens the city, short enough not to feel like waiting.
const HOLD_MS = 450
// A finger that drifts further than this before the hold lands is a swipe or a
// change of mind, not a hold.
const HOLD_SLOP_PX = 10

// The phone splash is one big tap-anywhere-to-search target; this is the one
// thing on it you tap *at*. It gives the phone the same shortcut the desktop
// splash has — the last places you opened, with their current conditions, one
// tap from the forecast — without taking the poster apart. Recents are the
// list; saved cities stand in only when a city was saved but never searched
// (the recents list was cleared, say), matching SplashHome.
//
// With no place saved (and so nothing that opens on launch), the poster also
// carries a search pill above the cards: on a first run it is the obvious way
// in, where otherwise the only route to search was the corner button.
//
// Holding a card (or right-clicking it, or the context-menu key) pops a small
// menu above it: set or clear it as home, save or unsave it, and remove it
// from the strip. While the menu is up a scrim covers the rest of the screen,
// so a tap anywhere else only closes it rather than also opening whatever was
// under the finger.
export function SplashCities({
  recents, savedCities, unit, exiting, entering, busy, onSelect, isHome, onSearch,
  isSaved, onSave, onUnsave, onSetHome, onClearHome, onRemoveRecent,
}) {
  // The splash covers the loading skeleton underneath it, so the card that was
  // tapped carries the spinner — otherwise picking a city looks like nothing
  // happened until the forecast lands. Only ever read alongside `busy`, so a
  // value left over from a finished fetch marks nothing.
  const [pending, setPending] = useState(null)
  // The card whose menu is open, by conditionKey.
  const [menuKey, setMenuKey] = useState(null)

  const holdTimer = useRef(null)
  const holdStart = useRef(null)
  // Set when a hold opened the menu, so the click the release sends afterwards
  // doesn't also open the city.
  const didHold = useRef(false)

  const fromRecents = recents.length > 0
  const cities = (fromRecents ? recents : savedCities).slice(0, MAX_CARDS)
  const conditions = useCityConditions(cities)

  // Derived rather than cleared in an effect: a card that left the strip (it
  // was just removed) or a splash that is loading or leaving has no menu.
  const menuCity = menuKey && !busy && !exiting && !entering
    ? cities.find(c => conditionKey(c) === menuKey) ?? null
    : null

  useEffect(() => {
    if (!menuCity) return
    const onKey = (e) => { if (e.key === 'Escape') setMenuKey(null) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [menuCity])

  useEffect(() => () => clearTimeout(holdTimer.current), [])

  if (!cities.length && !onSearch) return null

  const openCity = (city) => {
    setPending(conditionKey(city))
    onSelect(city)
  }

  const openMenu = (key) => {
    setMenuKey(key)
    navigator.vibrate?.(15)
  }

  const cancelHold = () => {
    clearTimeout(holdTimer.current)
    holdStart.current = null
  }

  const startHold = (e, key) => {
    didHold.current = false
    // Primary button only: a right-click goes through onContextMenu instead.
    if (e.pointerType === 'mouse' && e.button !== 0) return
    holdStart.current = { x: e.clientX, y: e.clientY }
    clearTimeout(holdTimer.current)
    holdTimer.current = setTimeout(() => {
      didHold.current = true
      holdStart.current = null
      openMenu(key)
    }, HOLD_MS)
  }

  const moveHold = (e) => {
    const start = holdStart.current
    if (!start) return
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > HOLD_SLOP_PX) cancelHold()
  }

  const handleClick = (city, key) => {
    if (didHold.current) { didHold.current = false; return }
    // A tap on the lifted card puts the menu away rather than opening the city
    // out from under it.
    if (menuCity && menuKey === key) { setMenuKey(null); return }
    openCity(city)
  }

  // Right-click, the context-menu key, and on Android the browser's own
  // long-press, which can land before HOLD_MS does.
  const handleContextMenu = (e, key) => {
    e.preventDefault()
    // A press still in progress is a touch hold the browser beat us to: its
    // release must not count as a tap. (A right-click never started one.)
    if (holdStart.current) didHold.current = true
    cancelHold()
    if (!(menuCity && menuKey === key)) openMenu(key)
  }

  const runAction = (action) => {
    setMenuKey(null)
    action()
  }

  const renderMenu = (city, alignEnd) => {
    const home = isHome?.(city)
    const saved = isSaved?.(city)
    return (
      <div
        className={`splash-menu${alignEnd ? ' splash-menu--end' : ''}`}
        role="menu"
        aria-label={`${city.name} options`}
      >
        <button
          className="splash-menu-item"
          role="menuitem"
          onClick={() => runAction(() => (home ? onClearHome() : onSetHome(city)))}
        >
          <House size={17} aria-hidden="true" fill={home ? 'currentColor' : 'none'} />
          <span>{home ? 'Remove home' : 'Set as home'}</span>
        </button>
        {/* When the strip is showing saved cities, removing a card already
            unsaves it, so a separate save toggle would only repeat Remove. */}
        {fromRecents && (
          <button
            className="splash-menu-item"
            role="menuitem"
            onClick={() => runAction(() => (saved ? onUnsave(city) : onSave(city)))}
          >
            <Bookmark size={17} aria-hidden="true" fill={saved ? 'currentColor' : 'none'} />
            <span>{saved ? 'Remove from saved' : 'Save'}</span>
          </button>
        )}
        <button
          className="splash-menu-item splash-menu-item--danger"
          role="menuitem"
          onClick={() => runAction(() => (fromRecents ? onRemoveRecent(city) : onUnsave(city)))}
        >
          <Trash2 size={17} aria-hidden="true" />
          <span>Remove</span>
        </button>
      </div>
    )
  }

  return (
    <>
      {menuCity && (
        <div
          className="splash-mini-scrim"
          aria-hidden="true"
          onClick={() => setMenuKey(null)}
          onContextMenu={(e) => e.preventDefault()}
        />
      )}
      <div className={`splash-mini${exiting ? ' splash-mini--exit' : ''}${entering ? ' splash-mini--enter' : ''}${busy ? ' splash-mini--busy' : ''}${menuCity ? ' splash-mini--menu' : ''}`}>
        {onSearch && (
          <button className="splash-mini-card splash-mini-search" onClick={onSearch}>
            <Search size={18} aria-hidden="true" />
            <span>Search for a city</span>
          </button>
        )}
        {cities.length > 0 && (
        <div className="splash-mini-row">
        {cities.map((city, i) => {
          const key = conditionKey(city)
          const cond = conditions[key]
          const info = cond ? getWeatherInfo(cond.code, !cond.isDay, cond.severe) : null
          const home = isHome?.(city)
          const opening = busy && pending === key
          const menuOpen = menuCity != null && menuKey === key
          return (
            <div className={`splash-mini-slot${menuOpen ? ' splash-mini-slot--open' : ''}`} key={key}>
              {menuOpen && renderMenu(city, cities.length > 1 && i === cities.length - 1)}
              <button
                className={`splash-mini-card${opening ? ' splash-mini-card--opening' : ''}${menuOpen ? ' splash-mini-card--held' : ''}`}
                onClick={() => handleClick(city, key)}
                onPointerDown={(e) => startHold(e, key)}
                onPointerMove={moveHold}
                onPointerUp={cancelHold}
                onPointerCancel={cancelHold}
                onContextMenu={(e) => handleContextMenu(e, key)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
              >
                <span className="splash-mini-name">
                  {home && <House size={13} className="splash-mini-home" aria-label="Home" />}
                  <span className="splash-mini-name-text">{city.name}</span>
                  {/* The most recent place is the one the splash's sky, icon and
                      headline are showing (see useLocalConditions) — the same mark
                      the desktop splash puts on its card. */}
                  {fromRecents && i === 0 && (
                    <Navigation size={13} className="splash-mini-here" aria-label="Showing this weather" />
                  )}
                </span>
                {/* Cities stored from a search keep the country code on `country`,
                    not `country_code` — fall back to it. */}
                <span className="splash-mini-sub">
                  {[city.admin1, city.country_code ?? city.country].filter(Boolean).join(', ') || ' '}
                </span>
                <span className="splash-mini-now">
                  {opening ? (
                    <span className="spinner splash-mini-spinner" role="status" aria-label="Loading" />
                  ) : (
                    <>
                      {info && (
                        <span className="splash-mini-icon">
                          <WeatherIcon id={info.icon} alt={info.label} />
                        </span>
                      )}
                      <span className={`splash-mini-temp${cond ? '' : ' splash-mini-temp--unknown'}`}>
                        {cond ? `${toTemp(cond.temp, unit)}°` : '-'}
                      </span>
                    </>
                  )}
                </span>
              </button>
            </div>
          )
        })}
        </div>
        )}
      </div>
    </>
  )
}
