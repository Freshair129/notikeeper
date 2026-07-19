package com.example.notikeeper.data

import android.content.Context

/**
 * Small encrypted settings store (same Keystore-backed [SecureStore] as [DbKey]).
 * Holds the optional private-cloud upload config + the upload high-water mark.
 */
object Settings {
    fun getApiUrl(c: Context): String = SecureStore.getString(c, "api_url", "")
    fun setApiUrl(c: Context, v: String) = SecureStore.putString(c, "api_url", v)

    fun getApiToken(c: Context): String = SecureStore.getString(c, "api_token", "")
    fun setApiToken(c: Context, v: String) = SecureStore.putString(c, "api_token", v)

    fun getAutoUpload(c: Context): Boolean = SecureStore.getBoolean(c, "auto_upload", false)
    fun setAutoUpload(c: Context, v: Boolean) = SecureStore.putBoolean(c, "auto_upload", v)

    fun getLastUploadedId(c: Context): Long = SecureStore.getLong(c, "last_uploaded_id", 0L)
    fun setLastUploadedId(c: Context, v: Long) = SecureStore.putLong(c, "last_uploaded_id", v)

    /**
     * Server-confirmed high-water mark: the max row id the PC has durably
     * stored (from `/ingest`'s `ackedThroughId`). Feeds Phase 2 pruning
     * (see docs/ARCHITECTURE_CHANGE_REQUEST.md phase 2). Never allowed to
     * move backwards.
     */
    fun getPrunableThroughId(c: Context): Long = SecureStore.getLong(c, "prunable_through_id", 0L)
    fun setPrunableThroughId(c: Context, v: Long) =
        SecureStore.putLong(c, "prunable_through_id", maxOf(v, getPrunableThroughId(c)))

    /**
     * Phase 2 kill switch: pruning only ever runs when the owner explicitly
     * turns it on. Defaults to off so a fresh install/update never starts
     * deleting on-device data until the owner has confirmed the ack protocol
     * behaves correctly on their own data.
     */
    fun getPruneEnabled(c: Context): Boolean = SecureStore.getBoolean(c, "prune_enabled", false)
    fun setPruneEnabled(c: Context, v: Boolean) = SecureStore.putBoolean(c, "prune_enabled", v)

    /** Retention floor: never prune a row younger than this, even if acked. */
    const val PRUNE_RETENTION_MS = 7L * 24 * 3600_000L

    /** Epoch millis of the last successful upload — shown on the Device & Connection screen. */
    fun getLastSyncTime(c: Context): Long = SecureStore.getLong(c, "last_sync_time", 0L)
    fun setLastSyncTime(c: Context, v: Long) = SecureStore.putLong(c, "last_sync_time", v)

    /** Friendly local label for this device. Empty = not set yet (caller falls back to the device model). */
    fun getDeviceName(c: Context): String = SecureStore.getString(c, "device_name", "")
    fun setDeviceName(c: Context, v: String) = SecureStore.putString(c, "device_name", v)

    // Eyes-free read-aloud (driving mode)
    fun getReadAloudNoti(c: Context): Boolean = SecureStore.getBoolean(c, "read_noti", false)
    fun setReadAloudNoti(c: Context, v: Boolean) = SecureStore.putBoolean(c, "read_noti", v)

    fun getReadAloudScreen(c: Context): Boolean = SecureStore.getBoolean(c, "read_screen", false)
    fun setReadAloudScreen(c: Context, v: Boolean) = SecureStore.putBoolean(c, "read_screen", v)

    /** Packages allowed to be read aloud. Empty set = read every app. */
    fun getSpeakApps(c: Context): Set<String> = SecureStore.getStringSet(c, "speak_apps", emptySet())
    fun setSpeakApps(c: Context, v: Set<String>) = SecureStore.putStringSet(c, "speak_apps", v)

    /** True if [pkg] should be spoken: whitelist empty (all) or contains it. */
    fun shouldSpeak(c: Context, pkg: String): Boolean {
        val allow = getSpeakApps(c)
        return allow.isEmpty() || pkg in allow
    }

    /** Fresh-install default: only the main chat apps, not every notification on the device. */
    val DEFAULT_CAPTURE_APPS = setOf(
        "jp.naver.line.android",  // LINE
        "com.facebook.orca",      // Messenger
        "com.whatsapp",           // WhatsApp
        "org.telegram.messenger"  // Telegram
    )

    /**
     * Packages allowed to be captured (notifications + screen).
     * Unset (fresh install) = [DEFAULT_CAPTURE_APPS]. Explicitly cleared to empty by the
     * user = capture every app.
     */
    fun getCaptureApps(c: Context): Set<String> =
        SecureStore.getStringSet(c, "capture_apps", DEFAULT_CAPTURE_APPS)
    fun setCaptureApps(c: Context, v: Set<String>) = SecureStore.putStringSet(c, "capture_apps", v)

    /** True if [pkg] should be captured: default/whitelist contains it, or the whitelist was explicitly cleared (= all). */
    fun shouldCapture(c: Context, pkg: String): Boolean {
        val allow = getCaptureApps(c)
        return allow.isEmpty() || pkg in allow
    }

    // In-app updater: URL of the version.json to check.
    // Defaults to NotiKeeper's GitHub Releases "latest/download" stable URL so a fresh
    // install can auto-check for updates without the user pasting anything.
    const val DEFAULT_UPDATE_URL =
        "https://github.com/Freshair129/notikeeper/releases/latest/download/version.json"
    fun getUpdateUrl(c: Context): String = SecureStore.getString(c, "update_url", DEFAULT_UPDATE_URL)
    fun setUpdateUrl(c: Context, v: String) = SecureStore.putString(c, "update_url", v)
}
