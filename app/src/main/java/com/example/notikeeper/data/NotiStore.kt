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

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        db.execSQL("DROP TABLE IF EXISTS notifications")
        onCreate(db)
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
            put("dedupKey", "noti:$title:$text:$postTime")
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
                    NotiStore(appCtx, DbKey.getOrCreate(appCtx)).also { instance = it }
                }
            }
    }
}
