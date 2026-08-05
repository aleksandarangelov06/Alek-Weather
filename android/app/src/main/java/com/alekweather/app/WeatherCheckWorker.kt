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
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.roundToInt

/**
 * The weather check that runs whether or not the app is open.
 *
 * The rules started as a port of the web app's `src/utils/notifications.js` and
 * have since grown past it; they had to move to Kotlin because the JS versions
 * only ever ran inside a live WebView, so closing the app meant nothing fired.
 * Nothing on the page decides what to notify about any more, so this file is
 * the only place the wording and the thresholds live.
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
            WeatherNotifier.post(applicationContext, id, title, body, R.drawable.ic_notify_alert)
            fired.add(id)
        }
        store.markAlertsSeen(fired)
    }

    // ── Precipitation in the next 12 hours ───────────────────────────────────

    /**
     * Finds the notable spell of precipitation in the next 12 hours and reports
     * when it starts and how long it runs.
     *
     * "Rain in the next 12 hours" was true of a shower at 7pm and of one already
     * falling, which made it useless for deciding anything. So the scan now
     * picks the worst hour in the window, walks outward to the edges of the
     * spell around it, and phrases the result against the clock. Picking the
     * worst hour first (rather than the earliest) is what keeps the timing
     * attached to the part worth knowing about: an afternoon of drizzle with a
     * thunderstorm at the end of it is a notification about the thunderstorm.
     */
    private fun checkRain(store: NotifyStore, data: JSONObject, zone: ZoneId) {
        val today = LocalDate.now(zone).toString()

        val hourly = data.optJSONObject("hourly") ?: return
        val times = hourly.optJSONArray("time") ?: return
        val codes = hourly.optJSONArray("weather_code") ?: return
        val probs = hourly.optJSONArray("precipitation_probability")

        // Scan from the current hour. If it isn't in the array something is off
        // with the response; starting at 0 would report on hours already past.
        val nowHour = LocalTime.now(zone).hour
        val nowKey = "${today}T%02d:00".format(Locale.US, nowHour)
        var start = -1
        for (i in 0 until times.length()) {
            if (times.optString(i).startsWith(nowKey)) { start = i; break }
        }
        if (start == -1) return

        val span = minOf(WINDOW_HOURS, codes.length() - start)
        if (span <= 0) return
        val wet = BooleanArray(span) { PRECIP.containsKey(codes.optInt(start + it, -1)) }

        // The worst hour in the window, by the severity ranking rather than by
        // when it lands: 2pm drizzle and 6pm freezing rain is a notification
        // about the freezing rain.
        var peak = -1
        for (j in 0 until span) {
            if (!wet[j]) continue
            if (peak == -1 || severityAt(codes, start + j) > severityAt(codes, start + peak)) peak = j
        }
        if (peak == -1) return
        val worst = PRECIP[codes.optInt(start + peak, -1)] ?: return

        // The spell around that hour. A single dry hour mid-spell is a lull, not
        // an ending: without the tolerance, showers that pause for an hour read
        // as two separate one-hour events and the duration is always "1 hour".
        var from = peak
        while (from - 1 >= 0 && (wet[from - 1] || (from - 2 >= 0 && wet[from - 2]))) from--
        var to = peak
        while (to + 1 < span && (wet[to + 1] || (to + 2 < span && wet[to + 2]))) to++

        // Overnight, when a phone buzzing about drizzle is worse than silence.
        // Severe weather still goes through: the whole point of a warning about
        // a thunderstorm or freezing rain is that it reaches you before you walk
        // out into it.
        if (inQuietHours(zone) && worst.severity < QUIET_BYPASS_SEVERITY) return

        // Once a day, unless it gets worse. A drizzle notice at 8am must not be
        // what stops the afternoon's thunderstorm from being announced, so the
        // severity that fired is remembered alongside the date and only a
        // higher one fires again. Same tag, so the second one replaces the first
        // in the shade rather than stacking.
        val prior = store.notifiedDate("rain")
        if (prior != null && prior.substringBefore('|') == today &&
            worst.severity <= (prior.substringAfter('|', "").toIntOrNull() ?: 0)
        ) return

        val startsIn = from
        val hours = to - from + 1
        // The spell is still going at the edge of what was scanned, so its
        // length is unknown; say where the window ends instead of guessing.
        val openEnded = to == span - 1

        var peakProb = 0
        if (probs != null) {
            for (j in from..to) peakProb = maxOf(peakProb, probs.optInt(start + j, 0))
        }

        val title = "${worst.label} ${whenTitle(startsIn, clock(nowHour + startsIn))}"
        val body = buildString {
            append(worst.label.lowercase(Locale.US).replaceFirstChar { it.uppercase() })
            append(' ')
            append(
                when {
                    startsIn <= 0 -> "starting now"
                    startsIn == 1 -> "starting within the hour"
                    startsIn <= 3 -> "starting in about $startsIn hours"
                    else -> "starting around ${clock(nowHour + startsIn)}"
                },
            )
            append(
                when {
                    openEnded -> ", continuing past ${clock(nowHour + span - 1)}"
                    hours <= 1 -> ", clearing within the hour"
                    else -> ", lasting about $hours hours"
                },
            )
            append('.')
            // Only worth stating when the model is hedging; at 90% and up the
            // sentence above is already the story.
            if (peakProb in 1 until CONFIDENT_PROB) append(" Chance peaks at $peakProb%.")
        }

        WeatherNotifier.post(applicationContext, "rain-forecast", title, body, worst.icon)
        store.markNotifiedDate("rain", "$today|${worst.severity}")
    }

    private fun severityAt(codes: JSONArray, index: Int): Int =
        PRECIP[codes.optInt(index, -1)]?.severity ?: 0

    /** "Heavy Rain" + this = the notification title. */
    private fun whenTitle(hoursAway: Int, clock: String): String = when {
        hoursAway <= 0 -> "Starting Now"
        hoursAway == 1 -> "Within the Hour"
        hoursAway <= 3 -> "in $hoursAway Hours"
        else -> "at $clock"
    }

    /** 15 -> "3 PM". Hours past 23 wrap, since they are offsets from now. */
    private fun clock(hour: Int): String {
        val h = ((hour % 24) + 24) % 24
        val h12 = if (h % 12 == 0) 12 else h % 12
        return "$h12 ${if (h < 12) "AM" else "PM"}"
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

        // Tomorrow in one phrase. Thunderstorms and freezing rain used to fall
        // under the flat " with rain" (95/96/99 were in RAIN_CODES), and a dry
        // day said nothing at all about the sky, so a clear day and an overcast
        // one read identically.
        // The phrase and the icon come from the same branch so they can never
        // disagree about what tomorrow is.
        val code = daily.optJSONArray("weather_code")?.optInt(1, -1) ?: -1
        val (condition, icon) = when {
            THUNDER_CODES.contains(code) -> " with thunderstorms" to R.drawable.ic_notify_storm
            FREEZING_CODES.contains(code) -> " with freezing rain" to R.drawable.ic_notify_ice
            SNOW_CODES.contains(code) -> " with snow" to R.drawable.ic_notify_snow
            SHOWER_CODES.contains(code) -> " with showers" to R.drawable.ic_notify_rain
            RAIN_CODES.contains(code) -> " with rain" to R.drawable.ic_notify_rain
            FOG_CODES.contains(code) -> " and foggy" to R.drawable.ic_notify_cloud
            code == 3 -> " and overcast" to R.drawable.ic_notify_cloud
            code == 2 -> " and partly cloudy" to R.drawable.ic_notify_sun
            code == 0 || code == 1 -> " and mostly sunny" to R.drawable.ic_notify_sun
            else -> "" to R.drawable.ic_notify_sun
        }

        // Wind only earns a mention when it is the thing you would have noticed.
        val wind = daily.optJSONArray("wind_speed_10m_max")?.optDouble(1, Double.NaN) ?: Double.NaN
        val windNote = when {
            wind.isNaN() -> ""
            wind >= WINDY_MPH -> ", windy"
            wind >= BREEZY_MPH -> ", breezy"
            else -> ""
        }

        val unit = store.unit
        WeatherNotifier.post(
            applicationContext,
            "tomorrow-weather",
            "Tomorrow's Weather",
            "High ${fmtTemp(high, unit)}, Low ${fmtTemp(low, unit)}$condition$windNote$weekContext.",
            icon,
        )
        store.markNotifiedDate("tomorrow", today)
    }

    /** Forecasts are fetched in Fahrenheit; the page's unit choice is applied here. */
    private fun fmtTemp(fahrenheit: Double, unit: String): String =
        if (unit == "C") "${((fahrenheit - 32) * 5 / 9).roundToInt()}°" else "${fahrenheit.roundToInt()}°"

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
        append("&hourly=weather_code,precipitation_probability")
        append("&daily=weather_code,temperature_2m_max,temperature_2m_min,wind_speed_10m_max")
        // Wind in mph so the thresholds below can be read as written; the
        // default is km/h, which would make BREEZY_MPH a much lower bar.
        append("&temperature_unit=fahrenheit&wind_speed_unit=mph")
        append("&timezone=auto&forecast_days=7")
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

        /** What one WMO weather code means for the notification. */
        private data class Precip(val severity: Int, val label: String, val icon: Int)

        /**
         * Every precipitating WMO code, with how bad it is and what to call it.
         *
         * One table rather than the four buckets this replaces. The buckets had
         * no place to say *which* kind of precipitation a code was, so snow in
         * the light bucket was announced as "Light Rain Expected", and the
         * freezing codes (56, 57, 66, 67) were in no bucket at all, meaning the
         * single most hazardous thing on the scale was the one thing that never
         * notified.
         *
         * Severity is a total order, not a tier, so any two hours can be
         * compared directly. The spacing is arbitrary and only the ranking
         * matters; gaps are left so a code can be slotted in later without
         * renumbering. Anything absent is a dry hour, fog and cloud included.
         */
        private val PRECIP = mapOf(
            96 to Precip(100, "Thunderstorms With Hail", R.drawable.ic_notify_storm),
            99 to Precip(100, "Thunderstorms With Hail", R.drawable.ic_notify_storm),
            95 to Precip(95, "Thunderstorms", R.drawable.ic_notify_storm),
            67 to Precip(90, "Heavy Freezing Rain", R.drawable.ic_notify_ice),
            66 to Precip(85, "Freezing Rain", R.drawable.ic_notify_ice),
            57 to Precip(80, "Freezing Drizzle", R.drawable.ic_notify_ice),
            56 to Precip(75, "Freezing Drizzle", R.drawable.ic_notify_ice),
            82 to Precip(70, "Violent Downpours", R.drawable.ic_notify_rain),
            75 to Precip(65, "Heavy Snow", R.drawable.ic_notify_snow),
            86 to Precip(63, "Heavy Snow Showers", R.drawable.ic_notify_snow),
            65 to Precip(60, "Heavy Rain", R.drawable.ic_notify_rain),
            73 to Precip(50, "Snow", R.drawable.ic_notify_snow),
            63 to Precip(46, "Rain", R.drawable.ic_notify_rain),
            81 to Precip(45, "Rain Showers", R.drawable.ic_notify_rain),
            55 to Precip(40, "Heavy Drizzle", R.drawable.ic_notify_rain),
            71 to Precip(30, "Light Snow", R.drawable.ic_notify_snow),
            85 to Precip(28, "Light Snow Showers", R.drawable.ic_notify_snow),
            77 to Precip(26, "Snow Grains", R.drawable.ic_notify_snow),
            61 to Precip(25, "Light Rain", R.drawable.ic_notify_rain),
            80 to Precip(24, "Light Showers", R.drawable.ic_notify_rain),
            53 to Precip(20, "Drizzle", R.drawable.ic_notify_rain),
            51 to Precip(18, "Light Drizzle", R.drawable.ic_notify_rain),
        )

        /** Codes that describe tomorrow in one phrase, for the daily summary. */
        private val RAIN_CODES = setOf(51, 53, 55, 61, 63, 65)
        private val SHOWER_CODES = setOf(80, 81, 82)
        private val SNOW_CODES = setOf(71, 73, 75, 77, 85, 86)
        private val THUNDER_CODES = setOf(95, 96, 99)
        private val FREEZING_CODES = setOf(56, 57, 66, 67)
        private val FOG_CODES = setOf(45, 48)

        /** How far ahead the precipitation scan looks. */
        private const val WINDOW_HOURS = 12
        /** At or above this chance, the forecast speaks for itself. */
        private const val CONFIDENT_PROB = 90
        /**
         * Severity from which a spell is worth the overnight interruption:
         * violent downpours and everything above them (freezing precipitation,
         * thunderstorms). Snow and ordinary rain wait for morning.
         */
        private const val QUIET_BYPASS_SEVERITY = 70

        /** Rain and tomorrow hold off overnight; alerts never do. */
        private const val QUIET_HOUR_START = 22
        private const val QUIET_HOUR_END = 7
        private const val TOMORROW_HOUR_START = 17
        private const val TOMORROW_HOUR_END = 22

        /** Sustained wind (mph) that gets a mention in tomorrow's summary. */
        private const val BREEZY_MPH = 20
        private const val WINDY_MPH = 30

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
