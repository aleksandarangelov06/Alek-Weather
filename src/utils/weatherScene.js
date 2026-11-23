// Which particle scene WeatherCanvas draws for a weather code (null: none).
// Shared with the phone's sky stage, which uses it to tell whether a new code
// actually changes the picture.
export function sceneFor(code) {
  if (code == null) return null
  if (code === 95 || code === 96 || code === 99) return 'storm'
  if (code === 65 || code === 82) return 'downpour'
  if ((code >= 51 && code <= 63) || code === 80 || code === 81) return 'rain'
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow'
  if (code === 45 || code === 48) return 'fog'
  if (code === 3) return 'overcast'
  if (code === 2) return 'partly'
  return null
}
