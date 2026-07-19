package com.alekweather.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.webkit.GeolocationPermissions
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
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
 */
class MainActivity : AppCompatActivity() {
    private lateinit var web: WebView

    /** Held while the system location prompt is up; see [onRequestPermissionsResult]. */
    private var pendingGeoOrigin: String? = null
    private var pendingGeoCallback: GeolocationPermissions.Callback? = null

    companion object {
        const val DOMAIN = "appassets.androidplatform.net"
        const val START_URL = "https://$DOMAIN/index.html"
        const val REQ_LOCATION = 1
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

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
            // Leaflet's radar tiles read as "mixed" scale without this pair.
            loadWithOverviewMode = false
            useWideViewPort = false
        }

        // Lets the WebView report prefers-color-scheme: dark when the app is in
        // night mode, which is what the web app's "system" theme setting reads.
        if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
            WebSettingsCompat.setAlgorithmicDarkeningAllowed(web.settings, true)
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
