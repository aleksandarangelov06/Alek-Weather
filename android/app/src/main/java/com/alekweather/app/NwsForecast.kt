package com.alekweather.app

import java.net.URI
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.util.Locale
import org.json.JSONArray
import org.json.JSONObject

/**
 * Overlays the NWS forecast onto an Open-Meteo response, for US locations.
 *
 * A Kotlin port of the merge in `src/hooks/useWeather.js`, kept deliberately
 * narrow: only the three fields the notification rules actually read
 * (`hourly.weather_code`, `hourly.precipitation_probability`,
 * `daily.weather_code`). The web version merges a dozen more because it renders
 * them; nothing here would look at temperature or humidity.
 *
 * Why this exists: Open-Meteo's model is routinely blind to convection that the
 * NWS forecasts confidently. Verified over Bel Air MD — Open-Meteo carried
 * "partly cloudy, 2% chance" for an afternoon the NWS called at 55/99/45%
 * thunderstorms, and a storm duly arrived. Without this overlay a background
 * pass reads the same blind model and simply never notifies.
 *
 * Every step is non-fatal. A failure anywhere leaves the Open-Meteo values in
 * place, which is exactly the behaviour this file replaces, so the worst case
 * is the old one. Non-US points get a 404 from the points endpoint and fall
 * through untouched.
 */
object NwsForecast {

    /**
     * Merges NWS hourly and daily forecasts into [data] in place.
     *
     * [get] performs an NWS-authenticated GET; the worker passes its own
     * `httpGet(url, nws = true)` so timeouts and the User-Agent stay in one place.
     *
     * Returns true if the hourly merge succeeded, meaning the codes in [data] are
     * now NWS-sourced.
     */
    fun overlay(data: JSONObject, lat: Double, lon: Double, zone: ZoneId, get: (String) -> String): Boolean {
        // Locale.US: a comma-decimal locale would format the point as "39,5359"
        // and the request would 404. Same reason checkAlerts does it.
        val point = "%.4f,%.4f".format(Locale.US, lat, lon)
        val props = JSONObject(get("$POINTS_URL/$point")).optJSONObject("properties") ?: return false

        val hourly = data.optJSONObject("hourly")
        var mergedHourly = false
        val hourlyUrl = props.optString("forecastHourly").ifEmpty { null }
        if (hourly != null && hourlyUrl != null) {
            try {
                periodsOf(get(hourlyUrl))?.let { mergeHourly(hourly, it, zone); mergedHourly = true }
            } catch (e: Exception) {
                // Keep Open-Meteo's hourly.
            }
        }

        val daily = data.optJSONObject("daily")
        val forecastUrl = props.optString("forecast").ifEmpty { null }
        if (daily != null && forecastUrl != null) {
            try {
                periodsOf(get(forecastUrl))?.let { mergeDaily(daily, it, zone) }
            } catch (e: Exception) {
                // Keep Open-Meteo's daily.
            }
        }

        // Re-derive each day's code from the merged hours so the "tomorrow"
        // summary and the 12-hour precipitation scan can never contradict each
        // other. The NWS period-summary and hourly endpoints come from different
        // systems and routinely disagree — a day period saying "thunderstorms"
        // over an hourly breakdown showing only cloud.
        //
        // The web version also runs its minutely_15 nowcast check here. That is
        // deliberately absent: the check now returns early for NWS-sourced codes
        // anyway (see nowcastHourlyCode), so porting it would be dead weight —
        // and the worker never fetches minutely_15 to begin with.
        if (mergedHourly && daily != null && hourly != null) alignDailyCodes(daily, hourly, zone)
        return mergedHourly
    }

    private fun periodsOf(body: String): JSONArray? =
        JSONObject(body).optJSONObject("properties")?.optJSONArray("periods")?.takeIf { it.length() > 0 }

    // ── Hourly ───────────────────────────────────────────────────────────────

    private fun mergeHourly(hourly: JSONObject, periods: JSONArray, zone: ZoneId) {
        val times = hourly.optJSONArray("time") ?: return
        val codes = hourly.optJSONArray("weather_code") ?: return
        val probs = hourly.optJSONArray("precipitation_probability")

        val codeByHour = HashMap<String, Int>()
        val probByHour = HashMap<String, Int>()
        for (i in 0 until periods.length()) {
            val p = periods.optJSONObject(i) ?: continue
            val key = hourKey(p.optString("startTime"), zone) ?: continue
            parseIcon(p.optString("icon"))?.let { codeByHour[key] = ICON_TO_WMO[it] ?: OVERCAST }
            p.optJSONObject("probabilityOfPrecipitation")?.let {
                if (!it.isNull("value")) probByHour[key] = it.optInt("value")
            }
        }

        for (i in 0 until times.length()) {
            // Open-Meteo hourly timestamps are already local ("2026-08-08T13:00").
            val key = times.optString(i).take(13) + ":00"
            codeByHour[key]?.let { codes.put(i, it) }
            if (probs != null) probByHour[key]?.let { probs.put(i, it) }
        }
    }

    // ── Daily ────────────────────────────────────────────────────────────────

    private fun mergeDaily(daily: JSONObject, periods: JSONArray, zone: ZoneId) {
        val dates = daily.optJSONArray("time") ?: return
        val codes = daily.optJSONArray("weather_code")
        val highs = daily.optJSONArray("temperature_2m_max")
        val lows = daily.optJSONArray("temperature_2m_min")

        // NWS gives day/night period pairs; group them by local calendar date.
        val dayIcon = HashMap<String, String>()
        val nightIcon = HashMap<String, String>()
        val dayTemp = HashMap<String, Int>()
        val nightTemp = HashMap<String, Int>()
        for (i in 0 until periods.length()) {
            val p = periods.optJSONObject(i) ?: continue
            val date = dateKey(p.optString("startTime"), zone) ?: continue
            val icon = parseIcon(p.optString("icon"))
            val temp = if (p.isNull("temperature")) null else p.optInt("temperature")
            if (p.optBoolean("isDaytime")) {
                if (icon != null) dayIcon[date] = icon
                if (temp != null) dayTemp[date] = temp
            } else {
                if (icon != null) nightIcon[date] = icon
                if (temp != null) nightTemp[date] = temp
            }
        }

        for (i in 0 until dates.length()) {
            val date = dates.optString(i)
            pickMoreSevere(dayIcon[date], nightIcon[date])?.let { codes?.put(i, ICON_TO_WMO[it] ?: OVERCAST) }
            // Daytime period is the high, nighttime the low.
            dayTemp[date]?.let { highs?.put(i, it) }
            nightTemp[date]?.let { lows?.put(i, it) }
        }
    }

    /**
     * Rewrites each day's code to the worst still-upcoming hour of that day.
     *
     * Past hours are skipped: a storm that already cleared must not keep
     * "tomorrow's" summary — or today's — pinned to weather nobody will see.
     */
    private fun alignDailyCodes(daily: JSONObject, hourly: JSONObject, zone: ZoneId) {
        val dates = daily.optJSONArray("time") ?: return
        val dailyCodes = daily.optJSONArray("weather_code") ?: return
        val times = hourly.optJSONArray("time") ?: return
        val hourCodes = hourly.optJSONArray("weather_code") ?: return

        val now = LocalDateTime.now(zone)
        val currentSlot = "%04d-%02d-%02dT%02d:00".format(
            Locale.US, now.year, now.monthValue, now.dayOfMonth, now.hour,
        )

        for (d in 0 until dates.length()) {
            val date = dates.optString(d)
            var peakCode = -1
            var peakSeverity = -1
            for (h in 0 until times.length()) {
                val slot = times.optString(h)
                if (!slot.startsWith(date)) continue
                if (slot < currentSlot) continue
                val code = hourCodes.optInt(h, -1)
                if (code < 0) continue
                val severity = wmoSeverity(code)
                if (severity > peakSeverity) {
                    peakSeverity = severity
                    peakCode = code
                }
            }
            if (peakCode >= 0) dailyCodes.put(d, peakCode)
        }
    }

    // ── Icon parsing ─────────────────────────────────────────────────────────

    /**
     * "https://api.weather.gov/icons/land/day/tsra,80?size=small" -> "tsra".
     *
     * A period can carry two conditions ("/icons/land/day/ovc/tsra,60"); the more
     * severe one wins, which is why this ranks rather than taking the first.
     */
    private fun parseIcon(iconUrl: String?): String? {
        if (iconUrl.isNullOrEmpty()) return null
        val path = try {
            URI(iconUrl).path ?: return null
        } catch (e: Exception) {
            return null
        }
        val parts = path.split('/').filter { it.isNotEmpty() }
        // Drop "icons", "land"|"marine", "day"|"night" — the rest are conditions,
        // each optionally suffixed with ",<chance>".
        if (parts.size <= 3) return null
        val conditions = parts.drop(3).map { it.substringBefore(',') }
        return ICON_PRIORITY.firstOrNull { conditions.contains(it) } ?: conditions.firstOrNull()
    }

    /** Whichever icon ranks higher (more severe) in [ICON_PRIORITY]. */
    private fun pickMoreSevere(a: String?, b: String?): String? {
        if (a == null) return b
        if (b == null) return a
        val ia = ICON_PRIORITY.indexOf(a)
        val ib = ICON_PRIORITY.indexOf(b)
        if (ia == -1) return b
        if (ib == -1) return a
        return if (ia <= ib) a else b
    }

    // ── Time keys ────────────────────────────────────────────────────────────

    /** NWS "2026-08-08T13:00:00-04:00" -> local "2026-08-08T13:00". */
    private fun hourKey(isoString: String, zone: ZoneId): String? = localTime(isoString, zone)?.let {
        "%04d-%02d-%02dT%02d:00".format(Locale.US, it.year, it.monthValue, it.dayOfMonth, it.hour)
    }

    /** NWS "2026-08-08T06:00:00-04:00" -> local "2026-08-08". */
    private fun dateKey(isoString: String, zone: ZoneId): String? = localTime(isoString, zone)?.let {
        "%04d-%02d-%02d".format(Locale.US, it.year, it.monthValue, it.dayOfMonth)
    }

    private fun localTime(isoString: String, zone: ZoneId): LocalDateTime? = try {
        if (isoString.isEmpty()) null
        else OffsetDateTime.parse(isoString).atZoneSameInstant(zone).toLocalDateTime()
    } catch (e: Exception) {
        null
    }

    // ── Tables ───────────────────────────────────────────────────────────────

    private const val POINTS_URL = "https://api.weather.gov/points"

    /** Fallback for an icon the table doesn't know: cloud, never precipitation. */
    private const val OVERCAST = 3

    /** How bad a WMO code is, for finding the worst hour of a day. */
    private fun wmoSeverity(code: Int): Int = when {
        code >= 95 -> 8 // thunderstorm
        code >= 85 -> 7 // snow showers
        code >= 80 -> 6 // rain showers
        code >= 71 -> 5 // snow
        code >= 65 -> 4 // heavy rain
        code >= 61 -> 3 // moderate rain
        code >= 51 -> 2 // drizzle
        code >= 45 -> 1 // fog
        else -> 0
    }

    /** NWS icon code -> WMO weather code. Mirrors NWS_ICON_TO_WMO in useWeather.js. */
    private val ICON_TO_WMO = mapOf(
        "skc" to 0, "wind_skc" to 0, "hot" to 0, "cold" to 0,
        "few" to 1, "wind_few" to 1,
        "sct" to 2, "wind_sct" to 2,
        "bkn" to 3, "wind_bkn" to 3, "ovc" to 3, "wind_ovc" to 3,
        "fog" to 45, "ice_fog" to 48,
        "haze" to 3, "dust" to 3, "smoke" to 3,
        "drizzle" to 51,
        "rain" to 61,
        "rain_showers" to 80,
        "rain_showers_hi" to 82,
        "tsra_sct" to 95, "tsra" to 95,
        "tsra_hi" to 96,
        "snow" to 71,
        "snow_showers" to 85, "snow_showers_hi" to 86,
        "fzra" to 67, "sleet" to 77, "blizzard" to 75,
        "tornado" to 99, "hurricane" to 99,
    )

    /** Most severe first. Mirrors NWS_ICON_PRIORITY in useWeather.js. */
    private val ICON_PRIORITY = listOf(
        "tornado", "hurricane", "tsra_hi", "tsra", "tsra_sct",
        "blizzard", "rain_showers_hi", "snow_showers_hi",
        "rain", "rain_showers", "snow", "snow_showers", "fzra", "sleet",
        "drizzle", "ice_fog", "fog", "haze", "dust", "smoke",
        "ovc", "wind_ovc", "bkn", "wind_bkn", "sct", "wind_sct",
        "few", "wind_few", "skc", "wind_skc", "hot", "cold",
    )
}
