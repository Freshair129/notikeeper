package com.example.notikeeper.data

import android.content.Context
import android.util.Base64
import java.security.SecureRandom

/**
 * Supplies the SQLCipher passphrase.
 *
 * The passphrase is 32 random bytes generated once, then stored (Base64) in
 * [SecureStore] — an AES-256-GCM value wrapped directly with an Android
 * Keystore key that is NOT bound to user authentication, so the background
 * capture services can open the database without any user interaction, while
 * the raw key never exists in plaintext on disk.
 *
 * Note: clearing app data, a factory reset, or a Keystore key mismatch after
 * backup/restore destroys this key, which makes the existing encrypted
 * database unreadable (by design — see SECURITY.md).
 */
object DbKey {
    private const val KEY = "db_pass"

    fun getOrCreate(context: Context): String {
        SecureStore.getStringOrNull(context, KEY)?.let { return it }

        val raw = ByteArray(32)
        SecureRandom().nextBytes(raw)
        val pass = Base64.encodeToString(raw, Base64.NO_WRAP)
        SecureStore.putString(context, KEY, pass)
        return pass
    }
}
