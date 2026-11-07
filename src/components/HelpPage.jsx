import { ArrowLeft, X, ChevronRight, LifeBuoy } from 'lucide-react'
import { openMeteoBlockedUntil } from '../utils/openMeteoQuota'

// The Help page: a full-screen page over everything else, opened from
// Settings → About and from the request-limit error card. On a wide screen the
// articles are listed down the left and the chosen one reads on the right; on a
// narrow one it is the list, then the article.
//
// Each article is { id, title, summary, Body }. Add new ones to HELP_ARTICLES.

// Matches the breakpoint in App.css where the list and article stop sitting
// side by side.
const NARROW = '(max-width: 899px)'

function QuotaStatus() {
  const until = openMeteoBlockedUntil()
  if (!until) {
    return <p className="help-status help-status--ok">Forecasts are loading normally right now.</p>
  }
  const at = new Date(until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return (
    <p className="help-status help-status--paused">
      The app has paused forecast requests and will try again at about {at}.
    </p>
  )
}

function RequestLimits() {
  return (
    <>
      <QuotaStatus />

      <h3>Where forecasts come from</h3>
      <p>
        Alek Weather gets its forecasts from Open-Meteo, a free, open-source
        weather service. In the US, details from the National Weather Service
        are added on top, but the forecast itself always starts at Open-Meteo.
      </p>

      <h3>Free, but not unlimited</h3>
      <p>
        Open-Meteo is free for personal use, but it limits how much each
        internet connection can ask for:
      </p>
      <ul>
        <li>about <strong>600</strong> requests a minute</li>
        <li>about <strong>5,000</strong> requests an hour</li>
        <li>about <strong>10,000</strong> requests a day</li>
      </ul>
      <p>
        Past a limit, it turns every request away until that limit resets, and
        the app can't load any forecast in the meantime.
      </p>

      <h3>Why it can happen when you've barely used the app</h3>
      <p>
        The limit belongs to your internet connection, not to you. On a shared
        network (a school, an office, public Wi-Fi, some mobile carriers), many
        people can share one connection, and every app on it that uses
        Open-Meteo counts toward the same allowance.
      </p>

      <h3>What the app does about it</h3>
      <ul>
        <li>Stops sending requests until the limit resets, so it doesn't use up the allowance again the moment it comes back.</li>
        <li>Keeps showing the last readings it has for your locations, up to six hours old.</li>
        <li>Tries again by itself: after a minute for the per-minute limit, at the top of the hour for the hourly one, and once an hour for the daily one.</li>
      </ul>

      <h3>What you can do</h3>
      <ul>
        <li><strong>Wait.</strong> The minute limit clears in a minute and the hourly one at the top of the hour. The daily one can take until the next day.</li>
        <li><strong>Switch networks, then tap Try again.</strong> Moving between Wi-Fi and mobile data gives you a different connection, with its own allowance. Try again always sends one fresh request, even while the app has paused.</li>
      </ul>
    </>
  )
}

const HELP_ARTICLES = [
  {
    id: 'request-limits',
    title: 'Why does it say the forecast service hit its request limit?',
    summary: 'What the limit is, why it can happen, and what to do.',
    Body: RequestLimits,
  },
]

// `article` is the open article's id, or null for the list. `onSelect(id)`
// opens one (null goes back to the list); `onClose` leaves the page.
export function HelpPage({ article, onSelect, onClose }) {
  const open = HELP_ARTICLES.find(a => a.id === article) ?? null
  // Wide screens always have an article showing beside the list.
  const shown = open ?? HELP_ARTICLES[0]
  const Body = shown.Body

  // Back steps up one level. On a narrow screen an open article sits in place
  // of the list, so Back returns to the list; everywhere else the list is
  // already on screen, so Back leaves Help for wherever it was opened from.
  const back = () => {
    if (open && window.matchMedia(NARROW).matches) onSelect(null)
    else onClose()
  }

  return (
    <div className={`help-page${open ? ' help-page--article' : ''}`} role="dialog" aria-modal="true" aria-label="Help">
      <header className="help-page-header">
        <button className="back-btn help-back" onClick={back} aria-label="Back">
          <ArrowLeft size={18} />
          <span>Back</span>
        </button>
        <span className="help-page-title">
          <LifeBuoy size={18} aria-hidden="true" />
          Help
        </span>
        <button className="header-icon-btn help-close" onClick={onClose} aria-label="Close help">
          <X size={20} />
        </button>
      </header>

      <div className="help-layout">
        <nav className="help-list" aria-label="Help articles">
          {HELP_ARTICLES.map(a => (
            <button
              key={a.id}
              className={`help-list-item${a.id === shown.id ? ' help-list-item--active' : ''}`}
              aria-current={a.id === shown.id ? 'page' : undefined}
              onClick={() => onSelect(a.id)}
            >
              <span className="help-list-text">
                <span className="help-list-title">{a.title}</span>
                <span className="help-list-summary">{a.summary}</span>
              </span>
              <ChevronRight size={16} aria-hidden="true" className="help-list-chevron" />
            </button>
          ))}
        </nav>

        <article className="help-article" key={shown.id}>
          <h2 className="help-title">{shown.title}</h2>
          <Body />
        </article>
      </div>
    </div>
  )
}
