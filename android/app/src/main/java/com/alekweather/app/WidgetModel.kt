package com.alekweather.app

import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.TextStyle
import java.util.Locale
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.roundToInt

/**
 * What the home-screen widgets show, read out of the cached forecast that
 * [WidgetData] fetched.
 *
 * Built at render time rather than at fetch time, so "Now" and the hour labels
 * follow the clock even when the last fetch is half an hour old. The labels,
 * icons and dry-code rule are ports of `src/utils/weatherCodes.js`, so a widget
 * calls the sky what the app calls it.
 *
 * Temperatures stay in °F and wind in mph (how the forecast is fetched) until
 * [WidgetFormat] turns them into the units the page synced.
 */
class WidgetSnapshot(
    val place: String,
    val zone: ZoneId,
    val now: LocalDateTime,
    val fetchedAt: LocalDateTime,
    val tempF: Double,
    val feelsF: Double?,
    val code: Int,
    val isDay: Boolean,
    val humidity: Int?,
    val dewF: Double?,
    val windMph: Double?,
    val gustMph: Double?,
    val windDeg: Double?,
    val pressureHpa: Double?,
    /** -1 falling, 0 steady, 1 rising, over the next three hours. */
    val pressureTrend: Int,
    val uv: Double?,
    val hiF: Double?,
    val loF: Double?,
    val rainChanceToday: Int?,
    val hours: List<Hour>,
    val days: List<Day>,
    val aqi: Int?,
    val alert: Alert?,
    /** Rain or snow in the next 12 hours, or null when they are dry. */
    val precipNote: PrecipNote?,
    val sun: SunEvent?,
) {
    /** [full]: "Rain from 3 PM". [short], for a tile: "From 3 PM". */
    class PrecipNote(private val kind: String, private val verb: String, private val time: String) {
        val full: String get() = "$kind $verb $time"
        val short: String get() = "${verb.replaceFirstChar { it.uppercase() }} $time"
    }

    class Hour(val label: String, val tempF: Double, val code: Int, val isDay: Boolean, val pop: Int?)
    class Day(val label: String, val code: Int, val hiF: Double, val loF: Double, val pop: Int?)
    class Alert(val event: String, val until: LocalDateTime?)
    /** The next sunrise or sunset, and the other one after it. */
    class SunEvent(val isSunset: Boolean, val at: LocalDateTime, val other: LocalDateTime?)

    companion object {
        /** Under this chance a wet code is a contradiction; see DRY_POP in weatherCodes.js. */
        private const val DRY_POP = 5
        private const val DRY_CODE = 3
        /** Past this, the "current" block is too old to stand for right now. */
        private const val STALE_CURRENT_MIN = 90L
        private const val NOTE_WINDOW = 12

        /** Null when the cache is missing or unreadable. */
        fun from(cache: JSONObject?): WidgetSnapshot? = try {
            cache?.let { parse(it) }
        } catch (e: Exception) {
            null
        }

        private fun parse(cache: JSONObject): WidgetSnapshot? {
            val data = cache.optJSONObject("forecast") ?: return null
            val zone = try {
                ZoneId.of(data.optString("timezone"))
            } catch (e: Exception) {
                ZoneId.systemDefault()
            }
            val now = LocalDateTime.now(zone)
            val fetchedAt = LocalDateTime.ofInstant(Instant.ofEpochMilli(cache.optLong("fetchedAt")), zone)
            val nwsHourly = cache.optBoolean("nwsHourly", false)

            val current = data.optJSONObject("current") ?: JSONObject()
            val hourly = data.optJSONObject("hourly") ?: return null
            val daily = data.optJSONObject("daily") ?: return null
            val times = hourly.optJSONArray("time") ?: return null
            val hTemp = hourly.optJSONArray("temperature_2m")
            val hCode = hourly.optJSONArray("weather_code")
            val hPop = hourly.optJSONArray("precipitation_probability")
            val hDay = hourly.optJSONArray("is_day")

            val idx = hourIndex(times, now) ?: return null
            fun popAt(i: Int): Int? = hPop?.intOrNull(i)
            fun codeAt(i: Int): Int = dry(hCode?.optInt(i, DRY_CODE) ?: DRY_CODE, popAt(i))

            // Right now. NWS-merged hourly codes beat Open-Meteo's current code
            // (the overlay exists because the model misses what the NWS calls),
            // and a current block from a fetch long ago is replaced by the hour.
            val stale = java.time.Duration.between(fetchedAt, now).toMinutes() > STALE_CURRENT_MIN
            val tempF = if (stale) hTemp?.doubleOrNull(idx) else current.doubleOrNull("temperature_2m") ?: hTemp?.doubleOrNull(idx)
            val code = if (nwsHourly || stale) codeAt(idx) else dry(current.optInt("weather_code", codeAt(idx)), popAt(idx))
            val isDay = if (stale) hDay?.optInt(idx, 1) != 0 else current.optInt("is_day", hDay?.optInt(idx, 1) ?: 1) != 0

            val hours = (0 until 6).mapNotNull { k ->
                val i = idx + k
                if (i >= times.length()) return@mapNotNull null
                val t = hTemp?.doubleOrNull(i) ?: return@mapNotNull null
                Hour(
                    label = if (k == 0) "Now" else WidgetFormat.hour(LocalDateTime.parse(times.optString(i))),
                    tempF = if (k == 0 && tempF != null) tempF else t,
                    code = if (k == 0) code else codeAt(i),
                    isDay = if (k == 0) isDay else hDay?.optInt(i, 1) != 0,
                    pop = popAt(i),
                )
            }

            val dDates = daily.optJSONArray("time") ?: return null
            val dCode = daily.optJSONArray("weather_code")
            val dHi = daily.optJSONArray("temperature_2m_max")
            val dLo = daily.optJSONArray("temperature_2m_min")
            val dPop = daily.optJSONArray("precipitation_probability_max")
            val today = now.toLocalDate()
            var ti = -1
            for (i in 0 until dDates.length()) if (dDates.optString(i) == today.toString()) { ti = i; break }
            if (ti == -1) return null

            val days = (1..3).mapNotNull { k ->
                val i = ti + k
                if (i >= dDates.length()) return@mapNotNull null
                val hi = dHi?.doubleOrNull(i) ?: return@mapNotNull null
                val lo = dLo?.doubleOrNull(i) ?: return@mapNotNull null
                Day(
                    label = LocalDate.parse(dDates.optString(i)).dayOfWeek.getDisplayName(TextStyle.SHORT, Locale.US),
                    code = dry(dCode?.optInt(i, DRY_CODE) ?: DRY_CODE, dPop?.intOrNull(i)),
                    hiF = hi,
                    loF = lo,
                    pop = dPop?.intOrNull(i),
                )
            }

            val pressure = hourly.optJSONArray("pressure_msl")
            val pNow = current.doubleOrNull("pressure_msl") ?: pressure?.doubleOrNull(idx)
            val pLater = pressure?.doubleOrNull(idx + 3)
            val trend = if (pNow == null || pLater == null) 0 else when {
                pLater - pNow > 1.0 -> 1
                pLater - pNow < -1.0 -> -1
                else -> 0
            }

            val alert = cache.optJSONObject("alert")?.let { a ->
                val event = a.optString("event").ifEmpty { null } ?: return@let null
                val until = a.optString("until").ifEmpty { null }?.let {
                    try {
                        LocalDateTime.ofInstant(java.time.OffsetDateTime.parse(it).toInstant(), zone)
                    } catch (e: Exception) {
                        null
                    }
                }
                // An alert that has run out since the fetch is no longer active.
                if (until != null && until.isBefore(now)) null else Alert(event, until)
            }

            return WidgetSnapshot(
                place = cache.optString("place").ifEmpty { "Home" },
                zone = zone,
                now = now,
                fetchedAt = fetchedAt,
                tempF = tempF ?: return null,
                feelsF = if (stale) null else current.doubleOrNull("apparent_temperature"),
                code = code,
                isDay = isDay,
                humidity = if (stale) hourly.optJSONArray("relative_humidity_2m")?.intOrNull(idx) else current.intOrNull("relative_humidity_2m"),
                dewF = hourly.optJSONArray("dew_point_2m")?.doubleOrNull(idx),
                windMph = if (stale) hourly.optJSONArray("wind_speed_10m")?.doubleOrNull(idx) else current.doubleOrNull("wind_speed_10m"),
                gustMph = if (stale) hourly.optJSONArray("wind_gusts_10m")?.doubleOrNull(idx) else current.doubleOrNull("wind_gusts_10m"),
                windDeg = if (stale) hourly.optJSONArray("wind_direction_10m")?.doubleOrNull(idx) else current.doubleOrNull("wind_direction_10m"),
                pressureHpa = pNow,
                pressureTrend = trend,
                uv = hourly.optJSONArray("uv_index")?.doubleOrNull(idx),
                hiF = dHi?.doubleOrNull(ti),
                loF = dLo?.doubleOrNull(ti),
                rainChanceToday = dPop?.intOrNull(ti),
                hours = hours,
                days = days,
                aqi = cache.optJSONObject("aqi")?.intOrNull("us_aqi"),
                alert = alert,
                precipNote = precipNote(hCode, hPop, times, idx, code),
                sun = sunEvent(daily, ti, now),
            )
        }

        /** The index of the hour that contains [now], or null if the forecast doesn't reach it. */
        private fun hourIndex(times: JSONArray, now: LocalDateTime): Int? {
            val key = now.withMinute(0).withSecond(0).withNano(0)
            for (i in 0 until times.length()) {
                val t = try {
                    LocalDateTime.parse(times.optString(i))
                } catch (e: Exception) {
                    continue
                }
                if (!t.isBefore(key)) return i
            }
            return null
        }

        private fun dry(code: Int, pop: Int?): Int =
            if (isWet(code) && pop != null && pop < DRY_POP) DRY_CODE else code

        fun isWet(code: Int): Boolean = code in 51..67 || code in 71..77 || code in 80..86 || code in 95..99

        /**
         * One phrase for the next 12 hours of precipitation: when it starts, or
         * when it ends if it is already falling. A single dry hour inside a spell
         * is a lull, as in WeatherCheckWorker's rain scan.
         */
        private fun precipNote(codes: JSONArray?, pops: JSONArray?, times: JSONArray, idx: Int, nowCode: Int): PrecipNote? {
            codes ?: return null
            val span = minOf(NOTE_WINDOW, times.length() - idx)
            if (span <= 0) return null
            val codeAt = { j: Int -> if (j == 0) nowCode else dry(codes.optInt(idx + j, DRY_CODE), pops?.intOrNull(idx + j)) }
            val wet = BooleanArray(span) { isWet(codeAt(it)) }
            val first = wet.indexOfFirst { it }
            if (first == -1) return null
            var last = first
            while (last + 1 < span && (wet[last + 1] || (last + 2 < span && wet[last + 2]))) last++
            var worst = codeAt(first)
            for (j in first..last) if (wet[j] && severity(codeAt(j)) > severity(worst)) worst = codeAt(j)
            val kind = kindOf(worst)
            fun at(j: Int) = WidgetFormat.hour(LocalDateTime.parse(times.optString(idx + j)))
            return when {
                first > 0 -> PrecipNote(kind, "from", at(first))
                last >= span - 1 -> PrecipNote(kind, "for", "hours")
                else -> PrecipNote(kind, "until", at(last + 1))
            }
        }

        private fun severity(code: Int): Int = when (code) {
            95, 96, 99 -> 5
            56, 57, 66, 67 -> 4
            in 71..77, 85, 86 -> 3
            65, 82 -> 2
            else -> 1
        }

        private fun kindOf(code: Int): String = when (code) {
            95, 96, 99 -> "Storms"
            56, 57, 66, 67 -> "Freezing rain"
            in 71..77, 85, 86 -> "Snow"
            51, 53, 55 -> "Drizzle"
            else -> "Rain"
        }

        private fun sunEvent(daily: JSONObject, ti: Int, now: LocalDateTime): SunEvent? {
            val rise = daily.optJSONArray("sunrise") ?: return null
            val set = daily.optJSONArray("sunset") ?: return null
            fun t(a: JSONArray, i: Int): LocalDateTime? = try {
                LocalDateTime.parse(a.optString(i))
            } catch (e: Exception) {
                null
            }
            val riseToday = t(rise, ti)
            val setToday = t(set, ti) ?: return null
            return when {
                riseToday != null && now.isBefore(riseToday) -> SunEvent(false, riseToday, setToday)
                now.isBefore(setToday) -> SunEvent(true, setToday, t(rise, ti + 1))
                else -> t(rise, ti + 1)?.let { SunEvent(false, it, t(set, ti + 1)) }
            }
        }

        private fun JSONArray.doubleOrNull(i: Int): Double? =
            if (i < 0 || i >= length() || isNull(i)) null else optDouble(i).takeIf { !it.isNaN() }

        private fun JSONArray.intOrNull(i: Int): Int? = doubleOrNull(i)?.roundToInt()

        private fun JSONObject.doubleOrNull(key: String): Double? =
            if (!has(key) || isNull(key)) null else optDouble(key).takeIf { !it.isNaN() }

        private fun JSONObject.intOrNull(key: String): Int? = doubleOrNull(key)?.roundToInt()
    }
}

/** Labels and icons per WMO code, ported from `codes` in weatherCodes.js. */
object WeatherCodes {
    private class Entry(val label: String, val icon: Int, val nightIcon: Int = icon)

    private val CODES = mapOf(
        0 to Entry("Clear Sky", R.drawable.wx_sun, R.drawable.wx_moon),
        1 to Entry("Mainly Clear", R.drawable.wx_sun_small, R.drawable.wx_moon),
        2 to Entry("Partly Cloudy", R.drawable.wx_sun_cloud, R.drawable.wx_cloud),
        3 to Entry("Overcast", R.drawable.wx_cloud),
        45 to Entry("Foggy", R.drawable.wx_fog),
        48 to Entry("Rime Fog", R.drawable.wx_fog),
        51 to Entry("Light Drizzle", R.drawable.wx_sun_rain, R.drawable.wx_rain),
        53 to Entry("Moderate Drizzle", R.drawable.wx_sun_rain, R.drawable.wx_rain),
        55 to Entry("Heavy Drizzle", R.drawable.wx_rain),
        56 to Entry("Freezing Drizzle", R.drawable.wx_rain),
        57 to Entry("Freezing Drizzle", R.drawable.wx_rain),
        61 to Entry("Slight Rain", R.drawable.wx_rain),
        63 to Entry("Moderate Rain", R.drawable.wx_rain),
        65 to Entry("Heavy Rain", R.drawable.wx_rain),
        66 to Entry("Light Freezing Rain", R.drawable.wx_rain),
        67 to Entry("Freezing Rain", R.drawable.wx_rain),
        71 to Entry("Slight Snow", R.drawable.wx_snow),
        73 to Entry("Moderate Snow", R.drawable.wx_snowflake),
        75 to Entry("Heavy Snow", R.drawable.wx_snowflake),
        77 to Entry("Snow Grains", R.drawable.wx_snow),
        80 to Entry("Slight Showers", R.drawable.wx_sun_rain, R.drawable.wx_rain),
        81 to Entry("Moderate Showers", R.drawable.wx_rain),
        82 to Entry("Violent Showers", R.drawable.wx_storm),
        85 to Entry("Slight Snow Showers", R.drawable.wx_snow),
        86 to Entry("Heavy Snow Showers", R.drawable.wx_snowflake),
        95 to Entry("Thunderstorm", R.drawable.wx_storm),
        // 96/99 are the strong-thunderstorm tier, not hail; see weatherCodes.js.
        96 to Entry("Heavy Thunderstorm", R.drawable.wx_storm_strong),
        99 to Entry("Severe Thunderstorm", R.drawable.wx_storm_strong),
    )

    fun label(code: Int): String = CODES[code]?.label ?: "Unknown"

    /** [lightSurface]: fog's mist is a mid-tone there, bright everywhere else. */
    fun icon(code: Int, isDay: Boolean, lightSurface: Boolean): Int {
        val e = CODES[code] ?: return R.drawable.wx_therm
        val icon = if (isDay) e.icon else e.nightIcon
        return if (icon == R.drawable.wx_fog && !lightSurface) R.drawable.wx_fog_bright else icon
    }

    /** The Sky style's background, matching the app's sky for this condition. */
    fun skyBackground(code: Int, isDay: Boolean): Int = when {
        code in 95..99 -> R.drawable.bg_sky_storm
        code == 45 || code == 48 -> R.drawable.bg_sky_fog
        code in 71..77 || code == 85 || code == 86 -> if (isDay) R.drawable.bg_sky_snow_day else R.drawable.bg_sky_snow_night
        code in 51..67 || code in 80..82 -> if (isDay) R.drawable.bg_sky_rain_day else R.drawable.bg_sky_rain_night
        code == 3 -> if (isDay) R.drawable.bg_sky_overcast_day else R.drawable.bg_sky_overcast_night
        code == 2 -> if (isDay) R.drawable.bg_sky_partly_day else R.drawable.bg_sky_partly_night
        else -> if (isDay) R.drawable.bg_sky_clear_day else R.drawable.bg_sky_clear_night
    }
}

/** Unit conversion and phrasing, in the units the page last synced. */
class WidgetFormat(private val units: NotifyStore.Units) {
    fun temp(f: Double): String =
        if (units.temp == "C") "${((f - 32) * 5 / 9).roundToInt()}°" else "${f.roundToInt()}°"

    fun hiLo(hi: Double?, lo: Double?): String =
        if (hi == null || lo == null) "" else "H ${temp(hi)}  L ${temp(lo)}"

    /** Number and unit apart, so the unit can be set smaller. */
    fun wind(mph: Double): Pair<String, String> = when (units.wind) {
        "kmh" -> "${(mph * 1.609344).roundToInt()}" to " km/h"
        "ms" -> "%.1f".format(Locale.US, mph * 0.44704) to " m/s"
        "kn" -> "${(mph * 0.868976).roundToInt()}" to " kn"
        else -> "${mph.roundToInt()}" to " mph"
    }

    fun pressure(hpa: Double): Pair<String, String> = when (units.pressure) {
        "hPa" -> "${hpa.roundToInt()}" to ""
        "mmHg" -> "${(hpa * 0.750062).roundToInt()}" to ""
        else -> "%.2f".format(Locale.US, hpa / 33.8639) to ""
    }

    companion object {
        private val DIRS = arrayOf("N", "NE", "E", "SE", "S", "SW", "W", "NW")

        fun direction(deg: Double): String = DIRS[(((deg / 45).roundToInt() % 8) + 8) % 8]

        /** 15:00 -> "3 PM", as the app's hourly strip labels hours. */
        fun hour(t: LocalDateTime): String {
            val h = t.hour
            return "${if (h % 12 == 0) 12 else h % 12} ${if (h < 12) "AM" else "PM"}"
        }

        /** 16:48 -> ("4:48", " PM"). */
        fun clock(t: LocalDateTime): Pair<String, String> {
            val h = t.hour
            return "${if (h % 12 == 0) 12 else h % 12}:%02d".format(Locale.US, t.minute) to if (h < 12) " AM" else " PM"
        }

        fun clockText(t: LocalDateTime): String = clock(t).let { it.first + it.second }
    }
}
