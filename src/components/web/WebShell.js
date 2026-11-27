// The web layout's chunk (see webShellChunk.js): every component App renders
// only in the Web style, and the stylesheet that goes with them. Vite loads the
// CSS ahead of this module and appends it after the main stylesheet, so its
// rules still come after App.css and win the same ties they always did.
//
// Import from here only through loadWebShell — a static import anywhere in the
// main bundle would pull the whole layout back into it.
//
// StormCenter.css isn't imported here: it comes with StormCenterPage, which the
// phones open too (see ../stormCenterChunk.js), so it may land in a shared
// chunk whose CSS loads before WebApp.css. Its rules don't rely on coming later.
import '../../WebApp.css'

export { WebLayout } from './WebLayout'
export { WebTabs } from './WebTabs'
export { WebAlertPill } from './WebAlertPill'
export { SplashHome } from './SplashHome'
export { WebLoadingScreen } from './WebLoadingScreen'
