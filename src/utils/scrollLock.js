// Holds the page still under a dialog (the alert sheet, the alert's area map).
//
// The page scrolls on <html>, and <html> sets its own overflow-x, so
// `body.style.overflow = 'hidden'` (what these used to do) never reaches the
// viewport: the forecast kept scrolling behind the sheet. This puts a class on
// <html> instead (.scroll-lock in App.css, alongside .splash-lock), which also
// stops iOS rubber-banding the page. Counted, so a map opened over a sheet
// doesn't unlock the page when it closes.

let holds = 0

export function lockScroll() {
  holds += 1
  if (holds === 1) document.documentElement.classList.add('scroll-lock')
  let released = false
  return () => {
    if (released) return
    released = true
    holds -= 1
    if (holds === 0) document.documentElement.classList.remove('scroll-lock')
  }
}
