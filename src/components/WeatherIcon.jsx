import { useId } from 'react'
import {
  SunGlyph, MoonGlyph, SunSmallGlyph, SunCloudGlyph, CloudGlyph,
  SunRainGlyph, RainGlyph, SnowGlyph, SnowflakeGlyph, StormGlyph, ThermGlyph,
} from './weatherGlyphs'

// Keyed by the icon ids in weatherCodes.js. The map lives here rather than in
// weatherGlyphs so that file exports components and nothing else, which is what
// fast refresh needs to hot-swap a glyph without reloading the app.
const GLYPHS = {
  sun: SunGlyph,
  moon: MoonGlyph,
  sunSmall: SunSmallGlyph,
  sunCloud: SunCloudGlyph,
  cloud: CloudGlyph,
  sunRain: SunRainGlyph,
  rain: RainGlyph,
  snow: SnowGlyph,
  snowflake: SnowflakeGlyph,
  storm: StormGlyph,
  therm: ThermGlyph,
}

// Fog is drawn here rather than in weatherGlyphs because it isn't a Fluent
// redraw at all: the upstream 🌫️ asset is fixed pale-gray mist lines, an
// invisible smudge on light backgrounds and a white blob on dark. This version
// uses currentColor so it can be given a theme-aware mid-tone (see
// .weather-icon-fog in App.css) that reads clearly in both. The glyph is
// straight mist lines with drifting dots, alternating dot–line and line–dot per
// row to read as haze rather than water.
function FogIcon({ alt }) {
  return (
    <svg
      className="weather-icon-fog" viewBox="0 0 32 32"
      role="img" aria-label={alt || undefined} aria-hidden={alt ? undefined : true}
      fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"
      style={{ width: '1em', height: '1em', verticalAlign: 'middle' }}
    >
      <line x1="11" y1="7"  x2="26" y2="7"  opacity="0.85" />
      <circle cx="6"  cy="7"  r="1.4" fill="currentColor" stroke="none" opacity="0.85" />
      <line x1="6"  y1="13" x2="21" y2="13" />
      <circle cx="26" cy="13" r="1.4" fill="currentColor" stroke="none" />
      <line x1="11" y1="19" x2="26" y2="19" opacity="0.9" />
      <circle cx="6"  cy="19" r="1.4" fill="currentColor" stroke="none" opacity="0.9" />
      <line x1="6"  y1="25" x2="21" y2="25" opacity="0.95" />
      <circle cx="26" cy="25" r="1.4" fill="currentColor" stroke="none" opacity="0.95" />
    </svg>
  )
}

// Strong thunderstorm: the stock Fluent storm cloud carries a single orange bolt
// on the right. This adds a second, matching bolt on the lower-left so the icon
// reads as a more intense storm — the same bolt path shifted left and down, with
// a thin light outline so it stays legible where it crosses the cloud.
//
// This used to be an absolutely-positioned <svg> stacked on top of an <img>,
// because the cloud lived in a CDN image nothing on the page could reach into.
// With the cloud inline it is simply one more path in the same drawing, so it
// scales, clips and animates with everything else.
const STORM_BOLT = 'M19.5424 19.6248L14.6898 26.9037C14.4703 27.233 13.957 27.0776 13.957 26.6818L13.9569 21.4029C13.9569 21.182 13.7778 21.0029 13.5569 21.0029H12.6787C12.3645 21.0029 12.173 20.6573 12.3395 20.3909L16.2178 14.1856C16.4308 13.8448 16.957 13.9957 16.957 14.3976V18.6029C16.957 18.8238 17.1361 19.0029 17.357 19.0029H19.2096C19.5291 19.0029 19.7196 19.3589 19.5424 19.6248Z'

function SecondBolt({ u }) {
  return (
    <g className="wi-part wi-part--bolt" transform="translate(-6.4 1.5)">
      <defs>
        <linearGradient id={`${u}-bolt2`} x1="16.0347" y1="12.6133" x2="16.0347" y2="25.8114" gradientUnits="userSpaceOnUse">
          <stop offset="0.3542" stopColor="#FF9B49" />
          <stop offset="1" stopColor="#FF4E4B" />
        </linearGradient>
      </defs>
      <path
        d={STORM_BOLT} fill={`url(#${u}-bolt2)`}
        stroke="#FFE0B0" strokeWidth="0.5" strokeLinejoin="round"
      />
    </g>
  )
}

// Motion is not a prop. Every glyph ships its animatable parts already tagged
// (.wi-mote on individual drops and flakes, .wi-part--* on each layer group),
// but the keyframes are only bound inside a hero container — see
// "Weather icon motion" in App.css. That keeps the hourly and daily strips,
// which render dozens of these at once, completely static during a scroll
// without any call site having to know which slot it is rendering into.
export function WeatherIcon({ id, alt = '' }) {
  // Gradient ids are document-global. Two icons on one screen would otherwise
  // define the same id, and every instance would resolve to whichever mounted
  // first — fine until that one unmounts and the rest lose their fills.
  const u = useId().replace(/:/g, '')

  if (id === 'fog') return <FogIcon alt={alt} />

  const strong = id === 'stormStrong'
  const Glyph = GLYPHS[strong ? 'storm' : id]
  if (!Glyph) return null

  // fill="none" on the root mirrors the upstream Fluent <svg>. Every glyph
  // element carries its own fill now, but a stroked shape that doesn't — the
  // snowflake's ring, the moon's crater rims — otherwise inherits the browser
  // default of black, which is what painted a black dot in the snowflake.
  return (
    <svg
      className={`weather-icon weather-icon--${id}`} viewBox="0 0 32 32" fill="none"
      role="img" aria-label={alt || undefined} aria-hidden={alt ? undefined : true}
      style={{ width: '1em', height: '1em', verticalAlign: 'middle' }}
    >
      <Glyph u={u} />
      {strong && <SecondBolt u={u} />}
    </svg>
  )
}
