// The web version lives in package.json ("version"); bump it there. A named
// JSON import is tree-shaken by Vite, so only the string reaches the bundle.
import { version } from '../../package.json'

export const APP_VERSION = version
export const ANDROID_VERSION = '2.1'
// The release channel, shown after the version wherever it is displayed
// ("4.0.1 Beta"). Display only: the versions themselves stay plain numbers,
// because the APK's update check compares release tags numerically and a
// suffix in a tag would read as an older version. Empty for a stable release.
export const APP_CHANNEL = 'Beta'
export const APP_VERSION_LABEL = APP_CHANNEL ? `${APP_VERSION} ${APP_CHANNEL}` : APP_VERSION
export const ANDROID_VERSION_LABEL = APP_CHANNEL ? `${ANDROID_VERSION} ${APP_CHANNEL}` : ANDROID_VERSION
export const IS_ANDROID_APP =
  typeof location !== 'undefined' && location.hostname === 'appassets.androidplatform.net'
