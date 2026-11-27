import { useEffect, useLayoutEffect, useRef, useState } from 'react'

// The web app's page selector: one rounded bar holding every tab, with a filled
// pill that slides to whichever is active. The pill is a single positioned
// element rather than a background on each button so the move between tabs is
// animated rather than a hard swap.
//
// Also the Hourly page's reading menu, which is the same control in a different
// place — hence the id and label props. `controls` is for the case where every
// tab points at one region that changes contents (the hourly table) rather than
// at a panel per tab; a tab may carry `disabled` when its reading has no data,
// and `className` / `title` for a tab dressed for the moment (the Storm Center).
//
// `pages` ([{ id, label, onSelect }]) sit at the bar's right end: Settings, a
// page of the app rather than of the forecast. It takes the pill like any tab,
// but sits apart from the forecast pages (after a divider) and outside the
// arrow-key cycle, since it doesn't need a forecast and the forecast tabs do.
//
// `brand` (a node) is drawn at the bar's left end, outside the scrolling row so
// it stays put when the tabs scroll, and set off from them by a divider. It is
// the way back to the splash, where `active` is 'home' and no tab is selected.
export function WebTabs({
  tabs, active, onChange, pages = [], brand = null,
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
    const list = listRef.current
    // Which ends of the row have tabs scrolled out of sight, for the edge
    // fades in WebApp.css. Attributes rather than state: they change on every
    // scroll frame and only CSS reads them.
    const edges = () => {
      if (!list) return
      const max = list.scrollWidth - list.clientWidth
      list.toggleAttribute('data-more-start', max > 1 && list.scrollLeft > 1)
      list.toggleAttribute('data-more-end', max > 1 && list.scrollLeft < max - 1)
    }
    const measure = () => {
      const el = btnRefs.current[active]
      // Nothing to select (the splash): no pill, rather than one left sitting
      // on whichever tab had it last.
      if (!el) { setPill(null); edges(); return }
      setPill({ left: el.offsetLeft, width: el.offsetWidth })
      // Too narrow for every tab (a phone-width window), so the bar scrolls:
      // centre the active one rather than leave the selection off the edge.
      // Done by hand instead of scrollIntoView, which would also scroll the
      // page to bring the header into view.
      if (list && list.scrollWidth > list.clientWidth) {
        list.scrollTo({
          left: Math.max(0, el.offsetLeft - (list.clientWidth - el.offsetWidth) / 2),
          behavior: measuredRef.current ? 'smooth' : 'auto',
        })
      }
      measuredRef.current = true
      edges()
    }
    measure()
    const raf = requestAnimationFrame(() => setReady(true))
    if (!list) return () => cancelAnimationFrame(raf)
    const ro = new ResizeObserver(measure)
    ro.observe(list)
    list.addEventListener('scroll', edges, { passive: true })
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      list.removeEventListener('scroll', edges)
    }
  }, [active, tabs])

  // A mouse wheel only scrolls vertically, and the row's scrollbar is hidden,
  // so with a mouse an overflowing bar had no way to reach its far tabs. Over
  // the bar, the wheel scrolls it sideways instead; once the row is at the end
  // the wheel is in, it falls through to the page as usual. A trackpad's own
  // sideways swipe (deltaX) and touch already scroll it natively, and
  // ctrl+wheel is a zoom, so those are left alone.
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const onWheel = (e) => {
      if (e.ctrlKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return
      const max = list.scrollWidth - list.clientWidth
      if (max <= 1) return
      const step = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? list.clientWidth : 1)
      if ((step < 0 && list.scrollLeft <= 0) || (step > 0 && list.scrollLeft >= max - 1)) return
      e.preventDefault()
      // A wheel notch is a big jump (about 100px): glide it like a native
      // scroll. A trackpad sends a stream of small deltas, already smooth.
      list.scrollBy({ left: step, behavior: Math.abs(step) >= 40 ? 'smooth' : 'auto' })
    }
    list.addEventListener('wheel', onWheel, { passive: false })
    return () => list.removeEventListener('wheel', onWheel)
  }, [])

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
      {/* The bar (the glass card) and, inside it, the row that scrolls. Kept
          apart so the row's edges can fade out where tabs run past them
          without fading the bar's own rim and shadow along with them. */}
      <div className="web-tabs card">
        {brand && (
          <>
            {brand}
            <span className="web-tabs-divider web-tabs-divider--brand" aria-hidden="true" />
          </>
        )}
        <div className="web-tabs-scroll" role="tablist" aria-label={label} ref={listRef} onKeyDown={handleKeyDown}>
          {pill && (
            <span
              className={`web-tab-pill${ready ? ' web-tab-pill--ready' : ''}`}
              style={{ transform: `translateX(${pill.left}px)`, width: pill.width }}
              aria-hidden="true"
            />
          )}
          {tabs.map((t) => (
            <button
              key={t.id}
              ref={(el) => { btnRefs.current[t.id] = el }}
              className={`web-tab${t.id === active ? ' web-tab--active' : ''}${t.className ? ` ${t.className}` : ''}`}
              title={t.title}
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
              className={`web-tab${active === p.id ? ' web-tab--active' : ''}`}
              aria-current={active === p.id ? 'page' : undefined}
              onClick={p.onSelect}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
