import { lazy, Suspense } from 'react'
import { loadReorderList } from './reorderChunk'
import { ReorderRowView } from './ReorderRowView'
import { ChunkBoundary } from './ChunkBoundary'

const makeImpl = () => lazy(() => loadReorderList().then(m => ({ default: m.ReorderList })))
let ReorderListImpl = makeImpl()
const freshImpl = () => { ReorderListImpl = makeImpl() }

// The same rows without the drag, for the moment the chunk is still loading
// (and for good if it can't load: the minus buttons still work, only dragging
// is missing). Same markup, so nothing moves when the real list takes over.
function StaticRows({ blocks, removable, onRemove }) {
  return blocks.map(id => (
    <ReorderRowView key={id} id={id} onRemove={removable.includes(id) ? onRemove : null} />
  ))
}

export function ReorderList(props) {
  return (
    <ChunkBoundary fallback={() => <StaticRows {...props} />} onRetry={freshImpl}>
      <Suspense fallback={<StaticRows {...props} />}>
        <ReorderListImpl {...props} />
      </Suspense>
    </ChunkBoundary>
  )
}
