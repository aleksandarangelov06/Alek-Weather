export const APP_VERSION = '3.5'

// Version of the Android wrapper, which ships on its own cadence from the web
// app: the APK is a WebView shell around this same build, so a change to one
// does not imply a release of the other. Kept in step with versionName in
// android/app/build.gradle and with the GitHub release tag.
export const ANDROID_VERSION = '0.2'

// The APK serves the build from a WebViewAssetLoader on this host, so it is
// also what distinguishes "running inside the APK" from the Pages site.
export const IS_ANDROID_APP =
  typeof location !== 'undefined' && location.hostname === 'appassets.androidplatform.net'
