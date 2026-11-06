// The art on the app-style switch cover (see .style-cover in App.css):
// the Android robot, which waves, and an apple that gets a bite taken out of
// it. Plain inline SVG so the moving parts are separate elements that CSS can
// animate on the compositor; every timing lives in App.css.
//
// The Android robot is reproduced or modified from work created and shared by
// Google and used according to terms described in the Creative Commons 3.0
// Attribution License. The apple is drawn here, not Apple's logo artwork.

function AndroidRobot() {
  return (
    <svg className="sca sca-android" viewBox="0 0 100 100" aria-hidden="true">
      <g className="sca-android-body">
        <g className="sca-android-head">
          <line className="sca-antenna sca-antenna--l" x1="38" y1="26" x2="32" y2="16" />
          <line className="sca-antenna sca-antenna--r" x1="62" y1="26" x2="68" y2="16" />
          <path d="M27 46 A23 23 0 0 1 73 46 Z" />
          <circle className="sca-eye" cx="40" cy="35" r="2.6" />
          <circle className="sca-eye" cx="60" cy="35" r="2.6" />
        </g>
        <path d="M27 49 H73 V76 a6 6 0 0 1 -6 6 H33 a6 6 0 0 1 -6 -6 Z" />
        <rect x="16" y="50" width="8.5" height="25" rx="4.25" />
        <rect className="sca-android-wave" x="75.5" y="50" width="8.5" height="25" rx="4.25" />
        <rect x="36" y="78" width="8.5" height="15" rx="4.25" />
        <rect x="55.5" y="78" width="8.5" height="15" rx="4.25" />
      </g>
    </svg>
  )
}

function BittenApple() {
  return (
    <svg className="sca sca-apple" viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <mask id="sca-bite-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
          <rect width="100" height="100" fill="#fff" />
          {/* The bite: a circle that grows from nothing at the apple's edge,
              cutting the mouthful away. */}
          <circle className="sca-bite" cx="88" cy="52" r="13" fill="#000" />
        </mask>
      </defs>
      <g className="sca-apple-fruit">
        <g mask="url(#sca-bite-mask)">
          <path d="M50 31 C43 25 24 23 17 40 C10 58 22 86 36 90 C42 92 46 88 50 88 C54 88 58 92 64 90 C78 86 90 60 83 41 C77 24 57 25 50 31 Z" />
        </g>
        <path className="sca-apple-leaf" d="M51 25 C51 15 59 8 68 8 C68 18 60 25 51 25 Z" />
      </g>
      {/* Crumbs that fly off as the bite lands. */}
      <circle className="sca-crumb sca-crumb--1" cx="86" cy="48" r="1.8" />
      <circle className="sca-crumb sca-crumb--2" cx="88" cy="55" r="1.4" />
      <circle className="sca-crumb sca-crumb--3" cx="85" cy="58" r="1.2" />
    </svg>
  )
}

export function StyleCoverArt({ to }) {
  if (to === 'android') return <AndroidRobot />
  if (to === 'ios') return <BittenApple />
  return null
}
