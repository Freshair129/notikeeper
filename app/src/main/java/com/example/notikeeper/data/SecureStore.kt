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
 * is direct Keystore use. Backs [Settings] (14 general settings, all sharing one
 * file/alias below) and, via its own isolated file/alias, [DbKey]'s SQLCipher
 * passphrase — see "isolated SQLCipher passphrase store" further down for why
 * that one value does not share the general store.
 *
 * The Keystore keys are NOT bound to user authentication: background capture
 * services must be able to read/write while the app is locked (see SECURITY.md).
 *
 * One-time migration: the first access after upgrading from a version that used
 * EncryptedSharedPreferences decrypts every existing value with the old library
 * and re-encrypts it here, then deletes the old file and its Keystore master key
 * alias. This preserves existing installs' data — critically, the SQLCipher
 * passphrase (at that point still landing in the general store below; see
 * getDbPassphrase for how it moves out to its own store from here).
 */
object SecureStore {
    private const val PREFS_FILE = "secure_store"
    private const val KEY_ALIAS = "notikeeper_secure_store_key"
    private const val MIGRATED_MARKER = "_migrated_from_v1"
    private const val GCM_TAG_BITS = 128
    // Package names (the only Set<String> values stored) are restricted to
    // [a-zA-Z0-9_.], so a comma is a safe join/split delimiter.
    private const val SET_DELIM = ","

    // ---------- Keystore-backed AES-GCM secret keys (one alias per store) ----------

    private fun getOrCreateKeyForAlias(alias: String): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(alias, null) as? SecretKey)?.let { return it }

        val spec = KeyGenParameterSpec.Builder(
            alias,
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

    private fun getOrCreateKey(): SecretKey = getOrCreateKeyForAlias(KEY_ALIAS)

    private fun encryptToString(plain: String, key: SecretKey): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key)
        val ciphertext = cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
        return Base64.encodeToString(cipher.iv, Base64.NO_WRAP) + ":" +
            Base64.encodeToString(ciphertext, Base64.NO_WRAP)
    }

    private fun decryptFromString(stored: String, key: SecretKey): String {
        val sep = stored.indexOf(':')
        val iv = Base64.decode(stored.substring(0, sep), Base64.NO_WRAP)
        val ciphertext = Base64.decode(stored.substring(sep + 1), Base64.NO_WRAP)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(GCM_TAG_BITS, iv))
        return String(cipher.doFinal(ciphertext), Charsets.UTF_8)
    }

    // ---------- plain SharedPreferences file holding the ciphertext ----------

    private fun rawPrefs(context: Context): SharedPreferences =
        context.applicationContext.getSharedPreferences(PREFS_FILE, Context.MODE_PRIVATE)

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

        val generalKey = getOrCreateKey()
        val editor = raw.edit()
        for (k in OLD_STRING_KEYS) old.getString(k, null)?.let { editor.putString(k, encryptToString(it, generalKey)) }
        for (k in OLD_BOOLEAN_KEYS) if (old.contains(k)) {
            editor.putString(k, encryptToString(if (old.getBoolean(k, false)) "1" else "0", generalKey))
        }
        for (k in OLD_LONG_KEYS) if (old.contains(k)) {
            editor.putString(k, encryptToString(old.getLong(k, 0L).toString(), generalKey))
        }
        for (k in OLD_SET_KEYS) old.getStringSet(k, null)?.let {
            editor.putString(k, encryptToString(it.joinToString(SET_DELIM), generalKey))
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

    // ---------- typed public API (general settings — Settings.kt's 14 keys) ----------

    private fun readRaw(context: Context, key: String): String? {
        migrateIfNeeded(context)
        val stored = rawPrefs(context).getString(key, null) ?: return null
        return try {
            decryptFromString(stored, getOrCreateKey())
        } catch (_: Throwable) {
            // Only THIS value is unreadable — a corrupted single entry, a stray
            // Keystore hiccup touching just this ciphertext. Drop it and let the
            // caller fall back to its own default; every other setting stays
            // exactly as it was. This used to call a wipe() that cleared the
            // entire file and deleted the shared Keystore alias on ANY single
            // bad value — which, before the SQLCipher passphrase got its own
            // isolated store below, meant one corrupted setting (say, a stray
            // byte in the saved update-check URL) took the encrypted database
            // down with it. One bad key now costs exactly one setting.
            rawPrefs(context).edit().remove(key).apply()
            null
        }
    }

    private fun writeRaw(context: Context, key: String, value: String) {
        migrateIfNeeded(context)
        rawPrefs(context).edit().putString(key, encryptToString(value, getOrCreateKey())).apply()
    }

    fun getString(context: Context, key: String, default: String): String = readRaw(context, key) ?: default
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

    // ---------- isolated SQLCipher passphrase store (DbKey's one value) ----------
    //
    // db_pass is the one value in this whole object whose loss is catastrophic:
    // without it, noti.db — potentially years of archive — is permanently
    // unreadable. It used to live in the same file, under the same Keystore
    // alias, as every other setting above, so a decrypt failure on something as
    // minor as a saved update-check URL could take the passphrase down with it.
    // Its own file and its own Keystore alias mean nothing that happens to any
    // other setting can reach it.

    private const val DBKEY_PREFS_FILE = "secure_store_dbkey"
    private const val DBKEY_ALIAS = "notikeeper_dbkey_key"
    private const val DBKEY_ENTRY = "value"

    private fun dbKeyPrefs(context: Context): SharedPreferences =
        context.applicationContext.getSharedPreferences(DBKEY_PREFS_FILE, Context.MODE_PRIVATE)

    /**
     * The SQLCipher passphrase, or null if none has ever been created.
     *
     * Checks the dedicated store first. An install that already went through
     * the androidx.security migration above still has its passphrase filed
     * under "db_pass" in the *general* store (this dedicated store didn't exist
     * yet when that migration ran) — that's the fallback: found there, it's
     * copied into the dedicated store and removed from the general one, a
     * one-time move that runs at most once per install. Skipping this fallback
     * would make every existing archive look keyless the first time this
     * version runs and mint a fresh passphrase that doesn't match the
     * already-encrypted noti.db on disk.
     */
    fun getDbPassphrase(context: Context): String? {
        dbKeyPrefs(context).getString(DBKEY_ENTRY, null)?.let { stored ->
            return try {
                decryptFromString(stored, getOrCreateKeyForAlias(DBKEY_ALIAS))
            } catch (_: Throwable) {
                // The dedicated entry itself is unreadable. Remove it so this
                // isn't retried every call, and return null — the caller
                // (DbKey → NotiStore) treats that as "no key yet" and mints a
                // fresh one, which correctly can no longer open the existing
                // noti.db. That half is unavoidable: an unreadable passphrase
                // means the old file's contents are gone regardless. What NO
                // LONGER happens is silence — NotiStore quarantines the old
                // file instead of deleting it, and tells the user.
                dbKeyPrefs(context).edit().remove(DBKEY_ENTRY).apply()
                null
            }
        }

        val legacy = readRaw(context, "db_pass") ?: return null
        putDbPassphrase(context, legacy)
        rawPrefs(context).edit().remove("db_pass").apply()
        return legacy
    }

    fun putDbPassphrase(context: Context, value: String) {
        val enc = encryptToString(value, getOrCreateKeyForAlias(DBKEY_ALIAS))
        dbKeyPrefs(context).edit().putString(DBKEY_ENTRY, enc).apply()
    }
}
