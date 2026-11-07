import { useEffect, useState } from 'react'

// Marks a detail cover whose fill has finished growing, which is what lets an
// iOS glass card have its backdrop blur back (see .detail-cover--settled in
// App.css). Set on the element directly rather than through state: the next
// className React writes — the switch to --closing — clears it, which is
// exactly when the blur should go again. Used by WeatherDetails and
// DailyForecast, the two cards with a cover.
export function markCoverSettled(e) {
  if (e.animationName === 'detailFillIn') e.currentTarget.classList.add('detail-cover--settled')
}

// Where a cover opens from (and folds back into): the tapped tile or row's box,
// as an inset() list relative to the card — the cover's own box, which is the
// card's padding box — plus the element's corner radius, so the rectangle
// starts as exactly that tile. App.css reads them as --from-inset and
// --from-radius. With nothing to measure it opens from the card's middle.
// The card is found from the element (its nearest `cardSel` ancestor).
export function coverFrom(el, cardSel) {
  const card = el?.closest?.(cardSel)
  if (!card) return { '--from-inset': '50%', '--from-radius': '12px' }
  const c = card.getBoundingClientRect()
  const r = el.getBoundingClientRect()
  const top = c.top + card.clientTop
  const left = c.left + card.clientLeft
  const t = Math.max(0, r.top - top)
  const l = Math.max(0, r.left - left)
  const rt = Math.max(0, left + card.clientWidth - r.right)
  const b = Math.max(0, top + card.clientHeight - r.bottom)
  const radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 12
  return { '--from-inset': `${t}px ${rt}px ${b}px ${l}px`, '--from-radius': `${radius}px` }
}

let coverSeq = 0
// Covers whose history.back() is in flight, so a quick double tap on the header
// doesn't send a second back before the first pop lands and spend an entry
// that isn't ours.
const backPending = new Set()

// Puts an open detail cover on the history stack, so the phone's back gesture
// (Android's, or Safari's edge swipe) closes it the way it closes the other
// overlays, and returns the function every in-app way out should call instead
// of closing directly. The pattern is AlertAreaMap's: push on the way in, and
// route every exit through history.back(), so the entry is always spent and the
// next back press doesn't land on nothing.
//
// `open` is whether a cover is up and not already closing; switching from one
// day or tile to another keeps it true, so that is one entry, not one per
// switch. `close` runs the cover's own close animation. It is read from the
// render that opened the cover, which is fine for the two callers: their close
// functions only call state setters and touch refs.
//
// The entry carries the instance's id because a pop doesn't always mean ours
// went: open settings over an open cover and back closes settings, after which
// history sits on our entry again — the cover stays. Only a pop that lands
// anywhere else closes it.
export function useCoverHistory(open, close) {
  const [id] = useState(() => `cover-${++coverSeq}`)

  useEffect(() => {
    if (!open) return
    history.pushState({ overlay: 'detailCover', coverId: id }, '')
    let popped = false
    const onPop = () => {
      backPending.delete(id)
      if (history.state?.coverId === id) return
      popped = true
      close()
    }
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
      // Unmounted with the cover still up (a new city loaded under it): spend
      // the entry so back isn't left pointing at a cover that's gone.
      if (!popped && history.state?.coverId === id) history.back()
    }
  }, [open, id]) // eslint-disable-line react-hooks/exhaustive-deps

  return () => {
    if (history.state?.coverId === id) {
      if (backPending.has(id)) return
      backPending.add(id)
      history.back()
    }
    else close()
  }
}
