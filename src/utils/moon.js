// Moon phase from the date alone — no API carries it. Counts mean synodic
// months from a known new moon, which drifts by well under a day against the
// true phase: plenty for a name, an illumination percentage, and a date.

const SYNODIC_DAYS = 29.530588853
const REF_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14) // 2000-01-06 18:14 UTC
const DAY_MS = 86400000

// Upper bounds of each named phase as a fraction of the cycle. The quarter and
// full names cover about two days each, the way a printed calendar uses them.
const PHASES = [
  [0.034, 'New Moon'],
  [0.216, 'Waxing Crescent'],
  [0.284, 'First Quarter'],
  [0.466, 'Waxing Gibbous'],
  [0.534, 'Full Moon'],
  [0.716, 'Waning Gibbous'],
  [0.784, 'Last Quarter'],
  [0.966, 'Waning Crescent'],
  [1, 'New Moon'],
]

// `phase` runs 0 → 1 from new moon through full (0.5) and back.
export function getMoonInfo(date = new Date()) {
  const age = ((date - REF_NEW_MOON) / DAY_MS) % SYNODIC_DAYS
  const phase = (age < 0 ? age + SYNODIC_DAYS : age) / SYNODIC_DAYS
  const illumination = (1 - Math.cos(2 * Math.PI * phase)) / 2
  const name = PHASES.find(([end]) => phase < end)[1]
  const daysTo = (target) => ((target - phase + 1) % 1) * SYNODIC_DAYS
  return {
    phase,
    illumination,
    name,
    waxing: phase < 0.5,
    nextFull: new Date(+date + daysTo(0.5) * DAY_MS),
    nextNew: new Date(+date + daysTo(0) * DAY_MS),
    daysToFull: Math.round(daysTo(0.5)),
    daysToNew: Math.round(daysTo(0)),
  }
}
