import { createPortal } from 'react-dom'
import { GripHorizontal, RotateCcw } from 'lucide-react'

// What's drawn on top of the page during a drag: a small chip with the card's
// name beside the pointer, and the drop indicator — a line where a new row will
// open, or a highlighted area for "beside" and "swap". Fixed-position and in a
// portal, so none of it can push the cards around while you aim.
export function DragLayer({ drag, names }) {
  if (!drag) return null
  const box = drag.target?.box
  return createPortal(
    <div className="web-drag-layer" aria-hidden="true">
      {box?.kind === 'line' && (
        <div className="web-drop-line" style={{ left: box.left, top: box.y - 2, width: box.right - box.left }}>
          <span className="web-drop-pill">{box.label}</span>
        </div>
      )}
      {box?.kind === 'zone' && (
        <div className="web-drop-zone" style={{ left: box.left, top: box.top, width: box.width, height: box.height }}>
          <span className="web-drop-pill">{box.label}</span>
        </div>
      )}
      <div className="web-drag-chip" style={{ left: drag.x + 16, top: drag.y + 12 }}>
        <GripHorizontal size={14} />
        {names[drag.id] ?? drag.id}
      </div>
    </div>,
    document.body,
  )
}

// The grip tab on a card's top edge: the only place a card is picked up from.
// Keyboard: focus it, then the arrow keys move the card (onKeyMove).
export function DragHandle({ id, name, onStart, onKeyMove }) {
  return (
    <button
      type="button"
      className="web-widget-handle"
      data-handle-for={id}
      aria-label={`Move ${name}. Drag, or use the arrow keys.`}
      title="Drag to move this card"
      onPointerDown={(e) => onStart(e, id)}
      onKeyDown={(e) => {
        const dir = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }[e.key]
        if (!dir || !onKeyMove) return
        e.preventDefault()
        onKeyMove(id, dir)
      }}
    >
      <GripHorizontal size={16} aria-hidden="true" />
    </button>
  )
}

// Shown once the layout has been changed: one click back to the default.
export function ResetLayout({ visible, onReset }) {
  if (!visible) return null
  return (
    <div className="web-layout-reset">
      <button type="button" className="web-layout-reset-btn" onClick={onReset}>
        <RotateCcw size={13} aria-hidden="true" />
        Reset layout
      </button>
    </div>
  )
}
