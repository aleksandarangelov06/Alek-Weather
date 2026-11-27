// Splits an NWS alert's text (its description or instruction) into the
// paragraphs the alert page and sheet show (WeatherAlerts.jsx), as NWS wrote
// them. Paragraphs are separated by blank lines; the single line breaks inside
// one are only NWS's 69-column wrapping, so they become spaces (or nothing,
// after a word hyphenated across the break: "one-\nthird" is "one-third").
function unwrap(block) {
  return block
    .replace(/-\s*\n\s*/g, '-')
    .replace(/\s*\n\s*/g, ' ')
    .trim()
}

export function alertParagraphs(text) {
  if (!text) return []
  return text.split(/\n\s*\n/).map(unwrap).filter(Boolean)
}

// The same paragraphs, with a forecast laid out as one: marine (and some fire
// weather) alerts write theirs as ".TODAY...E winds 45 kt. Seas 9 ft.
// .TONIGHT...E winds 40 kt." Unwrapped, that ran every period together into
// one block. Each period becomes { label, text }, the words left as issued;
// everything else stays a paragraph. Returns a list of
// { kind: 'text', text } and { kind: 'periods', periods }.
const PERIOD_RE = /\.([A-Z][A-Z ]*?)\.\.\.([\s\S]*?)(?=\s*\.[A-Z][A-Z ]*?\.\.\.|$)/g

const DAY_NAMES = {
  MON: 'Monday', TUE: 'Tuesday', WED: 'Wednesday', THU: 'Thursday', FRI: 'Friday', SAT: 'Saturday', SUN: 'Sunday',
}

// "SAT NIGHT" → "Saturday night", "REST OF TODAY" → "Rest of today".
function periodName(raw) {
  const words = raw.trim().toLowerCase().split(/\s+/)
  const day = DAY_NAMES[words[0].toUpperCase()]
  if (day) words[0] = day.toLowerCase()
  const text = words.join(' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export function alertBlocks(text) {
  return alertParagraphs(text).map((para) => {
    if (!/^\.[A-Z][A-Z ]*?\.\.\./.test(para)) return { kind: 'text', text: para }
    const periods = [...para.matchAll(PERIOD_RE)]
      .map((m) => ({ label: periodName(m[1]), text: m[2].trim() }))
      .filter((p) => p.text)
    return periods.length ? { kind: 'periods', periods } : { kind: 'text', text: para }
  })
}

// The forecaster's headline ("...GALE WARNING IN EFFECT THROUGH LATE
// TONIGHT... ...HEAVY FREEZING SPRAY WARNING IN EFFECT..."), one line per
// statement, without the ellipses that only separate them. The words and
// their capitals are left as issued: lowering them would also lower the
// place names in them.
export function headlineLines(headline) {
  if (!headline) return []
  return headline
    .split(/\.{3,}/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

// Warning, Watch, Advisory or Statement, from the event's name.
export function alertTierName(event) {
  const e = (event ?? '').trim()
  if (/warning$/i.test(e)) return 'Warning'
  if (/watch$/i.test(e)) return 'Watch'
  if (/advisory$/i.test(e)) return 'Advisory'
  return 'Statement'
}
