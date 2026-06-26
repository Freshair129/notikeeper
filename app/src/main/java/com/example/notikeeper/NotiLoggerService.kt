package com.example.notikeeper

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import com.example.notikeeper.data.NotiStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * Background, app-wide capture. Android delivers every posted notification
 * here (once the user grants "Notification access"). We pull out title + body
 * and persist it so it survives the system's ~24h limit.
 *
 * This complements [MessengerReaderService]: notifications catch everything
 * passively, the screen reader catches full Messenger threads when opened.
 */
class NotiLoggerService : NotificationListenerService() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        sbn ?: return
        val notification = sbn.notification ?: return
        val extras = notification.extras ?: return

        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()

        // Prefer the fullest body we can get: big text > grouped lines > short text.
        val bigText = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString()
        val lines = extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES)
        val text = when {
            !bigText.isNullOrBlank() -> bigText
            !lines.isNullOrEmpty() -> lines.joinToString("\n") { it.toString() }
            else -> extras.getCharSequence(Notification.EXTRA_TEXT)?.toString().orEmpty()
        }

        if (title.isBlank() && text.isBlank()) return
        // Skip persistent/ongoing notifications (music player, downloads, "running" icons).
        if (notification.flags and Notification.FLAG_ONGOING_EVENT != 0) return

        val appName = runCatching {
            val pm = packageManager
            pm.getApplicationLabel(pm.getApplicationInfo(sbn.packageName, 0)).toString()
        }.getOrDefault(sbn.packageName)

        val pkg = sbn.packageName
        val postTime = sbn.postTime
        scope.launch {
            NotiStore.get(applicationContext).insertNoti(pkg, appName, title, text, postTime)
        }

        // Eyes-free driving mode: read the alert aloud (only for whitelisted apps).
        if (com.example.notikeeper.data.Settings.getReadAloudNoti(applicationContext) &&
            com.example.notikeeper.data.Settings.shouldSpeak(applicationContext, pkg)
        ) {
            val spoken = buildString {
                if (title.isNotBlank()) append(title).append(". ")
                append(text)
            }
            Speaker.speak(applicationContext, spoken)
        }
    }
}
