package com.alekweather.app

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.webkit.GeolocationPermissions
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.graphics.ColorUtils
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.ServiceWorkerClientCompat
import androidx.webkit.ServiceWorkerControllerCompat
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat
import androidx.webkit.WebViewFeature
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import org.json.JSONObject

/**
 * Alek Weather: a single WebView hosting the Vite build that lives in
 * `assets/` (copied there from `dist/` by `build-apk.ps1`).
 *
 * The build is served through a WebViewAssetLoader rather than loaded as a
 * `file://` URL. That matters for three reasons: the injected CSP is written
 * in terms of `'self'`, which is meaningless at a null `file://` origin; the
 * service worker only registers on a real http(s) origin; and localStorage
 * (theme, saved locations, units) is partitioned per-origin. The loader is
 * mounted at "/" so the app's absolute paths -- `/logo-dark.svg`,
 * `/pwa-icon.svg` -- resolve unchanged, and no web-side build config differs
 * between the APK and the GitHub Pages deploy.
 *
 * The window is edge to edge: both system bars are transparent and the page
 * paints the full height of the screen. See [applyEdgeToEdge] and [pushInsets]
 * for how content is kept clear of them, and [BarsBridge] for how the bar icons
 * stay legible against a sky gradient that changes through the day.
 */
class MainActivity : AppCompatActivity() {
    private lateinit var web: WebView

    /** Held while the system location prompt is up; see [onRequestPermissionsResult]. */
    private var pendingGeoOrigin: String? = null
    private var pendingGeoCallback: GeolocationPermissions.Callback? = null

    /** Latest system bar insets, in CSS pixels. Applied once the page is ready. */
    private var insetTopCss = 0f
    private var insetRightCss = 0f
    private var insetBottomCss = 0f
    private var insetLeftCss = 0f
    private var pageReady = false

    /** Single worker for the update check/download so they never touch the UI thread. */
    private val updateIo = Executors.newSingleThreadExecutor()

    /**
     * Whether the POST_NOTIFICATIONS prompt has been shown at least once. Lets
     * [NotifyBridge.permission] tell "never asked" (default) from "asked and
     * denied", which the web toggle renders differently. Persisted so a denial
     * survives relaunch. Only meaningful on Android 13+.
     */
    private var notifAsked = false

    companion object {
        const val DOMAIN = "appassets.androidplatform.net"
        const val START_URL = "https://$DOMAIN/index.html"
        const val REQ_LOCATION = 1
        const val REQ_NOTIF = 2

        /** Notification channel for weather notifications (rain, alerts, tomorrow). */
        const val NOTIF_CHANNEL = "weather"
        const val NOTIF_PREFS = "alek_notif"

        /** Below this relative luminance a background needs light (white) icons. */
        const val LIGHT_ICON_THRESHOLD = 0.5

        /** GitHub Releases API for the sideload self-update (see [Updater]). */
        const val LATEST_RELEASE_URL =
            "https://api.github.com/repos/aleksandarangelov06/Alek-Weather/releases/latest"
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        applyEdgeToEdge()
        createNotificationChannel()
        notifAsked = getSharedPreferences(NOTIF_PREFS, MODE_PRIVATE).getBoolean("asked", false)

        val loader = WebViewAssetLoader.Builder()
            .setDomain(DOMAIN)
            .addPathHandler("/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        web = WebView(this)
        setContentView(web)

        web.settings.apply {
            javaScriptEnabled = true
            // localStorage: theme choice, saved locations, unit preferences.
            domStorageEnabled = true
            setGeolocationEnabled(true)
            loadWithOverviewMode = false
            useWideViewPort = false
        }

        // Lets the WebView report prefers-color-scheme: dark when the app is in
        // night mode, which is what the web app's "system" theme setting reads.
        if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
            WebSettingsCompat.setAlgorithmicDarkeningAllowed(web.settings, true)
        }

        web.addJavascriptInterface(BarsBridge(), "AndroidBars")
        web.addJavascriptInterface(Updater(), "AndroidUpdate")
        web.addJavascriptInterface(NotifyBridge(), "AndroidNotify")

        // The page paints under the bars, so it needs to know how much of the
        // top and bottom is covered. Insets can arrive before or after the page
        // is ready, so both paths call pushInsets and it no-ops until both are.
        ViewCompat.setOnApplyWindowInsetsListener(web) { _, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout(),
            )
            val density = resources.displayMetrics.density
            insetTopCss = bars.top / density
            insetRightCss = bars.right / density
            insetBottomCss = bars.bottom / density
            insetLeftCss = bars.left / density
            pushInsets()
            // Returned unconsumed: the WebView still needs these to populate
            // env(safe-area-inset-*) for the page's own CSS.
            insets
        }

        web.webViewClient = object : WebViewClientCompat() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest,
            ): WebResourceResponse? = loader.shouldInterceptRequest(request.url)

            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest,
            ): Boolean {
                // Keep the app's own pages in the WebView; hand anything else
                // (attribution links, external forecasts) to the real browser.
                if (request.url.host == DOMAIN) return false
                startActivity(Intent(Intent.ACTION_VIEW, request.url))
                return true
            }

            override fun onPageFinished(view: WebView, url: String) {
                pageReady = true
                pushInsets()
                watchBarColors()
            }
        }

        // A service worker's own fetches bypass WebViewClient entirely, so the
        // Workbox precache would try to resolve appassets.androidplatform.net
        // over the real network and fail to install. Route them through the
        // same loader; without this the app still opens but never works offline.
        if (WebViewFeature.isFeatureSupported(WebViewFeature.SERVICE_WORKER_BASIC_USAGE) &&
            WebViewFeature.isFeatureSupported(WebViewFeature.SERVICE_WORKER_SHOULD_INTERCEPT_REQUEST)
        ) {
            ServiceWorkerControllerCompat.getInstance().setServiceWorkerClient(
                object : ServiceWorkerClientCompat() {
                    override fun shouldInterceptRequest(
                        request: WebResourceRequest,
                    ): WebResourceResponse? = loader.shouldInterceptRequest(request.url)
                },
            )
        }

        web.webChromeClient = object : WebChromeClient() {
            override fun onGeolocationPermissionsShowPrompt(
                origin: String,
                callback: GeolocationPermissions.Callback,
            ) {
                grantGeolocation(origin, callback)
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (web.canGoBack()) web.goBack() else finish()
            }
        })

        if (savedInstanceState != null) web.restoreState(savedInstanceState)
        else web.loadUrl(START_URL)
    }

    /**
     * Transparent system bars with the page painting behind them, so the sky
     * gradient runs the full height of the screen instead of stopping at two
     * grey strips.
     */
    private fun applyEdgeToEdge() {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.statusBarColor = Color.TRANSPARENT
        window.navigationBarColor = Color.TRANSPARENT
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            // Otherwise the system paints its own translucent scrim behind the
            // gesture pill, which reads as a faint band over the gradient.
            window.isNavigationBarContrastEnforced = false
            window.isStatusBarContrastEnforced = false
        }
    }

    /**
     * Feeds the real system bar insets to the page as the --android-inset-*
     * custom properties on :root.
     *
     * The page draws behind the bars, so it needs to know how much of each edge
     * is covered. A WebView only fills env(safe-area-inset-*) from a display
     * cutout, so on a phone with no notch those read 0 while the bars still
     * overlap the page. The CSS routes every inset through
     * max(env(...), var(--android-inset-*)), so setting these variables covers
     * exactly the shortfall and reaches fixed/sticky elements (search, settings,
     * radar) that body padding never could. Left at 0 in the browser, where env
     * is already correct.
     */
    private fun pushInsets() {
        if (!pageReady) return
        val js = """
            (function (top, right, bottom, left) {
              var s = document.documentElement.style;
              s.setProperty('--android-inset-top', top + 'px');
              s.setProperty('--android-inset-right', right + 'px');
              s.setProperty('--android-inset-bottom', bottom + 'px');
              s.setProperty('--android-inset-left', left + 'px');
            })($insetTopCss, $insetRightCss, $insetBottomCss, $insetLeftCss);
        """.trimIndent()
        web.evaluateJavascript(js, null)
    }

    /**
     * Mirrors the page's own bar colours back to the system icons.
     *
     * The app already keeps `<meta name="theme-color">` matched to the top of
     * the sky and the body background matched to the bottom, for the benefit of
     * installed-PWA Chrome. Reusing those means the icons follow the sky through
     * dawn and dusk and follow an in-app theme override, with no web changes.
     */
    private fun watchBarColors() {
        val js = """
            (function () {
              if (window.__alekBarsWatch) { window.__alekBarsWatch(); return; }
              function report() {
                var metas = document.querySelectorAll('meta[name="theme-color"]');
                var meta = null;
                for (var i = 0; i < metas.length; i++) {
                  // Prefer the one whose media query currently applies; the app
                  // sets them all to the same value once it has a forecast.
                  if (!metas[i].media || window.matchMedia(metas[i].media).matches) {
                    meta = metas[i];
                    break;
                  }
                }
                var status = meta ? meta.content : '';
                var nav = window.getComputedStyle(document.body).backgroundColor;
                try { AndroidBars.setBarAppearance(status, nav); } catch (e) {}
              }
              window.__alekBarsWatch = report;
              new MutationObserver(report).observe(document.head,
                { subtree: true, attributes: true, attributeFilter: ['content'] });
              new MutationObserver(report).observe(document.body,
                { attributes: true, attributeFilter: ['style', 'class'] });
              new MutationObserver(report).observe(document.documentElement,
                { attributes: true, attributeFilter: ['data-theme', 'style'] });
              report();
            })();
        """.trimIndent()
        web.evaluateJavascript(js, null)
    }

    inner class BarsBridge {
        /**
         * @param statusColor colour behind the status bar, as the page sees it
         * @param navColor colour behind the navigation bar
         *
         * Called from a WebView JS thread, so the window touch has to be posted
         * back to the UI thread.
         */
        @JavascriptInterface
        fun setBarAppearance(statusColor: String, navColor: String) {
            val status = parseCssColor(statusColor)
            val nav = parseCssColor(navColor)
            runOnUiThread {
                val controller = WindowCompat.getInsetsController(window, web)
                // "Light bars" means dark icons, which is what a light
                // background needs -- the naming reads backwards.
                status?.let {
                    controller.isAppearanceLightStatusBars =
                        ColorUtils.calculateLuminance(it) > LIGHT_ICON_THRESHOLD
                }
                nav?.let {
                    controller.isAppearanceLightNavigationBars =
                        ColorUtils.calculateLuminance(it) > LIGHT_ICON_THRESHOLD
                }
            }
        }
    }

    /** Creates the channel the weather notifications post to (required on 26+). */
    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                NOTIF_CHANNEL,
                "Weather",
                NotificationManager.IMPORTANCE_DEFAULT,
            ).apply { description = "Rain, weather alerts, and the daily forecast" }
            (getSystemService(NOTIFICATION_SERVICE) as NotificationManager)
                .createNotificationChannel(channel)
        }
    }

    /** Reports a POST_NOTIFICATIONS outcome to the page as an aleknotifpermission event. */
    private fun emitNotifPermission(state: String) {
        emitUpdate("aleknotifpermission", JSONObject.quote(state))
    }

    /**
     * Web notifications for the APK, bound as `window.AndroidNotify`. A WebView
     * exposes no Notifications API, so the web build (utils/notifications.js)
     * talks to this instead: it reads and requests the POST_NOTIFICATIONS grant
     * and posts system notifications through NotificationManager.
     */
    inner class NotifyBridge {
        /** 'granted' | 'denied' | 'default', mirroring web Notification.permission. */
        @JavascriptInterface
        fun permission(): String {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                val granted = ContextCompat.checkSelfPermission(
                    this@MainActivity, Manifest.permission.POST_NOTIFICATIONS,
                ) == PackageManager.PERMISSION_GRANTED
                if (granted) return "granted"
                // Never asked reads as "default" so the toggle offers to prompt;
                // once asked and refused it stays "denied" across relaunches.
                return if (notifAsked) "denied" else "default"
            }
            // Pre-13 has no runtime permission; the channel is live unless the
            // user switched notifications off in system settings.
            return if (NotificationManagerCompat.from(this@MainActivity).areNotificationsEnabled()) {
                "granted"
            } else {
                "denied"
            }
        }

        /** Opens the OS prompt when needed; the result returns via emitNotifPermission. */
        @JavascriptInterface
        fun requestPermission() {
            runOnUiThread {
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
                    emitNotifPermission(
                        if (NotificationManagerCompat.from(this@MainActivity).areNotificationsEnabled()) "granted" else "denied",
                    )
                    return@runOnUiThread
                }
                if (ContextCompat.checkSelfPermission(
                        this@MainActivity, Manifest.permission.POST_NOTIFICATIONS,
                    ) == PackageManager.PERMISSION_GRANTED
                ) {
                    emitNotifPermission("granted")
                    return@runOnUiThread
                }
                notifAsked = true
                getSharedPreferences(NOTIF_PREFS, MODE_PRIVATE).edit().putBoolean("asked", true).apply()
                ActivityCompat.requestPermissions(
                    this@MainActivity,
                    arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                    REQ_NOTIF,
                )
            }
        }

        /**
         * Posts (or replaces) a notification. `tag` doubles as the dedup key, so
         * re-firing the same alert updates the existing one rather than stacking.
         * The runtime check keeps NotificationManagerCompat from throwing on 13+
         * when the grant is missing.
         */
        @SuppressLint("MissingPermission")
        @JavascriptInterface
        fun notify(tag: String, title: String, body: String) {
            val mgr = NotificationManagerCompat.from(this@MainActivity)
            if (!mgr.areNotificationsEnabled()) return
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                ContextCompat.checkSelfPermission(
                    this@MainActivity, Manifest.permission.POST_NOTIFICATIONS,
                ) != PackageManager.PERMISSION_GRANTED
            ) {
                return
            }

            val intent = Intent(this@MainActivity, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
            val pending = PendingIntent.getActivity(
                this@MainActivity,
                tag.hashCode(),
                intent,
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            val notification = NotificationCompat.Builder(this@MainActivity, NOTIF_CHANNEL)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(NotificationCompat.BigTextStyle().bigText(body))
                .setContentIntent(pending)
                .setAutoCancel(true)
                .build()
            mgr.notify(tag, tag.hashCode(), notification)
        }
    }

    /** Handles the `#rrggbb` and `rgb()`/`rgba()` forms the page produces. */
    private fun parseCssColor(value: String?): Int? {
        val raw = value?.trim().orEmpty()
        if (raw.isEmpty()) return null
        return try {
            when {
                raw.startsWith("#") -> Color.parseColor(raw)
                raw.startsWith("rgb") -> {
                    val parts = raw.substringAfter('(').substringBefore(')')
                        .split(',')
                        .map { it.trim() }
                    if (parts.size < 3) return null
                    // A fully transparent body background tells us nothing about
                    // what will actually show through behind the bar.
                    if (parts.size >= 4 && parts[3].toFloat() == 0f) return null
                    Color.rgb(parts[0].toInt(), parts[1].toInt(), parts[2].toInt())
                }
                else -> null
            }
        } catch (e: IllegalArgumentException) {
            null
        } catch (e: NumberFormatException) {
            null
        }
    }

    /**
     * The WebView's geolocation prompt is separate from Android's: granting it
     * only matters once the OS permission is held, so ask for that first and
     * answer the WebView from the result.
     */
    private fun grantGeolocation(origin: String, callback: GeolocationPermissions.Callback) {
        val granted = ContextCompat.checkSelfPermission(
            this, Manifest.permission.ACCESS_FINE_LOCATION,
        ) == PackageManager.PERMISSION_GRANTED

        if (granted) {
            callback.invoke(origin, true, false)
            return
        }

        pendingGeoOrigin = origin
        pendingGeoCallback = callback
        ActivityCompat.requestPermissions(
            this,
            arrayOf(
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION,
            ),
            REQ_LOCATION,
        )
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray,
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)

        if (requestCode == REQ_NOTIF) {
            val ok = grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED
            emitNotifPermission(if (ok) "granted" else "denied")
            return
        }

        if (requestCode != REQ_LOCATION) return

        val callback = pendingGeoCallback ?: return
        val origin = pendingGeoOrigin
        pendingGeoCallback = null
        pendingGeoOrigin = null

        val ok = grantResults.isNotEmpty() &&
            grantResults.any { it == PackageManager.PERMISSION_GRANTED }
        // `retain = false`: a denial here should not be remembered, so the user
        // can retry from the app's own "use my location" button.
        callback.invoke(origin, ok, false)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onDestroy() {
        updateIo.shutdownNow()
        super.onDestroy()
    }

    /** Installed versionName, e.g. "0.2"; "" if it can't be read. */
    private fun installedVersion(): String = try {
        packageManager.getPackageInfo(packageName, 0).versionName ?: ""
    } catch (e: PackageManager.NameNotFoundException) {
        ""
    }

    /**
     * Delivers an update result/progress object to the page as a DOM CustomEvent,
     * so the web side subscribes with addEventListener rather than us needing a
     * global callback to already exist. Must run on the WebView's thread.
     */
    private fun emitUpdate(event: String, detailJson: String) {
        runOnUiThread {
            web.evaluateJavascript(
                "window.dispatchEvent(new CustomEvent('$event', { detail: $detailJson }))",
                null,
            )
        }
    }

    /**
     * The sideload self-updater, bound as `window.AndroidUpdate` and used only
     * from the APK's Settings (the web build gates it behind the appassets host).
     *
     * It exists because the app is sideloaded, not from Play: it asks the GitHub
     * Releases API for the latest tag, and — on request — downloads that release's
     * APK and hands it to the system package installer. The install is never
     * silent; Android always shows its own confirm dialog, and the APK must carry
     * the same signature as the installed one (our releases share a keystore) or
     * the update is refused. All network runs on [updateIo]; results come back as
     * `alekupdate` / `alekupdateprogress` CustomEvents.
     */
    inner class Updater {
        @JavascriptInterface
        fun currentVersion(): String = installedVersion()

        /** Compare the latest release tag with the installed version; report back. */
        @JavascriptInterface
        fun check() {
            updateIo.execute {
                try {
                    val release = JSONObject(httpGet(LATEST_RELEASE_URL))
                    val latest = release.optString("tag_name").removePrefix("v").trim()
                    val current = installedVersion()
                    val apkUrl = apkAssetUrl(release)
                    val out = JSONObject()
                        .put("current", current)
                        .put("latest", latest)
                    if (apkUrl != null && isNewer(latest, current)) {
                        out.put("status", "available").put("url", apkUrl)
                    } else {
                        out.put("status", "current")
                    }
                    emitUpdate("alekupdate", out.toString())
                } catch (e: Exception) {
                    emitUpdate("alekupdate", errorJson(e))
                }
            }
        }

        /** Download the given release APK and launch the system installer. */
        @JavascriptInterface
        fun install(url: String) {
            updateIo.execute {
                try {
                    // Android O+ gates sideloaded installs behind a per-app toggle;
                    // send the user to grant it rather than failing silently.
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
                        !packageManager.canRequestPackageInstalls()
                    ) {
                        runOnUiThread {
                            startActivity(
                                Intent(
                                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                                    Uri.parse("package:$packageName"),
                                ),
                            )
                        }
                        emitUpdate("alekupdate", JSONObject().put("status", "permission").toString())
                        return@execute
                    }
                    val apk = downloadApk(url)
                    launchInstaller(apk)
                } catch (e: Exception) {
                    emitUpdate("alekupdate", errorJson(e))
                }
            }
        }
    }

    private fun errorJson(e: Exception): String =
        JSONObject().put("status", "error").put("error", e.message ?: "Network error").toString()

    /** First .apk asset's browser_download_url, or null if the release has none. */
    private fun apkAssetUrl(release: JSONObject): String? {
        val assets = release.optJSONArray("assets") ?: return null
        for (i in 0 until assets.length()) {
            val asset = assets.optJSONObject(i) ?: continue
            if (asset.optString("name").endsWith(".apk", ignoreCase = true)) {
                return asset.optString("browser_download_url").ifEmpty { null }
            }
        }
        return null
    }

    /** Dotted numeric compare ("0.10" > "0.9"), tolerant of unequal segment counts. */
    private fun isNewer(latest: String, current: String): Boolean {
        if (latest.isEmpty()) return false
        if (current.isEmpty()) return true
        val a = latest.split(".")
        val b = current.split(".")
        for (i in 0 until maxOf(a.size, b.size)) {
            val x = a.getOrNull(i)?.toIntOrNull() ?: 0
            val y = b.getOrNull(i)?.toIntOrNull() ?: 0
            if (x != y) return x > y
        }
        return false
    }

    private fun httpGet(url: String): String {
        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 15000
            readTimeout = 15000
            // GitHub rejects requests without a User-Agent; the Accept pins the API version.
            setRequestProperty("User-Agent", "AlekWeather-Android")
            setRequestProperty("Accept", "application/vnd.github+json")
        }
        try {
            if (conn.responseCode !in 200..299) throw java.io.IOException("HTTP ${conn.responseCode}")
            return conn.inputStream.bufferedReader().use { it.readText() }
        } finally {
            conn.disconnect()
        }
    }

    /** Streams the release APK into cacheDir, emitting percent progress as it goes. */
    private fun downloadApk(url: String): File {
        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = 15000
            readTimeout = 30000
            instanceFollowRedirects = true
            setRequestProperty("User-Agent", "AlekWeather-Android")
        }
        try {
            if (conn.responseCode !in 200..299) throw java.io.IOException("HTTP ${conn.responseCode}")
            val total = conn.contentLength.toLong()
            val out = File(cacheDir, "update.apk")
            var lastPct = -1
            conn.inputStream.use { input ->
                out.outputStream().use { sink ->
                    val buf = ByteArray(64 * 1024)
                    var read = input.read(buf)
                    var done = 0L
                    while (read >= 0) {
                        sink.write(buf, 0, read)
                        done += read
                        if (total > 0) {
                            val pct = (done * 100 / total).toInt()
                            if (pct != lastPct) {
                                lastPct = pct
                                emitUpdate("alekupdateprogress", pct.toString())
                            }
                        }
                        read = input.read(buf)
                    }
                }
            }
            return out
        } finally {
            conn.disconnect()
        }
    }

    private fun launchInstaller(apk: File) {
        val uri = FileProvider.getUriForFile(this, "$packageName.fileprovider", apk)
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        runOnUiThread { startActivity(intent) }
    }
}
