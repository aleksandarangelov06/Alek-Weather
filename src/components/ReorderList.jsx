import { DndContext, closestCenter, KeyboardSensor, MouseSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ReorderRowView } from './ReorderRowView'

// The drag-and-drop half of reorder mode, in its own chunk: @dnd-kit is about
// 40 KB that only this list uses, and only once someone taps "Reorder cards".
// Import ReorderListLazy rather than this file.

// The list is one column, so a dragged row only ever moves up or down.
const lockToVertical = ({ transform }) => ({ ...transform, x: 0 })

function SortableRow({ id, onRemove }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id })
  return (
    <ReorderRowView
      id={id}
      onRemove={onRemove}
      rowRef={setNodeRef}
      handleRef={setActivatorNodeRef}
      handleProps={{ ...attributes, ...listeners }}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      dragging={isDragging}
    />
  )
}

// A mouse picks a row up after a few pixels, a finger after a short hold (a
// quick swipe still scrolls the page), and the keyboard with space and the
// arrow keys. `onMove(id, overId)` reports a drop onto another row.
export function ReorderList({ blocks, removable, onRemove, onMove }) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const handleDragEnd = ({ active, over }) => {
    if (over && active.id !== over.id) onMove(active.id, over.id)
  }
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[lockToVertical]} onDragEnd={handleDragEnd}>
      <SortableContext items={blocks} strategy={verticalListSortingStrategy}>
        {blocks.map(id => (
          <SortableRow key={id} id={id} onRemove={removable.includes(id) ? onRemove : null} />
        ))}
      </SortableContext>
    </DndContext>
  )
}
