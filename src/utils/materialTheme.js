// Material You palette generation.
//
// Material's own tokens come from HCT (a CAM16 hue/chroma paired with an L*
// lightness). Shipping the real HCT solver would mean pulling in Google's
// material-color-utilities, so this approximates it in CIELCh instead: the same
// idea — fixed hue, fixed chroma, tone == L* — in a space the browser math can
// reach in ~60 lines. Hues land within a few degrees of the reference tokens,
// which is well inside what anyone can see on a settings card.
//
// A palette is one hue at four chroma levels (primary/secondary/neutral/neutral
// variant); a token is one (palette, tone) pair, picked to match the M3 spec.

const DEFAULT_SEED = '#6750a4'

// Chroma per palette role. Primary keeps the seed's own chroma (floored, so a
// near-grey seed still reads as a color); the rest are fixed, which is what
// gives every seed the same muted surfaces and near-neutral text.
const PALETTE_CHROMA = {
  primary: null, // seed chroma, floored at PRIMARY_MIN_CHROMA
  secondary: 16,
  neutral: 4,
  neutralVariant: 8,
}
const PRIMARY_MIN_CHROMA = 40
// Below this the seed is grey/black/white and its hue is just rounding noise —
// flooring the chroma there would pick a color at random, so go monochrome.
const ACHROMATIC = 2

// [palette, tone] per token, per scheme. Mirrors the M3 light/dark schemes.
const TOKENS = {
  light: {
    'primary':                ['primary', 40],
    'on-primary':             ['primary', 100],
    'surface':                ['neutral', 98],
    'surface-container':      ['neutral', 94],
    'surface-container-high': ['neutral', 92],
    'secondary-container':    ['secondary', 90],
    'on-secondary-container': ['secondary', 10],
    'outline':                ['neutralVariant', 50],
    'on-surface':             ['neutral', 10],
    'on-surface-variant':     ['neutralVariant', 30],
  },
  dark: {
    'primary':                ['primary', 80],
    'on-primary':             ['primary', 20],
    'surface':                ['neutral', 6],
    'surface-container':      ['neutral', 12],
    'surface-container-high': ['neutral', 22],
    'secondary-container':    ['secondary', 30],
    'on-secondary-container': ['secondary', 90],
    'outline':                ['neutralVariant', 60],
    'on-surface':             ['neutral', 90],
    'on-surface-variant':     ['neutralVariant', 80],
  },
}

// ── sRGB ⇄ CIELab (D65) ──────────────────────────────────────────────────────

const WHITE = [0.3127 / 0.3290, 1, (1 - 0.3127 - 0.3290) / 0.3290] // D65 in XYZ

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const toSrgb   = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055)

function hexToLch(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => toLinear(v / 255))

  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / WHITE[0]
  const y = (0.2126729 * r + 0.7151522 * g + 0.0721750 * b) / WHITE[1]
  const z = (0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / WHITE[2]
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (t * 24389 / 27 + 16) / 116)
  const [fx, fy, fz] = [f(x), f(y), f(z)]

  const A = 500 * (fx - fy)
  const B = 200 * (fy - fz)
  return {
    l: 116 * fy - 16,
    c: Math.hypot(A, B),
    h: (Math.atan2(B, A) * 180 / Math.PI + 360) % 360,
  }
}

// Returns linear-RGB channels, which may fall outside [0,1] (out of gamut).
function lchToLinearRgb(l, c, h) {
  const rad = h * Math.PI / 180
  const A = c * Math.cos(rad)
  const B = c * Math.sin(rad)

  const fy = (l + 16) / 116
  const fx = fy + A / 500
  const fz = fy - B / 200
  const inv = (t) => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) * 27 / 24389)
  const x = inv(fx) * WHITE[0]
  const y = (l > 8 ? fy ** 3 : l * 27 / 24389) * WHITE[1]
  const z = inv(fz) * WHITE[2]

  return [
     3.2404542 * x - 1.5371385 * y - 0.4985314 * z,
    -0.9692660 * x + 1.8760108 * y + 0.0415560 * z,
     0.0556434 * x - 0.2040259 * y + 1.0572252 * z,
  ]
}

const inGamut = (rgb) => rgb.every(v => v >= -1e-4 && v <= 1 + 1e-4)

// Tone + hue are the identity of a Material color, so when a (tone, chroma)
// pair falls outside sRGB — saturated yellows at low tones, most hues near
// white — chroma is what gives way. Binary search for the most colorful
// in-gamut version rather than clipping channels, which would shift the hue.
function lchToHex(l, c, h) {
  let rgb = lchToLinearRgb(l, c, h)
  if (!inGamut(rgb)) {
    let lo = 0, hi = c
    for (let i = 0; i < 16; i++) {
      const mid = (lo + hi) / 2
      if (inGamut(lchToLinearRgb(l, mid, h))) lo = mid
      else hi = mid
    }
    rgb = lchToLinearRgb(l, lo, h)
  }
  return '#' + rgb
    .map(v => Math.round(Math.min(1, Math.max(0, toSrgb(Math.min(1, Math.max(0, v))))) * 255)
      .toString(16).padStart(2, '0'))
    .join('')
}

// ── Public API ───────────────────────────────────────────────────────────────

export { DEFAULT_SEED }

export const isValidSeed = (hex) => typeof hex === 'string' && /^#?[0-9a-f]{6}$/i.test(hex.trim())

/**
 * Build the --md-* token set for one scheme from a seed color.
 * @param {string} seed   hex color, e.g. '#6750a4'
 * @param {'light'|'dark'} scheme
 * @returns {Record<string, string>} CSS custom property name → hex
 */
export function materialTokens(seed, scheme) {
  const base = hexToLch(seed) ?? hexToLch(DEFAULT_SEED)
  const grey = base.c < ACHROMATIC
  const chroma = grey
    ? { primary: 0, secondary: 0, neutral: 0, neutralVariant: 0 }
    : { ...PALETTE_CHROMA, primary: Math.max(base.c, PRIMARY_MIN_CHROMA) }
  const out = {}
  for (const [token, [palette, tone]] of Object.entries(TOKENS[scheme])) {
    out[`--md-${token}`] = lchToHex(tone, chroma[palette], base.h)
  }
  return out
}

/**
 * Paint (or clear) the generated tokens as inline custom properties on an
 * element — inline styles outrank the stylesheet's baseline purple, so the
 * default seed is applied by clearing rather than by writing the same values.
 */
export function applyMaterialTokens(el, seed, scheme) {
  const clear = !seed || seed.toLowerCase() === DEFAULT_SEED
  const tokens = clear ? null : materialTokens(seed, scheme)
  for (const token of Object.keys(TOKENS[scheme])) {
    const prop = `--md-${token}`
    if (tokens) el.style.setProperty(prop, tokens[prop])
    else el.style.removeProperty(prop)
  }
}
