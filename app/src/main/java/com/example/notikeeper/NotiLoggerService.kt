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

    /**
     * Fires whenever the system (re)binds this listener — first launch, after
     * the user re-grants notification access, after an OEM battery killer or
     * a crash releases it, after reboot. Compares against the last time we
     * actually captured something and records a gap row if the silence was
     * long enough to be a real blind window rather than an ordinary rebind —
     * see G-28/G-29 in the capture-to-archive integrity audit. There is no
     * reliable "I am about to be disconnected" callback to hook instead (a
     * kill or a permission revocation doesn't guarantee onListenerDisconnected
     * fires before the process dies), so detecting retroactively at
     * reconnection is the one approach that's robust to every failure mode.
     */
    override fun onListenerConnected() {
        super.onListenerConnected()
        scope.launch {
            val ctx = applicationContext
            val last = com.example.notikeeper.data.Settings.getLastNotiHeartbeat(ctx)
            val now = NotiStore.get(ctx).recordGapIfAny("noti", last)
            com.example.notikeeper.data.Settings.setLastNotiHeartbeat(ctx, now)
        }
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        sbn ?: return
        val notification = sbn.notification ?: return
        val extras = notification.extras ?: return

        // Skip persistent/ongoing notifications (music player, downloads, "running" icons).
        if (notification.flags and Notification.FLAG_ONGOING_EVENT != 0) return

        val pkg = sbn.packageName
        // Honour the user's per-app capture whitelist (empty = capture all).
        if (!com.example.notikeeper.data.Settings.shouldCapture(applicationContext, pkg)) return

        val appName = runCatching {
            val pm = packageManager
            pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString()
        }.getOrDefault(pkg)

        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()

        // Prefer NotificationCompat.MessagingStyle when the app used it: it carries
        // the real per-message sender (Person) and a real send timestamp
        // (Message.getTimestamp()), not just this notification's post time and one
        // flattened body — see G-37 in the capture-to-archive integrity audit. Each
        // update of a MessagingStyle notification re-hands the WHOLE conversation
        // history in getMessages(), not just the new message; that's fine here
        // because insertNoti's existing dedupKey (pkg+title+text+5min-bucket of the
        // real, stable per-message timestamp) already ignores rows it's seen
        // before, so re-processing history on every update can't duplicate rows —
        // it just gives every past message a chance to be captured, including ones
        // whose notification arrived before this code existed.
        val messagingMessages = runCatching {
            androidx.core.app.NotificationCompat.MessagingStyle
                .extractMessagingStyleFromNotification(notification)?.messages
        }.getOrNull()

        if (!messagingMessages.isNullOrEmpty()) {
            scope.launch {
                val ctx = applicationContext
                val store = NotiStore.get(ctx)
                val freshlySpoken = ArrayList<String>()
                for (msg in messagingMessages) {
                    val msgText = msg.text?.toString()?.trim().orEmpty()
                    if (msgText.isBlank()) continue
                    // Reuses relations.mjs's existing "Sender: text" prefix convention
                    // (SENDER_PREFIX_RE) so the server-side sender extraction that
                    // already runs on noti-source text picks this up with zero
                    // server changes.
                    val senderName = msg.person?.name?.toString()?.trim()
                    val rowText = if (!senderName.isNullOrBlank()) "$senderName: $msgText" else msgText
                    val isNew = store.insertNoti(pkg, appName, title, rowText, msg.timestamp)
                    if (isNew) freshlySpoken.add(rowText)
                }
                // Proof of life for the gap check in onListenerConnected — a capture
                // that actually ran, not just the service being bound.
                com.example.notikeeper.data.Settings.setLastNotiHeartbeat(ctx, System.currentTimeMillis())

                if (freshlySpoken.isNotEmpty() &&
                    com.example.notikeeper.data.Settings.getReadAloudNoti(ctx) &&
                    com.example.notikeeper.data.Settings.shouldSpeak(ctx, pkg)
                ) {
                    val spoken = buildString {
                        if (title.isNotBlank()) append(title).append(". ")
                        append(freshlySpoken.joinToString(". "))
                    }
                    Speaker.speak(ctx, spoken)
                }
            }
            return
        }

        // Fallback: no MessagingStyle (most apps) — one row from title + the
        // fullest body we can get: big text > grouped lines > short text.
        val bigText = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString()
        val lines = extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES)
        val text = when {
            !bigText.isNullOrBlank() -> bigText
            !lines.isNullOrEmpty() -> lines.joinToString("\n") { it.toString() }
            else -> extras.getCharSequence(Notification.EXTRA_TEXT)?.toString().orEmpty()
        }

        if (title.isBlank() && text.isBlank()) return

        val postTime = sbn.postTime
        scope.launch {
            val ctx = applicationContext
            NotiStore.get(ctx).insertNoti(pkg, appName, title, text, postTime)
            // Proof of life for the gap check in onListenerConnected — a capture
            // that actually ran, not just the service being bound.
            com.example.notikeeper.data.Settings.setLastNotiHeartbeat(ctx, System.currentTimeMillis())
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
