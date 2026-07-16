// Skeleton placeholder shown while weather data loads. Mirrors the real
// layout piece by piece (current conditions stack, hourly strip, 7-day rows,
// details grid) so the page doesn't jump when the content arrives.
export function LoadingScreen() {
  return (
    <div className="weather-content loading-screen" role="status" aria-label="Fetching weather">
      <div className="weather-left">
        {/* Current conditions: location, date, icon, big temp, condition, feels-like */}
        <div className="card skeleton-card skeleton-current">
          <div className="skeleton-line skeleton-loc" />
          <div className="skeleton-line skeleton-date" />
          <div className="skeleton-circle skeleton-cur-icon" />
          <div className="skeleton-line skeleton-temp" />
          <div className="skeleton-line skeleton-cond" />
          <div className="skeleton-line skeleton-feels" />
        </div>
      </div>
      <div className="weather-right">
        {/* Hourly forecast: section label + strip of time/icon/temp columns */}
        <div className="card skeleton-card">
          <div className="skeleton-line skeleton-label" />
          <div className="skeleton-hourly">
            {[0, 1, 2, 3, 4, 5, 6, 7].map(i => (
              <div key={i} className="skeleton-hour">
                <div className="skeleton-line skeleton-hour-time" />
                <div className="skeleton-circle skeleton-hour-icon" />
                <div className="skeleton-line skeleton-hour-temp" />
              </div>
            ))}
          </div>
        </div>
        {/* 7-day forecast: day name / icon / temperature range rows */}
        <div className="card skeleton-card">
          <div className="skeleton-line skeleton-label" />
          <div className="skeleton-daily">
            {[0, 1, 2, 3, 4, 5, 6].map(i => (
              <div key={i} className="skeleton-day-row">
                <div className="skeleton-line skeleton-day-name" />
                <div className="skeleton-circle skeleton-day-icon" />
                <div className="skeleton-line skeleton-day-bar" />
              </div>
            ))}
          </div>
        </div>
        {/* Details: 2×2 grid of stat tiles */}
        <div className="card skeleton-card">
          <div className="skeleton-line skeleton-label" />
          <div className="skeleton-details">
            {[0, 1, 2, 3].map(i => (
              <div key={i} className="skeleton-tile" />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
