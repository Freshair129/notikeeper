package com.example.notikeeper

import android.accessibilityservice.AccessibilityService
import android.graphics.Rect
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import com.example.notikeeper.data.NotiStore
import com.example.notikeeper.data.ScreenRow
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * Reads what is actually on screen in Messenger via the accessibility tree and
 * archives every visible message line. This captures the FULL conversation the
 * user is looking at (and older messages as they scroll up) — not just the
 * short preview a notification carries.
 *
 * Scope is intentionally narrow: only the Messenger packages, only text that is
 * visibly rendered, stored locally on the device. No network, no other apps.
 */
class MessengerReaderService : AccessibilityService() {

    private val targets = setOf(
        "com.facebook.orca",     // Messenger
        "com.facebook.mlite",    // Messenger Lite
        "com.facebook.katana",      // Facebook app (in-app chat)
        "jp.naver.line.android",    // LINE
        "com.instagram.android",    // Instagram DMs
        "com.whatsapp",             // WhatsApp
        "com.whatsapp.w4b",         // WhatsApp Business
        "org.telegram.messenger",   // Telegram
        "org.thunderdog.challegram" // Telegram X
    )

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    /** Cache of package name -> human app label (LINE / Instagram / Messenger...). */
    private val appNames = HashMap<String, String>()

    /** In-memory LRU of recently saved lines, so scrolling doesn't re-save them. */
    private val recent = object : LinkedHashMap<String, Boolean>(512, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Boolean>): Boolean =
            size > 600
    }

    /** Obvious UI chrome we don't want to archive as "messages". */
    private val chrome = setOf(
        "Aa", "GIF", "Open Photos", "Camera", "Voice message", "Send",
        "Active now", "Message", "Home", "Chats", "Menu", "Back", "Search"
    )

    private var lastCaptureAt = 0L

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        event ?: return
        val pkg = event.packageName?.toString() ?: return
        if (pkg !in targets) return
        when (event.eventType) {
            AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED,
            AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED -> Unit
            else -> return
        }

        // Debounce: Messenger fires many content-changed events while animating.
        val now = System.currentTimeMillis()
        if (now - lastCaptureAt < 500) return
        lastCaptureAt = now

        val root = rootInActiveWindow ?: return
        val width = resources.displayMetrics.widthPixels
        val lines = ArrayList<Line>()
        try {
            collect(root, width, lines)
        } finally {
            @Suppress("DEPRECATION") root.recycle()
        }
        if (lines.isEmpty()) return

        // Conversation/contact name = the top-most short line in the app bar area.
        val convo = lines.filter { it.top < 350 }.minByOrNull { it.top }?.text ?: "Messenger"

        val fresh = ArrayList<ScreenRow>()
        for (l in lines) {
            if (l.text in chrome) continue
            if (l.text == convo) continue
            val key = "$convo|${l.side}|${l.text}"
            if (recent.containsKey(key)) continue
            recent[key] = true
            fresh.add(ScreenRow(pkg, appLabel(pkg), convo, l.text, l.side, now))
        }
        if (fresh.isEmpty()) return
        scope.launch { NotiStore.get(applicationContext).insertScreenBatch(fresh) }

        // Eyes-free driving mode: read newly-seen lines aloud (only for whitelisted apps).
        if (com.example.notikeeper.data.Settings.getReadAloudScreen(applicationContext) &&
            com.example.notikeeper.data.Settings.shouldSpeak(applicationContext, pkg)
        ) {
            Speaker.speak(applicationContext, fresh.joinToString(". ") { it.text })
        }
    }

    private data class Line(val text: String, val top: Int, val side: String)

    /** Depth-first walk: collect every node that renders text or has a description. */
    private fun collect(node: AccessibilityNodeInfo?, width: Int, out: MutableList<Line>) {
        node ?: return
        val raw = node.text?.toString()?.trim()?.takeIf { it.isNotBlank() }
            ?: node.contentDescription?.toString()?.trim()?.takeIf { it.isNotBlank() }
        if (raw != null && raw.length in 1..2000) {
            val bounds = Rect()
            node.getBoundsInScreen(bounds)
            // Right-aligned bubbles are usually the user's own messages.
            val side = if (bounds.centerX() > width * 0.55) "me" else "them"
            out.add(Line(raw, bounds.top, side))
        }
        for (i in 0 until node.childCount) {
            val child = node.getChild(i)
            collect(child, width, out)
            @Suppress("DEPRECATION") child?.recycle()
        }
    }

    private fun appLabel(pkg: String): String = appNames.getOrPut(pkg) {
        runCatching {
            packageManager.getApplicationLabel(packageManager.getApplicationInfo(pkg, 0)).toString()
        }.getOrDefault(pkg)
    }

    override fun onInterrupt() {}
}
