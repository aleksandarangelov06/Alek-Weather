import { GripVertical, Minus } from 'lucide-react'
import { blockMeta } from './blockMeta'

// One card in reorder mode, drawn as a short row so the whole stack fits on a
// phone screen and a move is a short drag rather than hauling a 600px card
// past the others. The whole row is the handle. A card that can't be removed
// (onRemove null) gets a blank where the minus would be.
//
// Only the markup: ReorderList wires the drag in through the refs and handle
// props, and ReorderListLazy draws it bare while that chunk is on its way.
export function ReorderRowView({ id, onRemove, rowRef, handleRef, handleProps, style, dragging = false }) {
  const { label, Icon } = blockMeta(id)
  return (
    <div
      ref={rowRef}
      className={`card reorder-row${dragging ? ' reorder-row--dragging' : ''}`}
      style={style}
    >
      {/* Outside the handle, so tapping it can never start a drag. */}
      {onRemove ? (
        <button
          type="button"
          className="reorder-row-action reorder-row-action--remove"
          onClick={() => onRemove(id)}
          aria-label={`Remove ${label}`}
        >
          <Minus size={16} strokeWidth={3} aria-hidden="true" />
        </button>
      ) : (
        <span className="reorder-row-action reorder-row-action--none" aria-hidden="true" />
      )}
      <div className="reorder-row-handle" ref={handleRef} {...handleProps}>
        <Icon size={19} className="reorder-row-icon" aria-hidden="true" />
        <span className="reorder-row-label">{label}</span>
        <GripVertical size={19} className="reorder-row-grip" aria-hidden="true" />
      </div>
    </div>
  )
}
