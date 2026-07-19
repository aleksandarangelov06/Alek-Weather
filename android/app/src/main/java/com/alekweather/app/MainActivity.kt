package com.alekweather.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.webkit.GeolocationPermissions
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
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
    private var insetBottomCss = 0f
    private var pageReady = false

    companion object {
        const val DOMAIN = "appassets.androidplatform.net"
        const val START_URL = "https://$DOMAIN/index.html"
        const val REQ_LOCATION = 1

        /** Below this relative luminance a background needs light (white) icons. */
        const val LIGHT_ICON_THRESHOLD = 0.5
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        applyEdgeToEdge()

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

        // The page paints under the bars, so it needs to know how much of the
        // top and bottom is covered. Insets can arrive before or after the page
        // is ready, so both paths call pushInsets and it no-ops until both are.
        ViewCompat.setOnApplyWindowInsetsListener(web) { _, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout(),
            )
            val density = resources.displayMetrics.density
            insetTopCss = bars.top / density
            insetBottomCss = bars.bottom / density
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
     * Keeps page content clear of the bars it is painting behind.
     *
     * The app's CSS already pads for `env(safe-area-inset-*)`, but a WebView
     * populates those from the display cutout only -- on a phone without one
     * they can read 0 even though the status bar is still covering 24dp of the
     * page. So this pads the body by whatever the CSS did *not* already
     * account for, measured rather than assumed, and pads by nothing when the
     * WebView reports the insets properly. Fixed-position elements are
     * unaffected by body padding, which is what keeps the sky full bleed.
     */
    private fun pushInsets() {
        if (!pageReady) return
        val js = """
            (function (top, bottom) {
              if (!document.body) return;
              function envPx(side) {
                var probe = document.createElement('div');
                probe.style.cssText =
                  'position:fixed;left:0;width:0;visibility:hidden;pointer-events:none;' +
                  'height:env(safe-area-inset-' + side + ', 0px)';
                document.body.appendChild(probe);
                var h = probe.getBoundingClientRect().height;
                probe.remove();
                return h;
              }
              var padTop = Math.max(0, top - envPx('top'));
              var padBottom = Math.max(0, bottom - envPx('bottom'));
              document.body.style.paddingTop = padTop ? padTop + 'px' : '';
              document.body.style.paddingBottom = padBottom ? padBottom + 'px' : '';
            })($insetTopCss, $insetBottomCss);
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
}
