package com.example.notikeeper.data

import android.content.Context
import android.util.Base64
import java.security.SecureRandom

/**
 * Supplies the SQLCipher passphrase.
 *
 * The passphrase is 32 random bytes generated once, then stored (Base64) in
 * [SecureStore]'s dedicated, isolated store for this one value — its own
 * SharedPreferences file, its own Android Keystore alias, not shared with any
 * other setting (see SecureStore's "isolated SQLCipher passphrase store"
 * section for why). The Keystore key is NOT bound to user authentication, so
 * the background capture services can open the database without any user
 * interaction, while the raw key never exists in plaintext on disk.
 *
 * Note: clearing app data, a factory reset, or a Keystore key mismatch after
 * backup/restore destroys this key, which makes the existing encrypted
 * database unreadable (by design — see SECURITY.md). NotiStore.get quarantines
 * (renames, never deletes) the resulting unreadable file and surfaces a notice
 * when this happens, rather than silently discarding it.
 */
object DbKey {
    fun getOrCreate(context: Context): String {
        SecureStore.getDbPassphrase(context)?.let { return it }

        val raw = ByteArray(32)
        SecureRandom().nextBytes(raw)
        val pass = Base64.encodeToString(raw, Base64.NO_WRAP)
        SecureStore.putDbPassphrase(context, pass)
        return pass
    }
}
