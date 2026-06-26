package com.example.notikeeper.data

import android.content.Context
import android.util.Base64
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.security.SecureRandom

/**
 * Supplies the SQLCipher passphrase.
 *
 * The passphrase is 32 random bytes generated once, then stored (Base64) inside
 * EncryptedSharedPreferences. Those prefs are encrypted with a master key held
 * in the Android Keystore (hardware-backed where available), and that master
 * key is NOT bound to user authentication — so the background capture services
 * can open the database without any user interaction, while the raw key never
 * exists in plaintext on disk.
 *
 * Note: clearing app data or a factory reset destroys this key, which makes the
 * existing encrypted database unreadable (by design).
 */
object DbKey {
    private const val PREFS = "secure_prefs"
    private const val KEY = "db_pass"

    fun getOrCreate(context: Context): String {
        val appCtx = context.applicationContext
        val masterKey = MasterKey.Builder(appCtx)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        val prefs = EncryptedSharedPreferences.create(
            appCtx,
            PREFS,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
        prefs.getString(KEY, null)?.let { return it }

        val raw = ByteArray(32)
        SecureRandom().nextBytes(raw)
        val pass = Base64.encodeToString(raw, Base64.NO_WRAP)
        prefs.edit().putString(KEY, pass).apply()
        return pass
    }
}
