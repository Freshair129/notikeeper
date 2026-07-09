package com.example.notikeeper.data

import android.content.ContentValues
import android.content.Context
import net.sqlcipher.database.SQLiteDatabase
import net.sqlcipher.database.SQLiteOpenHelper

/** One captured row. `source` = "noti" (from notification) or "screen" (from accessibility read). */
data class NotiItem(
    val id: Long,
    val source: String,
    val pkg: String,
    val appName: String,
    val title: String,   // notification title OR conversation/contact name
    val text: String,    // message / line
    val side: String,    // "" | "me" | "them"  (screen capture only)
    val postTime: Long
)

/** A single line read off the Messenger screen by the AccessibilityService. */
data class ScreenRow(
    val pkg: String,
    val appName: String,
    val sender: String,
    val text: String,
    val side: String,
    val postTime: Long
)

/**
 * Encrypted SQLite store (SQLCipher / AES-256). The whole `noti.db` file is
 * unreadable without the passphrase from [DbKey]. Otherwise behaves like the
 * plain version: singleton, idempotent inserts via a UNIQUE dedupKey.
 */
class NotiStore private constructor(
    context: Context,
    private val passphrase: String
) : SQLiteOpenHelper(context.applicationContext, "noti.db", null, 2) {

    private val database: SQLiteDatabase by lazy { getWritableDatabase(passphrase) }

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            """CREATE TABLE notifications(
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 source TEXT NOT NULL,
                 pkg TEXT NOT NULL,
                 appName TEXT NOT NULL,
                 title TEXT NOT NULL,
                 text TEXT NOT NULL,
                 side TEXT NOT NULL DEFAULT '',
                 postTime INTEGER NOT NULL,
                 dedupKey TEXT
               )"""
        )
        db.execSQL("CREATE UNIQUE INDEX idx_dedup ON notifications(dedupKey)")
        db.execSQL("CREATE INDEX idx_time ON notifications(postTime)")
    }

    // The phone is becoming a capture buffer whose rows must survive schema
    // bumps (see docs/ARCHITECTURE_CHANGE_REQUEST.md) — the PC is only ever
    // caught up via uploads it acknowledged, so dropping the table here would
    // silently destroy un-acked data. No schema change is pending, so this is
    // a no-op; future migrations must be additive (ALTER TABLE / CREATE INDEX
    // IF NOT EXISTS), never a DROP.
    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
    }

    /** Insert one captured notification (background, app-wide). */
    fun insertNoti(pkg: String, appName: String, title: String, text: String, postTime: Long) {
        val values = ContentValues().apply {
            put("source", "noti")
            put("pkg", pkg)
            put("appName", appName)
            put("title", title)
            put("text", text)
            put("side", "")
            put("postTime", postTime)
            // Dedup on content, NOT time: spam/promo channels repost identical text
            // with a fresh timestamp each time, so including postTime here made every
            // repost a "new" row. Keying on (pkg, title, text) collapses those to one
            // — same exact-match semantics the PC server uses. Trade-off: a genuinely
            // repeated short message ("ครับ") is also kept once, which the PC store
            // already does anyway, so phone and PC stay consistent.
            put("dedupKey", "noti:$pkg:$title:$text")
        }
        database.insertWithOnConflict(
            "notifications", null, values, SQLiteDatabase.CONFLICT_IGNORE
        )
    }

    /** Insert a batch of lines read off the screen, in one transaction. */
    fun insertScreenBatch(rows: List<ScreenRow>) {
        if (rows.isEmpty()) return
        val db = database
        db.beginTransaction()
        try {
            for (r in rows) {
                val values = ContentValues().apply {
                    put("source", "screen")
                    put("pkg", r.pkg)
                    put("appName", r.appName)
                    put("title", r.sender)
                    put("text", r.text)
                    put("side", r.side)
                    put("postTime", r.postTime)
                    put("dedupKey", "screen:${r.sender}:${r.side}:${r.text}")
                }
                db.insertWithOnConflict(
                    "notifications", null, values, SQLiteDatabase.CONFLICT_IGNORE
                )
            }
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    /** Empty search = newest first. Otherwise match app/contact name, sender, or message. */
    fun query(search: String): List<NotiItem> {
        val db = database
        val cursor = if (search.isBlank()) {
            db.rawQuery(
                "SELECT id,source,pkg,appName,title,text,side,postTime FROM notifications " +
                    "ORDER BY postTime DESC, id DESC LIMIT 5000",
                null
            )
        } else {
            val like = "%$search%"
            db.rawQuery(
                "SELECT id,source,pkg,appName,title,text,side,postTime FROM notifications " +
                    "WHERE appName LIKE ? OR title LIKE ? OR text LIKE ? " +
                    "ORDER BY postTime DESC, id DESC LIMIT 5000",
                arrayOf(like, like, like)
            )
        }
        val result = ArrayList<NotiItem>()
        cursor.use {
            while (it.moveToNext()) {
                result.add(
                    NotiItem(
                        id = it.getLong(0),
                        source = it.getString(1),
                        pkg = it.getString(2),
                        appName = it.getString(3),
                        title = it.getString(4),
                        text = it.getString(5),
                        side = it.getString(6),
                        postTime = it.getLong(7)
                    )
                )
            }
        }
        return result
    }

    /** Rows with id greater than [afterId], oldest first. Pass -1 for everything (export). */
    fun querySince(afterId: Long): List<NotiItem> {
        val cursor = database.rawQuery(
            "SELECT id,source,pkg,appName,title,text,side,postTime FROM notifications " +
                "WHERE id > ? ORDER BY id ASC LIMIT 20000",
            arrayOf(afterId.toString())
        )
        val result = ArrayList<NotiItem>()
        cursor.use {
            while (it.moveToNext()) {
                result.add(
                    NotiItem(
                        id = it.getLong(0),
                        source = it.getString(1),
                        pkg = it.getString(2),
                        appName = it.getString(3),
                        title = it.getString(4),
                        text = it.getString(5),
                        side = it.getString(6),
                        postTime = it.getLong(7)
                    )
                )
            }
        }
        return result
    }

    /** Every message in one conversation (same pkg + title), newest first — for the thread detail view. */
    fun threadMessages(pkg: String, title: String): List<NotiItem> {
        val cursor = database.rawQuery(
            "SELECT id,source,pkg,appName,title,text,side,postTime FROM notifications " +
                "WHERE pkg = ? AND title = ? ORDER BY postTime DESC, id DESC LIMIT 2000",
            arrayOf(pkg, title)
        )
        val result = ArrayList<NotiItem>()
        cursor.use {
            while (it.moveToNext()) {
                result.add(
                    NotiItem(
                        id = it.getLong(0),
                        source = it.getString(1),
                        pkg = it.getString(2),
                        appName = it.getString(3),
                        title = it.getString(4),
                        text = it.getString(5),
                        side = it.getString(6),
                        postTime = it.getLong(7)
                    )
                )
            }
        }
        return result
    }

    /** Aggregate snapshot for the in-app dashboard. */
    data class Stats(
        val total: Long,
        val notiCount: Long,
        val screenCount: Long,
        val minTime: Long,
        val maxTime: Long,
        val topApps: List<Pair<String, Long>>,  // appName -> count, sorted desc, up to 8
        val hourlyLast24h: LongArray             // 24 buckets, oldest -> newest
    )

    fun getStats(): Stats {
        val db = database
        var total = 0L; var noti = 0L; var screen = 0L
        var minT = Long.MAX_VALUE; var maxT = Long.MIN_VALUE
        db.rawQuery(
            "SELECT COUNT(*), " +
                "SUM(CASE WHEN source='noti'   THEN 1 ELSE 0 END), " +
                "SUM(CASE WHEN source='screen' THEN 1 ELSE 0 END), " +
                "MIN(postTime), MAX(postTime) FROM notifications",
            null
        ).use {
            if (it.moveToNext()) {
                total  = it.getLong(0)
                noti   = it.getLong(1)
                screen = it.getLong(2)
                if (!it.isNull(3)) minT = it.getLong(3)
                if (!it.isNull(4)) maxT = it.getLong(4)
            }
        }

        val apps = ArrayList<Pair<String, Long>>()
        db.rawQuery(
            "SELECT appName, COUNT(*) c FROM notifications GROUP BY appName ORDER BY c DESC LIMIT 8",
            null
        ).use {
            while (it.moveToNext()) apps.add(it.getString(0) to it.getLong(1))
        }

        // Activity in the last 24h, bucketed by hour, oldest -> newest.
        val now = System.currentTimeMillis()
        val cutoff = now - 24L * 3600_000L
        val buckets = LongArray(24)
        db.rawQuery(
            "SELECT postTime FROM notifications WHERE postTime >= ?",
            arrayOf(cutoff.toString())
        ).use {
            while (it.moveToNext()) {
                val t = it.getLong(0)
                val idx = (((t - cutoff) / 3600_000L).toInt()).coerceIn(0, 23)
                buckets[idx]++
            }
        }
        return Stats(total, noti, screen, minT, maxT, apps, buckets)
    }

    /** Distinct (package, appName) seen so far — for the read-aloud app picker. */
    fun distinctApps(): List<Pair<String, String>> {
        val cursor = database.rawQuery(
            "SELECT pkg, appName FROM notifications GROUP BY pkg ORDER BY appName COLLATE NOCASE",
            null
        )
        val list = ArrayList<Pair<String, String>>()
        cursor.use {
            while (it.moveToNext()) list.add(it.getString(0) to it.getString(1))
        }
        return list
    }

    /** One conversation, grouped by (pkg, title) — title doubles as sender/contact/group name. */
    data class ThreadSummary(
        val pkg: String,
        val appName: String,
        val title: String,
        val lastText: String,
        val count: Long,
        val lastTime: Long
    )

    /** Conversations grouped by app + sender/title, newest first. No backend needed — local only. */
    fun listThreads(): List<ThreadSummary> {
        val cursor = database.rawQuery(
            """SELECT pkg, appName, title, text, c, lastTime FROM (
                 SELECT n.pkg pkg, n.appName appName, n.title title, n.text text, t.c c, t.lastTime lastTime
                 FROM notifications n
                 JOIN (
                   SELECT pkg, title, COUNT(*) c, MAX(postTime) lastTime
                   FROM notifications
                   WHERE title != ''
                   GROUP BY pkg, title
                 ) t ON n.pkg = t.pkg AND n.title = t.title AND n.postTime = t.lastTime
               )
               GROUP BY pkg, title
               ORDER BY lastTime DESC
               LIMIT 500""",
            null
        )
        val list = ArrayList<ThreadSummary>()
        cursor.use {
            while (it.moveToNext()) {
                list.add(
                    ThreadSummary(
                        pkg = it.getString(0),
                        appName = it.getString(1),
                        title = it.getString(2),
                        lastText = it.getString(3),
                        count = it.getLong(4),
                        lastTime = it.getLong(5)
                    )
                )
            }
        }
        return list
    }

    fun clear() {
        database.delete("notifications", null, null)
    }

    companion object {
        @Volatile
        private var instance: NotiStore? = null

        fun get(context: Context): NotiStore =
            instance ?: synchronized(this) {
                instance ?: run {
                    val appCtx = context.applicationContext
                    SQLiteDatabase.loadLibs(appCtx)
                    val passphrase = DbKey.getOrCreate(appCtx)
                    val store = try {
                        NotiStore(appCtx, passphrase).also { it.database.rawQuery("SELECT 1", null).close() }
                    } catch (_: Throwable) {
                        // Passphrase no longer matches the on-disk DB (e.g. after
                        // a Keystore key reset wiped the saved DB key). Drop the
                        // db so the user can keep using the app; the data on PC
                        // (data.jsonl) is the recovery path.
                        appCtx.getDatabasePath("noti.db").let { f ->
                            f.delete(); java.io.File(f.path + "-journal").delete()
                        }
                        NotiStore(appCtx, passphrase)
                    }
                    instance = store
                    store
                }
            }
    }
}
