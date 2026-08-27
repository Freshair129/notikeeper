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
import java.io.Writer
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/**
 * Turns captured rows into portable JSON/CSV and gets them off the device:
 *  - share()           -> system share sheet (Google Drive, Gmail, Nearby, send-to-PC apps…)
 *  - saveToDownloads() -> a copy in the public Downloads folder
 *  - uploadJson()      -> POST to the user's own private endpoint
 *
 * share() and saveToDownloads() take a writer callback rather than a
 * pre-built String: the export buttons drive NotiStore.allRows() (an
 * uncapped, cursor-backed sequence) straight into the destination file, so a
 * large archive never has to exist twice over in memory — once as rows, once
 * as the whole serialized payload. uploadJson() still takes a String body:
 * an HTTP POST needs one anyway, and its caller (the capped querySince/
 * upload-batch path) is bounded by design, unlike export.
 */
object Exporter {

    // time_exact/captured_at/extraction_version: snake_case on the wire to match
    // scraper.mjs/adb-scraper.mjs's pre-existing time_exact field (see G-09/G-36
    // in the capture-to-archive integrity audit) rather than introducing a second
    // naming convention the server would need to reconcile. optNullable* omits
    // the key entirely for a null value rather than writing JSON null, matching
    // how absent fields already work for older/pre-migration rows.
    private fun rowToJson(it: NotiItem): JSONObject = JSONObject().apply {
        put("id", it.id)
        put("source", it.source)
        put("app", it.appName)
        put("pkg", it.pkg)
        put("title", it.title)
        put("text", it.text)
        put("side", it.side)
        put("time", it.postTime)
        put("time_exact", it.timeExact)
        it.capturedAt?.let { c -> put("captured_at", c) }
        it.extractionVersion?.let { v -> put("extraction_version", v) }
    }

    /** Used by the upload path, which POSTs a bounded batch as one JSON body. */
    fun itemsToJson(items: List<NotiItem>): String {
        val arr = JSONArray()
        for (it in items) arr.put(rowToJson(it))
        return arr.toString(2)
    }

    private fun csv(s: String): String {
        val needsQuote = s.any { it == ',' || it == '"' || it == '\n' || it == '\r' }
        val escaped = s.replace("\"", "\"\"")
        return if (needsQuote) "\"$escaped\"" else escaped
    }

    /** Streams [rows] to [writer] as a JSON array, one object at a time. Returns the row count. */
    fun writeJsonRows(writer: Writer, rows: Sequence<NotiItem>): Int {
        writer.write("[\n")
        var count = 0
        for (it in rows) {
            if (count > 0) writer.write(",\n")
            writer.write("  ")
            writer.write(rowToJson(it).toString())
            count++
        }
        writer.write(if (count > 0) "\n]" else "]")
        return count
    }

    /** Streams [rows] to [writer] as CSV, one line at a time. Returns the row count. */
    fun writeCsvRows(writer: Writer, rows: Sequence<NotiItem>): Int {
        // pkg is in the JSON export (rowToJson) and in the iOS companion's own CSV
        // writer (MessageStore.swift) but was missing here — the one field that
        // actually distinguishes same-named apps/threads across packages, and
        // without it a round-trip through this CSV can't reconstruct pkg at all.
        // See G-23 in the capture-to-archive integrity audit.
        writer.write("id,source,app,pkg,title,text,side,time,time_exact,captured_at,extraction_version\n")
        var count = 0
        for (it in rows) {
            writer.write(it.id.toString())
            writer.write(",")
            writer.write(csv(it.source)); writer.write(",")
            writer.write(csv(it.appName)); writer.write(",")
            writer.write(csv(it.pkg)); writer.write(",")
            writer.write(csv(it.title)); writer.write(",")
            writer.write(csv(it.text)); writer.write(",")
            writer.write(csv(it.side)); writer.write(",")
            writer.write(it.postTime.toString()); writer.write(",")
            writer.write(if (it.timeExact) "1" else "0"); writer.write(",")
            writer.write(it.capturedAt?.toString() ?: ""); writer.write(",")
            writer.write(it.extractionVersion?.toString() ?: "")
            writer.write("\n")
            count++
        }
        return count
    }

    /**
     * Deletes everything currently in cacheDir/exports. There's no reliable
     * "the app I shared to is done reading the file" callback from
     * ACTION_SEND, so a just-shared file can't be deleted the instant the
     * share sheet closes without risking deleting it out from under a
     * receiving app that's still reading the stream. What this bounds instead
     * is unbounded accumulation of decrypted plaintext (exports, the
     * downloaded update APK) in app-private cache forever — every new export
     * or update download starts by clearing whatever the previous one left
     * behind, so at most one plaintext artifact lingers at a time instead of
     * one per export/update ever run — see G-24 in the capture-to-archive
     * integrity audit.
     */
    fun purgeCache(context: Context) {
        File(context.cacheDir, "exports").listFiles()?.forEach { it.delete() }
    }

    /** Write to cache via [write] and fire the system share sheet. */
    fun share(context: Context, fileName: String, mime: String, write: (Writer) -> Unit) {
        val dir = File(context.cacheDir, "exports").apply { mkdirs() }
        purgeCache(context)
        val file = File(dir, fileName)
        file.bufferedWriter(Charsets.UTF_8).use(write)
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

    /** Save a copy into the public Downloads folder via [write]. Returns true on success. */
    fun saveToDownloads(context: Context, fileName: String, mime: String, write: (Writer) -> Unit): Boolean =
        runCatching {
            val values = ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, fileName)
                put(MediaStore.Downloads.MIME_TYPE, mime)
                put(MediaStore.Downloads.IS_PENDING, 1)
            }
            val resolver = context.contentResolver
            val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                ?: return false
            resolver.openOutputStream(uri)?.bufferedWriter(Charsets.UTF_8)?.use(write)
            values.clear()
            values.put(MediaStore.Downloads.IS_PENDING, 0)
            resolver.update(uri, values, null, null)
            true
        }.getOrDefault(false)

    /** Result of a successful upload: HTTP status + the server's ack high-water mark (0 if absent/unparseable). */
    data class UploadResult(val code: Int, val ackedThroughId: Long)

    /** POST JSON to a private endpoint. Returns the HTTP status code + ack high-water mark, or throws. */
    suspend fun uploadJson(endpoint: String, token: String, json: String, deviceName: String = ""): UploadResult =
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
                val body = conn.inputStream.use { it.readBytes().toString(Charsets.UTF_8) }
                val ackedThroughId = runCatching { JSONObject(body).optLong("ackedThroughId", 0L) }
                    .getOrDefault(0L)
                UploadResult(code, ackedThroughId)
            } finally {
                conn.disconnect()
            }
        }
}
