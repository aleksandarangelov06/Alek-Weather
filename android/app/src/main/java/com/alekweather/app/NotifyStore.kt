package com.alekweather.app

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * The notification settings and dedup state, in SharedPreferences.
 *
 * The web app keeps its preferences in localStorage, which belongs to the
 * WebView and is unreadable from a background worker (and from a process that
 * has no WebView at all). So the page mirrors what the worker needs — the
 * toggle, the enabled types, the current location, the unit — through
 * `AndroidNotify.syncSettings`, and this class is where that lands. The
 * home-screen widgets read the same place from here, plus its name and the
 * wind and pressure units.
 *
 * The dedup state lives here too, and only here: both the foreground check and
 * the background one run through [WeatherCheckWorker], so there is a single
 * record of what has already been notified. Splitting it between localStorage
 * and prefs would let a rain notification fire twice — once from the worker
 * while closed, once from the page on next open.
 */
class NotifyStore(context: Context) {
    private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    companion object {
        const val PREFS = "alek_notif"

        private const val KEY_ENABLED = "enabled"
        private const val KEY_TYPES = "types"
        private const val KEY_LAT = "lat"
        private const val KEY_LON = "lon"
        private const val KEY_UNIT = "unit"
        private const val KEY_PLACE = "place"
        private const val KEY_WIND_UNIT = "unit_wind"
        private const val KEY_PRESSURE_UNIT = "unit_pressure"
        private const val KEY_SEEN_ALERTS = "seen_alerts"
        private const val KEY_NOTIFIED_DATES = "notified_dates"

        /** Matches the web side's cap on remembered alert ids. */
        private const val SEEN_ALERTS_CAP = 200
    }

    val enabled: Boolean get() = prefs.getBoolean(KEY_ENABLED, false)

    /** "rain", "alerts", "tomorrow" — the per-type toggles from Settings. */
    val types: Set<String>
        get() = prefs.getStringSet(KEY_TYPES, emptySet()) ?: emptySet()

    /** Null until the page has synced a location at least once. */
    val latitude: Double? get() = prefs.getString(KEY_LAT, null)?.toDoubleOrNull()
    val longitude: Double? get() = prefs.getString(KEY_LON, null)?.toDoubleOrNull()

    /** "F" or "C"; forecasts are always fetched in F and converted for display. */
    val unit: String get() = prefs.getString(KEY_UNIT, "F") ?: "F"

    /** The notification place's name, for the widgets' place line. */
    val placeName: String? get() = prefs.getString(KEY_PLACE, null)

    /**
     * Every unit the widgets display in. Wind and pressure have their own
     * settings on the page's Units screen; until a page that sends them has
     * synced, they follow the °F / °C switch the way UNIT_SYSTEMS does.
     */
    class Units(val temp: String, val wind: String, val pressure: String)

    val units: Units
        get() {
            val temp = unit
            val metric = temp == "C"
            return Units(
                temp,
                prefs.getString(KEY_WIND_UNIT, null) ?: if (metric) "kmh" else "mph",
                prefs.getString(KEY_PRESSURE_UNIT, null) ?: if (metric) "hPa" else "inHg",
            )
        }

    /**
     * Replaces the mirrored settings. Coordinates arrive as strings because
     * SharedPreferences has no double; a float would lose the last decimals.
     */
    fun saveSettings(
        enabled: Boolean,
        types: Set<String>,
        latitude: Double?,
        longitude: Double?,
        unit: String,
        placeName: String? = this.placeName,
        windUnit: String? = null,
        pressureUnit: String? = null,
    ) {
        prefs.edit()
            .putBoolean(KEY_ENABLED, enabled)
            .putStringSet(KEY_TYPES, types)
            .putString(KEY_LAT, latitude?.toString())
            .putString(KEY_LON, longitude?.toString())
            .putString(KEY_UNIT, unit)
            .putString(KEY_PLACE, placeName)
            .putString(KEY_WIND_UNIT, windUnit)
            .putString(KEY_PRESSURE_UNIT, pressureUnit)
            .apply()
    }

    // ── Dedup: NOAA alerts ───────────────────────────────────────────────────

    fun seenAlertIds(): Set<String> {
        val raw = prefs.getString(KEY_SEEN_ALERTS, null) ?: return emptySet()
        return try {
            val arr = JSONArray(raw)
            (0 until arr.length()).mapNotNull { arr.optString(it).ifEmpty { null } }.toSet()
        } catch (e: org.json.JSONException) {
            emptySet()
        }
    }

    fun markAlertsSeen(ids: Collection<String>) {
        if (ids.isEmpty()) return
        // Insertion order matters: the cap drops the oldest ids, and an alert
        // old enough to be forgotten has long since expired.
        val merged = (seenAlertIds() + ids).toList().takeLast(SEEN_ALERTS_CAP)
        prefs.edit().putString(KEY_SEEN_ALERTS, JSONArray(merged).toString()).apply()
    }

    // ── Dedup: once per day per type ─────────────────────────────────────────

    /** The local date ("YYYY-MM-DD") this type last fired on, or null. */
    fun notifiedDate(type: String): String? = notifiedDates().optString(type).ifEmpty { null }

    fun markNotifiedDate(type: String, date: String) {
        val dates = notifiedDates().put(type, date)
        prefs.edit().putString(KEY_NOTIFIED_DATES, dates.toString()).apply()
    }

    private fun notifiedDates(): JSONObject {
        val raw = prefs.getString(KEY_NOTIFIED_DATES, null) ?: return JSONObject()
        return try {
            JSONObject(raw)
        } catch (e: org.json.JSONException) {
            JSONObject()
        }
    }
}
