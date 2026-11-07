// The web version lives in package.json ("version"); bump it there. A named
// JSON import is tree-shaken by Vite, so only the string reaches the bundle.
import { version } from '../../package.json'

export const APP_VERSION = version
export const ANDROID_VERSION = '1.2'
export const IS_ANDROID_APP =
  typeof location !== 'undefined' && location.hostname === 'appassets.androidplatform.net'
