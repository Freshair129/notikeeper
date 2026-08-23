package com.example.notikeeper

import android.content.Context
import android.content.Intent
import androidx.core.content.FileProvider
import com.example.notikeeper.data.Settings
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

data class UpdateInfo(
    val versionCode: Int,
    val versionName: String,
    val apkUrl: String,
    val notes: String,
    /** SHA-256 of the APK, lowercase hex, as published in version.json — see
     *  G-17 in the capture-to-archive integrity audit. Null for a manifest
     *  that doesn't carry one (every version.json published before this
     *  check existed, and any host that hasn't started publishing one yet);
     *  [download] verifies it when present and skips verification when it
     *  isn't, rather than refusing every update until every past release is
     *  retroactively re-published with a hash it never had. */
    val sha256: String?
)

/**
 * Self-update for the sideloaded APK. Reads a `version.json` from a URL
 * (e.g. GitHub Releases `.../releases/latest/download/version.json`), compares
 * versionCode with this build, and if newer downloads the APK and launches the
 * system installer.
 *
 * version.json shape:
 *   { "versionCode": 6, "versionName": "1.5",
 *     "url": "https://.../NotiKeeper.apk", "notes": "...",
 *     "sha256": "<lowercase hex, optional>" }
 *
 * Trust chain: HTTPS is required for both the manifest and the APK fetch (see
 * [isHttps]) and the APK is hash-checked against the manifest's own sha256
 * when present. What this does NOT establish: that the manifest itself came
 * from someone trustworthy — an attacker able to serve responses at whatever
 * URL Settings.updateUrl points to can publish a manifest whose hash matches
 * their own tampered APK just as validly as the real one. The one thing that
 * genuinely stops an attacker's build from installing over this one is
 * Android's own signature-continuity check at install time (see SECURITY.md);
 * this file's job is narrower — making sure what actually gets installed is
 * byte-for-byte what the manifest said it would be, over a connection that
 * can't be silently downgraded to plaintext or redirected off HTTPS.
 */
object Updater {

    private fun isHttps(url: String) = url.startsWith("https://", ignoreCase = true)

    /** Returns info if a newer version is available, else null. */
    suspend fun check(context: Context): UpdateInfo? = withContext(Dispatchers.IO) {
        val url = Settings.getUpdateUrl(context)
        if (url.isBlank() || !isHttps(url)) return@withContext null
        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = 10000
            readTimeout = 10000
            instanceFollowRedirects = true
            setRequestProperty("Accept", "application/json")
        }
        try {
            if (conn.responseCode !in 200..299) return@withContext null
            // instanceFollowRedirects can hand back a response fetched over a
            // redirect chain HttpURLConnection followed on its own — whether it
            // refuses to follow an https->http downgrade isn't something this
            // code should assume without being able to verify it on-device, so
            // check explicitly: conn.url is the URL that ACTUALLY answered,
            // after any redirects, not the one this fetch started with.
            if (!isHttps(conn.url.toString())) return@withContext null
            val text = conn.inputStream.bufferedReader().use { it.readText() }
            val o = JSONObject(text)
            val code = o.getInt("versionCode")
            if (code <= BuildConfig.VERSION_CODE) return@withContext null
            val apkUrl = o.getString("url")
            if (!isHttps(apkUrl)) return@withContext null
            UpdateInfo(
                versionCode = code,
                versionName = o.optString("versionName", ""),
                apkUrl = apkUrl,
                notes = o.optString("notes", ""),
                sha256 = o.optString("sha256", "").takeIf { it.isNotBlank() }?.lowercase()
            )
        } catch (e: Exception) {
            null
        } finally {
            conn.disconnect()
        }
    }

    /**
     * Download the APK into the shared cache and return the file.
     *
     * [expectedSha256] (from the manifest, [UpdateInfo.sha256]) is verified
     * against the downloaded bytes when present; a mismatch deletes the file
     * and throws before the caller ever gets a File back, so install() can
     * never be reached with a tampered or corrupted download. A null
     * [expectedSha256] — no hash in this manifest — downloads unverified,
     * same as before this existed.
     */
    suspend fun download(context: Context, apkUrl: String, expectedSha256: String? = null): File =
        withContext(Dispatchers.IO) {
            require(isHttps(apkUrl)) { "refusing a non-HTTPS APK URL" }
            val dir = File(context.cacheDir, "exports").apply { mkdirs() }
            // Same cache dir Exporter's plaintext exports use, and the same
            // "clear it out before writing the next thing" bound on how long a
            // plaintext artifact can linger there — see Exporter.purgeCache / G-24.
            Exporter.purgeCache(context)
            val file = File(dir, "update.apk")
            val conn = (URL(apkUrl).openConnection() as HttpURLConnection).apply {
                connectTimeout = 15000
                readTimeout = 60000
                instanceFollowRedirects = true
            }
            try {
                conn.connect()
                // Same explicit final-URL check as check() above, and more load-
                // bearing here — this is the actual install artifact, not just
                // the manifest describing it.
                require(isHttps(conn.url.toString())) { "APK fetch was redirected off HTTPS" }
                val digest = if (expectedSha256 != null) MessageDigest.getInstance("SHA-256") else null
                conn.inputStream.use { input ->
                    file.outputStream().use { out ->
                        if (digest == null) {
                            input.copyTo(out)
                        } else {
                            val buf = ByteArray(64 * 1024)
                            while (true) {
                                val n = input.read(buf)
                                if (n < 0) break
                                digest.update(buf, 0, n)
                                out.write(buf, 0, n)
                            }
                        }
                    }
                }
                if (digest != null) {
                    val actual = digest.digest().joinToString("") { "%02x".format(it) }
                    if (actual != expectedSha256) {
                        file.delete()
                        throw IllegalStateException(
                            "downloaded APK does not match the sha256 in version.json " +
                                "(expected $expectedSha256, got $actual) — refusing to install"
                        )
                    }
                }
            } finally {
                conn.disconnect()
            }
            file
        }

    /** Launch the system package installer for [file]. */
    fun install(context: Context, file: File) {
        val uri = FileProvider.getUriForFile(context, context.packageName + ".fileprovider", file)
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(intent)
    }
}
