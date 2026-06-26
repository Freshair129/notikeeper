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

data class UpdateInfo(
    val versionCode: Int,
    val versionName: String,
    val apkUrl: String,
    val notes: String
)

/**
 * Self-update for the sideloaded APK. Reads a `version.json` from a URL
 * (e.g. GitHub Releases `.../releases/latest/download/version.json`), compares
 * versionCode with this build, and if newer downloads the APK and launches the
 * system installer.
 *
 * version.json shape:
 *   { "versionCode": 6, "versionName": "1.5",
 *     "url": "https://.../NotiKeeper.apk", "notes": "..." }
 */
object Updater {

    /** Returns info if a newer version is available, else null. */
    suspend fun check(context: Context): UpdateInfo? = withContext(Dispatchers.IO) {
        val url = Settings.getUpdateUrl(context)
        if (url.isBlank()) return@withContext null
        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = 10000
            readTimeout = 10000
            instanceFollowRedirects = true
            setRequestProperty("Accept", "application/json")
        }
        try {
            if (conn.responseCode !in 200..299) return@withContext null
            val text = conn.inputStream.bufferedReader().use { it.readText() }
            val o = JSONObject(text)
            val code = o.getInt("versionCode")
            if (code <= BuildConfig.VERSION_CODE) return@withContext null
            UpdateInfo(
                versionCode = code,
                versionName = o.optString("versionName", ""),
                apkUrl = o.getString("url"),
                notes = o.optString("notes", "")
            )
        } catch (e: Exception) {
            null
        } finally {
            conn.disconnect()
        }
    }

    /** Download the APK into the shared cache and return the file. */
    suspend fun download(context: Context, apkUrl: String): File = withContext(Dispatchers.IO) {
        val dir = File(context.cacheDir, "exports").apply { mkdirs() }
        val file = File(dir, "update.apk")
        val conn = (URL(apkUrl).openConnection() as HttpURLConnection).apply {
            connectTimeout = 15000
            readTimeout = 60000
            instanceFollowRedirects = true
        }
        try {
            conn.inputStream.use { input -> file.outputStream().use { input.copyTo(it) } }
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
