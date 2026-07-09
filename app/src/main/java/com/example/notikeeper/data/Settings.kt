package com.example.notikeeper.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Small encrypted settings store (same Keystore-backed file as [DbKey]).
 * Holds the optional private-cloud upload config + the upload high-water mark.
 */
object Settings {
    private fun buildPrefs(appCtx: Context): SharedPreferences {
        val masterKey = MasterKey.Builder(appCtx)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        return EncryptedSharedPreferences.create(
            appCtx,
            "secure_prefs",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }

    /**
     * Open the encrypted prefs, recovering from a corrupted Keystore master
     * key (AEADBadTagException — happens after backup/restore or partial reset).
     * When recovery wipes the prefs file the DB passphrase is gone too, so the
     * encrypted noti.db is also unrecoverable: we delete it next time NotiStore
     * tries to open it.
     */
    private fun prefs(context: Context): SharedPreferences {
        val appCtx = context.applicationContext
        return try {
            buildPrefs(appCtx)
        } catch (_: Throwable) {
            // Wipe both the prefs file AND its v1 androidx-security backing
            // so the master key gets regenerated cleanly on the next call.
            appCtx.getSharedPreferences("secure_prefs", Context.MODE_PRIVATE).edit().clear().commit()
            appCtx.deleteSharedPreferences("secure_prefs")
            try {
                val ks = java.security.KeyStore.getInstance("AndroidKeyStore")
                ks.load(null)
                if (ks.containsAlias("_androidx_security_master_key_")) {
                    ks.deleteEntry("_androidx_security_master_key_")
                }
            } catch (_: Throwable) { /* best effort */ }
            buildPrefs(appCtx)
        }
    }

    fun getApiUrl(c: Context): String = prefs(c).getString("api_url", "") ?: ""
    fun setApiUrl(c: Context, v: String) = prefs(c).edit().putString("api_url", v).apply()

    fun getApiToken(c: Context): String = prefs(c).getString("api_token", "") ?: ""
    fun setApiToken(c: Context, v: String) = prefs(c).edit().putString("api_token", v).apply()

    fun getAutoUpload(c: Context): Boolean = prefs(c).getBoolean("auto_upload", false)
    fun setAutoUpload(c: Context, v: Boolean) = prefs(c).edit().putBoolean("auto_upload", v).apply()

    fun getLastUploadedId(c: Context): Long = prefs(c).getLong("last_uploaded_id", 0L)
    fun setLastUploadedId(c: Context, v: Long) = prefs(c).edit().putLong("last_uploaded_id", v).apply()

    /**
     * Server-confirmed high-water mark: the max row id the PC has durably
     * stored (from `/ingest`'s `ackedThroughId`). Feeds Phase 2 pruning
     * (see docs/ARCHITECTURE_CHANGE_REQUEST.md phase 2). Never allowed to
     * move backwards.
     */
    fun getPrunableThroughId(c: Context): Long = prefs(c).getLong("prunable_through_id", 0L)
    fun setPrunableThroughId(c: Context, v: Long) =
        prefs(c).edit().putLong("prunable_through_id", maxOf(v, getPrunableThroughId(c))).apply()

    /**
     * Phase 2 kill switch: pruning only ever runs when the owner explicitly
     * turns it on. Defaults to off so a fresh install/update never starts
     * deleting on-device data until the owner has confirmed the ack protocol
     * behaves correctly on their own data.
     */
    fun getPruneEnabled(c: Context): Boolean = prefs(c).getBoolean("prune_enabled", false)
    fun setPruneEnabled(c: Context, v: Boolean) = prefs(c).edit().putBoolean("prune_enabled", v).apply()

    /** Retention floor: never prune a row younger than this, even if acked. */
    const val PRUNE_RETENTION_MS = 7L * 24 * 3600_000L

    /** Epoch millis of the last successful upload — shown on the Device & Connection screen. */
    fun getLastSyncTime(c: Context): Long = prefs(c).getLong("last_sync_time", 0L)
    fun setLastSyncTime(c: Context, v: Long) = prefs(c).edit().putLong("last_sync_time", v).apply()

    /** Friendly local label for this device. Empty = not set yet (caller falls back to the device model). */
    fun getDeviceName(c: Context): String = prefs(c).getString("device_name", "") ?: ""
    fun setDeviceName(c: Context, v: String) = prefs(c).edit().putString("device_name", v).apply()

    // Eyes-free read-aloud (driving mode)
    fun getReadAloudNoti(c: Context): Boolean = prefs(c).getBoolean("read_noti", false)
    fun setReadAloudNoti(c: Context, v: Boolean) = prefs(c).edit().putBoolean("read_noti", v).apply()

    fun getReadAloudScreen(c: Context): Boolean = prefs(c).getBoolean("read_screen", false)
    fun setReadAloudScreen(c: Context, v: Boolean) = prefs(c).edit().putBoolean("read_screen", v).apply()

    /** Packages allowed to be read aloud. Empty set = read every app. */
    fun getSpeakApps(c: Context): Set<String> = prefs(c).getStringSet("speak_apps", emptySet()) ?: emptySet()
    fun setSpeakApps(c: Context, v: Set<String>) = prefs(c).edit().putStringSet("speak_apps", v).apply()

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
        prefs(c).getStringSet("capture_apps", DEFAULT_CAPTURE_APPS) ?: DEFAULT_CAPTURE_APPS
    fun setCaptureApps(c: Context, v: Set<String>) = prefs(c).edit().putStringSet("capture_apps", v).apply()

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
    fun getUpdateUrl(c: Context): String =
        prefs(c).getString("update_url", DEFAULT_UPDATE_URL) ?: DEFAULT_UPDATE_URL
    fun setUpdateUrl(c: Context, v: String) = prefs(c).edit().putString("update_url", v).apply()
}
