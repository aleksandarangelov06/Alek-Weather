import { useLayoutEffect, useRef, useState } from 'react'

// The web app's page selector: one rounded bar holding every tab, with a filled
// pill that slides to whichever is active. The pill is a single positioned
// element rather than a background on each button so the move between tabs is
// animated rather than a hard swap.
export function WebTabs({ tabs, active, onChange }) {
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

  const move = (delta) => {
    const i = tabs.findIndex((t) => t.id === active)
    onChange(tabs[(i + delta + tabs.length) % tabs.length].id)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); move(1) }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); move(-1) }
    else if (e.key === 'Home') { e.preventDefault(); onChange(tabs[0].id) }
    else if (e.key === 'End') { e.preventDefault(); onChange(tabs[tabs.length - 1].id) }
  }

  return (
    <div className="web-tabs-wrap">
      <div className="web-tabs card" role="tablist" aria-label="Forecast pages" ref={listRef} onKeyDown={handleKeyDown}>
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
            id={`web-tab-${t.id}`}
            aria-selected={t.id === active}
            aria-controls={`web-panel-${t.id}`}
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
