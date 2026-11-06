// Settings icon: three horizontal sliders, each with a solid round knob.
// Replaces the gear. The knobs are separate elements with their own classes so
// the press animation (.settings-btn.is-opening in App.css) can slide each one
// along its track — a different distance and direction per row — before they
// settle back where they started, so the icon looks the same once the settings
// panel has opened and closed again.
//
// Knobs are filled rather than outlined: they sit on top of the track line,
// and a solid dot hides the line under it without needing a background colour
// to mask with (the button is translucent glass on some styles).

export function SlidersIcon({ size = 24, strokeWidth = 1.5, ...rest }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="sliders-icon"
      {...rest}
    >
      <path d="M4 6h16M4 12h16M4 18h16" />
      <circle className="slider-knob slider-knob--1" cx="15" cy="6"  r="1.9" fill="currentColor" />
      <circle className="slider-knob slider-knob--2" cx="8"  cy="12" r="1.9" fill="currentColor" />
      <circle className="slider-knob slider-knob--3" cx="13" cy="18" r="1.9" fill="currentColor" />
    </svg>
  )
}
