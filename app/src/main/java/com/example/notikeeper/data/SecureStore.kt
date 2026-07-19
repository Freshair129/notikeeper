package com.example.notikeeper.data

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Encrypted key-value store backed directly on the Android Keystore (AES-256-GCM),
 * replacing androidx.security:security-crypto — that library's APIs were all
 * deprecated at 1.1.0 with no further releases; Google's own migration guidance
 * is direct Keystore use. Backs both [DbKey] (the SQLCipher passphrase) and
 * [Settings].
 *
 * The Keystore key is NOT bound to user authentication: background capture
 * services must be able to read/write while the app is locked (see SECURITY.md).
 *
 * One-time migration: the first access after upgrading from a version that used
 * EncryptedSharedPreferences decrypts every existing value with the old library
 * and re-encrypts it here, then deletes the old file and its Keystore master key
 * alias. This preserves existing installs' data — critically, the SQLCipher
 * passphrase, without which noti.db becomes permanently unreadable.
 *
 * Corruption recovery (e.g. after a backup/restore restores the ciphertext file
 * without its non-exportable Keystore key — see AndroidManifest's backup
 * exclusion, which now prevents this going forward) wipes this store and lets
 * callers fall back to their own default/regeneration behavior, same trade-off
 * EncryptedSharedPreferences had. Unlike before, that recovery now covers every
 * caller uniformly (the old DbKey path had no equivalent recovery at all).
 */
object SecureStore {
    private const val PREFS_FILE = "secure_store"
    private const val KEY_ALIAS = "notikeeper_secure_store_key"
    private const val MIGRATED_MARKER = "_migrated_from_v1"
    private const val GCM_TAG_BITS = 128
    // Package names (the only Set<String> values stored) are restricted to
    // [a-zA-Z0-9_.], so a comma is a safe join/split delimiter.
    private const val SET_DELIM = ","

    // ---------- Keystore-backed AES-GCM secret key ----------

    private fun getOrCreateKey(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }

        val spec = KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            // Deliberately NOT setUserAuthenticationRequired(true) — background
            // services must read/write while the app is locked.
            .build()
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(spec)
        return generator.generateKey()
    }

    private fun encryptToString(plain: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
        val ciphertext = cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
        return Base64.encodeToString(cipher.iv, Base64.NO_WRAP) + ":" +
            Base64.encodeToString(ciphertext, Base64.NO_WRAP)
    }

    private fun decryptFromString(stored: String): String {
        val sep = stored.indexOf(':')
        val iv = Base64.decode(stored.substring(0, sep), Base64.NO_WRAP)
        val ciphertext = Base64.decode(stored.substring(sep + 1), Base64.NO_WRAP)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), GCMParameterSpec(GCM_TAG_BITS, iv))
        return String(cipher.doFinal(ciphertext), Charsets.UTF_8)
    }

    // ---------- plain SharedPreferences file holding the ciphertext ----------

    private fun rawPrefs(context: Context): SharedPreferences =
        context.applicationContext.getSharedPreferences(PREFS_FILE, Context.MODE_PRIVATE)

    private fun wipe(context: Context) {
        rawPrefs(context).edit().clear().commit()
        try {
            val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
            if (ks.containsAlias(KEY_ALIAS)) ks.deleteEntry(KEY_ALIAS)
        } catch (_: Throwable) { /* best effort */ }
    }

    // ---------- one-time migration from androidx.security EncryptedSharedPreferences ----------

    private val OLD_STRING_KEYS = listOf("db_pass", "api_url", "api_token", "device_name", "update_url")
    private val OLD_BOOLEAN_KEYS = listOf("auto_upload", "prune_enabled", "read_noti", "read_screen")
    private val OLD_LONG_KEYS = listOf("last_uploaded_id", "prunable_through_id", "last_sync_time")
    private val OLD_SET_KEYS = listOf("speak_apps", "capture_apps")

    @Synchronized
    private fun migrateIfNeeded(context: Context) {
        val raw = rawPrefs(context)
        if (raw.getBoolean(MIGRATED_MARKER, false)) return

        val old: SharedPreferences = try {
            val masterKey = androidx.security.crypto.MasterKey.Builder(context.applicationContext)
                .setKeyScheme(androidx.security.crypto.MasterKey.KeyScheme.AES256_GCM)
                .build()
            androidx.security.crypto.EncryptedSharedPreferences.create(
                context.applicationContext,
                "secure_prefs",
                masterKey,
                androidx.security.crypto.EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                androidx.security.crypto.EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            )
        } catch (_: Throwable) {
            // Old file corrupted or absent — nothing to carry over. Same
            // graceful-loss behavior the pre-migration code already had.
            raw.edit().putBoolean(MIGRATED_MARKER, true).apply()
            return
        }

        val editor = raw.edit()
        for (k in OLD_STRING_KEYS) old.getString(k, null)?.let { editor.putString(k, encryptToString(it)) }
        for (k in OLD_BOOLEAN_KEYS) if (old.contains(k)) {
            editor.putString(k, encryptToString(if (old.getBoolean(k, false)) "1" else "0"))
        }
        for (k in OLD_LONG_KEYS) if (old.contains(k)) {
            editor.putString(k, encryptToString(old.getLong(k, 0L).toString()))
        }
        for (k in OLD_SET_KEYS) old.getStringSet(k, null)?.let {
            editor.putString(k, encryptToString(it.joinToString(SET_DELIM)))
        }
        editor.putBoolean(MIGRATED_MARKER, true)
        editor.apply()

        // Old data now lives in the new store — remove the old file and its
        // Keystore master key so nothing stale is left around to corrupt later.
        context.applicationContext.getSharedPreferences("secure_prefs", Context.MODE_PRIVATE)
            .edit().clear().commit()
        context.applicationContext.deleteSharedPreferences("secure_prefs")
        try {
            val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
            if (ks.containsAlias("_androidx_security_master_key_")) {
                ks.deleteEntry("_androidx_security_master_key_")
            }
        } catch (_: Throwable) { /* best effort */ }
    }

    // ---------- typed public API ----------

    private fun readRaw(context: Context, key: String): String? {
        migrateIfNeeded(context)
        val stored = rawPrefs(context).getString(key, null) ?: return null
        return try {
            decryptFromString(stored)
        } catch (_: Throwable) {
            wipe(context)
            null
        }
    }

    private fun writeRaw(context: Context, key: String, value: String) {
        migrateIfNeeded(context)
        rawPrefs(context).edit().putString(key, encryptToString(value)).apply()
    }

    fun getString(context: Context, key: String, default: String): String = readRaw(context, key) ?: default
    fun getStringOrNull(context: Context, key: String): String? = readRaw(context, key)
    fun putString(context: Context, key: String, value: String) = writeRaw(context, key, value)

    fun getBoolean(context: Context, key: String, default: Boolean): Boolean =
        readRaw(context, key)?.let { it == "1" } ?: default
    fun putBoolean(context: Context, key: String, value: Boolean) = writeRaw(context, key, if (value) "1" else "0")

    fun getLong(context: Context, key: String, default: Long): Long =
        readRaw(context, key)?.toLongOrNull() ?: default
    fun putLong(context: Context, key: String, value: Long) = writeRaw(context, key, value.toString())

    fun getStringSet(context: Context, key: String, default: Set<String>): Set<String> =
        readRaw(context, key)?.let { if (it.isEmpty()) emptySet() else it.split(SET_DELIM).toSet() } ?: default
    fun putStringSet(context: Context, key: String, value: Set<String>) =
        writeRaw(context, key, value.joinToString(SET_DELIM))
}
