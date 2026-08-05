package com.alekweather.app

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

/**
 * Posts the app's weather notifications.
 *
 * Lives outside [MainActivity] because [WeatherCheckWorker] posts the same
 * notifications with no Activity — and usually no process — around: everything
 * here takes a plain Context so the foreground bridge and the background worker
 * share one channel, one tag scheme, and one permission check.
 */
object WeatherNotifier {
    /** Channel the weather notifications post to (required on 26+). */
    const val CHANNEL_ID = "weather"

    fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Weather",
            NotificationManager.IMPORTANCE_DEFAULT,
        ).apply { description = "Rain, weather alerts, and the daily forecast" }
        (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
            .createNotificationChannel(channel)
    }

    /**
     * Whether a notification would actually be shown. The grant can be revoked
     * from system settings between runs, so the worker re-checks on every pass
     * rather than trusting what the toggle stored.
     */
    fun canPost(context: Context): Boolean {
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return false
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return true
        return ContextCompat.checkSelfPermission(
            context, Manifest.permission.POST_NOTIFICATIONS,
        ) == PackageManager.PERMISSION_GRANTED
    }

    /**
     * Posts (or replaces) a notification. `tag` doubles as the dedup key, so
     * re-firing the same alert updates the existing one rather than stacking.
     *
     * `icon` is one of the ic_notify_* drawables, chosen by the caller from the
     * weather it is reporting. It defaults to the launcher icon so nothing can
     * post without one; the launcher icon is a poor status-bar glyph (the
     * system masks small icons to their alpha, which turns a full-colour square
     * into a solid blob), so every real call passes a silhouette.
     */
    @SuppressLint("MissingPermission")
    fun post(
        context: Context,
        tag: String,
        title: String,
        body: String,
        icon: Int = R.mipmap.ic_launcher,
    ) {
        if (!canPost(context)) return

        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pending = PendingIntent.getActivity(
            context,
            tag.hashCode(),
            intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(icon)
            // The accent the shade tints the icon and the app name with. Without
            // it the system picks its own grey, and the icons read as disabled.
            .setColor(ContextCompat.getColor(context, R.color.icon_bg))
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(pending)
            .setAutoCancel(true)
            .build()
        NotificationManagerCompat.from(context).notify(tag, tag.hashCode(), notification)
    }
}
