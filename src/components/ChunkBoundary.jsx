import { Component } from 'react'

// Holds a failure to one lazily loaded part of the app (the radar, Settings,
// the alert map) instead of letting it reach the root boundary, which swaps the
// whole app for the crash card. A chunk that fails to download (a dropped
// connection, a deploy that renamed it) is the usual cause, and it is worth a
// second try: the loaders forget a failed fetch, and onRetry hands the wrapper
// the chance to build a fresh React.lazy, since a lazy component keeps its
// rejection for good.
//
// `fallback(retry, attempts)` draws the failed slot; `retry` clears the error
// and remounts the children.
export class ChunkBoundary extends Component {
  state = { failed: false, attempts: 0 }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error) {
    console.error('Lazy part failed:', error)
  }

  retry = () => {
    this.props.onRetry?.()
    this.setState((s) => ({ failed: false, attempts: s.attempts + 1 }))
  }

  render() {
    if (this.state.failed) return this.props.fallback(this.retry, this.state.attempts)
    return this.props.children
  }
}

// The button a fallback offers: try again once or twice, then a full reload,
// which also picks up a newer build if a deploy is what broke the fetch.
export function RetryButton({ retry, attempts, className = 'chunk-error-btn' }) {
  const reload = attempts >= 2
  return (
    <button type="button" className={className} onClick={reload ? () => location.reload() : retry}>
      {reload ? 'Reload app' : 'Try again'}
    </button>
  )
}
