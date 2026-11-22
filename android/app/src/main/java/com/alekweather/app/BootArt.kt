package com.alekweather.app

import android.graphics.Bitmap
import android.graphics.BlurMaskFilter
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RadialGradient
import android.graphics.RectF
import android.graphics.Shader
import androidx.core.graphics.PathParser
import java.util.concurrent.Callable
import java.util.concurrent.Future
import java.util.concurrent.FutureTask
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.roundToInt

/**
 * The launch screen's artwork, for [BootOverlay]: the boot stage from
 * index.html (the logo, rain, a storm, snow and sun), layer for layer.
 *
 * Every moving part of the web stage is an <svg> box of its own. Here each is
 * a [Layer] with the same box (in dp, inside its slide), the same viewBox, the
 * same paths ([BootPaths]) and the same gradients. Layers are drawn once into
 * bitmaps, off the UI thread, so a frame of the animation only moves, turns,
 * scales and fades finished pictures.
 */
internal object BootArt {
    const val STAGE_DP = 160f

    /** The weather glyphs sit 5% in from the stage's edge, as on the page, to read the logo's size. */
    const val GLYPH_INSET_DP = 8f
    const val GLYPH_DP = 144f

    /** Slides, in the page's order: logo, rain, storm, snow, sun. */
    const val SLIDES = 5

    enum class Motion { STILL, SPIN, BREATHE, DRIFT, DROP, FLAKE, BOLT }

    class Layer(
        val slide: Int,
        /** The layer's box inside its slide, in dp. */
        val left: Float,
        val top: Float,
        val size: Float,
        val viewBox: RectF,
        val motion: Motion,
        /** DROP and FLAKE: one fall, and how far into it the layer starts (the page's --fall and -(--lag)). */
        val fallMs: Float = 0f,
        val leadMs: Float = 0f,
        /** A transform from the art's own units into the viewBox (the logo cloud's <g>). */
        val group: Matrix? = null,
        val ops: (Palette) -> List<Op>,
    )

    sealed class Op(val path: Path)

    /** A filled path; [glowSigma] adds a blurred copy underneath (an feGaussianBlur merged under its source). */
    class Fill(path: Path, val paint: Paint, val glowSigma: Float = 0f) : Op(path)

    /** An inner shadow along the path's edge, offset by [dy] (the logo cloud's filter). */
    class Inset(path: Path, val dy: Float, val sigma: Float, val color: Int) : Op(path)

    /** A layer drawn: its bitmap, and where that sits in the layer's box, in px. */
    class Drawn(val bitmap: Bitmap, val left: Float, val top: Float)

    /** The page dims its lavender cloud tones in dark mode (the --wi-* overrides in App.css). */
    class Palette(private val dark: Boolean) {
        fun wi(hex: Int): Int = if (dark) DARK_WI[hex] ?: hex else hex
    }

    private val DARK_WI = mapOf(
        0xE0D3FF to 0xB1A7CA,
        0xF2F0FF to 0xBFBCCC,
        0xCECDFF to 0xA3A2CA,
        0xB7B6FA to 0x9190C6,
        0xD1C8FF to 0xA59ECA,
        0xE9E2FF to 0xB8B3CA,
    )

    private val LOGO_BOX = RectF(-160f, -160f, 160f, 160f)
    private val LOGO_CLOUD_BOX = RectF(0f, 0f, 512f, 512f)
    private val GLYPH_BOX = RectF(0f, 0f, 32f, 32f)
    private val SUN_BOX = RectF(-0.47f, 0.19f, 31.53f, 32.19f)

    // The logo's sun spans 37..357 of its 512-unit artwork: 7.227% in, 62.5% across.
    private const val LOGO_SUN_AT = STAGE_DP * 0.07227f
    private const val LOGO_SUN_DP = STAGE_DP * 0.625f

    val LAYERS: List<Layer> = listOf(
        // The logo: rays turning, the sun breathing, the cloud drifting.
        Layer(0, LOGO_SUN_AT, LOGO_SUN_AT, LOGO_SUN_DP, LOGO_BOX, Motion.SPIN) {
            listOf(Fill(logoRays(), solid(0xFFAB00)))
        },
        Layer(0, LOGO_SUN_AT, LOGO_SUN_AT, LOGO_SUN_DP, LOGO_BOX, Motion.BREATHE) {
            val disc = Path().apply { addCircle(0f, 0f, 90f, Path.Direction.CW) }
            // objectBoundingBox cx/cy 38%, r 62% of the disc's 180-unit box.
            val fill = radial(trs(-21.6f, -21.6f, 0f, 111.6f, 111.6f), s(0f, 0xFFF9C4), s(0.45f, 0xFFD600), s(1f, 0xF57C00))
            listOf(Fill(disc, fill, glowSigma = 10f))
        },
        Layer(0, 0f, 0f, STAGE_DP, LOGO_CLOUD_BOX, Motion.DRIFT, group = trs(197f, 210f, 0f, 9.6875f, 9.6875f)) {
            val puff = path(BootPaths.LOGO_PUFF)
            val body = path(BootPaths.LOGO_BODY)
            listOf(
                Fill(puff, radial(rs(187.537f, 7.257f, 5.601f, 5.54446f), s(0.309f, 0xE8E8E9), s(1f, 0xD2D2D2))),
                Fill(puff, radial(rs(218.758f, 8.678f, 4.4f, 3.0099f, 2.75776f), s(0f, 0xCDCDCE), s(1f, 0xCDCDCE, 0f))),
                Fill(body, solid(0xD5D4DA)),
                Fill(body, linear(18.86f, 24.032f, 18.86f, 16.519f, s(0f, 0xDED7FA), s(1f, 0xDED7FA, 0f))),
                Inset(body, dy = -1f, sigma = 1f, color = rgb(0xD0C8F4)),
                Fill(body, radial(rs(136.5f, 10.583f, 11.787f, 11.1541f, 11.965f), s(0.179f, 0xFCFBFE), s(1f, 0xFCFBFE, 0f))),
                Fill(body, radial(rs(144.444f, 1.551f, 10.052f, 6.84295f, 7.17037f), s(0f, 0xFCFBFE), s(1f, 0xFCFBFE, 0f))),
                Fill(body, radial(rs(166.654f, 11.702f, 9.208f, 23.8577f, 18.7887f), s(0.815f, 0xCECCD7, 0f), s(1f, 0xCECCD7))),
                Fill(body, radial(rs(-46.79f, 32.892f, 6.486f, 6.46347f, 8.91976f), s(0f, 0xD0C9EE), s(1f, 0xD0C9EE, 0f))),
            )
        },

        // Rain: three drops falling behind the cloud.
        glyph(1, Motion.DROP, 1350f, 0f) { listOf(Fill(path(BootPaths.RAIN_DROP_1), solid(0x3239FF))) },
        glyph(1, Motion.DROP, 1540f, 500f) { listOf(Fill(path(BootPaths.RAIN_DROP_2), solid(0x3239FF))) },
        glyph(1, Motion.DROP, 1220f, 920f) {
            listOf(Fill(path(BootPaths.RAIN_DROP_3), linear(22.2303f, 20.8728f, 17.0656f, 27.7478f, s(0f, 0x3364FE), s(1f, 0x3749FF))))
        },
        glyph(1, Motion.DRIFT) { p ->
            val body = path(BootPaths.RAIN_BODY)
            listOf(
                Fill(path(BootPaths.RAIN_PUFF), radial(trs(12.091f, 7.58007f, -110.468f, 3.57025f, 3.46764f), s(0.30655f, p.wi(0xCECDFF)), s(1f, p.wi(0xB7B6FA)))),
                Fill(body, solid(p.wi(0xE0D3FF))),
                Fill(body, radial(trs(28.2744f, 7.14872f, 147.006f, 12.0883f, 13.5028f), s(0.189911f, p.wi(0xF2F0FF)), s(1f, p.wi(0xF2F0FF), 0f))),
            )
        },

        // Storm: four quicker drops, the cloud, and the bolt over it.
        glyph(2, Motion.DROP, 780f, 0f) { listOf(Fill(path(BootPaths.STORM_DROP_1), solid(0x535DFF))) },
        glyph(2, Motion.DROP, 890f, 290f) { listOf(Fill(path(BootPaths.STORM_DROP_2), solid(0x535DFF))) },
        glyph(2, Motion.DROP, 700f, 530f) { listOf(Fill(path(BootPaths.STORM_DROP_3), solid(0x535DFF))) },
        glyph(2, Motion.DROP, 830f, 150f) { listOf(Fill(path(BootPaths.STORM_DROP_4), solid(0x535DFF))) },
        glyph(2, Motion.DRIFT) {
            val body = path(BootPaths.STORM_BODY)
            listOf(
                Fill(path(BootPaths.STORM_PUFF), radial(trs(13.4368f, 5.74919f, 140.486f, 3.98677f, 3.40611f), s(0f, 0x4C42D7), s(1f, 0x35209B))),
                Fill(body, solid(0x3124C5)),
                Fill(body, radial(trs(14.3176f, 19.5719f, 125.266f, 8.30268f, 5.21837f), s(0.303281f, 0x381B90), s(1f, 0x381B90, 0f))),
                Fill(path(BootPaths.STORM_BODY_LIT), radial(trs(24.6743f, 7.12758f, 142.503f, 10.9332f, 11.9987f), s(0.141507f, 0x6051FF), s(1f, 0x6051FF, 0f))),
            )
        },
        glyph(2, Motion.BOLT) {
            listOf(Fill(path(BootPaths.STORM_BOLT), linear(16.0347f, 12.6133f, 16.0347f, 25.8114f, s(0.3542f, 0xFF9B49), s(1f, 0xFF4E4B))))
        },

        // Snow: the cloud, and two flakes drifting down in front of it.
        glyph(3, Motion.DRIFT) { p ->
            val body = path(BootPaths.SNOW_BODY)
            listOf(
                Fill(path(BootPaths.SNOW_PUFF), radial(trs(12.5165f, 7.70722f, -110.468f, 3.57025f, 3.46764f), s(0.30655f, p.wi(0xCECDFF)), s(1f, p.wi(0xB7B6FA)))),
                Fill(body, solid(p.wi(0xE0D3FF))),
                Fill(body, radial(trs(28.6999f, 7.27588f, 147.006f, 12.0883f, 13.5028f), s(0.189911f, p.wi(0xF2F0FF)), s(1f, p.wi(0xF2F0FF), 0f))),
            )
        },
        glyph(3, Motion.FLAKE, 1500f, 300f) { p ->
            listOf(
                Fill(path(BootPaths.SNOW_FLAKE_1), solid(p.wi(0xD1C8FF))),
                Fill(
                    circles(
                        12.0539f, 26.156f, 2.14922f,
                        13.9966f, 24.5833f, 0.730651f,
                        14.5571f, 26.8239f, 0.730651f,
                        13.2659f, 28.6364f, 0.730651f,
                        10.9066f, 28.6364f, 0.730651f,
                        9.60968f, 26.8866f, 0.730651f,
                        10.0628f, 24.7304f, 0.730651f,
                        12.0297f, 23.7304f, 0.730651f,
                    ),
                    solid(p.wi(0xE9E2FF)),
                ),
            )
        },
        glyph(3, Motion.FLAKE, 1800f, 1100f) { p ->
            listOf(
                Fill(path(BootPaths.SNOW_FLAKE_2), solid(p.wi(0xD1C8FF))),
                Fill(
                    circles(
                        20.8638f, 22.2864f, 1.26063f,
                        21.3746f, 20.9122f, 0.428564f,
                        22.3268f, 21.8757f, 0.428564f,
                        22.2166f, 23.1763f, 0.428564f,
                        21.0257f, 23.8811f, 0.428564f,
                        19.8483f, 23.3854f, 0.428564f,
                        19.4328f, 22.1616f, 0.428564f,
                        20.1269f, 21.0692f, 0.428564f,
                    ),
                    solid(p.wi(0xE9E2FF)),
                ),
            )
        },

        // Sun: rays turning about the disc, the disc breathing. The viewBox is
        // centred on the disc, so the box's centre is the disc's.
        glyph(4, Motion.SPIN, box = SUN_BOX) {
            val rays = path(BootPaths.SUN_RAYS)
            listOf(
                Fill(rays, linear(23.8781f, 6.8668f, 8.52811f, 26.4512f, s(0f, 0xFC8B23), s(1f, 0xE67639))),
                Fill(rays, radial(trs(18.1188f, 3.43722f, 138.155f, 3.77864f, 3.33393f), s(0.300161f, 0xFFA13A), s(1f, 0xFFA13A, 0f))),
            )
        },
        glyph(4, Motion.BREATHE, box = SUN_BOX) {
            listOf(Fill(path(BootPaths.SUN_CORE), radial(trs(21.6308f, 9.96711f, 117.739f, 19.1699f, 23.673f), s(0.17178f, 0xFFD13D), s(1f, 0xDCA21C), s(1f, 0xD89A29))))
        },
    )

    fun px(dp: Float, density: Float): Int = (dp * density).roundToInt()

    /** Every layer, drawn for this screen density and theme; null where a layer has nothing to draw. */
    fun render(density: Float, dark: Boolean): List<Drawn?> {
        val palette = Palette(dark)
        return LAYERS.map { draw(it, density, palette) }
    }

    /** [render] on a thread of its own, to overlap the WebView's start; null if memory ran out. */
    fun renderAsync(density: Float, dark: Boolean): Future<List<Drawn?>?> {
        val task = FutureTask<List<Drawn?>?>(
            Callable {
                try {
                    render(density, dark)
                } catch (e: OutOfMemoryError) {
                    null
                }
            },
        )
        Thread(task, "BootArt").start()
        return task
    }

    private fun draw(layer: Layer, density: Float, palette: Palette): Drawn? {
        val ops = layer.ops(palette)
        val box = px(layer.size, density).toFloat()
        val vb = layer.viewBox
        val toPx = Matrix().apply {
            setScale(box / vb.width(), box / vb.height())
            preTranslate(-vb.left, -vb.top)
            layer.group?.let { preConcat(it) }
        }

        // Only the part of the box the art covers gets a bitmap: a drop is a
        // sliver of its glyph's box.
        val bounds = RectF()
        val r = RectF()
        for (op in ops) {
            op.path.computeBounds(r, true)
            if (op is Fill && op.glowSigma > 0f) r.inset(-3f * op.glowSigma, -3f * op.glowSigma)
            bounds.union(r)
        }
        toPx.mapRect(bounds)
        val left = floor(bounds.left) - 1f
        val top = floor(bounds.top) - 1f
        val width = (ceil(bounds.right) + 1f - left).toInt()
        val height = (ceil(bounds.bottom) + 1f - top).toInt()
        if (width <= 0 || height <= 0) return null

        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        canvas.translate(-left, -top)
        canvas.concat(toPx)
        for (op in ops) {
            when (op) {
                is Fill -> fill(canvas, op)
                is Inset -> inset(canvas, op)
            }
        }
        return Drawn(bitmap, left, top)
    }

    private fun fill(canvas: Canvas, op: Fill) {
        if (op.glowSigma > 0f) {
            val glow = Paint(op.paint).apply { maskFilter = BlurMaskFilter(blurRadius(op.glowSigma), BlurMaskFilter.Blur.NORMAL) }
            canvas.drawPath(op.path, glow)
        }
        canvas.drawPath(op.path, op.paint)
    }

    // The SVG filter: the shape's alpha, shifted by dy and blurred, cut out of
    // the shape itself, leaves a soft band along the far edge, tinted. Drawn
    // here as the blurred outside of the shifted shape, clipped to the shape.
    private fun inset(canvas: Canvas, shadow: Inset) {
        val area = RectF()
        shadow.path.computeBounds(area, true)
        val pad = 4f * shadow.sigma + abs(shadow.dy)
        area.inset(-pad, -pad)
        val shifted = Path(shadow.path).apply { offset(0f, shadow.dy) }
        val outside = Path().apply {
            addRect(area, Path.Direction.CW)
            this.op(shifted, Path.Op.DIFFERENCE)
        }
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = shadow.color
            maskFilter = BlurMaskFilter(blurRadius(shadow.sigma), BlurMaskFilter.Blur.NORMAL)
        }
        canvas.save()
        canvas.clipPath(shadow.path)
        canvas.drawPath(outside, paint)
        canvas.restore()
    }

    /** BlurMaskFilter takes a radius; Skia turns that into sigma as 0.57735 * radius + 0.5. */
    private fun blurRadius(sigma: Float) = ((sigma - 0.5f) / 0.57735f).coerceAtLeast(0.01f)

    private fun glyph(
        slide: Int,
        motion: Motion,
        fallMs: Float = 0f,
        leadMs: Float = 0f,
        box: RectF = GLYPH_BOX,
        ops: (Palette) -> List<Op>,
    ) = Layer(slide, 0f, 0f, GLYPH_DP, box, motion, fallMs, leadMs, null, ops)

    private fun logoRays() = Path().apply {
        val bar = Path().apply { addRoundRect(RectF(-11f, -152f, 11f, -104f), 11f, 11f, Path.Direction.CW) }
        for (k in 0 until 8) addPath(bar, Matrix().apply { setRotate(45f * k) })
    }

    private fun circles(vararg xyr: Float) = Path().apply {
        for (i in xyr.indices step 3) addCircle(xyr[i], xyr[i + 1], xyr[i + 2], Path.Direction.CW)
    }

    private fun path(d: String): Path = PathParser.createPathFromPathData(d)

    fun rgb(hex: Int, alpha: Float = 1f): Int = ((alpha * 255f).roundToInt() shl 24) or (hex and 0xFFFFFF)

    private class Stop(val offset: Float, val color: Int)

    private fun s(offset: Float, hex: Int, alpha: Float = 1f) = Stop(offset, rgb(hex, alpha))

    private fun fillPaint() = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }

    private fun solid(hex: Int) = fillPaint().apply { color = rgb(hex) }

    private fun linear(x1: Float, y1: Float, x2: Float, y2: Float, vararg stops: Stop) = fillPaint().apply {
        shader = LinearGradient(
            x1, y1, x2, y2,
            IntArray(stops.size) { stops[it].color },
            FloatArray(stops.size) { stops[it].offset },
            Shader.TileMode.CLAMP,
        )
    }

    /** A unit-circle radial gradient placed by [matrix] (the SVG's gradientTransform). */
    private fun radial(matrix: Matrix, vararg stops: Stop) = fillPaint().apply {
        shader = RadialGradient(
            0f, 0f, 1f,
            IntArray(stops.size) { stops[it].color },
            FloatArray(stops.size) { stops[it].offset },
            Shader.TileMode.CLAMP,
        ).apply { setLocalMatrix(matrix) }
    }

    /** SVG `translate(tx ty) rotate(deg) scale(sx sy)`. */
    private fun trs(tx: Float, ty: Float, deg: Float, sx: Float, sy: Float) = Matrix().apply {
        setTranslate(tx, ty)
        preRotate(deg)
        preScale(sx, sy)
    }

    /** SVG `rotate(deg cx cy) scale(sx sy)`. */
    private fun rs(deg: Float, cx: Float, cy: Float, sx: Float, sy: Float = sx) = Matrix().apply {
        setRotate(deg, cx, cy)
        preScale(sx, sy)
    }
}
