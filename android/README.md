# Alek Weather for Android

This folder builds the Android app. It's the normal `vite build` output wrapped in a WebView, plus a bit of native code for the things a web page can't do: notifications while the app is closed, self-updates, haptics, the launch screen and the system bars.

The web app stays the single source of the UI. There's no second copy to keep in sync, and nothing in the web config differs between the APK and the GitHub Pages site. It's a hand-rolled Gradle project rather than Capacitor or a Trusted Web Activity. Unlike a TWA, the APK carries its own copy of the build, so it keeps working if the Pages site is down.

For what the app does and how releases work overall, see the [main README](../README.md).

## How it works

Everything lives in `app/src/main/java/com/alekweather/app/`.

`MainActivity.kt` holds a single WebView. A `WebViewAssetLoader` serves the bundled build from `https://appassets.androidplatform.net/`, mounted at `/`. A real https origin, rather than `file://`, is what lets the Content Security Policy (`'self'`), the service worker and per-origin `localStorage` work. Mounting at `/` means the app's absolute paths (`/logo-dark.svg` and so on) resolve unchanged, so the build's base path stays `/`. The web code detects the APK by that hostname (`IS_ANDROID_APP` in `src/utils/version.js`).

Some details that took figuring out:

- **Service worker requests skip `WebViewClient`**, so a `ServiceWorkerClientCompat` routes them through the same asset loader. Without it the app still opens, but the Workbox precache never installs and offline doesn't work.
- **Location needs two grants.** The WebView's own geolocation prompt only counts once Android's location permission is held, so `grantGeolocation` asks for that first and answers the WebView from the result. A denial isn't remembered, so the in-app locate button can ask again.
- **Links to other sites** open in the real browser. Only the app's own pages stay in the WebView.
- **Dark mode:** the theme is `Theme.AppCompat.DayNight` with algorithmic darkening allowed, so the web app's "System" theme sees the right `prefers-color-scheme`. The window background matches the PWA's background color, so there's no white flash before the page paints.
- **Edge to edge:** the bars are transparent and the page draws behind them. A WebView only fills `env(safe-area-inset-*)` from a display cutout, so the real bar insets are pushed to the page as `--android-inset-*` CSS variables. They can also be read at startup through `AndroidBars.insets()`, so the first frame is already laid out right.
- **Bar icon colors** follow the page. A small script injected after the first paint watches `<meta name="theme-color">` and the body background (which the app keeps matched to the top and bottom of the sky), and calls `AndroidBars.setBarAppearance`. The status and navigation icons then flip between light and dark as the sky changes.
- **The launch screen** is native. `BootOverlay` redraws the page's boot animation on a `SurfaceView` with its own thread, using artwork rendered once by `BootArt` from path data in `BootPaths`. In a WebView, even a CSS-only animation stutters during a cold start, because Chromium, the bundle and the first render all compete for the same threads. The page lifts the overlay through `AndroidBoot` when it's ready, with a 10-second fallback. If the artwork fails to render, the bridge isn't registered and the page shows its own boot screen instead.
- **Predictive back:** every in-app overlay (settings, search, saved places, the full-screen radar, the alert map) is a history entry in the page. While the WebView can go back, an `OnBackPressedCallback` streams the back gesture to the page as `alekback` events, and `src/utils/predictiveBack.js` animates the overlay closing under your finger. When there's nothing left to close, the callback switches off and Android plays its own back-to-home animation.
- **Backgrounded means paused.** `onPause` pauses the WebView and its timers, so the animated sky isn't redrawing hundreds of raindrops behind the launcher. The background weather check isn't affected.
- The activity is locked to portrait.

### Bridges

The page and the native side talk through JavaScript interfaces registered in `MainActivity.onCreate`:

| Name in the page | Kotlin class | Methods | Used by |
| --- | --- | --- | --- |
| `AndroidBars` | `BarsBridge` | `insets()`, `setBarAppearance(status, nav)` | `src/main.jsx`, the injected bar-color watcher |
| `AndroidBoot` | `BootBridge` | `active()`, `look(theme, sky)`, `lift()` | `src/utils/bootStage.js`, `public/boot-sky.js` |
| `AndroidTheme` | `ThemeBridge` | `systemSeed()` | `src/utils/materialTheme.js` |
| `AndroidNotify` | `NotifyBridge` | `permission()`, `requestPermission()`, `syncSettings(json)` | `src/utils/notifications.js` |
| `AndroidUpdate` | `Updater` | `currentVersion()`, `check()`, `install(url)` | `SettingsPage.jsx`, `UpdateToast.jsx` |
| `AndroidHaptics` | `HapticBridge` | `tap()`, `heavy()` | `src/utils/haptics.js` |

`AndroidBoot` is only registered while the native launch screen is up.

Answers that take time come back as `CustomEvent`s on `window`: `alekupdate`, `alekupdateprogress` and `aleknotifpermission`, plus `alekback` for the back gesture.

If you add a bridge, there are two rules:

1. Add a keep rule for it in [`app/proguard-rules.pro`](app/proguard-rules.pro). R8 strips methods that only JavaScript calls, so an unlisted bridge works in debug and fails in release with "not a function", with no warning at build time.
2. Make the page cope with the bridge missing. People run older APKs with newer web code inside, and an APK built before the bridge won't have it.

## Notifications

A WebView has no Notifications API. A notification is also only useful if it arrives while the app is closed, which no page script can do. So notifications are entirely native:

1. Whenever its notification settings or the location change, the page calls `AndroidNotify.syncSettings` with the on/off switch, the enabled types, the coordinates and the temperature unit.
2. `NotifyStore` keeps that in SharedPreferences (`alek_notif`), along with a record of what has already been sent.
3. `WeatherCheckWorker` runs on WorkManager about once an hour, plus once each time the app is opened, whenever there's a network connection. It fetches Open-Meteo itself and, in the US, overlays the NWS forecast with `NwsForecast.kt`. That's a narrow Kotlin port of the merge in `src/hooks/useWeather.js`, covering just the fields the rules read.
4. `WeatherNotifier` posts to a single "Weather" channel, with an icon that matches the weather (`res/drawable/ic_notify_*`).

The rules:

- **Rain, snow and storms:** the worst spell of precipitation in the next 12 hours, with when it starts and how long it lasts. It sends at most one a day, unless a worse spell turns up later, which replaces it. Between 10 pm and 7 am only severe weather gets through (violent downpours, freezing rain or drizzle, and thunderstorms).
- **Weather alerts:** each NWS alert for the location, once (up to 200 alert IDs are remembered), at any hour.
- **Tomorrow:** a summary of tomorrow, once a day, between 5 and 10 pm local time.

These rules only look at the forecast. The page's current-conditions logic (station reports, radar, the nowcast) isn't used here, and nothing notifies about what the sky is doing this minute.

WorkManager keeps the schedule in its own database, so it survives reboots, force-stops and app updates without a boot receiver of ours. Doze can push a run into the next maintenance window, so treat "hourly" as a minimum gap rather than a promise. A run that fails on the network retries with backoff instead of waiting an hour.

## Updates

The app updates itself from GitHub Releases:

- **When it checks:** 4 seconds after launch, at most every 6 hours, and when you tap Check in Settings > App updates. The automatic check only shows a bar when there's something newer. Tapping "Later" skips that version but not the next one.
- **What a check does:** `Updater.check()` asks the GitHub API for the latest release, strips the `v` from its tag and compares it as dotted numbers with the installed `versionName`. It offers the first `.apk` asset it finds.
- **What install accepts:** `install()` only takes the exact URL the last check found, under `github.com/aleksandarangelov06/Alek-Weather/releases/download/`, so the page can't hand the installer an arbitrary file.
- **The install-apps permission:** if the app isn't allowed to install apps yet, Android's settings page for it opens instead.
- **Install:** the APK downloads to the app's cache with progress reported back to the page. It goes to the system installer through a `FileProvider` URI.
- **Confirmation:** Android always asks before installing, and refuses an APK signed with a different key than the installed one.

## Building

### Toolchain

You need JDK 17, Gradle 8.7, and the Android SDK platform and build-tools 34, all under `~/android-tools`. The build script points `JAVA_HOME` and `ANDROID_HOME` at them itself, so nothing has to be on your `PATH` and there's no `local.properties` to keep out of the repo.

```text
~/android-tools/
  jdk/jdk-17.*/     Temurin 17. JDK 21 and later won't work with AGP 8.2.2.
  gradle-8.7/       Gradle 8.x. AGP 8.2.2 doesn't support Gradle 9.
  sdk/              ANDROID_HOME: cmdline-tools/latest, platforms/android-34,
                    build-tools/34.0.0, platform-tools
```

To set that up from scratch, download [Temurin 17][t], [Gradle 8.7][g] and the [Android command-line tools][c] into that layout (the command-line tools go in `sdk/cmdline-tools/latest`). Then accept the licenses and install the SDK packages:

```powershell
$env:JAVA_HOME = "$env:USERPROFILE\android-tools\jdk\jdk-17.0.20+8"   # your JDK folder
$sdk = "$env:USERPROFILE\android-tools\sdk"
& "$sdk\cmdline-tools\latest\bin\sdkmanager.bat" --sdk_root=$sdk --licenses
& "$sdk\cmdline-tools\latest\bin\sdkmanager.bat" --sdk_root=$sdk `
    platform-tools "platforms;android-34" "build-tools;34.0.0"
```

The script finds any `jdk-17*` folder by itself, so a newer 17.x patch release is fine.

[t]: https://adoptium.net/temurin/releases/?version=17&os=windows&arch=x64
[g]: https://services.gradle.org/distributions/gradle-8.7-bin.zip
[c]: https://developer.android.com/studio#command-line-tools-only

### Build

From the repo root:

```powershell
# debug: AlekWeather-debug.apk
powershell -ExecutionPolicy Bypass -File android\build-apk.ps1

# signed release: AlekWeather.apk
powershell -ExecutionPolicy Bypass -File android\build-apk.ps1 -Release
```

`build-apk.ps1` runs `npm run build` and wipes `app/src/main/assets`, so stale hashed bundles don't pile up. It then copies `dist/` in, runs Gradle's `assembleDebug` or `assembleRelease`, and copies the APK to the repo root. The assets folder and both APKs are gitignored.

Debug builds are marked debuggable, so don't publish them. Anything you share should be a `-Release` build.

Keep `build-apk.ps1` plain ASCII. Windows PowerShell 5.1 reads a `.ps1` without a BOM as ANSI, so a stray non-ASCII character, even in a comment, breaks the parser with an error on some unrelated line.

### Release signing

`-Release` needs `android/keystore.properties`, which `app/build.gradle` reads:

```properties
storeFile=C:/Users/you/keys/alek-weather.jks
storePassword=...
keyAlias=...
keyPassword=...
```

Use forward slashes (or doubled backslashes) in the path, since this is a Java properties file. A relative path resolves against `android/app/`. Both this file and the keystore stay out of the repo: the properties file is gitignored, and the keystore should live somewhere else entirely.

Keep a backup of the keystore. Every release has to be signed with the same key, or Android refuses to install it as an update. Without the key, everyone on the current version would have to uninstall before they could get a new one.

Without `keystore.properties`, the script refuses to make a release build rather than produce an unsigned APK.

### What a release build does

- R8 shrinks the code and resources (`minifyEnabled`, `shrinkResources`). This mostly trims the AndroidX libraries; the app's own Kotlin is small. [`app/proguard-rules.pro`](app/proguard-rules.pro) keeps the bridge classes and `WeatherCheckWorker`'s constructor (WorkManager creates it by name), and keeps line numbers so crash reports stay readable.
- Only English resources are kept (`resourceConfigurations += ['en']`). The UI is the web page, which is English throughout, so the libraries' strings in about 85 other languages would never show.
- The result is small: the 2.1 release APK is about 1.6 MB.

The app targets and compiles against API 34, with a minimum of API 26 (Android 8.0).

## Versions

Three numbers move together on every Android release:

- `versionCode` in `app/build.gradle`. It must go up every time (2.1 is `21`).
- `versionName` in `app/build.gradle`, for example `"2.1"`. The updater compares this against release tags.
- `ANDROID_VERSION` in `src/utils/version.js`, which Settings shows inside the app.

The release tag is `v` plus the `versionName` (`v2.1`), with no suffix: the updater compares numbers, and `v2.2-beta` would look older than it is. The "Beta" label comes from `APP_CHANNEL` in the same file instead. The APK attached to the release has to be named `AlekWeather.apk`, because the website's download link points at `releases/latest/download/AlekWeather.apk`. The full checklist is in the [main README](../README.md#releasing).

## Permissions

| Permission | Why |
| --- | --- |
| `INTERNET` | Everything |
| `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION` | Local weather. Asked for the first time you use your location. |
| `POST_NOTIFICATIONS` | Weather notifications. Asked when you turn them on (Android 13 and later). |
| `REQUEST_INSTALL_PACKAGES` | Handing a downloaded update to the installer |

WorkManager adds a few of its own when the manifests merge (for example `RECEIVE_BOOT_COMPLETED`, so the schedule comes back after a reboot).

## Installing

1. Get `AlekWeather.apk` onto the phone: download it from the [latest release](https://github.com/aleksandarangelov06/Alek-Weather/releases/latest), or copy it over USB.
2. Open it and allow installs from that app when asked (Settings > Apps > Special access > Install unknown apps).
3. Play Protect may warn about an unknown developer. That's normal for an app installed outside the Play Store.

After that, the app updates itself (see [Updates](#updates)). You can also install a newer release APK over the old one, as long as it's signed with the same key.

## If it ever goes on the Play Store

Some groundwork is already in place: release builds are signed with their own keystore, and `versionCode` goes up on every release. What's still missing:

- **A bundle, not an APK.** Play takes an `.aab`, built with the `:app:bundleRelease` task. Run `~/android-tools/gradle-8.7/bin/gradle.bat :app:bundleRelease` from this folder, with `JAVA_HOME` and `ANDROID_HOME` set the way `build-apk.ps1` sets them.
- **A newer target SDK.** Play's target API requirement has moved past 34, so `compileSdk`/`targetSdk`, and probably the Android Gradle Plugin, would need raising first.
- **No self-updater.** Play doesn't allow apps to update themselves outside the store, so a Play build would have to drop the updater and `REQUEST_INSTALL_PACKAGES`.
- **A privacy policy,** since the app asks for location.

The location question is worth getting ahead of in review. Location is only used for local weather. The coordinates go to the weather services the app reads from and to BigDataCloud to name the place, and nowhere else.
