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

import { HOURS_BY_SLOT, PAIR_MQ, spans, useMediaQuery, useTodayLayout } from './todayLayout'

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

// One placeholder per Today card, in the same card classes the real ones wear
// (.web-glance, .web-preview …) so their padding and the slot-sizing rules in
// WebApp.css reach the skeleton too.
function TodayCardSkeleton({ id, slot }) {
  switch (id) {
    // Current conditions: no card surface, centred in whatever slot it gets.
    case 'current':
      return (
        <div className="card skeleton-card skeleton-web-current">
          <div className="skeleton-line skeleton-loc" />
          <div className="skeleton-line skeleton-date" />
          <div className="skeleton-circle skeleton-cur-icon" />
          <div className="skeleton-line skeleton-temp" />
          <div className="skeleton-line skeleton-cond" />
          <div className="skeleton-line skeleton-feels" />
        </div>
      )
    // At a glance: eight readings; the grid decides how many per row.
    case 'glance':
      return (
        <div className="card skeleton-card web-glance">
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
      )
    // As many hours as the real strip will draw in this slot.
    case 'hourly':
      return (
        <div className="card skeleton-card web-preview web-strip">
          <div className="skeleton-line skeleton-label" />
          <div className="web-mini-hours">
            {rep(HOURS_BY_SLOT[slot] ?? HOURS_BY_SLOT.full).map((i) => (
              <StackTile
                key={i}
                className="web-mini-hour"
                lines={['skeleton-web-sm', 'icon', 'skeleton-web-md', 'skeleton-web-xs']}
              />
            ))}
          </div>
        </div>
      )
    case 'week':
      return (
        <div className="card skeleton-card web-preview web-week">
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
      )
    default:
      return null
  }
}

// Laid out exactly as TodayPage lays out the real cards: the user's saved rows,
// each card spanning its share of the 12-column grid (or the whole row once the
// grid folds to one column). Without the spans every card in a shared row got
// a single grid column, and the current and glance placeholders were crushed
// into slivers. The precipitation chart is left out, as the real page leaves
// it out until it knows there's rain to show.
function TodaySkeleton() {
  const { rows } = useTodayLayout()
  const paired = useMediaQuery(PAIR_MQ)
  const items = []
  for (const row of rows) {
    const ids = row.filter((id) => id !== 'nowcast')
    if (!ids.length) continue
    const s = spans(ids)
    for (const id of ids) {
      const slot = paired ? s[id].slot : 'full'
      items.push(
        <div
          key={id}
          className={`web-widget${slot === 'full' ? ' web-widget--full' : ''} web-widget--${slot}`}
          style={{ gridColumn: paired ? `span ${s[id].span}` : '1 / -1' }}
        >
          <TodayCardSkeleton id={id} slot={slot} />
        </div>,
      )
    }
  }
  return <div className="web-today-grid">{items}</div>
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
