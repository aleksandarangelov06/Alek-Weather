package com.alekweather.app

import android.appwidget.AppWidgetManager
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.RadioButton
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import kotlin.math.min

/**
 * The widget setup screen: pick Sky, Material You (and its theme) or Frosted
 * glass, with a live preview that is the widget itself, built by the same
 * [WidgetRenderer] call and applied locally rather than on the home screen.
 *
 * Android opens it when a widget is placed, and on 12+ again from a long-press
 * on the widget. Backing out of a new widget cancels it (the launcher removes
 * it); backing out of a reconfigure leaves the widget as it was.
 */
class WidgetConfigActivity : AppCompatActivity() {

    private var widgetId = AppWidgetManager.INVALID_APPWIDGET_ID
    private lateinit var kind: WidgetKind
    private var style = WidgetStyle.SKY
    private var theme = WidgetTheme.SYSTEM
    private var snapshot: WidgetSnapshot? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setResult(RESULT_CANCELED)

        widgetId = intent?.extras?.getInt(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
            ?: AppWidgetManager.INVALID_APPWIDGET_ID
        if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) {
            finish()
            return
        }
        kind = WidgetKind.of(this, widgetId) ?: WidgetKind.NOW3
        val reconfigure = WidgetPrefs.has(this, widgetId)
        style = WidgetPrefs.style(this, widgetId)
        theme = WidgetPrefs.theme(this, widgetId)
        snapshot = WidgetSnapshot.from(WidgetData.cache(this)) ?: WidgetRenderer.sample(this)

        setContentView(R.layout.activity_widget_config)
        findViewById<View>(R.id.back).setOnClickListener { finish() }

        options().forEach { (s, row) -> row.setOnClickListener { style = s; refresh() } }
        themes().forEach { (t, seg) -> seg.setOnClickListener { theme = t; refresh() } }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            findViewById<TextView>(R.id.material_desc).text = "Light or dark Material colors"
        }

        val store = NotifyStore(this)
        findViewById<TextView>(R.id.home_title).text =
            if (store.latitude == null) "No Home place yet" else "Home place · ${store.placeName ?: "Saved"}"
        findViewById<TextView>(R.id.home_desc).text =
            if (store.latitude == null) "Open Alek Weather and pick a Home place" else "Change your Home place in Saved places"

        findViewById<TextView>(R.id.save).apply {
            text = if (reconfigure) "Save" else "Add widget"
            setOnClickListener { save() }
        }
        refresh()
    }

    private fun options() = listOf(
        WidgetStyle.SKY to findViewById<View>(R.id.option_sky),
        WidgetStyle.MATERIAL to findViewById<View>(R.id.option_material),
        WidgetStyle.FROST to findViewById<View>(R.id.option_frost),
    )

    private fun radios() = mapOf(
        WidgetStyle.SKY to findViewById<RadioButton>(R.id.radio_sky),
        WidgetStyle.MATERIAL to findViewById<RadioButton>(R.id.radio_material),
        WidgetStyle.FROST to findViewById<RadioButton>(R.id.radio_frost),
    )

    private fun themes() = listOf(
        WidgetTheme.SYSTEM to findViewById<TextView>(R.id.theme_system),
        WidgetTheme.LIGHT to findViewById<TextView>(R.id.theme_light),
        WidgetTheme.DARK to findViewById<TextView>(R.id.theme_dark),
    )

    private fun refresh() {
        val radios = radios()
        for ((s, row) in options()) {
            val on = s == style
            radios[s]?.isChecked = on
            row.isSelected = on
            row.setBackgroundResource(if (on) R.drawable.cfg_option_selected else R.drawable.cfg_option)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) row.stateDescription = if (on) "Selected" else "Not selected"
        }
        findViewById<View>(R.id.theme_section).visibility = if (style == WidgetStyle.MATERIAL) View.VISIBLE else View.GONE
        for ((t, seg) in themes()) {
            val on = t == theme
            seg.isSelected = on
            seg.setBackgroundResource(if (on) R.drawable.cfg_segment_on else 0)
            seg.setTextColor(getColor(if (on) R.color.cfg_text else R.color.cfg_sub))
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) seg.stateDescription = if (on) "Selected" else "Not selected"
        }
        showPreview()
    }

    /**
     * Applies the real RemoteViews at the widget's designed size, scaled down
     * when the screen is narrower than that.
     */
    private fun showPreview() {
        val host = findViewById<FrameLayout>(R.id.preview)
        host.removeAllViews()
        val views = WidgetRenderer.build(this, kind, style, theme, snapshot, clickable = false)
        val widget = views.apply(applicationContext, host)

        val density = resources.displayMetrics.density
        val w = kind.designWidth * density
        val h = kind.designHeight * density
        // Screen minus this screen's side padding and the preview frame's.
        val available = resources.displayMetrics.widthPixels - 64 * density
        val scale = min(1f, available / w)

        widget.layoutParams = FrameLayout.LayoutParams(w.toInt(), h.toInt())
        widget.pivotX = 0f
        widget.pivotY = 0f
        widget.scaleX = scale
        widget.scaleY = scale
        host.layoutParams = host.layoutParams.apply {
            width = (w * scale).toInt()
            height = (h * scale).toInt()
        }
        host.clipChildren = true
        (host.parent as? ViewGroup)?.clipChildren = true
        host.addView(widget)
    }

    private fun save() {
        WidgetPrefs.save(this, widgetId, style, theme)
        WidgetRenderer.update(this, kind, widgetId)
        WidgetRefreshWorker.schedule(this)
        if (WidgetData.cache(this) == null) WidgetRefreshWorker.refreshNow(this)
        setResult(RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId))
        finish()
    }
}
