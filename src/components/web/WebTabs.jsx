import { useLayoutEffect, useRef, useState } from 'react'

// The web app's page selector: one rounded bar holding every tab, with a filled
// pill that slides to whichever is active. The pill is a single positioned
// element rather than a background on each button so the move between tabs is
// animated rather than a hard swap.
//
// Also the Hourly page's reading menu, which is the same control in a different
// place — hence the id and label props. `controls` is for the case where every
// tab points at one region that changes contents (the hourly table) rather than
// at a panel per tab; a tab may carry `disabled` when its reading has no data.
//
// `home` ({ label, icon, onSelect }) is drawn inside the bar ahead of the tabs
// without being one — the forecast bar's Home button, which leaves the forecast
// for the splash rather than switching page. It takes the pill when `active` is
// 'home' (the splash keeps this bar up, with Home selected), but it is kept out
// of `tabs` so the arrow keys, which wrap around the tab list, can never land
// on it: ← from the first page would otherwise throw you out to the splash.
//
// `pages` ([{ id, label, icon, onSelect }]) are the same idea at the other end
// of the bar: Locations and Settings, which are pages of the app rather than of
// the forecast. They take the pill like any tab, but sit apart from the forecast
// pages (after a divider) and outside the arrow-key cycle for the same reason
// Home does — they don't need a forecast, and the forecast tabs do.
export function WebTabs({
  tabs, active, onChange, home = null, pages = [], lead = null,
  idPrefix = 'web-tab', controls, label = 'Forecast pages', className = '',
}) {
  const listRef = useRef(null)
  const btnRefs = useRef({})
  const [pill, setPill] = useState(null)
  // Withheld until after the first measurement so the pill doesn't slide in
  // from the left edge on mount.
  const [ready, setReady] = useState(false)

  // Whether a measurement has already run, for the scroll below: the first one
  // lands the active tab without animating, later ones slide to it. `ready`
  // says the same thing but is state, so reading it here would re-run the
  // effect for no reason.
  const measuredRef = useRef(false)

  useLayoutEffect(() => {
    const measure = () => {
      const el = btnRefs.current[active]
      if (!el) return
      setPill({ left: el.offsetLeft, width: el.offsetWidth })
      // Too narrow for every tab (a phone-width window), so the bar scrolls:
      // centre the active one rather than leave the selection off the edge.
      // Done by hand instead of scrollIntoView, which would also scroll the
      // page to bring the header into view.
      const list = listRef.current
      if (list && list.scrollWidth > list.clientWidth) {
        list.scrollTo({
          left: Math.max(0, el.offsetLeft - (list.clientWidth - el.offsetWidth) / 2),
          behavior: measuredRef.current ? 'smooth' : 'auto',
        })
      }
      measuredRef.current = true
    }
    measure()
    const raf = requestAnimationFrame(() => setReady(true))
    const el = listRef.current
    if (!el) return () => cancelAnimationFrame(raf)
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => { cancelAnimationFrame(raf); ro.disconnect() }
  }, [active, tabs])

  // Arrow keys step over anything disabled rather than landing on it, so a
  // reading with no data can't become the selection by keyboard either.
  const move = (delta) => {
    const usable = tabs.filter((t) => !t.disabled)
    if (!usable.length) return
    const i = usable.findIndex((t) => t.id === active)
    onChange(usable[(i + delta + usable.length) % usable.length].id)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); move(1) }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); move(-1) }
    else if (e.key === 'Home') { e.preventDefault(); onChange(tabs[0].id) }
    else if (e.key === 'End') { e.preventDefault(); onChange(tabs[tabs.length - 1].id) }
  }

  return (
    <div className={`web-tabs-wrap${className ? ` ${className}` : ''}`}>
      <div className="web-tabs card" role="tablist" aria-label={label} ref={listRef} onKeyDown={handleKeyDown}>
        {pill && (
          <span
            className={`web-tab-pill${ready ? ' web-tab-pill--ready' : ''}`}
            style={{ transform: `translateX(${pill.left}px)`, width: pill.width }}
            aria-hidden="true"
          />
        )}
        {/* The lead slot (Locations) sits at the very start of the bar, set off
            from Home and the forecast pages by the same divider Settings gets
            at the other end. */}
        {lead && (
          <>
            <button
              type="button"
              ref={(el) => { btnRefs.current[lead.id] = el }}
              className={`web-tab web-tab--icon${active === lead.id ? ' web-tab--active' : ''}`}
              aria-current={active === lead.id ? 'page' : undefined}
              aria-label={lead.label}
              title={lead.label}
              onClick={lead.onSelect}
            >
              {lead.icon}
            </button>
            <span className="web-tabs-divider" aria-hidden="true" />
          </>
        )}
        {home && (
          <button
            type="button"
            ref={(el) => { btnRefs.current.home = el }}
            className={`web-tab web-tab--home${active === 'home' ? ' web-tab--active' : ''}`}
            aria-current={active === 'home' ? 'page' : undefined}
            onClick={home.onSelect}
          >
            {home.icon}
            {home.label}
          </button>
        )}
        {tabs.map((t) => (
          <button
            key={t.id}
            ref={(el) => { btnRefs.current[t.id] = el }}
            className={`web-tab${t.id === active ? ' web-tab--active' : ''}`}
            role="tab"
            id={`${idPrefix}-${t.id}`}
            aria-selected={t.id === active}
            aria-controls={controls ?? `web-panel-${t.id}`}
            disabled={t.disabled}
            tabIndex={t.id === active ? 0 : -1}
            onClick={() => onChange(t.id)}
          >
            {t.label}
          </button>
        ))}
        {pages.length > 0 && <span className="web-tabs-divider" aria-hidden="true" />}
        {pages.map((p) => (
          <button
            key={p.id}
            type="button"
            ref={(el) => { btnRefs.current[p.id] = el }}
            className={`web-tab web-tab--icon${active === p.id ? ' web-tab--active' : ''}`}
            aria-current={active === p.id ? 'page' : undefined}
            aria-label={p.label}
            title={p.label}
            onClick={p.onSelect}
          >
            {p.icon}
          </button>
        ))}
      </div>
    </div>
  )
}
