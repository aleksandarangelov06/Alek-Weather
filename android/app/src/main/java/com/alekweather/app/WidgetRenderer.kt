package com.alekweather.app

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Shader
import android.os.Build
import android.view.View
import android.widget.RemoteViews
import java.time.LocalDateTime
import kotlin.math.roundToInt

/**
 * Draws the widgets: one RemoteViews per widget, in the style its owner chose
 * on the setup screen ([WidgetConfigActivity]), from the cached forecast.
 *
 * The layouts carry the structure; everything that varies by style (background,
 * text and reading colors, tile and alert surfaces) is set here, so each kind
 * has one layout rather than one per style. Rows that repeat (days, hours,
 * tiles) are small cell layouts added with [RemoteViews.addView].
 */
object WidgetRenderer {

    /** A text color: a resource the launcher resolves (Material You), or a fixed one. */
    class Ink(val res: Int = 0, val fixed: Int = 0) {
        fun resolve(context: Context): Int = if (res != 0) context.getColor(res) else fixed
    }

    class Palette(
        val bg: Int?,
        val tile: Int,
        val alert: Int,
        val text: Ink,
        val sub: Ink,
        val rain: Ink,
        val good: Ink,
        val warn: Ink,
        val bad: Ink,
        val alertText: Ink,
        val line: Ink,
        /** Dark text on a light card: fog's mid-tone icon and the deeper temperature colors. */
        val lightSurface: Boolean,
    )

    private fun bright(bg: Int?, tile: Int, line: Int) = Palette(
        bg = bg,
        tile = tile,
        alert = R.drawable.alert_bright,
        text = Ink(fixed = 0xffffffff.toInt()),
        sub = Ink(fixed = 0xdbffffff.toInt()),
        rain = Ink(fixed = 0xffa5d8ff.toInt()),
        good = Ink(fixed = 0xff4ade80.toInt()),
        warn = Ink(fixed = 0xfffacc15.toInt()),
        bad = Ink(fixed = 0xffff8a8a.toInt()),
        alertText = Ink(fixed = 0xffffe4e4.toInt()),
        line = Ink(fixed = line),
        lightSurface = false,
    )

    fun palette(context: Context, style: WidgetStyle, theme: WidgetTheme): Palette = when (style) {
        // The Sky background depends on the weather, so it's picked per render.
        WidgetStyle.SKY -> bright(null, R.drawable.tile_bright, 0x38ffffff)
        WidgetStyle.FROST -> bright(R.drawable.bg_frost, R.drawable.tile_frost, 0x29ffffff)
        WidgetStyle.MATERIAL -> when (theme) {
            WidgetTheme.LIGHT -> Palette(
                R.drawable.bg_m3_light, R.drawable.tile_m3_light, R.drawable.alert_m3_light,
                Ink(R.color.wl_text), Ink(R.color.wl_sub), Ink(R.color.wl_rain), Ink(R.color.wl_good),
                Ink(R.color.wl_warn), Ink(R.color.wl_bad), Ink(R.color.wl_alert_text), Ink(R.color.wl_line),
                lightSurface = true,
            )
            WidgetTheme.DARK -> Palette(
                R.drawable.bg_m3_dark, R.drawable.tile_m3_dark, R.drawable.alert_m3_dark,
                Ink(R.color.wd_text), Ink(R.color.wd_sub), Ink(R.color.wd_rain), Ink(R.color.wd_good),
                Ink(R.color.wd_warn), Ink(R.color.wd_bad), Ink(R.color.wd_alert_text), Ink(R.color.wd_line),
                lightSurface = false,
            )
            WidgetTheme.SYSTEM -> Palette(
                R.drawable.bg_m3_sys, R.drawable.tile_m3_sys, R.drawable.alert_m3_sys,
                Ink(R.color.ws_text), Ink(R.color.ws_sub), Ink(R.color.ws_rain), Ink(R.color.ws_good),
                Ink(R.color.ws_warn), Ink(R.color.ws_bad), Ink(R.color.ws_alert_text), Ink(R.color.ws_line),
                lightSurface = (context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) !=
                    Configuration.UI_MODE_NIGHT_YES,
            )
        }
    }

    // ── Entry points ─────────────────────────────────────────────────────────

    fun updateAll(context: Context) {
        val snap = WidgetSnapshot.from(WidgetData.cache(context))
        val manager = AppWidgetManager.getInstance(context)
        for (kind in WidgetKind.values()) {
            for (id in kind.ids(context)) manager.updateAppWidget(id, build(context, kind, id, snap))
        }
    }

    fun update(context: Context, kind: WidgetKind, id: Int) {
        val snap = WidgetSnapshot.from(WidgetData.cache(context))
        AppWidgetManager.getInstance(context).updateAppWidget(id, build(context, kind, id, snap))
    }

    private fun build(context: Context, kind: WidgetKind, id: Int, snap: WidgetSnapshot?): RemoteViews =
        build(context, kind, WidgetPrefs.style(context, id), WidgetPrefs.theme(context, id), snap, clickable = true)

    /** Also used by the setup screen for its live preview, with [clickable] off. */
    fun build(
        context: Context,
        kind: WidgetKind,
        style: WidgetStyle,
        theme: WidgetTheme,
        snap: WidgetSnapshot?,
        clickable: Boolean,
    ): RemoteViews {
        val pal = palette(context, style, theme)
        val v = RemoteViews(context.packageName, kind.layout)
        val root = android.R.id.background
        val bg = pal.bg ?: snap?.let { WeatherCodes.skyBackground(it.code, it.isDay) } ?: R.drawable.bg_sky_partly_day
        v.setInt(root, "setBackgroundResource", bg)
        if (clickable) v.setOnClickPendingIntent(root, openApp(context))

        if (snap == null) {
            v.setViewVisibility(R.id.content, View.GONE)
            v.setViewVisibility(R.id.empty, View.VISIBLE)
            v.setTextViewText(
                R.id.empty,
                if (NotifyStore(context).latitude == null) "Open Alek Weather and pick a Home place" else "Updating weather",
            )
            v.ink(context, R.id.empty, pal.text)
            return v
        }
        v.setViewVisibility(R.id.empty, View.GONE)
        v.setViewVisibility(R.id.content, View.VISIBLE)

        val fmt = WidgetFormat(NotifyStore(context).units)
        val label = WeatherCodes.label(snap.code)
        v.setContentDescription(root, "${snap.place}, ${fmt.temp(snap.tempF)}, $label")

        // What every kind shares: the place line and the current reading.
        v.setTextViewText(R.id.place, snap.place)
        v.ink(context, R.id.place, pal.text)
        v.setInt(R.id.pin, "setColorFilter", pal.text.resolve(context))
        v.setTextViewText(R.id.temp, fmt.temp(snap.tempF))
        v.ink(context, R.id.temp, pal.text)
        v.setImageViewResource(R.id.icon, WeatherCodes.icon(snap.code, snap.isDay, pal.lightSurface))

        when (kind) {
            WidgetKind.COMPACT -> {
                condition(context, v, pal, label, fmt.hiLo(snap.hiF, snap.loF))
            }
            WidgetKind.NOW3 -> {
                condition(context, v, pal, label, fmt.hiLo(snap.hiF, snap.loF))
                v.setInt(R.id.divider, "setBackgroundColor", pal.line.resolve(context))
                dayColumns(context, v, pal, fmt, snap)
            }
            WidgetKind.HOURLY -> {
                val detail = snap.precipNote?.full ?: fmt.hiLo(snap.hiF, snap.loF)
                v.setTextViewText(R.id.summary, if (detail.isEmpty()) label else "$label · $detail")
                v.ink(context, R.id.summary, pal.sub)
                hourCells(context, v, pal, fmt, snap)
            }
            WidgetKind.DETAILS -> {
                condition(context, v, pal, label, fmt.hiLo(snap.hiF, snap.loF))
                v.setTextViewText(R.id.updated, " · ${WidgetFormat.clockText(snap.fetchedAt)}")
                v.ink(context, R.id.updated, pal.sub)
                tiles(context, v, pal, fmt, snap)
            }
            WidgetKind.COMBO -> {
                val feels = snap.feelsF?.let { "Feels ${fmt.temp(it)} · " } ?: ""
                condition(context, v, pal, label, feels + fmt.hiLo(snap.hiF, snap.loF))
                alert(context, v, pal, snap)
                hourCells(context, v, pal, fmt, snap)
                v.setInt(R.id.divider, "setBackgroundColor", pal.line.resolve(context))
                dayRows(context, v, pal, fmt, snap)
            }
        }
        return v
    }

    // ── Pieces ───────────────────────────────────────────────────────────────

    private fun condition(context: Context, v: RemoteViews, pal: Palette, label: String, sub: String) {
        v.setTextViewText(R.id.cond, label)
        v.ink(context, R.id.cond, pal.text)
        v.setTextViewText(R.id.hilo, sub)
        v.ink(context, R.id.hilo, pal.sub)
    }

    /** Shown from 20%: below that a number on every slot is noise. */
    private fun pop(p: Int?): String = if (p != null && p >= 20) "$p%" else ""

    private fun dayColumns(context: Context, v: RemoteViews, pal: Palette, fmt: WidgetFormat, snap: WidgetSnapshot) {
        v.removeAllViews(R.id.days)
        for (d in snap.days) {
            val c = RemoteViews(context.packageName, R.layout.cell_day_col)
            c.setTextViewText(R.id.day, d.label)
            c.ink(context, R.id.day, pal.sub)
            c.setImageViewResource(R.id.icon, WeatherCodes.icon(d.code, true, pal.lightSurface))
            c.setTextViewText(R.id.pop, pop(d.pop))
            c.ink(context, R.id.pop, pal.rain)
            c.setTextViewText(R.id.hi, fmt.temp(d.hiF))
            c.ink(context, R.id.hi, pal.text)
            c.setTextViewText(R.id.lo, fmt.temp(d.loF))
            c.ink(context, R.id.lo, pal.sub)
            v.addView(R.id.days, c)
        }
    }

    private fun hourCells(context: Context, v: RemoteViews, pal: Palette, fmt: WidgetFormat, snap: WidgetSnapshot) {
        v.removeAllViews(R.id.hours)
        snap.hours.forEachIndexed { i, h ->
            val c = RemoteViews(context.packageName, R.layout.cell_hour)
            if (i == 0) c.setInt(R.id.cell, "setBackgroundResource", pal.tile)
            c.setTextViewText(R.id.time, h.label)
            c.ink(context, R.id.time, pal.sub)
            c.setImageViewResource(R.id.icon, WeatherCodes.icon(h.code, h.isDay, pal.lightSurface))
            c.setTextViewText(R.id.temp, fmt.temp(h.tempF))
            c.ink(context, R.id.temp, pal.text)
            c.setTextViewText(R.id.pop, pop(h.pop))
            c.ink(context, R.id.pop, pal.rain)
            v.addView(R.id.hours, c)
        }
    }

    private class Tile(val label: String, val value: String, val unit: String, val caption: String, val tone: Ink)

    private fun tiles(context: Context, v: RemoteViews, pal: Palette, fmt: WidgetFormat, snap: WidgetSnapshot) {
        val dash = "-"
        val wind = snap.windMph?.let { fmt.wind(it) }
        val windCaption = snap.windDeg?.let { deg ->
            val dir = WidgetFormat.direction(deg)
            val gust = snap.gustMph
            if (gust != null && snap.windMph != null && gust - snap.windMph >= 5) "$dir, gusts ${fmt.wind(gust).first}" else "From $dir"
        } ?: ""
        val humidity = snap.humidity
        val (humidityCaption, humidityTone) = when {
            humidity == null -> "" to pal.sub
            humidity < 30 -> "Dry" to pal.warn
            humidity <= 60 -> "Normal" to pal.good
            humidity <= 75 -> "Humid" to pal.warn
            else -> "Muggy" to pal.bad
        }
        // getUVLabel's bands; High and up share the one alarm color here.
        val uv = snap.uv?.roundToInt()
        val (uvCaption, uvTone) = when {
            uv == null -> "" to pal.sub
            uv <= 2 -> "Low" to pal.good
            uv <= 5 -> "Moderate" to pal.warn
            uv <= 7 -> "High" to pal.bad
            uv <= 10 -> "Very high" to pal.bad
            else -> "Extreme" to pal.bad
        }
        // AirQuality.jsx's bands, with "Unhealthy for Sensitive Groups" cut to fit a tile.
        val aqi = snap.aqi
        val (aqiCaption, aqiTone) = when {
            aqi == null -> "" to pal.sub
            aqi <= 50 -> "Good" to pal.good
            aqi <= 100 -> "Moderate" to pal.warn
            aqi <= 150 -> "Sensitive" to pal.bad
            aqi <= 200 -> "Unhealthy" to pal.bad
            aqi <= 300 -> "Very bad" to pal.bad
            else -> "Hazardous" to pal.bad
        }
        val pressure = snap.pressureHpa?.let { fmt.pressure(it) }
        val sun = snap.sun
        val sunClock = sun?.let { WidgetFormat.clock(it.at) }
        val sunCaption = sun?.other?.let { (if (sun.isSunset) "Rise " else "Set ") + WidgetFormat.clock(it).first } ?: ""

        val list = listOf(
            Tile("Feels like", fmt.temp(snap.feelsF ?: snap.tempF), "", snap.dewF?.let { "Dew pt ${fmt.temp(it)}" } ?: "", pal.sub),
            Tile("Wind", wind?.first ?: dash, wind?.second ?: "", windCaption, pal.sub),
            Tile("Humidity", snap.humidity?.toString() ?: dash, if (snap.humidity != null) "%" else "", humidityCaption, humidityTone),
            Tile("UV", uv?.toString() ?: dash, "", uvCaption, uvTone),
            Tile("AQI", snap.aqi?.toString() ?: dash, "", aqiCaption, aqiTone),
            Tile("Rain", snap.rainChanceToday?.toString() ?: dash, if (snap.rainChanceToday != null) "%" else "",
                snap.precipNote?.short ?: "Dry ahead", if (snap.precipNote != null) pal.rain else pal.sub),
            Tile("Pressure", pressure?.first ?: dash, "",
                when (snap.pressureTrend) { 1 -> "Rising"; -1 -> "Falling"; else -> "Steady" }, pal.sub),
            Tile(if (sun?.isSunset == false) "Sunrise" else "Sunset", sunClock?.first ?: dash, sunClock?.second ?: "", sunCaption, pal.sub),
        )

        v.removeAllViews(R.id.tiles_top)
        v.removeAllViews(R.id.tiles_bottom)
        list.forEachIndexed { i, t ->
            val c = RemoteViews(context.packageName, R.layout.cell_tile)
            c.setInt(R.id.cell, "setBackgroundResource", pal.tile)
            c.setTextViewText(R.id.label, t.label)
            c.ink(context, R.id.label, pal.sub)
            c.setTextViewText(R.id.value, t.value)
            c.ink(context, R.id.value, pal.text)
            c.setTextViewText(R.id.unit, t.unit)
            c.ink(context, R.id.unit, pal.sub)
            c.setTextViewText(R.id.caption, t.caption)
            c.ink(context, R.id.caption, t.tone)
            v.addView(if (i < 4) R.id.tiles_top else R.id.tiles_bottom, c)
        }
    }

    private fun alert(context: Context, v: RemoteViews, pal: Palette, snap: WidgetSnapshot) {
        val alert = snap.alert
        if (alert == null) {
            v.setViewVisibility(R.id.alert, View.GONE)
            return
        }
        v.setViewVisibility(R.id.alert, View.VISIBLE)
        v.setInt(R.id.alert, "setBackgroundResource", pal.alert)
        v.setTextViewText(R.id.alert_title, alert.event)
        v.ink(context, R.id.alert_title, pal.alertText)
        val until = alert.until?.let { u ->
            val day = if (u.toLocalDate() != snap.now.toLocalDate()) {
                u.dayOfWeek.getDisplayName(java.time.format.TextStyle.SHORT, java.util.Locale.US) + " "
            } else {
                ""
            }
            "Until $day${WidgetFormat.clockText(u)} · "
        } ?: ""
        v.setTextViewText(R.id.alert_until, "${until}Tap to read it")
        v.ink(context, R.id.alert_until, pal.alertText)
        v.setInt(R.id.alert_icon, "setColorFilter", pal.alertText.resolve(context))
    }

    private fun dayRows(context: Context, v: RemoteViews, pal: Palette, fmt: WidgetFormat, snap: WidgetSnapshot) {
        v.removeAllViews(R.id.days)
        if (snap.days.isEmpty()) return
        // One scale across the rows, like the app's 7-day bars.
        val min = snap.days.minOf { it.loF }
        val max = snap.days.maxOf { it.hiF }
        val track = pal.line.resolve(context)
        for (d in snap.days) {
            val c = RemoteViews(context.packageName, R.layout.cell_day_row)
            c.setTextViewText(R.id.day, d.label)
            c.ink(context, R.id.day, pal.text)
            c.setImageViewResource(R.id.icon, WeatherCodes.icon(d.code, true, pal.lightSurface))
            c.setTextViewText(R.id.pop, pop(d.pop))
            c.ink(context, R.id.pop, pal.rain)
            c.setTextViewText(R.id.lo, fmt.temp(d.loF))
            c.ink(context, R.id.lo, pal.sub)
            c.setTextViewText(R.id.hi, fmt.temp(d.hiF))
            c.ink(context, R.id.hi, pal.text)
            c.setImageViewBitmap(R.id.bar, rangeBar(d.loF, d.hiF, min, max, track, pal.lightSurface))
            v.addView(R.id.days, c)
        }
    }

    /**
     * The low-to-high bar: a track with the day's range on it, colored from the
     * low's temperature to the high's. A bitmap because RemoteViews has no way
     * to offset a view by a computed fraction. Drawn at a nominal size; the
     * ImageView stretches it to the row (fitXY), which only changes its length.
     */
    private fun rangeBar(lo: Double, hi: Double, min: Double, max: Double, track: Int, light: Boolean): Bitmap {
        val w = 360f
        val h = 18f
        val bmp = Bitmap.createBitmap(w.toInt(), h.toInt(), Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bmp)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        paint.color = track
        canvas.drawRoundRect(RectF(0f, 0f, w, h), h / 2, h / 2, paint)
        val span = (max - min).takeIf { it > 0 } ?: 1.0
        val left = ((lo - min) / span * w).toFloat()
        val right = maxOf(((hi - min) / span * w).toFloat(), left + h)
        paint.color = 0xffffffff.toInt()
        paint.shader = LinearGradient(left, 0f, right, 0f, tempColor(lo, light), tempColor(hi, light), Shader.TileMode.CLAMP)
        canvas.drawRoundRect(RectF(left, 0f, right, h), h / 2, h / 2, paint)
        return bmp
    }

    // TEMP_STOPS and TEMP_STOPS_LIGHT from weatherCodes.js.
    private val STOPS = arrayOf(
        10 to 0x5eb8ff, 32 to 0x74c0fc, 45 to 0xa9e34b, 60 to 0x51cf66,
        75 to 0xffd43b, 85 to 0xff922b, 95 to 0xfa5252, 110 to 0xcc5de8,
    )
    private val STOPS_LIGHT = arrayOf(
        10 to 0x2563eb, 32 to 0x0284c7, 45 to 0x16a34a, 60 to 0x059669,
        75 to 0xca8a04, 85 to 0xea580c, 95 to 0xdc2626, 110 to 0x9333ea,
    )

    private fun tempColor(f: Double, light: Boolean): Int {
        val stops = if (light) STOPS_LIGHT else STOPS
        if (f <= stops.first().first) return 0xff000000.toInt() or stops.first().second
        if (f >= stops.last().first) return 0xff000000.toInt() or stops.last().second
        for (i in 0 until stops.size - 1) {
            val (t0, c0) = stops[i]
            val (t1, c1) = stops[i + 1]
            if (f <= t1) {
                val t = (f - t0) / (t1 - t0)
                fun ch(shift: Int): Int {
                    val a = (c0 shr shift) and 0xff
                    val b = (c1 shr shift) and 0xff
                    return (a + t * (b - a)).roundToInt()
                }
                return (0xff shl 24) or (ch(16) shl 16) or (ch(8) shl 8) or ch(0)
            }
        }
        return 0xff000000.toInt() or stops.last().second
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    /**
     * A text color. On Android 12+ a resource color is handed to the launcher
     * unresolved, so Material You follows a new wallpaper or dark mode the
     * moment it changes instead of at the next refresh.
     */
    private fun RemoteViews.ink(context: Context, id: Int, ink: Ink) {
        if (ink.res != 0 && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            setColorStateList(id, "setTextColor", ink.res)
        } else {
            setTextColor(id, ink.resolve(context))
        }
    }

    private fun openApp(context: Context): PendingIntent {
        val intent = Intent(context, MainActivity::class.java)
            .setAction(Intent.ACTION_MAIN)
            .addCategory(Intent.CATEGORY_LAUNCHER)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
        return PendingIntent.getActivity(
            context, 0, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
    }

    /** A believable forecast for the setup screen's preview when nothing is cached yet. */
    fun sample(context: Context): WidgetSnapshot {
        val now = LocalDateTime.now()
        val base = now.withMinute(0)
        val hours = listOf(54.0 to 2, 55.0 to 2, 55.0 to 3, 53.0 to 61, 51.0 to 63, 49.0 to 61).mapIndexed { i, (t, c) ->
            WidgetSnapshot.Hour(if (i == 0) "Now" else WidgetFormat.hour(base.plusHours(i.toLong())), t, c, true,
                listOf(null, null, 20, 70, 80, 60)[i])
        }
        val days = listOf(Triple(61, 49.0, 39.0), Triple(0, 46.0, 33.0), Triple(2, 50.0, 35.0)).mapIndexed { i, (c, hi, lo) ->
            WidgetSnapshot.Day(
                now.toLocalDate().plusDays(i + 1L).dayOfWeek.getDisplayName(java.time.format.TextStyle.SHORT, java.util.Locale.US),
                c, hi, lo, if (i == 0) 60 else null,
            )
        }
        return WidgetSnapshot(
            place = NotifyStore(context).placeName ?: "Home",
            zone = java.time.ZoneId.systemDefault(),
            now = now,
            fetchedAt = now,
            tempF = 54.0, feelsF = 51.0, code = 2, isDay = true,
            humidity = 48, dewF = 35.0, windMph = 9.0, gustMph = 18.0, windDeg = 315.0,
            pressureHpa = 1019.6, pressureTrend = 1, uv = 3.0,
            hiF = 57.0, loF = 41.0, rainChanceToday = 10,
            hours = hours, days = days, aqi = 34, alert = null,
            precipNote = null,
            sun = WidgetSnapshot.SunEvent(true, now.withHour(16).withMinute(48), now.plusDays(1).withHour(7).withMinute(2)),
        )
    }
}
