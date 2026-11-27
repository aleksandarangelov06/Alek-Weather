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

function OutsideUs() {
  return (
    <>
      <h3>Two sources in the US, one everywhere else</h3>
      <p>
        Every forecast starts at Open-Meteo, a free, open-source weather service
        that covers the whole world. In the US and its territories, the app adds
        data from the National Weather Service (NWS) and NOAA on top. Those are
        US government services, and they only cover the US, so everywhere else
        the forecast comes from Open-Meteo alone.
      </p>

      <h3>What you only get in the US</h3>
      <ul>
        <li><strong>Weather alerts.</strong> Watches, warnings and advisories come from the NWS, so they don't appear anywhere else, and the Storm Center has no alerts to show.</li>
        <li><strong>Forecaster details.</strong> The NWS forecast is blended in for temperature, feels-like, wind gusts, cloud cover, visibility, dew point and rain amounts.</li>
        <li><strong>Live readings from weather stations.</strong> Current conditions are checked against the nearest NWS station.</li>
        <li><strong>Sharper radar.</strong> In the US the radar map uses NOAA&apos;s own radar, drawn smoothly even zoomed in, plus a forecast radar for the next few hours. Elsewhere it uses RainViewer: past radar only, and blockier when zoomed in.</li>
        <li><strong>The full Alek Weather Engine.</strong> Outside the US the engine checks a coarser worldwide radar instead, which can tell whether something is falling but not how hard. See &quot;How does the Alek Weather Engine work?&quot;</li>
      </ul>

      <h3>How much the quality drops</h3>
      <p>
        It depends on where you are. Open-Meteo picks the best weather model it
        has for each place. Across much of Europe, Canada and Japan those are
        detailed national models, and forecasts are very good. In other places
        it relies on broader global models, which can miss local effects like
        mountains, coastlines and summer storms that pop up quickly.
      </p>
      <p>
        Without station readings or radar to check against, the current
        conditions are the model&apos;s best estimate. They can now and then
        say it&apos;s raining when it isn&apos;t, or the other way round.
      </p>

      <h3>Why not add more sources?</h3>
      <p>
        Most national weather services outside the US don&apos;t offer a free,
        open feed an app like this can use, or they cover only their own
        country. Open-Meteo is what makes worldwide forecasts possible without
        charging for the app.
      </p>
    </>
  )
}

function WeatherEngine() {
  return (
    <>
      <p>
        A forecast is a prediction. It can say rain at 3 PM while the sky stays
        dry, or miss a shower that&apos;s falling on you right now. The Alek
        Weather Engine closes that gap: it checks what the forecast says against
        live radar over your exact location, and shows you what is really
        happening.
      </p>

      <h3>How it works</h3>
      <ul>
        <li><strong>It reads the radar at your spot.</strong> Every time a forecast loads, and again every 5 minutes while it&apos;s open, the engine reads live radar at your location and at four points about a mile around it. Looking at five points tells a storm overhead apart from the edge of one passing by.</li>
        <li><strong>It measures how hard it&apos;s falling.</strong> In the US the engine reads the strength of the radar echo from NOAA&apos;s nationwide radar, updated about every 5 minutes. Light drizzle and a downpour look very different, so the conditions you see say how heavy it is, not just that it&apos;s raining.</li>
        <li><strong>It waits for a second look.</strong> A change has to show up on two radar scans in a row before the engine acts on it, so a cloud edge drifting past doesn&apos;t flip your screen between rain and sun. A strong storm is the exception: it shows at once.</li>
        <li><strong>It knows rain from snow.</strong> Snow shows up weaker on radar than rain does, so the engine uses a lower bar when it&apos;s snowing, and light snow isn&apos;t missed.</li>
      </ul>

      <h3>What you&apos;ll notice</h3>
      <ul>
        <li><strong>No phantom rain.</strong> If the forecast says rain but the radar shows nothing over you, you see the actual sky instead.</li>
        <li><strong>No missed showers.</strong> If rain is falling on you that the forecast didn&apos;t expect, you see it, at the strength the radar measures.</li>
        <li><strong>Calmer updates.</strong> Conditions change when the weather really changes, not with every flicker on the radar.</li>
      </ul>

      <h3>What it won&apos;t override</h3>
      <p>
        An active warning from the National Weather Service always wins: radar
        can show brief gaps inside a storm, and a warning is an official call.
        Radar also can&apos;t see lightning, so the engine never adds a
        thunderstorm the forecast didn&apos;t already call for.
      </p>

      <h3>Outside the US</h3>
      <p>
        The engine checks RainViewer&apos;s worldwide radar instead. It can tell
        whether something is falling over you, but not how hard, and it
        can&apos;t take the second look, so it&apos;s a lighter check than in
        the US.
      </p>

      <h3>Turning it off</h3>
      <p>
        The engine is on by default. It&apos;s the Enhanced accuracy switch in
        Settings, under Radar. With it off, you see the forecast&apos;s own
        reading for right now.
      </p>
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
  {
    id: 'outside-us',
    title: 'Why are forecasts outside the US less detailed?',
    summary: 'What changes outside the US, and why.',
    Body: OutsideUs,
  },
  {
    id: 'weather-engine',
    title: 'How does the Alek Weather Engine work?',
    summary: 'How live radar keeps the current conditions honest.',
    Body: WeatherEngine,
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
