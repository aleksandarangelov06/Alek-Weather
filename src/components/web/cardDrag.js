import { useEffect, useLayoutEffect, useRef, useState } from 'react'

// The drag engine behind the card grids on Today and Details.
//
// Plain pointer events rather than a drag library: the page decides what a
// drop means from where the pointer is (between rows, beside a card, on a
// card), and nothing moves until the drop, so all the engine has to do is
// track the pointer, ask the page what it's over, scroll near the window edges,
// and animate the cards to their new places afterwards.
//
// A drag starts only from a card's grip (see DragHandle), after a few pixels
// of travel, so a click on the grip stays a click. Escape cancels.

const THRESHOLD = 4
const SCROLL_EDGE = 80

// Every card in the grid that is actually on screen, with its box.
export function cardRects(container) {
  const out = []
  container?.querySelectorAll('[data-card-id]').forEach((el) => {
    const rect = el.getBoundingClientRect()
    if (rect.width && rect.height) out.push({ id: el.dataset.cardId, rect, el })
  })
  return out
}

// The card under (or nearest to) a point.
export function cardAt(cards, x, y) {
  let best = null
  let bestD = Infinity
  for (const c of cards) {
    const r = c.rect
    const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0
    const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0
    const d = dx * dx + dy * dy
    if (d < bestD) { bestD = d; best = c }
  }
  return best
}

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// resolve(id, x, y, cards) → target or null. A target carries `box`, the
//   indicator to draw: { kind: 'line', left, right, y, label } or
//   { kind: 'zone', left, top, width, height, label }.
// onDrop(id, target) applies it.
export function useCardDrag({ containerRef, resolve, onDrop }) {
  const [drag, setDrag] = useState(null) // { id, x, y, target }
  const session = useRef(null)
  const flipFrom = useRef(null)
  const latest = useRef({ resolve, onDrop })
  useLayoutEffect(() => { latest.current = { resolve, onDrop } })

  const compute = (st) => {
    st.target = latest.current.resolve(st.id, st.x, st.y, cardRects(containerRef.current))
    setDrag({ id: st.id, x: st.x, y: st.y, target: st.target })
  }

  const end = (commit) => {
    const st = session.current
    if (!st) return
    st.cleanup()
    session.current = null
    if (commit && st.started && st.target) {
      // Remember where every card was, so they can glide from there once the
      // new layout has rendered.
      flipFrom.current = new Map(cardRects(containerRef.current).map((c) => [c.id, c.rect]))
      latest.current.onDrop(st.id, st.target)
    }
    setDrag(null)
  }

  const start = (e, id) => {
    if (e.button !== 0 || session.current) return
    e.preventDefault()
    const st = { id, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, started: false, target: null, raf: 0 }

    // Scrolls the page while the pointer is near the top or bottom of the
    // window, faster the closer it gets, so a card can travel the whole page.
    const tick = () => {
      const h = window.innerHeight
      const v = st.y < SCROLL_EDGE ? -(SCROLL_EDGE - st.y) / 3
        : st.y > h - SCROLL_EDGE ? (st.y - (h - SCROLL_EDGE)) / 3 : 0
      if (v) window.scrollBy(0, v)
      st.raf = requestAnimationFrame(tick)
    }

    const move = (ev) => {
      st.x = ev.clientX
      st.y = ev.clientY
      if (!st.started) {
        if (Math.hypot(st.x - st.x0, st.y - st.y0) < THRESHOLD) return
        st.started = true
        document.body.classList.add('web-dragging')
        st.raf = requestAnimationFrame(tick)
      }
      compute(st)
    }
    const up = () => end(true)
    const cancel = () => end(false)
    const key = (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); end(false) } }
    const scrolled = () => { if (st.started) compute(st) }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', key, true)
    window.addEventListener('scroll', scrolled, { passive: true })
    st.cleanup = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('scroll', scrolled)
      cancelAnimationFrame(st.raf)
      document.body.classList.remove('web-dragging')
    }
    session.current = st
  }

  useEffect(() => () => session.current?.cleanup(), [])

  // After a drop has re-rendered the grid: start each moved card where it used
  // to be and let it glide into its new place.
  useLayoutEffect(() => {
    const before = flipFrom.current
    if (!before) return
    flipFrom.current = null
    if (reducedMotion()) return
    for (const c of cardRects(containerRef.current)) {
      const b = before.get(c.id)
      if (!b) continue
      const dx = b.left - c.rect.left
      const dy = b.top - c.rect.top
      if (Math.abs(dx) + Math.abs(dy) < 1) continue
      c.el.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
        { duration: 320, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
      )
    }
  })

  return { drag, start, markMoved: () => { flipFrom.current = new Map(cardRects(containerRef.current).map((c) => [c.id, c.rect])) } }
}
