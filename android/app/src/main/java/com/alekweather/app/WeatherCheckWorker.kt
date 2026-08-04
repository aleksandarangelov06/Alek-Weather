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
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.util.Locale
import java.util.concurrent.TimeUnit
import org.json.JSONObject
import kotlin.math.roundToInt

/**
 * The weather check that runs whether or not the app is open.
 *
 * The rules here are a port of the web app's `src/utils/notifications.js`: same
 * weather-code buckets, same 12-hour rain scan, same tomorrow-vs-the-week
 * comparison, same wording. They had to move to Kotlin because the JS versions
 * only ever ran inside a live WebView — close the app and nothing fired.
 *
 * The page no longer fires notifications itself. Opening the app enqueues a
 * one-shot run of this worker instead ([checkNow]), so foreground and background
 * take the same path and share the one dedup record in [NotifyStore].
 *
 * Data comes straight from Open-Meteo and the NWS, not from the page's blended
 * forecast: a background pass has no WebView to ask. That means a background
 * rain notification is based on the raw model where an in-app one would have
 * been NWS-corrected — close enough for "rain in the next 12 hours", and the
 * alternative is spinning up a headless WebView every hour.
 */
class WeatherCheckWorker(context: Context, params: WorkerParameters) : Worker(context, params) {

    override fun doWork(): Result {
        val store = NotifyStore(applicationContext)
        if (!store.enabled) return Result.success()
        // The grant can be revoked from system settings while the app is closed.
        if (!WeatherNotifier.canPost(applicationContext)) return Result.success()

        val lat = store.latitude ?: return Result.success()
        val lon = store.longitude ?: return Result.success()
        val types = store.types
        if (types.isEmpty()) return Result.success()

        var failed = false

        if (types.contains("alerts")) {
            try {
                checkAlerts(store, lat, lon)
            } catch (e: Exception) {
                // Caught separately so an NWS failure doesn't cost the forecast
                // check below. A point outside the NWS's coverage answers 4xx,
                // which is an answer, not something a retry would fix.
                if (e !is HttpException || e.code !in 400..499) failed = true
            }
        }

        if (types.contains("rain") || types.contains("tomorrow")) {
            try {
                val data = JSONObject(httpGet(forecastUrl(lat, lon)))
                val zone = zoneOf(data.optString("timezone"))
                if (types.contains("rain")) checkRain(store, data, zone)
                if (types.contains("tomorrow")) checkTomorrow(store, data, zone)
            } catch (e: Exception) {
                failed = true
            }
        }

        // Retry with backoff on a network blip; the periodic run would otherwise
        // wait a full hour to try again.
        return if (failed) Result.retry() else Result.success()
    }

    // ── NOAA alerts ──────────────────────────────────────────────────────────

    private fun checkAlerts(store: NotifyStore, lat: Double, lon: Double) {
        // Locale.US throughout: a comma-decimal locale would otherwise format
        // the point as "52,5200" and break the query.
        val point = "%.4f,%.4f".format(Locale.US, lat, lon)
        val url = "$NOAA_ALERTS_URL?point=$point"
        val features = JSONObject(httpGet(url, nws = true)).optJSONArray("features") ?: return
        val seen = store.seenAlertIds()
        val fired = mutableListOf<String>()

        for (i in 0 until features.length()) {
            val alert = features.optJSONObject(i) ?: continue
            val id = alert.optString("id")
            if (id.isEmpty() || seen.contains(id)) continue
            val props = alert.optJSONObject("properties")
            val title = props?.optString("event")?.ifEmpty { null } ?: "Weather Alert"
            val body = props?.optString("headline")?.ifEmpty { null }
                ?: props?.optString("areaDesc")?.substringBefore(';')
                ?: ""
            WeatherNotifier.post(applicationContext, id, title, body)
            fired.add(id)
        }
        store.markAlertsSeen(fired)
    }

    // ── Rain / storm in the next 12 hours ────────────────────────────────────

    private fun checkRain(store: NotifyStore, data: JSONObject, zone: ZoneId) {
        val today = LocalDate.now(zone).toString()
        if (store.notifiedDate("rain") == today) return
        if (inQuietHours(zone)) return

        val hourly = data.optJSONObject("hourly") ?: return
        val times = hourly.optJSONArray("time") ?: return
        val codes = hourly.optJSONArray("weather_code") ?: return

        // Scan from the current hour. If it isn't in the array something is off
        // with the response; starting at 0 would report on hours already past.
        val nowKey = "${today}T%02d:00".format(Locale.US, LocalTime.now(zone).hour)
        var start = -1
        for (i in 0 until times.length()) {
            if (times.optString(i).startsWith(nowKey)) { start = i; break }
        }
        if (start == -1) return

        var worstLevel = "clear"
        var worstCode: Int? = null
        for (i in start until minOf(start + 12, codes.length())) {
            val code = codes.optInt(i, -1)
            when (classify(code)) {
                "severe" -> { worstLevel = "severe"; worstCode = code }
                "heavy" -> if (worstLevel != "severe") { worstLevel = "heavy"; worstCode = code }
                "moderate" -> if (worstLevel != "severe" && worstLevel != "heavy") { worstLevel = "moderate"; worstCode = code }
                "light" -> if (worstLevel == "clear") { worstLevel = "light"; worstCode = code }
            }
            if (worstLevel == "severe") break
        }
        if (worstLevel == "clear") return
        val worst = worstCode ?: return

        val thunder = THUNDER_CODES.contains(worst)
        val snow = SNOW_CODES.contains(worst)

        val title = when (worstLevel) {
            "severe" -> if (thunder) "Thunderstorm Ahead" else "Violent Rain Ahead"
            "heavy" -> if (snow) "Heavy Snow Ahead" else "Heavy Rain Ahead"
            "moderate" -> if (snow) "Snow Expected" else "Rain Expected"
            else -> "Light Rain Expected"
        }
        val body = when (worstLevel) {
            "severe" -> if (thunder) "Thunderstorms expected in the next 12 hours." else "Violent rain showers expected in the next 12 hours."
            "heavy" -> if (snow) "Heavy snowfall expected in the next 12 hours." else "Heavy rain expected in the next 12 hours."
            "moderate" -> if (snow) "Moderate snow on the way in the next 12 hours." else "Rain moving in over the next 12 hours."
            else -> "Light rain or drizzle expected in the next 12 hours."
        }

        WeatherNotifier.post(applicationContext, "rain-forecast", title, body)
        store.markNotifiedDate("rain", today)
    }

    // ── Tomorrow's weather ───────────────────────────────────────────────────

    private fun checkTomorrow(store: NotifyStore, data: JSONObject, zone: ZoneId) {
        val today = LocalDate.now(zone).toString()
        if (store.notifiedDate("tomorrow") == today) return
        // In-app this fired whenever the app was first opened that day. Running
        // unattended it needs an hour of its own, and a summary of tomorrow is
        // worth reading in the evening, not at 6am.
        if (LocalTime.now(zone).hour !in TOMORROW_HOUR_START until TOMORROW_HOUR_END) return

        val daily = data.optJSONObject("daily") ?: return
        val highs = daily.optJSONArray("temperature_2m_max") ?: return
        val lows = daily.optJSONArray("temperature_2m_min") ?: return
        // [0] = today, [1] = tomorrow, [2..] = rest of the week.
        if (highs.length() < 2 || lows.length() < 2) return
        if (highs.isNull(1) || lows.isNull(1)) return

        val high = highs.optDouble(1)
        val low = lows.optDouble(1)
        if (high.isNaN() || low.isNaN()) return
        val avg = (high + low) / 2

        // Compare tomorrow with days 2-4, the same window WeatherOverview uses.
        val compareCount = minOf(3, highs.length() - 2)
        var weekContext = ""
        if (compareCount >= 2) {
            var sum = 0.0
            for (i in 2..compareCount + 1) sum += (highs.optDouble(i) + lows.optDouble(i)) / 2
            val diff = avg - sum / compareCount
            weekContext = when {
                diff > 8 -> ", notably warmer than the rest of the week"
                diff > 3 -> ", warmer than the rest of the week"
                diff < -8 -> ", notably cooler than the rest of the week"
                diff < -3 -> ", cooler than the rest of the week"
                else -> ", about the same as the rest of the week"
            }
        }

        val code = daily.optJSONArray("weather_code")?.optInt(1, -1) ?: -1
        val condition = when {
            RAIN_CODES.contains(code) -> " with rain"
            SNOW_CODES.contains(code) -> " with snow"
            else -> ""
        }

        val unit = store.unit
        WeatherNotifier.post(
            applicationContext,
            "tomorrow-weather",
            "Tomorrow's Weather",
            "High ${fmtTemp(high, unit)}, Low ${fmtTemp(low, unit)}$condition$weekContext.",
        )
        store.markNotifiedDate("tomorrow", today)
    }

    /** Forecasts are fetched in Fahrenheit; the page's unit choice is applied here. */
    private fun fmtTemp(fahrenheit: Double, unit: String): String =
        if (unit == "C") "${((fahrenheit - 32) * 5 / 9).roundToInt()}°" else "${fahrenheit.roundToInt()}°"

    private fun classify(code: Int): String = when {
        SEVERE_CODES.contains(code) -> "severe"
        HEAVY_CODES.contains(code) -> "heavy"
        MODERATE_CODES.contains(code) -> "moderate"
        LIGHT_CODES.contains(code) -> "light"
        else -> "clear"
    }

    /** Overnight, when a phone buzzing about drizzle is worse than silence. */
    private fun inQuietHours(zone: ZoneId): Boolean =
        LocalTime.now(zone).hour.let { it >= QUIET_HOUR_START || it < QUIET_HOUR_END }

    private fun zoneOf(timezone: String): ZoneId = try {
        if (timezone.isEmpty()) ZoneId.systemDefault() else ZoneId.of(timezone)
    } catch (e: Exception) {
        ZoneId.systemDefault()
    }

    private fun forecastUrl(lat: Double, lon: Double): String = buildString {
        append(FORECAST_URL)
        append("?latitude=").append(lat)
        append("&longitude=").append(lon)
        // Only what the two rules read; the page's full request pulls a dozen
        // more fields that nothing here would look at.
        append("&hourly=weather_code")
        append("&daily=weather_code,temperature_2m_max,temperature_2m_min")
        append("&temperature_unit=fahrenheit&timezone=auto&forecast_days=7")
    }

    private fun httpGet(url: String, nws: Boolean = false): String {
        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 15000
            readTimeout = 15000
            // The NWS requires contact info in the User-Agent; same string the
            // web app sends.
            if (nws) setRequestProperty("User-Agent", NWS_USER_AGENT)
        }
        try {
            if (conn.responseCode !in 200..299) throw HttpException(conn.responseCode)
            return conn.inputStream.bufferedReader().use { it.readText() }
        } finally {
            conn.disconnect()
        }
    }

    private class HttpException(val code: Int) : IOException("HTTP $code")

    companion object {
        private const val FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
        private const val NOAA_ALERTS_URL = "https://api.weather.gov/alerts/active"
        private const val NWS_USER_AGENT =
            "AlekWeatherApp/1.0 (angelov6+alekweather@terpmail.umd.edu)"

        /** Weather-code buckets, mirroring src/utils/notifications.js. */
        private val SEVERE_CODES = setOf(95, 96, 99, 82)
        private val HEAVY_CODES = setOf(65, 75, 86)
        private val MODERATE_CODES = setOf(63, 73, 81, 55)
        private val LIGHT_CODES = setOf(51, 53, 61, 71, 77, 80, 85)
        private val RAIN_CODES = setOf(51, 53, 55, 61, 63, 65, 80, 81, 82, 95, 96, 99)
        private val SNOW_CODES = setOf(71, 73, 75, 77, 85, 86)
        private val THUNDER_CODES = setOf(95, 96, 99)

        /** Rain and tomorrow hold off overnight; alerts never do. */
        private const val QUIET_HOUR_START = 22
        private const val QUIET_HOUR_END = 7
        private const val TOMORROW_HOUR_START = 17
        private const val TOMORROW_HOUR_END = 22

        private const val PERIODIC_WORK = "weather-check"
        private const val ONE_SHOT_WORK = "weather-check-now"

        /**
         * Runs the check hourly, forever, whether or not the app is open.
         *
         * WorkManager persists the schedule in its own database, so it survives
         * force-stop, reboot, and app update without a boot receiver of ours.
         * Doze can push a run into the next maintenance window, so treat the
         * hour as a floor rather than a promise — fine for a 12-hour rain
         * outlook, and the reason alerts are also re-checked on every app open.
         */
        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<WeatherCheckWorker>(1, TimeUnit.HOURS)
                .setConstraints(
                    Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build(),
                )
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                PERIODIC_WORK,
                // UPDATE, not KEEP: a schedule already enqueued by an older
                // install should pick up changes here without losing its place.
                ExistingPeriodicWorkPolicy.UPDATE,
                request,
            )
        }

        fun cancel(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(PERIODIC_WORK)
        }

        /**
         * One extra pass now — on app open, and when the settings change — so a
         * new alert doesn't wait for the next hourly slot. KEEP so repeatedly
         * backgrounding and reopening the app doesn't queue a pile of them.
         */
        fun checkNow(context: Context) {
            val request = OneTimeWorkRequestBuilder<WeatherCheckWorker>()
                .setConstraints(
                    Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build(),
                )
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(
                ONE_SHOT_WORK,
                ExistingWorkPolicy.KEEP,
                request,
            )
        }
    }
}
