# Alek Weather

A weather app for the web and Android. The forecast comes from Open-Meteo. In the US, the current conditions are also checked against the National Weather Service and NOAA's live radar.

That check exists because forecast models are often wrong about right now. Open-Meteo's model once had "Violent Showers" on screen on a dry, sunny afternoon. So the app trusts station reports, warnings and radar over the model whenever it has them, and the note at the bottom of the forecast tells you which one it went with.

[Web app](https://aleksandarangelov06.github.io/Alek-Weather/) · [Android APK](https://github.com/aleksandarangelov06/Alek-Weather/releases/latest/download/AlekWeather.apk) · [Releases](https://github.com/aleksandarangelov06/Alek-Weather/releases)

Current release: web 4.0.2 Beta, Android 2.2 Beta.

## What it does

The main screen shows the current conditions with a stack of cards under them. By default, from the top:

- **Weather insight**: notes on the rest of today and tomorrow, a conditions summary, the air quality and what to wear.
- **At a glance**: today's (or tomorrow's) low, high and current temperature, how it compares with yesterday, ratings for being outdoors, driving and exercise, and anything to watch out for.
- **Precipitation**: the next hour in 15-minute steps. It also says when rain or snow has just started or stopped.
- **Hourly forecast**: a timeline you can switch between temperature, feels like, chance of rain, wind, humidity and UV.
- **7-day forecast**: tap a day to see its hours.
- **Details**: tiles for precipitation, storms, humidity, wind, pressure, visibility, sun & UV, and air quality.
- **Radar**: tap to open it full screen.

The order is yours. Tap "Reorder cards" at the bottom of the forecast to drag them around or hide the first two.

Each Details tile opens into a full page with more behind it: today's rain total and the peak over the next day, a storm risk level worked out from rain chance, gusts and CAPE, dew point, the pressure trend, the lowest visibility ahead, first light, golden hour and last light, and the AQI broken down by pollutant.

### Places and alerts

Search for anywhere, or use your current location. Holding the search button skips the search page and locates you. You can save places and make one Home, which is what the app opens on.

With no forecast open, the home screen shows your location and saved places as cards with their current weather. Hold a card for more options.

Active NWS alerts show up above the forecast. Open one to read it in full and see a map of the area it covers.

### Radar

In the US the radar timeline plays observed frames first, then carries on into the HRRR model's forecast. By default it uses NOAA's MRMS national mosaic when zoomed out and switches to the nearest NEXRAD station up close. Outside the US it's RainViewer, observed frames only.

You can pin it to one source in Settings > Radar:

- **MRMS**: about 1 km resolution, smooth at any zoom, updated about every 5 minutes.
- **NEXRAD**: the nearest single station at 0.25 km, the sharpest view, but it only reaches about 230 km.
- **RainViewer**: global, but coarser and updated less often.

The same screen has the timeline setting (observed and forecast on one scrubber, or split behind a toggle) and Enhanced accuracy, which is explained further down.

### Looks

There are three styles: iOS, with frosted-glass cards; Android, using Material You colors; and Web, a desktop and tablet layout with Home, This week, Details and Radar tabs. Web isn't offered on phones because its header doesn't fit.

Each style has light and dark themes. On Android 12 and later, the Android app can also take its colors from your wallpaper.

Behind the forecast there's an animated sky that matches the weather (rain, snow, drifting clouds, fog, lightning), which can tilt with your phone. Other options:

- separate cards or one connected sheet
- how much of the sky shows through the cards
- color or line icons, animated or still
- color coding readings by how hot, cold or severe they are

### The Android app

The APK is the same web app in a native shell, with its own copy of the build. It doesn't load the website. It adds a few things the web can't do:

- Notifications for rain, snow and storms on the way, NWS alerts, and a summary of tomorrow, all for your Home place (or your first saved place if there's no Home). The forecast is checked about once an hour in the background, even with the app closed. Ordinary rain, snow and the summary stay quiet overnight (the summary comes between 5 and 10 pm), but severe weather and alerts come through whenever they're issued.
- Updates from GitHub. The app checks for a newer release on its own every few hours, and you can check any time in Settings > App updates. The download goes to Android's installer, which still asks you to confirm.
- Haptics on presses, which you can turn off under Settings > Touch.
- Android's predictive back gesture, a native launch screen, and status and navigation bars that match the sky.

### Speed and offline

The last reading for up to five recently opened places stays on the device for a day, so the app opens straight onto it and refreshes in the background. After that, a reading refreshes once it's 10 minutes old, and the radar check repeats every 5 minutes while the app is open.

The web app is a PWA. Once it's installed, the app itself loads without a connection, though forecasts still need one. When a new version is deployed, a bar at the bottom offers to reload onto it; nothing reloads on its own.

A slow NWS, radar or air quality service can't hold the forecast up for long. Air quality never holds it: its tile fills in when it lands. Once Open-Meteo has answered, the forecast waits at most 2.5 seconds more for the NWS and at most 3.5 seconds from the start for the radar. Either one that answers later is added when it arrives.

Open-Meteo is free, but each internet connection gets about 600 requests a minute, 5,000 an hour and 10,000 a day. When that runs out (it can happen on shared Wi-Fi), the app stops asking, keeps showing what it has and tries again later. Settings > About > Help has the details.

## How "right now" is decided

1. Open-Meteo provides the forecast everywhere, including a 15-minute nowcast for the next few hours.
2. In the US, the NWS hourly forecast replaces Open-Meteo's for the next day or two, and active alerts and nearby weather stations are checked.
3. If a station has a recent report, or there's an active warning, that decides the current condition. If not, a confident NWS hourly forecast can stand in for the model.
4. The nowcast then corrects anything that came only from the model. One example is a "Thunderstorm" that hasn't arrived yet, because models tend to label a whole afternoon with the storm.
5. With Enhanced accuracy on (the default), radar gets the last word, unless there's an active severe warning:
   - It reads NOAA's MRMS radar at your location and four points about 1.5 km around it. Outside the US, or when MRMS doesn't answer, it uses RainViewer.
   - If there's nothing over you and nothing falling right around you, rain or snow the forecast made up is cleared.
   - If you're inside a solid echo, precipitation shows even when the forecast says dry. The radar's strength sets how heavy it is, and the wet-bulb temperature decides rain or snow, which catches the snow that falls at 33 to 36°F.
   - A change has to show up on two radar sweeps in a row before it counts, so the edge of a passing cell doesn't flip the headline back and forth.

MRMS serves its radar as colored images without publishing what the colors mean, so the app turns the colors back into dBZ itself. That color scale was calibrated against the Iowa Environmental Mesonet's NEXRAD composite. The notes are at the top of [`src/hooks/useRadarPrecip.js`](src/hooks/useRadarPrecip.js).

## Where the data comes from

Everything is free and public, and nothing needs an API key.

| Source | Used for |
| --- | --- |
| [Open-Meteo](https://open-meteo.com/) | Forecast, nowcast, air quality, place search |
| [National Weather Service](https://www.weather.gov/documentation/services-web-api) | US hourly and daily forecasts, station observations, alerts |
| NOAA MRMS (`mapservices.weather.noaa.gov`) | US radar map, Enhanced accuracy |
| [Iowa Environmental Mesonet](https://mesonet.agron.iastate.edu/) | NEXRAD station radar, HRRR forecast radar |
| [RainViewer](https://www.rainviewer.com/api.html) | Radar outside the US, and the fallback |
| [OpenFreeMap](https://openfreemap.org/) | The map under the radar |
| [BigDataCloud](https://www.bigdatacloud.com/) | The name of the place you're standing in |
| Google Fonts | Google Sans and Inter |

## Settings

On a phone, Settings is laid out like this. The Web style has the same options, grouped into sections down the side.

- **Appearance**
  - Theme: light, dark or system. Its page also has the app style (iOS, Android, Web), the Material You color and card transparency.
  - Layout: separate cards or connected (phone styles only).
  - Color Coding: per card (hourly, 7-day, insight, details), plus a heat glow and a frozen effect at the extremes.
  - Weather Effects: the animated sky, and gyroscope tilt on phones.
  - Icons: color or line, animated or not.
- **Units**: °F/°C; wind in mph, km/h, m/s or knots; pressure in inHg, hPa or mmHg; visibility in miles or km; precipitation in inches or mm. Switching doesn't refetch anything.
- **Tiles**
  - Precipitation: on, off, or auto (only when it's raining or about to be).
  - Radar: timeline, Enhanced accuracy and source.
- **Touch** (Android app): haptics.
- **Notifications** (Android app): an on/off switch, then rain, snow and storms; weather alerts; and tomorrow's weather.
- **Other**
  - App updates in the Android app, and an APK download link when you're in a browser on an Android phone.
  - Add to Home Screen, where the browser supports it.
  - Clear cache, which keeps your settings and places.
  - Delete all data, which doesn't.
  - About and Help.

## Installing

**Web**: just open <https://aleksandarangelov06.github.io/Alek-Weather/>. To install it, use your browser's install button (Chrome, Edge) or Settings > Add to Home Screen in the app. On an iPhone or iPad, use Share > Add to Home Screen in Safari.

**Android** (8.0 or later): download [AlekWeather.apk](https://github.com/aleksandarangelov06/Alek-Weather/releases/latest/download/AlekWeather.apk) and open it. Android will ask you to allow installs from your browser or file manager the first time. It may also warn about an unknown developer, which is normal for anything installed outside the Play Store. After that, updates come through Settings > App updates.

## Running it locally

You need Node.js 20 or newer. There's no backend and no `.env` to set up.

```bash
git clone https://github.com/aleksandarangelov06/Alek-Weather.git
cd Alek-Weather
npm install
npm run dev        # dev server at http://localhost:5173
```

Other scripts:

```bash
npm run build      # production build into dist/ (service worker, manifest, CSP)
npm run preview    # serve that build locally
npm test           # unit tests (Vitest)
npm run test:watch
npm run lint       # ESLint
```

The build assumes it's served from `/`. For a subfolder, set `VITE_BASE_PATH`. The GitHub Pages deploy uses `/Alek-Weather/`.

To see the phone styles on a desktop, turn on your browser's device toolbar.

### Layout of the code

```text
index.html               app shell and the inline boot screen
vite.config.js           Vite, the PWA plugin and the Content Security Policy
src/
  main.jsx               entry point
  App.jsx                app state, layout and navigation
  App.css                phone styles (iOS and Android) and the sky
  WebApp.css             the Web layout
  components/            cards, pages, radar, settings, search
    web/                 the Web layout's tabs and pages
  hooks/
    useWeather.js        the forecast pipeline (loadForecast) and the weather hook
    useRadarPrecip.js    radar sampling for Enhanced accuracy
  utils/                 weather codes, units, themes, radar layers, haptics
android/                 the Android shell (Kotlin and Gradle), with its own README
.github/workflows/       GitHub Pages deploy
```

A few things that aren't obvious from the file names:

- Every style is the same React app. `<html>` gets `data-shell` (`mobile` or `desktop`) and `data-platform` (`ios` or `android`), and the CSS works off those.
- Everything is fetched straight from the browser. Settings, saved places and cached readings live in `localStorage` under `alek-weather-*` keys.
- Settings, the Web layout and the map libraries are split into their own chunks. MapLibre alone is about 1.6 MB, so it only downloads when a map first opens.
- Production builds get a Content Security Policy that lists every host the app is allowed to contact. If you add a data source, add its host in `vite.config.js` too. Otherwise the production build blocks it without any visible error, while it keeps working in dev.
- `loadForecast` is shared by the main forecast and the home screen's place cards, so the two can't disagree.

### Tests

`npm test` runs in under a second. The tests cover:

- the forecast pipeline against a fake network (timeouts, stalled services, a stalled radar)
- parsing NWS data
- reading dBZ out of MRMS colors, using real colors from the calibration
- the radar's two-sweep logic, wet-bulb rain or snow, and intensity from radar strength
- the At a glance comparisons and activity ratings
- which US radar region a location falls in

## Building the Android app

The APK wraps the normal `vite build` output in a WebView served from `https://appassets.androidplatform.net`. [`android/README.md`](android/README.md) has the full toolchain setup: JDK 17, Gradle 8.7 and Android SDK 34, all under `~/android-tools`. Then:

```powershell
# debug build -> AlekWeather-debug.apk
powershell -ExecutionPolicy Bypass -File android\build-apk.ps1

# signed release build -> AlekWeather.apk
powershell -ExecutionPolicy Bypass -File android\build-apk.ps1 -Release
```

A release build needs `android/keystore.properties` pointing at a keystore outside the repo. Both are gitignored. Don't publish debug builds, because they're marked debuggable.

The page talks to Android through JavaScript bridges defined in `MainActivity.kt`:

- `AndroidBars`: system bar colors and insets
- `AndroidBoot`: the native launch screen
- `AndroidTheme`: the wallpaper color
- `AndroidNotify`: settings for the background worker
- `AndroidUpdate`: the updater
- `AndroidHaptics`: haptics

One gotcha: release builds are shrunk by R8, which strips code that only JavaScript calls. If you add a bridge, keep it in [`android/app/proguard-rules.pro`](android/app/proguard-rules.pro). Otherwise it works in debug and fails in release with "not a function", and nothing warns you at build time.

Notifications don't go through the page at all. `WeatherCheckWorker` runs on WorkManager about once an hour and fetches Open-Meteo and the NWS itself, since no page script runs while the app is closed.

## Releasing

The web app deploys itself: every push to `main` builds and publishes to GitHub Pages ([`deploy.yml`](.github/workflows/deploy.yml)).

For the Android app:

1. Raise `versionCode` and set `versionName` in [`android/app/build.gradle`](android/app/build.gradle) (2.1 is `21`). `versionCode` has to go up every time.
2. Set `ANDROID_VERSION` (and `APP_CHANNEL`, `'Beta'` or empty) in [`src/utils/version.js`](src/utils/version.js) to match, and bump `version` in `package.json` if the web app changed.
3. Build with `-Release`.
4. Make a GitHub release tagged `vX.Y` and attach the APK as `AlekWeather.apk`. Keep the tag to plain numbers, because the updater compares tags numerically and something like `v2.2-beta` would look older. The file name matters too, since the download link points at `releases/latest/download/AlekWeather.apk`.
5. Sign every release with the same keystore. Android won't install an update signed with a different key.

## Privacy

There are no accounts, ads or analytics. Settings, places and cached forecasts stay in the browser's or app's own storage, and Settings > Delete all data wipes them.

To get a forecast, the app sends the place's coordinates to the weather services in the table above. If you use your current location, the coordinates also go to BigDataCloud to get the place's name. The Android app only asks for location so it can show local weather, and its notifications are worked out on the phone from the same public services.

## Credits

Weather data from [Open-Meteo](https://open-meteo.com/) (CC BY 4.0), the [National Weather Service](https://www.weather.gov/) and NOAA, the [Iowa Environmental Mesonet](https://mesonet.agron.iastate.edu/) at Iowa State, and [RainViewer](https://www.rainviewer.com/). Maps from [OpenFreeMap](https://openfreemap.org/), using [OpenMapTiles](https://openmaptiles.org/) and [OpenStreetMap](https://www.openstreetmap.org/copyright) data. Place names from [BigDataCloud](https://www.bigdatacloud.com/).

Built with React, Vite, vite-plugin-pwa, Leaflet, MapLibre GL, dnd-kit, Lucide and Vitest.

Made by Alek Studios™.

## License

No license yet.
