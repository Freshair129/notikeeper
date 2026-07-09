package com.example.notikeeper

import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.provider.MediaStore
import androidx.core.content.FileProvider
import com.example.notikeeper.data.NotiItem
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/**
 * Turns captured rows into portable JSON/CSV and gets them off the device:
 *  - share()           -> system share sheet (Google Drive, Gmail, Nearby, send-to-PC apps…)
 *  - saveToDownloads() -> a copy in the public Downloads folder
 *  - uploadJson()      -> POST to the user's own private endpoint
 */
object Exporter {

    fun itemsToJson(items: List<NotiItem>): String {
        val arr = JSONArray()
        for (it in items) {
            arr.put(
                JSONObject().apply {
                    put("id", it.id)
                    put("source", it.source)
                    put("app", it.appName)
                    put("pkg", it.pkg)
                    put("title", it.title)
                    put("text", it.text)
                    put("side", it.side)
                    put("time", it.postTime)
                }
            )
        }
        return arr.toString(2)
    }

    fun itemsToCsv(items: List<NotiItem>): String {
        val sb = StringBuilder("id,source,app,title,text,side,time\n")
        for (it in items) {
            sb.append(it.id).append(',')
                .append(csv(it.source)).append(',')
                .append(csv(it.appName)).append(',')
                .append(csv(it.title)).append(',')
                .append(csv(it.text)).append(',')
                .append(csv(it.side)).append(',')
                .append(it.postTime).append('\n')
        }
        return sb.toString()
    }

    private fun csv(s: String): String {
        val needsQuote = s.any { it == ',' || it == '"' || it == '\n' || it == '\r' }
        val escaped = s.replace("\"", "\"\"")
        return if (needsQuote) "\"$escaped\"" else escaped
    }

    /** Write to cache and fire the system share sheet. */
    fun share(context: Context, fileName: String, mime: String, content: String) {
        val dir = File(context.cacheDir, "exports").apply { mkdirs() }
        val file = File(dir, fileName)
        file.writeText(content)
        val uri = FileProvider.getUriForFile(context, context.packageName + ".fileprovider", file)
        val send = Intent(Intent.ACTION_SEND).apply {
            type = mime
            putExtra(Intent.EXTRA_STREAM, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        context.startActivity(
            Intent.createChooser(send, "ส่งออก / สำรองข้อมูล")
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        )
    }

    /** Save a copy into the public Downloads folder. Returns true on success. */
    fun saveToDownloads(context: Context, fileName: String, mime: String, content: String): Boolean =
        runCatching {
            val values = ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, fileName)
                put(MediaStore.Downloads.MIME_TYPE, mime)
                put(MediaStore.Downloads.IS_PENDING, 1)
            }
            val resolver = context.contentResolver
            val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                ?: return false
            resolver.openOutputStream(uri)?.use { it.write(content.toByteArray(Charsets.UTF_8)) }
            values.clear()
            values.put(MediaStore.Downloads.IS_PENDING, 0)
            resolver.update(uri, values, null, null)
            true
        }.getOrDefault(false)

    /** POST JSON to a private endpoint. Returns the HTTP status code, or throws. */
    suspend fun uploadJson(endpoint: String, token: String, json: String, deviceName: String = ""): Int =
        withContext(Dispatchers.IO) {
            val conn = (URL(endpoint).openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                doOutput = true
                connectTimeout = 15000
                readTimeout = 20000
                setRequestProperty("Content-Type", "application/json; charset=utf-8")
                if (token.isNotBlank()) setRequestProperty("Authorization", "Bearer $token")
                // Header values must be ASCII — percent-encode so Thai/non-Latin device
                // names survive the trip instead of being dropped or mangled. URLEncoder
                // uses '+' for spaces (form-encoding); switch to %20 so the server's
                // decodeURIComponent (which doesn't treat '+' as a space) decodes it back correctly.
                if (deviceName.isNotBlank()) {
                    val encoded = URLEncoder.encode(deviceName, "UTF-8").replace("+", "%20")
                    setRequestProperty("X-Device-Name", encoded)
                }
            }
            try {
                conn.outputStream.use { it.write(json.toByteArray(Charsets.UTF_8)) }
                val code = conn.responseCode
                if (code !in 200..299) throw RuntimeException("HTTP $code")
                code
            } finally {
                conn.disconnect()
            }
        }
}
