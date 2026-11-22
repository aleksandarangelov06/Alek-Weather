// Holds a phone page's opening transition (App.css, "Page transition") on its
// first frame through the frame it mounts in. That frame lays out and paints
// the whole page, so an animation started on it loses its opening frames to
// that work and visibly jumps ahead. Two rAFs, because the first still runs
// ahead of the paint; the second is the first frame with the page painted and
// ready to move. Call it from a layout effect, so the hold is on before the
// browser paints anything. Returns the cleanup.
//
// The class is written straight onto the node: React owns className on these
// elements, but it only rewrites it when its own value changes, which nothing
// does within two frames of mounting.
export function armPageTransition(el) {
  if (!el) return () => {}
  el.classList.add('pt-arming')
  let second = 0
  const first = requestAnimationFrame(() => {
    second = requestAnimationFrame(() => el.classList.remove('pt-arming'))
  })
  return () => {
    cancelAnimationFrame(first)
    cancelAnimationFrame(second)
    el.classList.remove('pt-arming')
  }
}
