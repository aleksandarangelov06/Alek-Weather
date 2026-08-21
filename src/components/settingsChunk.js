// The settings screen's dynamic import, kept out of SettingsPageLazy.jsx so that
// file exports components and nothing else — which is what Fast Refresh needs to
// swap it without dropping the app's state. Same split, and the same reason, as
// weatherGlyphs.jsx next to WeatherIcon.
export const loadSettingsPage = () => import('./SettingsPage')

// Unlike the radar, which the reader scrolls to, settings opens on a tap and is
// expected to be there on the next frame. Warming the chunk on pointerdown buys
// the fetch the pointer's own travel and release — enough on any real connection
// that the screen is already loaded by the time the click lands.
export function preloadSettings() {
  loadSettingsPage()
}
