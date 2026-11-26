// Loading skeleton for the web layout.
//
// The phone skeleton (LoadingScreen) is shaped like the phone page: a centred
// current-conditions stack, then hourly / daily / details cards down one
// column. The web layout shares none of that — it is a tabbed shell whose
// pages are grids of widgets — so on web that skeleton stood in for a page
// that never arrived, and the content jumped over it on load.
//
// Rather than describe the web pages a second time in skeleton markup, each
// block below reuses the real layout classes (.wt-grid, .wt-stats,
// .wt-strip-list, .web-day-row …) and replaces only the leaves with shimmer
// bars. Every responsive rule in WebApp.css therefore applies to the skeleton
// exactly as it does to the page, with no second set of breakpoints to keep in
// sync.
//
// The skeleton follows the selected tab, because that is the page about to
// appear. Radar is the exception: it has no card structure to imitate, only a
// map filling the window.

import { useMediaQuery } from './useMediaQuery'
import { BOARD_MQ } from './DailyPage'

const rep = (n) => Array.from({ length: n }, (_, i) => i)

// Today, card for card: the reading, the hours and the week in the main
// column, the two outlook cards beside them. The precipitation chart is left
// out, as the real page leaves it out unless there's rain to show.
function TodaySkeleton() {
  return (
    <div className="wt-grid">
      <div className="wt-main">
        <div className="card skeleton-card wt-now">
          <div className="skeleton-line skeleton-web-place" />
          <div className="skeleton-line skeleton-web-meta" />
          <div className="wt-reading">
            <div className="skeleton-circle skeleton-web-now-icon" />
            <div className="skeleton-line skeleton-web-now-temp" />
          </div>
          <div className="wt-stats">
            {rep(6).map((i) => (
              <div key={i} className="wt-stat">
                <div className="skeleton-line skeleton-web-sm" />
                <div className="skeleton-line skeleton-web-md" />
              </div>
            ))}
          </div>
        </div>

        <div className="card skeleton-card wt-hours">
          <div className="skeleton-line skeleton-label" />
          <div className="wt-strip">
            <div className="wt-strip-list">
              {rep(12).map((i) => (
                <div key={i} className="wt-hour">
                  <div className="skeleton-line skeleton-web-xs" />
                  <div className="skeleton-circle skeleton-web-icon" />
                  <div className="skeleton-line skeleton-web-sm" />
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="card skeleton-card wt-week">
          <div className="skeleton-line skeleton-label" />
          <div className="wt-days">
            {rep(7).map((i) => (
              <div key={i} className="skeleton-line skeleton-web-week-row" />
            ))}
          </div>
        </div>
      </div>

      <div className="wt-side">
        <div className="card skeleton-card skeleton-web-side skeleton-web-side--tall" />
        <div className="card skeleton-card skeleton-web-side" />
      </div>
    </div>
  )
}

function DailySkeleton() {
  const board = useMediaQuery(BOARD_MQ)
  if (board) {
    return (
      <>
        <div className="card skeleton-card web-chart-card web-board-card">
          <div className="web-page-head">
            <div className="skeleton-line skeleton-web-title" />
          </div>
          <div className="web-board">
            <div className="web-board-cols">
              {rep(7).map((i) => (
                <div key={i} className="web-board-day skeleton-web-board-day">
                  <div className="skeleton-line skeleton-web-xs" />
                  <div className="skeleton-circle skeleton-web-day-icon" />
                  <div className="skeleton-line skeleton-web-xs" />
                  <div className="skeleton-tile skeleton-web-board-plot" />
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="card skeleton-card web-dayview">
          <div className="skeleton-line skeleton-web-hero" />
          <div className="skeleton-tile skeleton-web-panel-chart" />
        </div>
      </>
    )
  }
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

// The map is the whole page here, so the placeholder is one full-bleed panel
// rather than a stack of card outlines.
function RadarSkeleton() {
  return <div className="skeleton-tile skeleton-web-radar" />
}

const PAGES = {
  today: TodaySkeleton,
  daily: DailySkeleton,
  details: DetailsSkeleton,
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
