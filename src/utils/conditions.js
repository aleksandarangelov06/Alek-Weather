// Thresholds that turn a raw reading into a label, a colour, and a sentence.
// Shared by the mobile details card and the web Details / Air Quality pages so
// the same humidity reading never gets two different verdicts.
//
// Condition colors are the --cond-* variables from App.css, which swap to
// lighter tones on dark and sky-tinted card surfaces so the readings stay
// legible there (e.g. red on a slate-blue card).

export function getAQIInfo(aqi) {
  if (aqi <= 50)  return { label: 'Good',                          color: 'var(--cond-green)' }
  if (aqi <= 100) return { label: 'Moderate',                      color: 'var(--cond-yellow)' }
  if (aqi <= 150) return { label: 'Unhealthy for Sensitive Groups', color: 'var(--cond-orange)' }
  if (aqi <= 200) return { label: 'Unhealthy',                     color: 'var(--cond-red)' }
  if (aqi <= 300) return { label: 'Very Unhealthy',                color: 'var(--cond-purple)' }
  return                 { label: 'Hazardous',                     color: 'var(--cond-violet)' }
}

export function getWindInfo(speed) {
  if (speed < 5)  return { color: 'var(--cond-green)',  size: 13 }
  if (speed < 15) return { color: 'var(--cond-lime)',   size: 15 }
  if (speed < 25) return { color: 'var(--cond-yellow)', size: 17 }
  if (speed < 35) return { color: 'var(--cond-orange)', size: 19 }
  if (speed < 45) return { color: 'var(--cond-red)',    size: 21 }
  return               { color: 'var(--cond-purple)',   size: 23 }
}

export function getHumidityInfo(pct) {
  if (pct < 25) return { color: 'var(--cond-blue)',   label: 'Dry'       }
  if (pct < 50) return { color: 'var(--cond-green)',  label: 'Good'      }
  if (pct < 65) return { color: 'var(--cond-yellow)', label: 'Fair'      }
  if (pct < 80) return { color: 'var(--cond-orange)', label: 'High'      }
  return              { color: 'var(--cond-red)',     label: 'Very High' }
}

export function getPressureInfo(hpa) {
  if (hpa < 980)  return { color: 'var(--cond-red)',    label: 'Stormy'   }
  if (hpa < 1000) return { color: 'var(--cond-orange)', label: 'Low'      }
  if (hpa < 1020) return { color: 'var(--cond-green)',  label: 'Normal'   }
  if (hpa < 1030) return { color: 'var(--cond-blue)',   label: 'High'     }
  return               { color: 'var(--cond-purple)',   label: 'Very High' }
}

export function getVisibilityInfo(miles) {
  if (miles < 0.5) return { color: 'var(--cond-red)',    label: 'Dense Fog' }
  if (miles < 2)   return { color: 'var(--cond-orange)', label: 'Fog'       }
  if (miles < 5)   return { color: 'var(--cond-yellow)', label: 'Haze'      }
  if (miles < 10)  return { color: 'var(--cond-lime)',   label: 'Fair'      }
  return                { color: 'var(--cond-green)',    label: 'Clear'     }
}

// Plain-language notes explaining what each current reading actually means.
export function getHumidityNote(pct) {
  if (pct < 25) return 'Very dry air; expect static and dry skin.'
  if (pct < 50) return 'Comfortable; sweat evaporates easily.'
  if (pct < 65) return 'Slightly humid but still manageable.'
  if (pct < 80) return 'Humid; it will feel muggy outside.'
  return 'Very humid; sweat barely evaporates.'
}

export function getWindNote(speed) {
  if (speed < 5)  return 'Calm; smoke rises almost straight up.'
  if (speed < 15) return 'A light breeze you can feel on your face.'
  if (speed < 25) return 'Breezy; small branches sway.'
  if (speed < 35) return 'Windy; walking into it takes effort.'
  if (speed < 45) return 'Very windy; secure loose objects outside.'
  return 'Damaging winds are possible; stay indoors.'
}

export function getVisibilityNote(miles) {
  if (miles < 0.5) return 'Dense fog; driving is dangerous.'
  if (miles < 2)   return 'Fog; use low beams and slow down.'
  if (miles < 5)   return 'Haze is noticeably limiting distance.'
  if (miles < 10)  return 'Slight haze; mostly clear.'
  return 'Clear; distant objects look sharp.'
}

export function getUVNote(uv) {
  if (uv < 3)  return 'Low risk; no protection needed.'
  if (uv < 6)  return 'Moderate; sunscreen is recommended.'
  if (uv < 8)  return 'High; wear sunscreen and a hat.'
  if (uv < 11) return 'Very high; limit midday sun exposure.'
  return 'Extreme; avoid the sun around midday.'
}

export function getAQINote(aqi) {
  if (aqi <= 50)  return 'Air quality is good; no precautions needed.'
  if (aqi <= 100) return 'Acceptable; very sensitive people may want to ease up outdoors.'
  if (aqi <= 150) return 'Sensitive groups should limit prolonged outdoor exertion.'
  if (aqi <= 200) return 'Everyone should limit prolonged outdoor exertion.'
  if (aqi <= 300) return 'Avoid prolonged outdoor exertion.'
  return 'Avoid all outdoor exertion.'
}

export function getPrecipInfo(pct) {
  if (pct < 20) return { color: 'var(--cond-green)',  label: 'Unlikely'    }
  if (pct < 50) return { color: 'var(--cond-yellow)', label: 'Possible'    }
  if (pct < 80) return { color: 'var(--cond-orange)', label: 'Likely'      }
  return              { color: 'var(--cond-blue)',    label: 'Very Likely' }
}

// CAPE (J/kg): the energy available to a rising parcel of air. It is the fuel
// for thunderstorms, not a forecast of them — something still has to set them
// off — which is why the notes say "if" rather than "will".
export function getStormInfo(cape) {
  if (cape < 300)  return { color: 'var(--cond-green)',  label: 'Minimal'  }
  if (cape < 1000) return { color: 'var(--cond-lime)',   label: 'Low'      }
  if (cape < 2500) return { color: 'var(--cond-yellow)', label: 'Moderate' }
  if (cape < 4000) return { color: 'var(--cond-orange)', label: 'High'     }
  return                { color: 'var(--cond-red)',     label: 'Extreme'  }
}

export function getStormNote(cape) {
  if (cape < 300)  return 'Stable air; thunderstorms are very unlikely.'
  if (cape < 1000) return 'Some instability; a stray storm is possible.'
  if (cape < 2500) return 'Enough energy for thunderstorms if they form.'
  if (cape < 4000) return 'Strong storms are possible if anything sets them off.'
  return 'Explosive instability; severe storms are possible.'
}

// Snowfall over a period, in inches of snow (not water equivalent).
export function getSnowInfo(inches) {
  if (inches <= 0) return { color: 'var(--cond-green)',  label: 'None'       }
  if (inches < 1)  return { color: 'var(--cond-blue)',   label: 'Light'      }
  if (inches < 4)  return { color: 'var(--cond-yellow)', label: 'Moderate'   }
  if (inches < 8)  return { color: 'var(--cond-orange)', label: 'Heavy'      }
  return                { color: 'var(--cond-red)',     label: 'Very Heavy' }
}

// Pollen in grains/m³. Trees, grasses and weeds provoke reactions at very
// different counts, so each group has its own bands (after the US National
// Allergy Bureau scale). Trees take the worst of alder, birch and olive, weeds
// the worst of mugwort and ragweed.
const POLLEN_GROUPS = {
  Tree:  { keys: ['alder_pollen', 'birch_pollen', 'olive_pollen'], bands: [15, 90, 1500] },
  Grass: { keys: ['grass_pollen'],                                 bands: [5, 20, 200] },
  Weed:  { keys: ['mugwort_pollen', 'ragweed_pollen'],             bands: [10, 50, 500] },
}
const POLLEN_LEVELS = [
  { label: 'None',      color: 'var(--cond-green)'  },
  { label: 'Low',       color: 'var(--cond-green)'  },
  { label: 'Moderate',  color: 'var(--cond-yellow)' },
  { label: 'High',      color: 'var(--cond-orange)' },
  { label: 'Very High', color: 'var(--cond-red)'    },
]
const POLLEN_NOTES = [
  'No pollen in the air right now.',
  'Low; only the most sensitive will notice.',
  'Moderate; allergy sufferers may feel it.',
  'High; most allergy sufferers will have symptoms.',
  'Very high; keep windows shut and limit time outside.',
]

// Per-group levels plus the worst of them, or null where the feed has no
// pollen at all (anywhere outside Europe).
export function getPollenInfo(aq) {
  if (!aq) return null
  const groups = []
  for (const [name, { keys, bands }] of Object.entries(POLLEN_GROUPS)) {
    const readings = keys.map((k) => aq[k]).filter((v) => v != null && Number.isFinite(v))
    if (!readings.length) continue
    const count = Math.max(...readings)
    const level = count < 1 ? 0 : 1 + bands.filter((b) => count >= b).length
    groups.push({ name, count, level, ...POLLEN_LEVELS[level] })
  }
  if (!groups.length) return null
  const worst = groups.reduce((a, b) => (b.level > a.level ? b : a))
  return { groups, worst, note: POLLEN_NOTES[worst.level] }
}

// Pressure trend over the last 3 hours — the part that actually forecasts
// anything. A ±1 hPa deadband keeps normal noise from reading as a trend.
export function getPressureTrend(hourly, hStart) {
  const series = hourly?.surface_pressure
  if (!series || hStart < 3) return null
  const now  = series[hStart]
  const past = series[hStart - 3]
  if (now == null || past == null) return null
  const delta = now - past
  if (delta > 1)  return { label: 'Rising',  delta, note: 'Pressure is rising; conditions are improving.' }
  if (delta < -1) return { label: 'Falling', delta, note: 'Pressure is falling; conditions may deteriorate.' }
  return { label: 'Steady', delta, note: 'Pressure is steady; little change expected.' }
}
