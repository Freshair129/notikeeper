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
    private fun prefs(context: Context): SharedPreferences {
        val appCtx = context.applicationContext
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

    fun getApiUrl(c: Context): String = prefs(c).getString("api_url", "") ?: ""
    fun setApiUrl(c: Context, v: String) = prefs(c).edit().putString("api_url", v).apply()

    fun getApiToken(c: Context): String = prefs(c).getString("api_token", "") ?: ""
    fun setApiToken(c: Context, v: String) = prefs(c).edit().putString("api_token", v).apply()

    fun getAutoUpload(c: Context): Boolean = prefs(c).getBoolean("auto_upload", false)
    fun setAutoUpload(c: Context, v: Boolean) = prefs(c).edit().putBoolean("auto_upload", v).apply()

    fun getLastUploadedId(c: Context): Long = prefs(c).getLong("last_uploaded_id", 0L)
    fun setLastUploadedId(c: Context, v: Long) = prefs(c).edit().putLong("last_uploaded_id", v).apply()

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

    // In-app updater: URL of the version.json to check.
    // Defaults to NotiKeeper's GitHub Releases "latest/download" stable URL so a fresh
    // install can auto-check for updates without the user pasting anything.
    const val DEFAULT_UPDATE_URL =
        "https://github.com/Freshair129/notikeeper/releases/latest/download/version.json"
    fun getUpdateUrl(c: Context): String =
        prefs(c).getString("update_url", DEFAULT_UPDATE_URL) ?: DEFAULT_UPDATE_URL
    fun setUpdateUrl(c: Context, v: String) = prefs(c).edit().putString("update_url", v).apply()
}
