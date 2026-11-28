// Renders the home-screen widget icons from the app's own weather glyphs.
//
//   node scripts/widget-icons.mjs
//
// Widgets are RemoteViews, which can't show an SVG and whose VectorDrawables
// can't express the Fluent art's transformed radial gradients. So the glyphs in
// src/components/weatherGlyphs.jsx are turned back into plain SVG here and
// rasterized with sharp into drawable-nodpi PNGs, which the widget ImageViews
// scale down to their dp size. Rerun this after changing a glyph; the PNGs are
// committed so the Android build doesn't need Node for them.
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

const GLYPHS = 'src/components/weatherGlyphs.jsx'
const ICON = 'src/components/WeatherIcon.jsx'
const OUT = 'android/app/src/main/res/drawable-nodpi'
// 48dp at xxxhdpi. The largest widget icon is 44dp.
const SIZE = 192

// JSX glyph body -> SVG markup. Covers exactly what weatherGlyphs.jsx uses:
// templated ids, camelCase presentation attributes, CSS-variable fills that
// carry a hex fallback, and className.
function jsxToSvg(body) {
  return body
    .replace(/\{`\$\{u\}-(\w+)`\}/g, '"u-$1"')
    .replace(/\{`url\(#\$\{u\}-(\w+)\)`\}/g, '"url(#u-$1)"')
    .replace(/var\(--[\w-]+,\s*(#[0-9A-Fa-f]+)\)/g, '$1')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/className=/g, 'class=')
    .replace(
      /\b(stopColor|stopOpacity|strokeWidth|strokeLinecap|strokeLinejoin|fillRule|clipRule|fillOpacity|strokeOpacity|strokeMiterlimit)=/g,
      (_, a) => a.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()) + '=',
    )
    .replace(/=\{([\d.]+)\}/g, '="$1"')
}

const wrap = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${SIZE}" height="${SIZE}" fill="none">${body}</svg>`

const svgs = {}
const text = fs.readFileSync(GLYPHS, 'utf8')
const re = /export function (\w+)Glyph\(\{ u \}\) \{\s*return \(\s*<>([\s\S]*?)<\/>\s*\)\s*\}/g
for (const m of text.matchAll(re)) {
  const name = m[1].charAt(0).toLowerCase() + m[1].slice(1)
  const body = jsxToSvg(m[2])
  if (/[{}]/.test(body.replace(/"[^"]*"/g, ''))) throw new Error(`unconverted JSX left in ${name}`)
  svgs[name] = body
}

// stormStrong: the storm cloud plus WeatherIcon's second bolt.
const bolt = fs.readFileSync(ICON, 'utf8').match(/const STORM_BOLT = '([^']+)'/)?.[1]
if (!bolt || !svgs.storm) throw new Error('storm glyph or STORM_BOLT not found')
svgs.stormStrong = svgs.storm +
  '<g transform="translate(-6.4 1.5)"><defs><linearGradient id="u-bolt2" x1="16.0347" y1="12.6133" x2="16.0347" y2="25.8114" gradientUnits="userSpaceOnUse">' +
  '<stop offset="0.3542" stop-color="#FF9B49"/><stop offset="1" stop-color="#FF4E4B"/></linearGradient></defs>' +
  `<path d="${bolt}" fill="url(#u-bolt2)" stroke="#FFE0B0" stroke-width="0.5" stroke-linejoin="round"/></g>`

// Fog is a stroke icon drawn in currentColor (FogIcon in WeatherIcon.jsx), so it
// comes in the two inks App.css gives it: the mid-tone for light surfaces and
// the bright mist for dark and sky ones.
const fog = (ink) =>
  `<g stroke="${ink}" stroke-width="2.4" stroke-linecap="round" fill="none">` +
  '<line x1="11" y1="7" x2="26" y2="7" opacity="0.85"/><line x1="6" y1="13" x2="21" y2="13"/>' +
  '<line x1="11" y1="19" x2="26" y2="19" opacity="0.9"/><line x1="6" y1="25" x2="21" y2="25" opacity="0.95"/></g>' +
  `<g fill="${ink}"><circle cx="6" cy="7" r="1.4" opacity="0.85"/><circle cx="26" cy="13" r="1.4"/>` +
  '<circle cx="6" cy="19" r="1.4" opacity="0.9"/><circle cx="26" cy="25" r="1.4" opacity="0.95"/></g>'
svgs.fog = fog('#5b6672')
svgs.fogBright = fog('rgba(255,255,255,0.9)')

fs.mkdirSync(OUT, { recursive: true })
for (const [name, body] of Object.entries(svgs)) {
  // Android resource names: lowercase and underscores only.
  const file = path.join(OUT, `wx_${name.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase())}.png`)
  await sharp(Buffer.from(wrap(body)), { density: 72 * (SIZE / 32) })
    .resize(SIZE, SIZE)
    .png({ compressionLevel: 9 })
    .toFile(file)
  console.log('wrote', file)
}
