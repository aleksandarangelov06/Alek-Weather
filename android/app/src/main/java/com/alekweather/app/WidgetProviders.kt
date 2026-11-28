package com.alekweather.app

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.os.Bundle

/** The five home-screen widgets, and the size each is designed at (dp). */
enum class WidgetKind(
    val layout: Int,
    val provider: Class<out AppWidgetProvider>,
    val designWidth: Int,
    val designHeight: Int,
) {
    COMPACT(R.layout.widget_compact, CompactWidget::class.java, 168, 168),
    NOW3(R.layout.widget_now3, NowWidget::class.java, 344, 176),
    HOURLY(R.layout.widget_hourly, HourlyWidget::class.java, 344, 176),
    DETAILS(R.layout.widget_details, DetailsWidget::class.java, 344, 264),
    COMBO(R.layout.widget_combo, ComboWidget::class.java, 344, 360);

    fun ids(context: Context): IntArray =
        AppWidgetManager.getInstance(context).getAppWidgetIds(ComponentName(context, provider))

    companion object {
        fun anyPlaced(context: Context): Boolean = values().any { it.ids(context).isNotEmpty() }

        /** Which kind a placed widget is, from the provider it was added under. */
        fun of(context: Context, widgetId: Int): WidgetKind? {
            val provider = AppWidgetManager.getInstance(context).getAppWidgetInfo(widgetId)?.provider ?: return null
            return values().firstOrNull { it.provider.name == provider.className }
        }
    }
}

enum class WidgetStyle { SKY, MATERIAL, FROST }

/** Material You only: follow the system, or stay light or dark. */
enum class WidgetTheme { SYSTEM, LIGHT, DARK }

/** Each placed widget's style, chosen on the setup screen. Sky until set. */
object WidgetPrefs {
    private const val PREFS = "alek_widgets"

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun has(context: Context, id: Int): Boolean = prefs(context).contains("style_$id")

    fun style(context: Context, id: Int): WidgetStyle =
        prefs(context).getString("style_$id", null)
            ?.let { runCatching { WidgetStyle.valueOf(it) }.getOrNull() } ?: WidgetStyle.SKY

    fun theme(context: Context, id: Int): WidgetTheme =
        prefs(context).getString("theme_$id", null)
            ?.let { runCatching { WidgetTheme.valueOf(it) }.getOrNull() } ?: WidgetTheme.SYSTEM

    fun save(context: Context, id: Int, style: WidgetStyle, theme: WidgetTheme) {
        prefs(context).edit().putString("style_$id", style.name).putString("theme_$id", theme.name).apply()
    }

    fun remove(context: Context, ids: IntArray) {
        val edit = prefs(context).edit()
        for (id in ids) edit.remove("style_$id").remove("theme_$id")
        edit.apply()
    }
}

/**
 * Shared behaviour for the five providers. Drawing always comes from the cache
 * ([WidgetData]); a fetch is only kicked off when that cache is missing or
 * older than the refresh interval, so a launcher that calls onUpdate freely
 * (on boot, on every resize) doesn't turn into a stream of requests.
 */
abstract class AlekWidgetProvider(private val kind: WidgetKind) : AppWidgetProvider() {

    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        for (id in ids) WidgetRenderer.update(context, kind, id)
        WidgetRefreshWorker.schedule(context)
        val cache = WidgetData.cache(context)
        val age = System.currentTimeMillis() - (cache?.optLong("fetchedAt") ?: 0L)
        if (cache == null || age > STALE_MS) WidgetRefreshWorker.refreshNow(context)
    }

    override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, id: Int, options: Bundle) {
        WidgetRenderer.update(context, kind, id)
    }

    override fun onDeleted(context: Context, ids: IntArray) {
        WidgetPrefs.remove(context, ids)
    }

    override fun onDisabled(context: Context) {
        // Fires when the last widget of *this* kind goes; the others may remain.
        if (!WidgetKind.anyPlaced(context)) WidgetRefreshWorker.cancel(context)
    }

    private companion object {
        const val STALE_MS = 30 * 60 * 1000L
    }
}

class CompactWidget : AlekWidgetProvider(WidgetKind.COMPACT)
class NowWidget : AlekWidgetProvider(WidgetKind.NOW3)
class HourlyWidget : AlekWidgetProvider(WidgetKind.HOURLY)
class DetailsWidget : AlekWidgetProvider(WidgetKind.DETAILS)
class ComboWidget : AlekWidgetProvider(WidgetKind.COMBO)
