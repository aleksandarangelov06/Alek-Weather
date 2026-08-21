// Loading skeleton for the web layout.
//
// The phone skeleton (LoadingScreen) is shaped like the phone page: a centred
// current-conditions stack, then hourly / daily / details cards down one
// column. The web layout shares none of that — it is a tabbed shell whose
// pages are grids of widgets — so on web that skeleton stood in for a page
// that never arrived, and the content jumped over it on load.
//
// Rather than describe the web pages a second time in skeleton markup, each
// block below reuses the real layout classes (.web-today-grid, .web-widget,
// .web-glance-grid, .web-mini-hours, .web-day-row …) and replaces only the
// leaves with shimmer bars. Every responsive rule in WebApp.css — the fold to
// one column at 1279px, the hourly strip's column counts, the tile resizing in
// a shared row — therefore applies to the skeleton exactly as it does to the
// page, with no second set of breakpoints to keep in sync.
//
// The skeleton follows the selected tab, because that is the page about to
// appear. Radar is the exception: it has no card structure to imitate, only a
// map filling the window.

const rep = (n) => Array.from({ length: n }, (_, i) => i)

// The stacked tiles (hour columns, week days, glance cells) are all the same
// shape: a few lines and an icon inside one sunken well.
function StackTile({ className, lines }) {
  return (
    <div className={className}>
      {lines.map((cls, i) =>
        cls === 'icon'
          ? <div key={i} className="skeleton-circle skeleton-web-icon" />
          : <div key={i} className={'skeleton-line ' + cls} />,
      )}
    </div>
  )
}

function TodaySkeleton() {
  return (
    <div className="web-today-grid">
      {/* Current conditions — the one narrow widget, so it keeps a track of its
          own at the paired width and folds with the rest below that. */}
      <div className="web-widget">
        <div className="card skeleton-card skeleton-web-current">
          <div className="skeleton-line skeleton-loc" />
          <div className="skeleton-line skeleton-date" />
          <div className="skeleton-circle skeleton-cur-icon" />
          <div className="skeleton-line skeleton-temp" />
          <div className="skeleton-line skeleton-cond" />
          <div className="skeleton-line skeleton-feels" />
        </div>
      </div>

      {/* At a glance — eight readings; the grid decides how many per row. */}
      <div className="web-widget">
        <div className="card skeleton-card">
          <div className="skeleton-line skeleton-label" />
          <div className="web-glance-grid">
            {rep(8).map((i) => (
              <StackTile
                key={i}
                className="web-glance-tile"
                lines={['icon', 'skeleton-web-sm', 'skeleton-web-lg']}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Hourly strip and week ahead both span the full grid. */}
      <div className="web-widget web-widget--full">
        <div className="card skeleton-card">
          <div className="skeleton-line skeleton-label" />
          <div className="web-mini-hours">
            {rep(13).map((i) => (
              <StackTile
                key={i}
                className="web-mini-hour"
                lines={['skeleton-web-sm', 'icon', 'skeleton-web-md', 'skeleton-web-xs']}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="web-widget web-widget--full">
        <div className="card skeleton-card">
          <div className="skeleton-line skeleton-label" />
          <div className="web-week-days">
            {rep(7).map((i) => (
              <StackTile
                key={i}
                className="web-week-day"
                lines={['skeleton-web-sm', 'icon', 'skeleton-web-xs', 'skeleton-web-md']}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function DailySkeleton() {
  return (
    <>
      <div className="card skeleton-card web-chart-card">
        <div className="web-page-head">
          <div className="skeleton-line skeleton-web-title" />
        </div>
        <div className="skeleton-tile skeleton-web-chart" />
      </div>

      <div className="card skeleton-card web-days-card">
        {rep(7).map((i) => (
          <div key={i} className="web-day">
            {/* A div, not the real <button>: the same grid track for track,
                without claiming to be pressable while there is nothing to
                press. */}
            <div className="web-day-row skeleton-web-day-row">
              <div className="skeleton-line skeleton-web-md" />
              <div className="skeleton-circle skeleton-web-day-icon" />
              <div className="skeleton-line skeleton-web-sm" />
              <div className="skeleton-line skeleton-web-xs" />
              <div className="skeleton-line skeleton-web-bar" />
              <div className="skeleton-line skeleton-web-xs" />
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

function DetailsSkeleton() {
  return (
    <>
      <div className="web-page-head">
        <div className="skeleton-line skeleton-web-title" />
      </div>
      <div className="web-detail-grid">
        {/* Humidity, wind, pressure, visibility, UV — five panels, as rendered. */}
        {rep(5).map((i) => (
          <div key={i} className="card skeleton-card web-detail">
            <div className="web-detail-head">
              <div className="skeleton-circle skeleton-web-icon" />
              <div className="skeleton-line skeleton-label" />
            </div>
            <div className="skeleton-line skeleton-web-hero" />
            <div className="skeleton-tile skeleton-web-panel-chart" />
          </div>
        ))}
      </div>
    </>
  )
}

function AirSkeleton() {
  return (
    <>
      <div className="web-page-head">
        <div className="skeleton-line skeleton-web-title" />
      </div>

      <div className="card skeleton-card web-aqi-hero">
        <div className="skeleton-tile skeleton-web-dial" />
        <div className="skeleton-web-copy">
          <div className="skeleton-line skeleton-web-hero" />
          <div className="skeleton-line skeleton-web-para" />
          <div className="skeleton-line skeleton-web-para skeleton-web-para--short" />
        </div>
      </div>

      <div className="card skeleton-card">
        <div className="skeleton-line skeleton-label" />
        <div className="web-poll-grid">
          {rep(6).map((i) => (
            <div key={i} className="web-poll">
              <div className="skeleton-line skeleton-web-sm" />
              <div className="skeleton-line skeleton-web-track" />
              <div className="skeleton-line skeleton-web-xs" />
            </div>
          ))}
        </div>
      </div>

      <div className="card skeleton-card">
        <div className="skeleton-line skeleton-label" />
        <div className="skeleton-tile skeleton-web-chart" />
      </div>
    </>
  )
}

// The map is the whole page here, so the placeholder is one full-bleed panel
// rather than a stack of card outlines.
function RadarSkeleton() {
  return <div className="skeleton-tile skeleton-web-radar" />
}

const PAGES = {
  today: TodaySkeleton,
  daily: DailySkeleton,
  details: DetailsSkeleton,
  air: AirSkeleton,
  radar: RadarSkeleton,
}

export function WebLoadingScreen({ tab = 'today' }) {
  const Page = PAGES[tab] ?? TodaySkeleton
  return (
    // .web-shell carries --web-sunken and the rest of the web tokens; without
    // it the wells inside the tiles would have no background to sit in.
    <div className="web-shell loading-screen" role="status" aria-label="Fetching weather">
      <div className={tab === 'radar' ? 'web-page web-page--radar' : 'web-page'}>
        <Page />
      </div>
    </div>
  )
}
