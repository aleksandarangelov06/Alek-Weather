package com.alekweather.app

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.time.ZoneId
import java.util.Locale
import java.util.concurrent.TimeUnit
import kotlin.math.abs
import org.json.JSONObject

/**
 * Fetches and caches the forecast the home-screen widgets draw from.
 *
 * Same place as the notifications (the Home place the page syncs into
 * [NotifyStore]) and the same sources: Open-Meteo with the NWS overlay on top
 * for US points, plus Open-Meteo's US AQI and the most severe active NWS alert.
 * Only the forecast is required; the overlay, AQI and alert each fail on their
 * own and leave a widget with less, not with nothing.
 *
 * The result goes to one JSON file. Widgets never fetch themselves: every
 * provider update renders from this cache, so redrawing (a resize, a new
 * widget, the clock moving "Now" along) costs no network.
 */
object WidgetData {
    private const val CACHE_FILE = "widget_forecast.json"
    private const val FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
    private const val AQI_URL = "https://air-quality-api.open-meteo.com/v1/air-quality"

    /** The cached forecast, or null when there is none for the current Home place. */
    fun cache(context: Context): JSONObject? {
        val file = File(context.filesDir, CACHE_FILE)
        if (!file.exists()) return null
        val json = try {
            JSONObject(file.readText())
        } catch (e: Exception) {
            return null
        }
        // A cache for the old Home place is worse than "Updating": it would show
        // the wrong city's weather under the new city's name.
        val store = NotifyStore(context)
        val lat = store.latitude ?: return null
        val lon = store.longitude ?: return null
        if (abs(json.optDouble("lat") - lat) > 1e-3 || abs(json.optDouble("lon") - lon) > 1e-3) return null
        return json
    }

    /** Fetches and stores a fresh forecast. Throws if the forecast itself can't be had. */
    fun fetch(context: Context, lat: Double, lon: Double, place: String) {
        val data = JSONObject(httpGet(forecastUrl(lat, lon)))
        val zone = try {
            ZoneId.of(data.optString("timezone"))
        } catch (e: Exception) {
            ZoneId.systemDefault()
        }

        var nwsHourly = false
        try {
            nwsHourly = NwsForecast.overlay(data, lat, lon, zone) { url -> httpGet(url, nws = true) }
        } catch (e: Exception) {
            // Outside the US, or the NWS is down: Open-Meteo stands.
        }

        val aqi = try {
            JSONObject(httpGet("$AQI_URL?latitude=$lat&longitude=$lon&current=us_aqi&timezone=auto"))
                .optJSONObject("current")
        } catch (e: Exception) {
            null
        }

        val alert = try {
            mostSevereAlert(lat, lon)
        } catch (e: Exception) {
            null
        }

        val out = JSONObject()
            .put("fetchedAt", System.currentTimeMillis())
            .put("lat", lat)
            .put("lon", lon)
            .put("place", place)
            .put("nwsHourly", nwsHourly)
            .put("forecast", data)
            .putOpt("aqi", aqi)
            .putOpt("alert", alert)
        // Write then rename, so a widget update racing the fetch never reads half a file.
        val tmp = File(context.filesDir, "$CACHE_FILE.tmp")
        tmp.writeText(out.toString())
        tmp.renameTo(File(context.filesDir, CACHE_FILE))
    }

    private fun forecastUrl(lat: Double, lon: Double): String = buildString {
        append(FORECAST_URL)
        append("?latitude=").append(lat)
        append("&longitude=").append(lon)
        append("&current=temperature_2m,apparent_temperature,weather_code,is_day,relative_humidity_2m,")
        append("wind_speed_10m,wind_direction_10m,wind_gusts_10m,pressure_msl")
        // The hourly copies of the current fields stand in for it once a fetch
        // is old enough that "current" no longer is (see WidgetSnapshot).
        append("&hourly=temperature_2m,weather_code,precipitation_probability,is_day,pressure_msl,")
        append("dew_point_2m,uv_index,relative_humidity_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m")
        append("&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset")
        // Canonical units, as the page and the notification worker fetch them;
        // WidgetFormat converts for display.
        append("&temperature_unit=fahrenheit&wind_speed_unit=mph")
        append("&timezone=auto&forecast_days=5")
    }

    /** The active alert to show: the most severe, then the soonest to end. */
    private fun mostSevereAlert(lat: Double, lon: Double): JSONObject? {
        val point = "%.4f,%.4f".format(Locale.US, lat, lon)
        val body = httpGet("${WeatherCheckWorker.NOAA_ALERTS_URL}?point=$point", nws = true)
        val features = JSONObject(body).optJSONArray("features") ?: return null
        var best: JSONObject? = null
        var bestRank = -1
        for (i in 0 until features.length()) {
            val props = features.optJSONObject(i)?.optJSONObject("properties") ?: continue
            val event = props.optString("event")
            if (event.isEmpty()) continue
            val rank = when (props.optString("severity")) {
                "Extreme" -> 4
                "Severe" -> 3
                "Moderate" -> 2
                "Minor" -> 1
                else -> 0
            }
            if (rank > bestRank) {
                bestRank = rank
                val until = props.optString("ends").takeIf { it.isNotEmpty() && it != "null" }
                    ?: props.optString("expires").takeIf { it.isNotEmpty() && it != "null" }
                best = JSONObject().put("event", event).putOpt("until", until)
            }
        }
        return best
    }

    private fun httpGet(url: String, nws: Boolean = false): String {
        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 15000
            readTimeout = 15000
            if (nws) setRequestProperty("User-Agent", WeatherCheckWorker.NWS_USER_AGENT)
        }
        try {
            if (conn.responseCode !in 200..299) throw IOException("HTTP ${conn.responseCode}")
            return conn.inputStream.bufferedReader().use { it.readText() }
        } finally {
            conn.disconnect()
        }
    }
}

/**
 * Refreshes the widgets' forecast every 30 minutes while any widget is on a
 * home screen, and once on demand (app opened, Home place or units changed, a
 * widget added).
 *
 * It redraws every widget whether or not the fetch worked: the hour labels and
 * "Now" move with the clock, and a failed fetch still has the last forecast to
 * draw from.
 */
class WidgetRefreshWorker(context: Context, params: WorkerParameters) : Worker(context, params) {

    override fun doWork(): Result {
        val ctx = applicationContext
        if (!WidgetKind.anyPlaced(ctx)) {
            cancel(ctx)
            return Result.success()
        }
        val store = NotifyStore(ctx)
        val lat = store.latitude
        val lon = store.longitude
        if (lat == null || lon == null) {
            WidgetRenderer.updateAll(ctx)
            return Result.success()
        }
        return try {
            WidgetData.fetch(ctx, lat, lon, store.placeName ?: "Home")
            WidgetRenderer.updateAll(ctx)
            Result.success()
        } catch (e: Exception) {
            WidgetRenderer.updateAll(ctx)
            Result.retry()
        }
    }

    companion object {
        private const val PERIODIC_WORK = "widget-refresh"
        private const val ONE_SHOT_WORK = "widget-refresh-now"

        private val network = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<WidgetRefreshWorker>(30, TimeUnit.MINUTES)
                .setConstraints(network)
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                PERIODIC_WORK,
                ExistingPeriodicWorkPolicy.UPDATE,
                request,
            )
        }

        fun cancel(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(PERIODIC_WORK)
        }

        /**
         * One fetch now. REPLACE rather than KEEP: this is called when the Home
         * place changes, and a run already in flight for the old place must not
         * be the one that wins.
         */
        fun refreshNow(context: Context) {
            if (!WidgetKind.anyPlaced(context)) return
            val request = OneTimeWorkRequestBuilder<WidgetRefreshWorker>()
                .setConstraints(network)
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(ONE_SHOT_WORK, ExistingWorkPolicy.REPLACE, request)
        }
    }
}
