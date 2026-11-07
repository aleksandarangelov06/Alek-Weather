import { useCallback, useEffect, useState } from 'react'
import { cardAt } from './cardDrag'

// The width where .web-today-grid still has its 12 columns — WebApp.css folds it
// to one column at 1279px. Below that nothing sits beside anything and every
// card renders at full size. Shared with the loading skeleton, which lays its
// placeholders out by the same rule so the page doesn't jump when data lands.
export const PAIR_MQ = '(min-width: 1280px)'

// Hours in the strip, by how much of the row the card has. Thirteen tiles fill
// a full row; beside the current card there's about three quarters of it, and
// half a row fits seven at the same tile size. The heading counts from
// whichever is in play, so it never promises hours that aren't drawn.
export const HOURS_BY_SLOT = { full: 13, wide: 9, half: 7, narrow: 5 }

export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const onChange = () => setMatches(mq.matches)
    onChange() // the width may have changed between the first render and this effect
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [query])
  return matches
}

// Today's layout is a list of rows, each holding one card (full width) or two
// side by side. It's stored as exactly that, rather than as an order that the
// page then pairs up by rule: with an implicit rule, moving one card could
// change which cards shared a row, so a drop rearranged neighbours you hadn't
// touched. Now the only cards that move are the ones you move.

const LAYOUT_KEY = 'alek-weather-today-layout'
const OLD_ORDER_KEY = 'alek-weather-today-order'

export const TODAY_IDS = ['current', 'glance', 'nowcast', 'hourly', 'week']
export const DEFAULT_LAYOUT = [['current', 'glance'], ['nowcast'], ['hourly'], ['week']]

// Repairs anything stored: unknown ids and duplicates dropped, no more than two
// per row, empty rows removed, and any card that's missing added back (the
// precipitation chart under the first row, where it has always lived).
export function normalize(rows) {
  if (!Array.isArray(rows)) return DEFAULT_LAYOUT
  const seen = new Set()
  const out = []
  for (const row of rows) {
    if (!Array.isArray(row)) continue
    const ids = row.filter((id) => TODAY_IDS.includes(id) && !seen.has(id))
    ids.forEach((id) => seen.add(id))
    for (let i = 0; i < ids.length; i += 2) out.push(ids.slice(i, i + 2))
  }
  if (!out.length) return DEFAULT_LAYOUT
  for (const id of TODAY_IDS) {
    if (seen.has(id)) continue
    if (id === 'nowcast') out.splice(Math.min(1, out.length), 0, [id])
    else out.push([id])
  }
  return out
}

// Layouts saved before rows existed were a flat order, where the current card
// shared a row with whatever followed it and the precipitation chart was fixed
// under the first row. Turned into rows once, so nobody's layout changes.
function fromOldOrder(order) {
  if (!Array.isArray(order)) return null
  const rows = []
  for (let i = 0; i < order.length; i++) {
    if (order[i] === 'current' && i + 1 < order.length) { rows.push([order[i], order[i + 1]]); i++ }
    else rows.push([order[i]])
  }
  return rows
}

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? 'null')
    if (saved) return normalize(saved)
    const old = fromOldOrder(JSON.parse(localStorage.getItem(OLD_ORDER_KEY) ?? 'null'))
    if (old) return normalize(old)
  } catch { /* corrupt storage falls through to the default */ }
  return DEFAULT_LAYOUT
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

export function useTodayLayout() {
  const [rows, setRowsState] = useState(load)
  const setRows = useCallback((next) => {
    setRowsState(next)
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(next)) } catch { /* private mode */ }
  }, [])
  const reset = useCallback(() => {
    setRowsState(DEFAULT_LAYOUT)
    try { localStorage.removeItem(LAYOUT_KEY); localStorage.removeItem(OLD_ORDER_KEY) } catch { /* private mode */ }
  }, [])
  return { rows, setRows, reset, isCustom: !same(rows, DEFAULT_LAYOUT) }
}

function find(rows, id) {
  for (let i = 0; i < rows.length; i++) {
    const j = rows[i].indexOf(id)
    if (j >= 0) return [i, j]
  }
  return null
}

// What a drop does:
//   insert  the card gets a row of its own, before or after the anchor's row
//   beside  the card joins the anchor's row, on the given side
//   swap    the two cards trade places (and so trade sizes)
export function applyDrop(rows, id, target) {
  const next = rows.map((r) => [...r])
  const from = find(next, id)
  const to = find(next, target.anchor)
  if (!from || !to) return rows

  if (target.kind === 'swap') {
    next[from[0]][from[1]] = target.anchor
    next[to[0]][to[1]] = id
    return next
  }

  next[from[0]].splice(from[1], 1)
  const compact = next.filter((r) => r.length)
  const [ri] = find(compact, target.anchor)

  if (target.kind === 'insert') {
    compact.splice(target.where === 'before' ? ri : ri + 1, 0, [id])
    return compact
  }

  // beside: anything else already in that row (a card that's hidden right now)
  // steps down to a row of its own just below, rather than being squeezed out.
  const extra = compact[ri].filter((x) => x !== target.anchor)
  compact[ri] = target.side === 'left' ? [id, target.anchor] : [target.anchor, id]
  compact.splice(ri + 1, 0, ...extra.map((x) => [x]))
  return compact
}

// The arrow keys on a card's grip: up and down move it a row at a time (on a
// row of its own), left and right switch sides with the card it's paired with.
export function keyMove(rows, visRows, id, dir) {
  const at = find(visRows, id)
  if (!at) return rows
  const [ri, ci] = at
  const row = visRows[ri]
  if (dir === 'left' || dir === 'right') {
    if (row.length < 2) return rows
    const other = row[1 - ci]
    return applyDrop(rows, id, { kind: 'beside', anchor: other, side: dir })
  }
  // Leaving a shared row first gives the card a row of its own in place.
  if (row.length > 1) {
    const other = row[1 - ci]
    return applyDrop(rows, id, { kind: 'insert', anchor: other, where: dir === 'up' ? 'before' : 'after' })
  }
  const ni = dir === 'up' ? ri - 1 : ri + 1
  if (ni < 0 || ni >= visRows.length) return rows
  return applyDrop(rows, id, { kind: 'insert', anchor: visRows[ni][0], where: dir === 'up' ? 'before' : 'after' })
}

// Works out what dropping here would do. `visRows` are the rows as drawn
// (cards with nothing to show left out); `paired` is false when the grid is a
// single column, where cards can't sit side by side.
//
//   • In the gap between rows, or near a row's top or bottom edge → a line:
//     the card gets a row of its own there.
//   • On the left or right third of a card that has its row to itself → that
//     side of the card highlights: the two will share the row.
//   • Anywhere else on a card → the card highlights: the two swap places.
export function resolveToday(rows, visRows, paired, dragId, x, y, cards) {
  const rect = Object.fromEntries(cards.map((c) => [c.id, c.rect]))
  const bands = visRows
    .map((ids) => {
      const rs = ids.map((id) => rect[id]).filter(Boolean)
      if (!rs.length) return null
      return {
        ids,
        top: Math.min(...rs.map((r) => r.top)),
        bottom: Math.max(...rs.map((r) => r.bottom)),
      }
    })
    .filter(Boolean)
  if (!bands.length) return null

  const left = Math.min(...cards.map((c) => c.rect.left))
  const right = Math.max(...cards.map((c) => c.rect.right))
  const line = (band, where, i) => {
    const prev = bands[i - 1]
    const next = bands[i + 1]
    const y = where === 'before'
      ? (prev ? (prev.bottom + band.top) / 2 : band.top - 8)
      : (next ? (band.bottom + next.top) / 2 : band.bottom + 8)
    return {
      kind: 'insert', anchor: band.ids[0], where,
      box: { kind: 'line', left, right, y, label: 'Own row here' },
    }
  }

  let target = null
  const bi = bands.findIndex((b) => y >= b.top && y <= b.bottom)
  if (bi < 0) {
    if (y < bands[0].top) target = line(bands[0], 'before', 0)
    else {
      let k = bands.length - 1
      for (let i = 0; i < bands.length - 1; i++) {
        if (y > bands[i].bottom && y < bands[i + 1].top) { k = i; break }
      }
      target = line(bands[k], 'after', k)
    }
  } else {
    const band = bands[bi]
    const edge = Math.min(56, (band.bottom - band.top) * 0.22)
    if (y < band.top + edge) target = line(band, 'before', bi)
    else if (y > band.bottom - edge) target = line(band, 'after', bi)
    else {
      const hit = cardAt(cards.filter((c) => band.ids.includes(c.id)), x, y)
      if (hit && hit.id !== dragId) {
        const r = hit.rect
        const others = band.ids.filter((id) => id !== dragId)
        const zone = Math.min(r.width * 0.33, 240)
        const area = (l, w, label) => ({ kind: 'zone', left: l, top: r.top, width: w, height: r.height, label })
        if (paired && others.length === 1 && x < r.left + zone) {
          target = { kind: 'beside', anchor: hit.id, side: 'left', box: area(r.left, r.width * 0.42, 'Place beside') }
        } else if (paired && others.length === 1 && x > r.right - zone) {
          target = { kind: 'beside', anchor: hit.id, side: 'right', box: area(r.right - r.width * 0.42, r.width * 0.42, 'Place beside') }
        } else {
          target = { kind: 'swap', anchor: hit.id, box: area(r.left, r.width, 'Swap') }
        }
      }
    }
  }

  // A drop that would change nothing (a line right next to the card's own
  // row, say) shows nothing, so every indicator you see means a real move.
  if (target && same(applyDrop(rows, dragId, target), rows)) return null
  return target
}

// How wide each card in a row is, out of the grid's 12 columns. The current
// card is a compact summary, so beside another card it takes the narrow slot;
// any other two cards split the row evenly.
export function spans(row) {
  if (row.length === 1) return { [row[0]]: { span: 12, slot: 'full' } }
  if (row.includes('current')) {
    const other = row.find((id) => id !== 'current')
    return { current: { span: 3, slot: 'narrow' }, [other]: { span: 9, slot: 'wide' } }
  }
  return { [row[0]]: { span: 6, slot: 'half' }, [row[1]]: { span: 6, slot: 'half' } }
}
