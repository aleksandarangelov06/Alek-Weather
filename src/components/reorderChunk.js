// Reorder mode's drag-and-drop list (see ReorderList), kept apart from
// ReorderListLazy.jsx so that file exports components only (Fast Refresh).
export const loadReorderList = () => import('./ReorderList')

// Warmed when a finger or pointer lands on "Reorder cards", so the chunk is
// usually in by the time the tap completes.
export function preloadReorderList() {
  loadReorderList().catch(() => { /* the list retries on mount */ })
}
