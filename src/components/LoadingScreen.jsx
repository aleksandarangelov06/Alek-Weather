// Skeleton placeholder shown while weather data loads. Mirrors the real
// layout (current-conditions card on the left, forecast blocks on the right)
// so the page doesn't jump when the content arrives.
export function LoadingScreen() {
  return (
    <div className="weather-content loading-screen" role="status" aria-label="Fetching weather">
      <div className="weather-left">
        <div className="card skeleton-card">
          <div className="skeleton-line skeleton-w40" />
          <div className="skeleton-line skeleton-temp skeleton-w60" />
          <div className="skeleton-line skeleton-w50" />
          <div className="skeleton-line skeleton-w70" />
          <div className="skeleton-line skeleton-w45" />
        </div>
      </div>
      <div className="weather-right">
        {[0, 1, 2].map(i => (
          <div key={i} className="card skeleton-card">
            <div className="skeleton-line skeleton-w30" />
            <div className="skeleton-line skeleton-w90" />
            <div className="skeleton-line skeleton-w80" />
            <div className="skeleton-line skeleton-w60" />
          </div>
        ))}
      </div>
    </div>
  )
}
