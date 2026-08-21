// Clothing glyphs — line icons for the overview's CLOTHING line.
//
// lucide-react ships exactly one garment (`Shirt`), so every band below 60°F
// used to fall back on a weather glyph: a gust for the jacket range, a
// snowflake for the heavy-layer range. Those describe the temperature, which
// the line already states in words, instead of the thing you're being told to
// put on. These fill the gap.
//
// Drawn to lucide's grid so they sit beside `Shirt` and `Umbrella` without
// looking imported: 24×24 viewBox, no fill, 2px currentColor stroke, round
// caps and joins. They take the same props lucide icons do (`size`,
// `className`, `style`, `aria-hidden`), so they're drop-in at any call site.

function Glyph({ size = 24, children, ...rest }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      {children}
    </svg>
  )
}

// Sleeveless: the shoulders are bare straps, which is the whole read at 18px.
export function TankTop(props) {
  return (
    <Glyph {...props}>
      <path d="M7 20V6c0-2.2 1.3-4 3-4" />
      <path d="M17 20V6c0-2.2-1.3-4-3-4" />
      <path d="M10 2c0 1.4.9 2.5 2 2.5S14 3.4 14 2" />
      <path d="M7 20a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2" />
    </Glyph>
  )
}

// Waistband over two legs — the only bottoms in the set, so it reads on shape.
export function Shorts(props) {
  return (
    <Glyph {...props}>
      <path d="M4 4h16v3H4z" />
      <path d="M4 7l1 13h5l2-9 2 9h5l1-13" />
    </Glyph>
  )
}

// Sleeves run to the wrist instead of the bicep: one long-sleeve step warmer
// than lucide's `Shirt`.
export function LongSleeve(props) {
  return (
    <Glyph {...props}>
      <path d="M9 2 5 4 3 14l3 1 1-3.5V20a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-8.5l1 3.5 3-1-2-10-4-2Z" />
      <path d="M9 2a3 3 0 0 0 6 0" />
    </Glyph>
  )
}

// Long sleeves plus the two things only a hoodie has: a hood seam and the
// drawstrings hanging off it.
export function Hoodie(props) {
  return (
    <Glyph {...props}>
      <path d="M9 2 5 4 3 14l3 1 1-3.5V20a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-8.5l1 3.5 3-1-2-10-4-2Z" />
      <path d="M9 2c.7 2.6 5.3 2.6 6 0" />
      <path d="M10.5 5.2v2.3M13.5 5.2v2.3" />
      <path d="M9 16h6" />
    </Glyph>
  )
}

// Full-length centre zip and an open V collar: the zip is what separates this
// from every pullover above it.
export function Jacket(props) {
  return (
    <Glyph {...props}>
      <path d="M8 2 4 4l-1 16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2L20 4l-4-2Z" />
      <path d="M8 2l4 4 4-4" />
      <path d="M12 6v16" />
    </Glyph>
  )
}

// Longer body and a belt at the waist — a trench, read against the jacket's
// bare zip.
export function Coat(props) {
  return (
    <Glyph {...props}>
      <path d="M8 2 4 4l-1 17a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1L20 4l-4-2Z" />
      <path d="M8 2l4 4 4-4" />
      <path d="M12 6v16" />
      <path d="M3.5 13h17" />
    </Glyph>
  )
}

// A coat with the hood up, for the range where you stop dressing for looks.
export function Parka(props) {
  return (
    <Glyph {...props}>
      <path d="M9 4.5 5 6 4 21a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1L19 6l-4-1.5Z" />
      <path d="M9 4.5a3 3 0 0 1 6 0" />
      <path d="M12 7v15" />
    </Glyph>
  )
}

// Cuffed dome with a bobble. Unmistakable at small sizes, which is why the
// coldest bands lead with accessories rather than another coat silhouette.
export function Beanie(props) {
  return (
    <Glyph {...props}>
      <path d="M4 16a8 8 0 0 1 16 0" />
      <path d="M3 16h18v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
      <circle cx="12" cy="4" r="1.6" />
    </Glyph>
  )
}

// Mitten, not a glove: the single thumb keeps it legible where five fingers
// would collapse into a smudge.
export function Mitten(props) {
  return (
    <Glyph {...props}>
      <path d="M8 19.5v-8a4 4 0 0 1 8 0v8" />
      <path d="M8 14.5v-2a2 2 0 0 0-4 0V15a6 6 0 0 0 3 5" />
      <path d="M7 19.5h10V21a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1z" />
    </Glyph>
  )
}

// Shaft, instep, heel — a rain/snow boot, replacing lucide's `Footprints`,
// which drew where you'd walked rather than what to put on.
export function Boot(props) {
  return (
    <Glyph {...props}>
      <path d="M7 3h4v6.4c0 1.2.7 2.3 1.8 2.8l2.9 1.4A4.5 4.5 0 0 1 18 17.7V21H7Z" />
      <path d="M7 16.5h4" />
    </Glyph>
  )
}
