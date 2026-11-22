package com.alekweather.app

import android.animation.ValueAnimator
import android.annotation.SuppressLint
import android.content.Context
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.PorterDuff
import android.graphics.Shader
import android.graphics.Typeface
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.Process
import android.provider.Settings
import android.view.Choreographer
import android.view.Gravity
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.View
import android.view.animation.PathInterpolator
import android.widget.FrameLayout
import java.util.Collections
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * The launch screen: the page's boot animation (#boot in index.html), drawn
 * natively over the WebView from the first frame until the page is ready.
 *
 * Why native: in a WebView even a compositor-only CSS animation shares the
 * launch with the page. Its frames are pulled through the app's UI thread and
 * drawn on the render thread the WebView also rasterises on, and at a cold
 * start all of that is busy (Chromium starting, the bundle, the first render,
 * the forecast landing), so the animation stuttered however fast the phone.
 *
 * Here the moving part is a SurfaceView above the window, drawn in software
 * on a thread of its own and timed by that thread's own Choreographer, from
 * bitmaps rendered once ([BootArt]). SurfaceFlinger composites it directly, so
 * nothing the WebView, the UI thread or the render thread does can hold one of
 * its frames back. Behind it, plain views paint the background and the sky,
 * which hold still.
 *
 * The page drives it through MainActivity's AndroidBoot bridge: it reports the
 * look (the theme, and the sky its own boot screen would show) and lifts it
 * when App would lift #boot. Until then #boot stays in the page as a blank
 * cover, so the app's launch staging underneath is unchanged.
 */
@SuppressLint("ViewConstructor")
internal class BootOverlay(
    context: Context,
    look: BootLook,
    @Volatile private var dark: Boolean,
    art: List<BootArt.Drawn?>,
) : FrameLayout(context), SurfaceHolder.Callback {

    private companion object {
        // The scene order's timing (public/boot-cycle.js): each slide has the
        // stage for a beat, popped in by POPPED, leaving from LEAVING, gone by
        // GONE (overlapping the next one's pop).
        const val BEAT = 700f
        const val POPPED = 210f
        const val LEAVING = 595f
        const val GONE = 735f
        const val ROUNDS = 4

        // The glyphs' own loops (index.html's keyframes).
        const val SPIN_MS = 10_000f
        const val BREATHE_MS = 2800f
        const val DRIFT_MS = 3600f
        const val BOLT_MS = 700f

        // The name rising in, the sky fading in, and the exit (#boot's transition).
        const val NAME_DELAY_MS = 120f
        const val NAME_MS = 600f
        const val SKY_FADE_MS = 400L
        const val FADE_MS = 450f

        const val NAME = "Alek Weather"

        /** The name's shadow over a sky: CSS 0 1px 10px, as a Paint radius (sigma 5). */
        const val SHADOW_RADIUS_DP = 7.8f

        val BG_LIGHT = Color.rgb(0xF0, 0xF2, 0xF5)
        val BG_DARK = Color.BLACK
        val TEXT_LIGHT = Color.rgb(0x1A, 0x1A, 0x2E)
        val TEXT_DARK = Color.rgb(0xE6, 0xED, 0xF3)

        val POP = PathInterpolator(0.34f, 1.56f, 0.64f, 1f)
        val OUT = PathInterpolator(0.4f, 0f, 1f, 1f)
        val EASE = PathInterpolator(0.42f, 0f, 0.58f, 1f)
        val EASE_IN = PathInterpolator(0.42f, 0f, 1f, 1f)
        val EASE_OUT = PathInterpolator(0f, 0f, 0.58f, 1f)
        val SKY_EASE = PathInterpolator(0.25f, 0.1f, 0.25f, 1f)
        val RISE = PathInterpolator(0.16f, 1f, 0.3f, 1f)
        val LIFT = PathInterpolator(0.4f, 0f, 0.2f, 1f)
    }

    private val density = resources.displayMetrics.density

    /** The system animation scale; 0 is animations off, which a page sees as prefers-reduced-motion. */
    private val animScale = Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f)

    /** Reduced motion, as on the page: the slides cross-fade, nothing inside them moves. */
    private val still = animScale == 0f

    private val stagePx = px(BootArt.STAGE_DP)
    private val glyphInsetPx = px(BootArt.GLYPH_INSET_DP)
    private val glyphPx = px(BootArt.GLYPH_DP)
    private val layerLeft = FloatArray(BootArt.LAYERS.size) { px(BootArt.LAYERS[it].left) }
    private val layerTop = FloatArray(BootArt.LAYERS.size) { px(BootArt.LAYERS[it].top) }
    private val layerBox = FloatArray(BootArt.LAYERS.size) { px(BootArt.LAYERS[it].size) }

    /** Room around the stage for the pop's overshoot, the exit's swell and the falling drops. */
    private val marginPx = px(24f)
    private val gapPx = px(22f)
    private val risePx = 8f * density
    private val shadowPadPx = px(12f)

    private val namePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        textSize = 24f * density
        typeface = nameTypeface()
        letterSpacing = -0.01f
    }
    private val nameAscent = -namePaint.fontMetrics.ascent
    private val nameHeight = namePaint.fontMetrics.let { it.descent - it.ascent }
    private val nameWidth = namePaint.measureText(NAME)

    // The stage and the name below it, a column centred on the screen as the
    // page's is, with the margins inside the surface.
    private val surfaceWidth = ceil(max(stagePx, nameWidth + 2f * shadowPadPx) + 2f * marginPx).toInt()
    private val surfaceHeight = ceil(marginPx + stagePx + gapPx + nameHeight + marginPx).toInt()

    private val order = sequence(BootArt.SLIDES)
    private val sky = SkyView(context)
    private val surface = SurfaceView(context)

    // Shared with the drawing thread.
    private val lock = Any()
    private var holder: SurfaceHolder? = null // guarded by lock
    @Volatile private var art: List<BootArt.Drawn?> = art
    @Volatile private var nameColor = 0
    @Volatile private var nameShadow = false
    @Volatile private var nameVersion = 0
    @Volatile private var liftRequested = false
    @Volatile private var released = false

    private val thread = HandlerThread("BootOverlay", Process.THREAD_PRIORITY_DISPLAY).apply { start() }
    private val drawHandler = Handler(thread.looper)
    private val drawer = Drawer()

    private var skyShown = false
    private var skyFade: ValueAnimator? = null
    private var lifting = false

    init {
        // Takes the touches meant for the app until it lifts, as #boot does.
        isClickable = true
        contentDescription = "Loading Alek Weather"
        addView(sky, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        surface.setZOrderOnTop(true)
        surface.holder.setFormat(PixelFormat.TRANSLUCENT)
        surface.holder.addCallback(this)
        addView(surface, LayoutParams(surfaceWidth, surfaceHeight, Gravity.CENTER))
        show(look, first = true)
    }

    /** A newer look from the page (see [BootLook]). */
    fun setLook(look: BootLook) = show(look, first = false)

    /** Fades the screen out, as #boot's exit did; [onGone] runs once it has. */
    fun lift(onGone: () -> Unit) {
        if (lifting) return
        lifting = true
        isClickable = false
        liftRequested = true
        skyFade?.cancel()
        sky.animate()
            .alpha(0f)
            .setDuration(FADE_MS.toLong())
            .setInterpolator(LIFT)
            .withEndAction {
                release()
                onGone()
            }
    }

    override fun onDetachedFromWindow() {
        super.onDetachedFromWindow()
        release()
    }

    override fun surfaceCreated(holder: SurfaceHolder) {
        synchronized(lock) { this.holder = holder }
        drawHandler.post { drawer.wake() }
    }

    override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) = Unit

    // Returns only once no frame is being drawn into the surface, so it is
    // never touched after the system takes it back.
    override fun surfaceDestroyed(holder: SurfaceHolder) {
        synchronized(lock) { this.holder = null }
    }

    private fun show(look: BootLook, first: Boolean) {
        val dark = look.dark(context)
        if (dark != this.dark) {
            this.dark = dark
            // The clouds dim in dark mode: redrawn off this thread, swapped in when ready.
            Thread({
                val drawn = try {
                    BootArt.render(density, dark)
                } catch (e: Exception) {
                    null
                } catch (e: OutOfMemoryError) {
                    null
                }
                if (drawn != null && this.dark == dark && !released) art = drawn
            }, "BootArt").start()
        }
        sky.base = if (dark) BG_DARK else BG_LIGHT
        val stops = look.skyStops()
        if (stops != null) {
            sky.setStops(stops.first, stops.second)
            if (!skyShown) fadeSky(1f, first)
        } else if (skyShown) {
            fadeSky(0f, first)
        }
        skyShown = stops != null
        // White over a sky, with a shadow, as the page's name is.
        nameColor = when {
            stops != null -> Color.WHITE
            dark -> TEXT_DARK
            else -> TEXT_LIGHT
        }
        nameShadow = stops != null
        nameVersion++
    }

    private fun fadeSky(to: Float, now: Boolean) {
        skyFade?.cancel()
        if (now) {
            sky.skyAlpha = to
            return
        }
        skyFade = ValueAnimator.ofFloat(sky.skyAlpha, to).apply {
            duration = SKY_FADE_MS
            interpolator = SKY_EASE
            addUpdateListener { sky.skyAlpha = it.animatedValue as Float }
            start()
        }
    }

    private fun release() {
        if (released) return
        released = true
        thread.quitSafely()
    }

    private fun px(dp: Float) = BootArt.px(dp, density).toFloat()

    // The page's boot name is Google Sans at 500 where the font is to hand
    // (Pixels ship it), else the system sans at that weight: Roboto Medium,
    // the page's own fallback.
    private fun nameTypeface(): Typeface {
        val family = Typeface.create("google-sans", Typeface.NORMAL)
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            Typeface.create(family, 500, false)
        } else {
            Typeface.create("sans-serif-medium", Typeface.NORMAL)
        }
    }

    // Rounds of the slides, each in a fresh random order, so every scene comes
    // up equally often and never twice running, not even where the loop wraps
    // (public/boot-cycle.js's sequence).
    private fun sequence(count: Int): IntArray {
        val seq = ArrayList<Int>(count * ROUNDS)
        repeat(ROUNDS) {
            val round = (0 until count).shuffled().toMutableList()
            if (seq.isNotEmpty() && round[0] == seq.last()) Collections.swap(round, 0, 1)
            seq.addAll(round)
        }
        val n = seq.size
        if (seq[n - 1] == seq[0]) Collections.swap(seq, n - 1, n - 2)
        return seq.toIntArray()
    }

    private fun alpha(f: Float) = (f * 255f).roundToInt().coerceIn(0, 255)

    /** Draws the stage and the name, every frame, on the overlay's own thread. */
    private inner class Drawer : Choreographer.FrameCallback {
        private var choreographer: Choreographer? = null
        private var looping = false
        private var start = 0L
        private var liftAt = 0L
        private val bitmapPaint = Paint(Paint.FILTER_BITMAP_FLAG)
        private var nameCache: Bitmap? = null
        private var nameDrawn = -1
        private var slideAlpha = 0f
        private var slideScale = 1f

        fun wake() {
            if (released || looping) return
            val c = choreographer ?: Choreographer.getInstance().also { choreographer = it }
            looping = true
            c.postFrameCallback(this)
        }

        override fun doFrame(frameTimeNanos: Long) {
            looping = false
            if (released) return
            if (start == 0L) start = frameTimeNanos
            val t = (frameTimeNanos - start) / 1_000_000f

            var fade = 1f
            var swell = 1f
            if (liftRequested) {
                if (liftAt == 0L) liftAt = frameTimeNanos
                val span = FADE_MS * animScale
                val x = if (span <= 0f) 1f else ((frameTimeNanos - liftAt) / 1_000_000f / span).coerceIn(0f, 1f)
                val p = LIFT.getInterpolation(x)
                fade = 1f - p
                // The stage swells a touch as it goes.
                if (!still) swell = 1f + 0.08f * p
            }

            val drew = synchronized(lock) {
                val h = holder ?: return@synchronized false
                val canvas = try {
                    h.lockCanvas()
                } catch (e: RuntimeException) {
                    null
                } ?: return@synchronized false
                try {
                    draw(canvas, t, fade, swell)
                } finally {
                    try {
                        h.unlockCanvasAndPost(canvas)
                    } catch (e: RuntimeException) {
                        // The surface went with the frame; surfaceCreated wakes this again.
                    }
                }
                true
            }

            // Goes on while there is a surface and something left to show.
            if (drew && fade > 0f) {
                looping = true
                choreographer?.postFrameCallback(this)
            }
        }

        private fun draw(canvas: Canvas, t: Float, fade: Float, swell: Float) {
            canvas.drawColor(Color.TRANSPARENT, PorterDuff.Mode.CLEAR)
            if (fade <= 0f) return
            val width = canvas.width.toFloat()
            val faded = fade < 1f
            if (faded) canvas.saveLayerAlpha(0f, 0f, width, canvas.height.toFloat(), alpha(fade))
            val stageLeft = (width - stagePx) / 2f
            val stageTop = marginPx
            canvas.save()
            if (swell != 1f) canvas.scale(swell, swell, stageLeft + stagePx / 2f, stageTop + stagePx / 2f)
            drawSlides(canvas, t, stageLeft, stageTop)
            canvas.restore()
            drawName(canvas, t, width)
            if (faded) canvas.restore()
        }

        private fun drawSlides(canvas: Canvas, t: Float, stageLeft: Float, stageTop: Float) {
            val layers = BootArt.LAYERS
            val drawn = art
            for (s in 0 until BootArt.SLIDES) {
                slide(s, t)
                if (slideAlpha <= 0f) continue
                val inset = if (s == 0) 0f else glyphInsetPx
                val size = if (s == 0) stagePx else glyphPx
                val left = stageLeft + inset
                val top = stageTop + inset
                // Faded as one piece, as the page's slide is, so a drop
                // doesn't show through a half-faded cloud.
                val grouped = slideAlpha < 1f
                if (grouped) {
                    val pad = size * 0.3f
                    canvas.saveLayerAlpha(left - pad, top - pad, left + size + pad, top + size + pad, alpha(slideAlpha))
                }
                canvas.save()
                if (slideScale != 1f) canvas.scale(slideScale, slideScale, left + size / 2f, top + size / 2f)
                for (i in layers.indices) {
                    if (layers[i].slide != s) continue
                    val d = drawn[i] ?: continue
                    drawLayer(canvas, i, d, t, left, top)
                }
                canvas.restore()
                if (grouped) canvas.restore()
            }
        }

        // Slide s's state at time t, from the shuffled order: popping in from
        // small with a slight overshoot, holding, then shrinking away as the
        // next one pops in. Into slideAlpha and slideScale.
        private fun slide(s: Int, t: Float) {
            val total = order.size * BEAT
            val time = t % total
            var a = 0f
            var scale = 0.6f
            for (i in order.indices) {
                if (order[i] != s) continue
                var local = time - i * BEAT
                if (local < 0f) {
                    // The last turn's exit runs into the next loop's first pop,
                    // but there is no last turn before the first loop.
                    if (t < total) continue
                    local += total
                }
                if (local >= GONE) continue
                when {
                    local < POPPED -> {
                        val p = (if (still) EASE_OUT else POP).getInterpolation(local / POPPED)
                        a = p
                        scale = 0.4f + 0.6f * p
                    }
                    local < LEAVING -> {
                        a = 1f
                        scale = 1f
                    }
                    else -> {
                        val p = (if (still) EASE_IN else OUT).getInterpolation((local - LEAVING) / (GONE - LEAVING))
                        a = 1f - p
                        scale = 1f - 0.4f * p
                    }
                }
                break
            }
            slideAlpha = a.coerceIn(0f, 1f)
            slideScale = if (still) 1f else scale
        }

        // One layer's own loop, as its keyframes in index.html run it: the
        // rays turning, the sun breathing, a cloud drifting there and back, a
        // drop falling, a flake wandering down, the bolt striking.
        private fun drawLayer(canvas: Canvas, i: Int, d: BootArt.Drawn, t: Float, slideLeft: Float, slideTop: Float) {
            val layer = BootArt.LAYERS[i]
            val box = layerBox[i]
            var dx = 0f
            var dy = 0f
            var turn = 0f
            var scale = 1f
            var a = 1f
            if (!still) {
                when (layer.motion) {
                    BootArt.Motion.SPIN -> turn = 360f * (t % SPIN_MS) / SPIN_MS
                    BootArt.Motion.BREATHE -> {
                        val u = (t % BREATHE_MS) / BREATHE_MS
                        val p = if (u < 0.5f) EASE.getInterpolation(u * 2f) else 1f - EASE.getInterpolation(u * 2f - 1f)
                        scale = 1f + 0.06f * p
                    }
                    BootArt.Motion.DRIFT -> {
                        val u = (t % DRIFT_MS) / DRIFT_MS
                        val back = (t / DRIFT_MS).toInt() % 2 == 1
                        val p = EASE.getInterpolation(if (back) 1f - u else u)
                        dx = (-0.03f + 0.06f * p) * box
                        dy = -0.015f * p * box
                    }
                    BootArt.Motion.DROP -> {
                        val u = ((t + layer.leadMs) % layer.fallMs) / layer.fallMs
                        dy = (-0.06f + 0.22f * u) * box
                        a = when {
                            u < 0.2f -> u / 0.2f
                            u < 0.55f -> 1f
                            else -> 1f - (u - 0.55f) / 0.45f
                        }
                    }
                    BootArt.Motion.FLAKE -> {
                        val u = ((t + layer.leadMs) % layer.fallMs) / layer.fallMs
                        if (u < 0.5f) {
                            val p = EASE.getInterpolation(u * 2f)
                            dx = 0.035f * p * box
                            dy = (-0.10f + 0.14f * p) * box
                        } else {
                            val p = EASE.getInterpolation(u * 2f - 1f)
                            dx = (0.035f - 0.055f * p) * box
                            dy = (0.04f + 0.14f * p) * box
                        }
                        a = when {
                            u < 0.25f -> EASE.getInterpolation(u * 4f)
                            u < 0.75f -> 1f
                            else -> 1f - EASE.getInterpolation((u - 0.75f) * 4f)
                        }
                    }
                    BootArt.Motion.BOLT -> a = bolt((t % BOLT_MS) / BOLT_MS)
                    BootArt.Motion.STILL -> Unit
                }
            }
            if (a <= 0f) return
            canvas.save()
            canvas.translate(slideLeft + layerLeft[i] + dx, slideTop + layerTop[i] + dy)
            if (turn != 0f) canvas.rotate(turn, box / 2f, box / 2f)
            if (scale != 1f) canvas.scale(scale, scale, box / 2f, box / 2f)
            bitmapPaint.alpha = alpha(a)
            canvas.drawBitmap(d.bitmap, d.left, d.top, bitmapPaint)
            canvas.restore()
        }

        // Two quick strikes, then a hold.
        private fun bolt(u: Float): Float = when {
            u < 0.30f -> 1f
            u < 0.34f -> 1f - 0.85f * (u - 0.30f) / 0.04f
            u < 0.38f -> 0.15f + 0.85f * (u - 0.34f) / 0.04f
            u < 0.42f -> 1f - 0.85f * (u - 0.38f) / 0.04f
            u < 0.46f -> 0.15f + 0.85f * (u - 0.42f) / 0.04f
            else -> 1f
        }

        // The name rises in a beat after the stage starts.
        private fun drawName(canvas: Canvas, t: Float, width: Float) {
            val x = ((t - NAME_DELAY_MS) / NAME_MS).coerceIn(0f, 1f)
            if (x <= 0f) return
            val p = RISE.getInterpolation(x)
            val dy = if (still) 0f else risePx * (1f - p)
            val bitmap = nameBitmap()
            bitmapPaint.alpha = alpha(p)
            canvas.drawBitmap(bitmap, (width - bitmap.width) / 2f, marginPx + stagePx + gapPx - shadowPadPx + dy, bitmapPaint)
        }

        // The name, set once per look rather than every frame.
        private fun nameBitmap(): Bitmap {
            val version = nameVersion
            nameCache?.let { if (nameDrawn == version) return it }
            val paint = Paint(namePaint).apply {
                color = nameColor
                if (nameShadow) setShadowLayer(SHADOW_RADIUS_DP * density, 0f, density, BootArt.rgb(0x000000, 0.28f))
            }
            val bitmap = Bitmap.createBitmap(
                ceil(nameWidth + 2f * shadowPadPx).toInt(),
                ceil(nameHeight + 2f * shadowPadPx).toInt(),
                Bitmap.Config.ARGB_8888,
            )
            Canvas(bitmap).drawText(NAME, shadowPadPx, shadowPadPx + nameAscent, paint)
            nameCache = bitmap
            nameDrawn = version
            return bitmap
        }
    }

    /** The background: the theme's, with the forecast's sky over it (#boot and its ::before). */
    private class SkyView(context: Context) : View(context) {
        var base = 0
            set(value) {
                if (field == value) return
                field = value
                invalidate()
            }
        var skyAlpha = 0f
            set(value) {
                if (field == value) return
                field = value
                invalidate()
            }
        private var colors: IntArray? = null
        private var offsets: FloatArray? = null
        private val paint = Paint()

        fun setStops(colors: IntArray, offsets: FloatArray) {
            if (this.colors contentEquals colors && this.offsets contentEquals offsets) return
            this.colors = colors
            this.offsets = offsets
            shade()
            invalidate()
        }

        override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) = shade()

        private fun shade() {
            val c = colors ?: return
            if (height == 0) return
            paint.shader = LinearGradient(0f, 0f, 0f, height.toFloat(), c, offsets, Shader.TileMode.CLAMP)
        }

        override fun onDraw(canvas: Canvas) {
            canvas.drawColor(base)
            if (colors == null || skyAlpha <= 0f) return
            paint.alpha = (skyAlpha * 255f).roundToInt().coerceIn(0, 255)
            canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), paint)
        }
    }
}

/**
 * How the launch screen looks: the page's Theme setting, and the sky its own
 * boot screen would open on (both as public/boot-sky.js reads them). The page
 * reports it through AndroidBoot.look, and it is kept here so the next launch
 * shows it from its very first frame, before there is a page to ask.
 */
internal class BootLook(val theme: String, val sky: String) {
    /** "on" is dark, "off" light; anything else follows the system. */
    fun dark(context: Context): Boolean = when (theme) {
        "on" -> true
        "off" -> false
        else -> (context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
            Configuration.UI_MODE_NIGHT_YES
    }

    /** The sky's colour stops, top to bottom, from its computed CSS gradient; null for none. */
    fun skyStops(): Pair<IntArray, FloatArray>? {
        if (!sky.contains("gradient(")) return null
        val colors = ArrayList<Int>()
        val offsets = ArrayList<Float>()
        for (m in STOP.findAll(sky)) {
            val (r, g, b, a, at) = m.destructured
            val alpha = a.toFloatOrNull() ?: 1f
            colors += Color.argb(
                (alpha * 255f).roundToInt().coerceIn(0, 255),
                r.toInt().coerceIn(0, 255),
                g.toInt().coerceIn(0, 255),
                b.toInt().coerceIn(0, 255),
            )
            offsets += at.toFloat() / 100f
        }
        if (colors.size < 2) return null
        for (i in 1 until offsets.size) if (offsets[i] < offsets[i - 1]) return null
        return colors.toIntArray() to offsets.toFloatArray()
    }

    fun save(context: Context) {
        prefs(context).edit().putString(THEME, theme).putString(SKY, sky).apply()
    }

    companion object {
        private const val PREFS = "alek-boot"
        private const val THEME = "theme"
        private const val SKY = "sky"

        // A stop as Chromium serialises a computed gradient: rgb(21, 101, 192) 40%
        private val STOP = Regex("""rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)\s*([\d.]+)%""")

        fun load(context: Context): BootLook {
            val p = prefs(context)
            return BootLook(p.getString(THEME, null) ?: "", p.getString(SKY, null) ?: "")
        }

        private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    }
}
