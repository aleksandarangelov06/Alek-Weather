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
export function WebTabs({
  tabs, active, onChange,
  idPrefix = 'web-tab', controls, label = 'Forecast pages', className = '',
}) {
  const listRef = useRef(null)
  const btnRefs = useRef({})
  const [pill, setPill] = useState(null)
  // Withheld until after the first measurement so the pill doesn't slide in
  // from the left edge on mount.
  const [ready, setReady] = useState(false)

  useLayoutEffect(() => {
    const measure = () => {
      const el = btnRefs.current[active]
      if (!el) return
      setPill({ left: el.offsetLeft, width: el.offsetWidth })
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
      </div>
    </div>
  )
}
