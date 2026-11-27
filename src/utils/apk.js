import { IS_ANDROID_APP } from './version'

// GitHub serves the newest release's asset under this path, so the link never
// needs bumping: the release script always uploads it as AlekWeather.apk.
export const APK_URL =
  'https://github.com/aleksandarangelov06/Alek-Weather/releases/latest/download/AlekWeather.apk'

// An Android phone or tablet in a browser, not the APK's own WebView. The APK
// is Android-only, so iPhones and desktops never see the offer.
export const isAndroidWeb = () =>
  !IS_ANDROID_APP &&
  typeof navigator !== 'undefined' &&
  /Android/i.test(navigator.userAgent)
