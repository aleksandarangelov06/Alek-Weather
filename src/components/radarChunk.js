// The radar chunk's one loader, shared by the lazy wrapper and anything that
// wants to fetch it ahead of time. Memoised, so a preload and a mount never
// start two downloads, and it records the component once it lands so the
// wrapper can render it directly — React.lazy suspends for a tick on its first
// render even when the module is already in, which is a frame of skeleton the
// web Radar tab would show every time it is opened from cold.
let promise = null
let component = null

export function loadWeatherRadar() {
  // A failed fetch (offline at preload time) is forgotten, so the next caller —
  // the tab actually opening — tries again instead of inheriting the failure.
  promise ??= import('./WeatherRadar')
    .then((m) => (component = m.WeatherRadar))
    .catch((e) => { promise = null; throw e })
  return promise
}

export function loadedWeatherRadar() {
  return component
}
