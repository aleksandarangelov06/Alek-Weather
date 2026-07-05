import { Component } from 'react'

// Catches render crashes anywhere in the tree and shows a recovery card
// instead of a blank white page.
export class ErrorBoundary extends Component {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    console.error('Unhandled render error:', error, info)
  }

  render() {
    if (!this.state.hasError) return this.props.children
    return (
      <div className="error-boundary">
        <p className="error-boundary-title">Something went wrong.</p>
        <p className="error-boundary-text">
          Reloading usually fixes this. If it keeps happening, resetting the
          app clears saved settings and starts fresh.
        </p>
        <div className="error-boundary-actions">
          <button className="error-boundary-btn" onClick={() => location.reload()}>
            Reload
          </button>
          <button
            className="error-boundary-btn error-boundary-btn--secondary"
            onClick={() => { localStorage.clear(); location.reload() }}
          >
            Reset app
          </button>
        </div>
      </div>
    )
  }
}
