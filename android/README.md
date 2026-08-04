# Alek Weather (Android APK)

Packages the existing web app as a sideloadable Android app. The web app stays
the single source of truth: this wraps the ordinary `vite build` output in a
WebView, so there is no second copy of the UI to keep in sync and no web-side
config that differs between the APK and the GitHub Pages deploy.

Same approach as `../../mcbusy-app` — a hand-rolled Gradle project rather than
Capacitor or a Trusted Web Activity. Unlike a TWA, the APK carries its own copy
of the build, so it does not depend on the Pages site being up.

## How it works

- **`MainActivity.kt`** — one WebView, served by a `WebViewAssetLoader` mounted
  at `/` on `https://appassets.androidplatform.net`. Serving over a real https
  origin rather than `file://` is what makes the injected CSP (`'self'`), the
  service worker, and per-origin localStorage all work. Mounting at `/` is what
  lets the app's absolute paths (`/logo-dark.svg`, `/pwa-icon.svg`) resolve
  unchanged, so `base` stays `/` for both build targets.
- **Geolocation** is a two-step grant: the WebView's own prompt only counts once
  the OS permission is held, so `onGeolocationPermissionsShowPrompt` requests
  `ACCESS_FINE_LOCATION` first and answers the WebView from the result.
- **Service worker requests bypass `WebViewClient`**, so a
  `ServiceWorkerClientCompat` routes them through the same loader. Without it
  the app still opens but the Workbox precache fails and offline never works.
- **Theme** is `Theme.AppCompat.DayNight` + algorithmic darkening, so the web
  app's "system" theme setting sees the right `prefers-color-scheme`.
- **Notifications are native, not web.** A WebView exposes no Notifications API,
  and — more to the point — a notification is only worth having if it arrives
  when the app is closed, which no page script can do. So `WeatherCheckWorker`
  (WorkManager, hourly) fetches Open-Meteo and the NWS itself and applies the
  rules that used to live in `src/utils/notifications.js`; the page's only job is
  to mirror the toggles, the current location, and the unit into
  `NotifyStore` through `AndroidNotify.syncSettings`. Opening the app enqueues
  one extra check, so both paths share the one dedup record and a rain
  notification still fires once a day, not once per path.

  WorkManager keeps its schedule in its own database, so it survives reboot,
  force-stop, and app update with no boot receiver of ours (the library merges
  in `RECEIVE_BOOT_COMPLETED` and its own receiver). Doze can push an hourly run
  into the next maintenance window — treat the hour as a floor. Rain and the
  daily summary stay quiet overnight; the summary fires between 17:00 and 22:00
  local, and NOAA alerts fire whenever they arrive.

## Build

Needs JDK 17, Gradle 8.7, and Android SDK platform/build-tools 34 — all already
installed under `~/android-tools` (the same toolchain McBusy uses).

```
powershell -ExecutionPolicy Bypass -File android\build-apk.ps1
```

Runs `npm run build`, copies `dist/` into `app/src/main/assets`, and assembles.
Output: `AlekWeather.apk` in the repo root (~3.2 MB).

## Install (sideload)

1. Copy `AlekWeather.apk` to the phone (USB, Drive, email to yourself).
2. Tap it in a file manager and allow installs from that app
   (Settings > Apps > Special access > Install unknown apps).
3. Debug-signed, so Play Protect may warn about an unknown developer. Expected
   for a personal sideload.

## Play Store, later

This build is debug-signed and cannot be uploaded as-is. It needs:

- a release keystore, kept out of the repo, wired into a `signingConfigs` block
- `./gradlew :app:bundleRelease` for an `.aab` (Play takes bundles, not APKs)
- `versionCode` bumped on every upload; it is still `1`
- a privacy policy, since the app requests location

The location permission is the one review question worth pre-empting: it is used
only for local forecasts and never leaves the device except as coordinates sent
to Open-Meteo.
