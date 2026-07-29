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
