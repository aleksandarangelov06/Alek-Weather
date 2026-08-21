import { Component } from 'react'

// Catches render crashes anywhere in the tree and shows a recovery card
// instead of a blank white page.
export class ErrorBoundary extends Component {
  state = { hasError: false, confirmingReset: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    console.error('Unhandled render error:', error, info)
  }

  // Resetting wipes every saved location and setting, so the button arms a
  // confirmation step first rather than clearing storage on a single tap.
  reset = () => {
    localStorage.clear()
    location.reload()
  }

  render() {
    if (!this.state.hasError) return this.props.children

    if (this.state.confirmingReset) {
      return (
        <div className="error-boundary">
          <p className="error-boundary-title">Are you sure you want to reset?</p>
          <p className="error-boundary-text">
            This deletes all of your saved data: saved locations, units, and
            every setting you've changed. It cannot be undone.
          </p>
          <div className="error-boundary-actions">
            <button
              className="error-boundary-btn error-boundary-btn--secondary"
              onClick={() => this.setState({ confirmingReset: false })}
            >
              Cancel
            </button>
            <button
              className="error-boundary-btn error-boundary-btn--danger"
              onClick={this.reset}
            >
              Delete and reset
            </button>
          </div>
        </div>
      )
    }

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
            onClick={() => this.setState({ confirmingReset: true })}
          >
            Reset app
          </button>
        </div>
      </div>
    )
  }
}
