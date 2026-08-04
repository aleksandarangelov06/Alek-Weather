import { WeatherRadar } from '../WeatherRadar'

// No page heading here, unlike the other tabs: the map is the page, and a
// heading would be 60px of the screen it is supposed to fill. The card stretches
// to the whole window, header included — the tab bar floats over the map rather
// than sitting above it. See .app--web-radar in WebApp.css for the chain of flex
// rules that gets it there.
export function RadarPage({ location, timezone, radarMode }) {
  return (
    <div className="web-page web-page--radar">
      <WeatherRadar location={location} timezone={timezone} mode={radarMode} fill />
    </div>
  )
}
