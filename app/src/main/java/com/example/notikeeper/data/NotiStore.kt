package com.example.notikeeper.data

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteException
import com.example.notikeeper.BuildConfig
import net.sqlcipher.database.SQLiteDatabase
import net.sqlcipher.database.SQLiteOpenHelper
import java.io.File

/**
 * One captured row. `source` = "noti" (from notification) or "screen" (from
 * accessibility read).
 *
 * [timeExact], [capturedAt], and [extractionVersion] are the provenance this
 * row didn't used to carry (see the capture-to-archive integrity audit,
 * G-36/G-09/G-10): every consumer — search, export, upload, the MCP tools —
 * used to receive [postTime] as if it always meant "this message was sent at
 * this time," with no way to tell a real `sbn.postTime` apart from a screen
 * capture's wall-clock approximation. They're nullable/default-false only for
 * rows written before this column existed (backfilled where the answer is
 * actually knowable — see NotiStore's onUpgrade); every row inserted from now
 * on populates all three.
 */
data class NotiItem(
    val id: Long,
    val source: String,
    val pkg: String,
    val appName: String,
    val title: String,   // notification title OR conversation/contact name
    val text: String,    // message / line
    val side: String,    // "" | "me" | "them"  (screen capture only)
    val postTime: Long,
    /** True only when [postTime] is a genuinely observed time (a notification's
     *  real `sbn.postTime`) rather than the capture tick a screen row is stamped
     *  with — see the class doc above. */
    val timeExact: Boolean = false,
    /** Wall-clock time this row was captured/inserted — always accurate, unlike
     *  [postTime], which is only exact when [timeExact] is true. Null for rows
     *  written before this column existed. */
    val capturedAt: Long? = null,
    /** `BuildConfig.VERSION_CODE` at capture time — which build's extraction
     *  logic (chrome filters, side inference, sender parsing, ...) produced
     *  this row. Null for rows written before this column existed. */
    val extractionVersion: Int? = null
)

/** Column list + cursor mapping shared by every SELECT that builds [NotiItem]s, so
 *  the four near-identical query functions in [NotiStore] can't drift out of sync
 *  with each other (or with [NotiItem]'s fields) one column at a time. */
private const val ITEM_COLUMNS =
    "id,source,pkg,appName,title,text,side,postTime,timeExact,capturedAt,extractionVersion"

/**
 * Minimum blind-window length worth recording as a capture gap (see
 * [NotiStore.insertGap], G-28/G-29). Below this, an ordinary app restart or a
 * few-second rebind after boot would generate a gap row on every single
 * cold start — noise, not signal. Above it, something actually stopped
 * capture for a meaningful stretch: a permission revoked, an OEM battery
 * killer, a crash that took a while to recover from.
 */
private const val GAP_THRESHOLD_MS = 15L * 60_000L

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
 * Pulled out of [NotiStore.insertNoti] as a pure function so it's unit-testable
 * without a device (SQLiteOpenHelper/SQLCipher can't run in a local JVM test) —
 * see G-33 in the capture-to-archive integrity audit. Behavior is unchanged;
 * see insertNoti's own comment for why the bucket is 5 minutes, not exact time
 * or content alone.
 */
internal fun notiDedupKey(pkg: String, title: String, text: String, postTime: Long): String {
    val bucket = postTime / (5 * 60 * 1000)
    return "noti:$pkg:$title:$text:$bucket"
}

/** Same reasoning as [notiDedupKey] — extracted from [NotiStore.insertScreenBatch]. */
internal fun screenDedupKey(row: ScreenRow): String = "screen:${row.sender}:${row.side}:${row.text}"

/** Same reasoning as [notiDedupKey] — extracted from [NotiStore.insertGap]. */
internal fun gapDedupKey(service: String, gapStartMs: Long, gapEndMs: Long): String =
    "gap:$service:$gapStartMs:$gapEndMs"

/**
 * Builds an FTS5 MATCH expression from free user text — mirrors
 * relations.mjs's ftsQuery() on the server side exactly (same reasoning:
 * see its own doc comment). Returns null for text the trigram tokenizer
 * can't usefully match (under 3 characters — trigram indexes 3-char
 * substrings). Splits on whitespace and ORs the >=3-char chunks as quoted
 * phrases; continuous-script text with no spaces (Thai and friends have
 * none) falls back to matching the whole string as one phrase.
 */
internal fun ftsMatchExpr(search: String): String? {
    val t = search.trim()
    if (t.length < 3) return null
    fun phrase(w: String) = "\"" + w.replace("\"", "\"\"") + "\""
    val parts = t.split(Regex("\\s+")).filter { it.length >= 3 }
    val terms = (parts.ifEmpty { listOf(t) }).map { phrase(it) }
    return terms.joinToString(" OR ")
}

/**
 * Builds the SQL + bind args for [NotiStore.query] — pulled out as a pure
 * function (no SQLiteDatabase involved) so the keyset-pagination logic (see
 * G-18) is unit-testable without a device, same reasoning as the dedupKey
 * builders above. `$ITEM_COLUMNS`/`NotiStore.QUERY_LIMIT` are interpolated
 * directly (never user input), only `search`/`before` ever become bind args.
 *
 * [hasFts] gates the FTS5 path entirely — false (the default) reproduces
 * the exact plain-LIKE query this function always built, byte for byte.
 * When true and [search] is long enough to produce a real FTS5 match
 * expression, the query narrows through `notifications_fts` first (a real
 * index) instead of scanning every row with LIKE. A short search (under 3
 * chars) still falls back to LIKE even with FTS available — trigram can't
 * usefully match that little text anyway, and LIKE handles it correctly.
 */
internal fun buildQuerySql(search: String, before: Pair<Long, Long>?, hasFts: Boolean = false): Pair<String, Array<String>> {
    val cursorClause = if (before != null) "(postTime < ? OR (postTime = ? AND id < ?))" else null
    val cursorArgs: (List<String>) -> List<String> = { base ->
        if (before != null) base + listOf(before.first.toString(), before.first.toString(), before.second.toString())
        else base
    }
    val ftsExpr = if (hasFts) ftsMatchExpr(search) else null
    return when {
        search.isBlank() -> {
            val where = cursorClause?.let { "WHERE $it" } ?: ""
            "SELECT $ITEM_COLUMNS FROM notifications $where " +
                "ORDER BY postTime DESC, id DESC LIMIT ${NotiStore.QUERY_LIMIT}" to cursorArgs(emptyList()).toTypedArray()
        }
        ftsExpr != null -> {
            val extra = cursorClause?.let { " AND $it" } ?: ""
            "SELECT $ITEM_COLUMNS FROM notifications " +
                "WHERE id IN (SELECT rowid FROM notifications_fts WHERE notifications_fts MATCH ?)$extra " +
                "ORDER BY postTime DESC, id DESC LIMIT ${NotiStore.QUERY_LIMIT}" to cursorArgs(listOf(ftsExpr)).toTypedArray()
        }
        else -> {
            val like = "%$search%"
            val extra = cursorClause?.let { " AND $it" } ?: ""
            "SELECT $ITEM_COLUMNS FROM notifications " +
                "WHERE (appName LIKE ? OR title LIKE ? OR text LIKE ?)$extra " +
                "ORDER BY postTime DESC, id DESC LIMIT ${NotiStore.QUERY_LIMIT}" to cursorArgs(listOf(like, like, like)).toTypedArray()
        }
    }
}

/**
 * Encrypted SQLite store (SQLCipher / AES-256). The whole `noti.db` file is
 * unreadable without the passphrase from [DbKey]. Otherwise behaves like the
 * plain version: singleton, idempotent inserts via a UNIQUE dedupKey.
 */
class NotiStore private constructor(
    context: Context,
    private val passphrase: String
) : SQLiteOpenHelper(context.applicationContext, "noti.db", null, 4) {

    // SQLiteOpenHelper doesn't expose the context it was built with, and
    // onUpgrade/backupBeforeMigration need one — retained explicitly rather
    // than relying on a base-class internal that isn't part of its public API.
    private val appContext: Context = context.applicationContext

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
                 dedupKey TEXT,
                 timeExact INTEGER NOT NULL DEFAULT 0,
                 capturedAt INTEGER,
                 extractionVersion INTEGER
               )"""
        )
        db.execSQL("CREATE UNIQUE INDEX idx_dedup ON notifications(dedupKey)")
        db.execSQL("CREATE INDEX idx_time ON notifications(postTime)")
        setupFts(db)
    }

    /**
     * G-18 in the capture-to-archive integrity audit: search was an
     * unindexed `LIKE '%q%'` scan — Wave 6/14 added debounce and real
     * pagination, but the scan itself was never indexed. FTS5's trigram
     * tokenizer is what relations.mjs already uses server-side for the same
     * Thai/CJK-no-word-spaces reason (see its own doc comment).
     *
     * This is wrapped in a try/catch and never allowed to propagate: whether
     * this exact SQLCipher-for-Android build (net.zetetic:
     * android-database-sqlcipher:4.5.4) actually has FTS5 compiled in could
     * not be confirmed with certainty without a device to test against —
     * research turned up conflicting signals (the build's own makefile is
     * supposed to enable it, but a documented upstream issue shows "no such
     * module: fts5" occurring in practice on this exact library despite
     * that flag). Rather than gate the fix on certainty this session has no
     * way to obtain, or risk every install failing to open its database on
     * upgrade if the assumption is wrong, this fails soft: if FTS5 truly
     * isn't available, this throws, gets caught, and [query] simply never
     * finds [hasFts] true — search stays on the exact LIKE scan it's always
     * used, functionally unchanged, not broken.
     */
    private fun setupFts(db: SQLiteDatabase) {
        runCatching {
            db.execSQL(
                """CREATE VIRTUAL TABLE IF NOT EXISTS notifications_fts USING fts5(
                     text, title, appName,
                     content='notifications',
                     content_rowid='id',
                     tokenize='trigram'
                   )"""
            )
            db.execSQL(
                """CREATE TRIGGER IF NOT EXISTS notifications_fts_ai AFTER INSERT ON notifications BEGIN
                     INSERT INTO notifications_fts(rowid, text, title, appName)
                       VALUES (new.id, new.text, new.title, new.appName);
                   END"""
            )
            db.execSQL(
                """CREATE TRIGGER IF NOT EXISTS notifications_fts_ad AFTER DELETE ON notifications BEGIN
                     INSERT INTO notifications_fts(notifications_fts, rowid, text, title, appName)
                       VALUES('delete', old.id, old.text, old.title, old.appName);
                   END"""
            )
            db.execSQL(
                """CREATE TRIGGER IF NOT EXISTS notifications_fts_au AFTER UPDATE ON notifications BEGIN
                     INSERT INTO notifications_fts(notifications_fts, rowid, text, title, appName)
                       VALUES('delete', old.id, old.text, old.title, old.appName);
                     INSERT INTO notifications_fts(rowid, text, title, appName)
                       VALUES (new.id, new.text, new.title, new.appName);
                   END"""
            )
            // Backfill for rows that existed before the index did (onUpgrade's
            // v3->v4 path; a no-op harmless extra call from onCreate, where
            // there's nothing to backfill yet).
            db.execSQL("INSERT INTO notifications_fts(notifications_fts) VALUES('rebuild')")
        }.onFailure {
            android.util.Log.w("NotiStore", "FTS5 unavailable on this build — search stays on the LIKE scan", it)
        }
    }

    // The phone is becoming a capture buffer whose rows must survive schema
    // bumps (see docs/ARCHITECTURE_CHANGE_REQUEST.md) — the PC is only ever
    // caught up via uploads it acknowledged, so dropping the table here would
    // silently destroy un-acked data. Future migrations must stay additive
    // (ALTER TABLE / CREATE INDEX IF NOT EXISTS), never a DROP — and every
    // branch here must leave the schema identical to what onCreate produces
    // on a fresh install, since nothing else enforces that the two stay
    // in sync (see G-26 in the capture-to-archive integrity audit: there is
    // still no real migration framework, just this method and discipline).
    //
    // version 2 -> 3 is the app's first real migration (see G-36/G-09/G-10):
    // adds timeExact/capturedAt/extractionVersion, purely additive columns —
    // ALTER TABLE ADD COLUMN never touches existing rows' other data, and a
    // failure partway through (columns added, backfill not yet run) still
    // leaves a queryable database, just with timeExact defaulted to 0 for
    // some noti rows that are actually exact — wrong but not corrupt, and the
    // backfill is idempotent (safe to have run zero or one times either way).
    //
    // Backed up first: this is the first ALTER TABLE this app has ever run
    // against a real installed database, and it cannot be device-tested in
    // the environment that wrote it (no emulator/device attached — see the
    // commit this shipped in). If anything here is wrong, the owner has an
    // exact byte-for-byte copy of their pre-migration archive to fall back to.
    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        if (oldVersion < 3) {
            backupBeforeMigration(oldVersion)
            // Explicit transaction (not just discipline about additive-only DDL,
            // see the comment above this method) so a failure partway through —
            // the ALTER TABLEs ran, the backfill UPDATE didn't, or vice versa —
            // rolls back to the exact pre-migration schema instead of leaving the
            // database in a half-migrated state onOpen has never seen before. See
            // G-26 in the capture-to-archive integrity audit.
            db.beginTransaction()
            try {
                db.execSQL("ALTER TABLE notifications ADD COLUMN timeExact INTEGER NOT NULL DEFAULT 0")
                db.execSQL("ALTER TABLE notifications ADD COLUMN capturedAt INTEGER")
                db.execSQL("ALTER TABLE notifications ADD COLUMN extractionVersion INTEGER")
                // The one thing we can actually determine for rows that already exist:
                // insertNoti has always stored a genuine sbn.postTime, so every existing
                // noti row's postTime IS exact. Screen rows never had a real observed
                // time at all (MessengerReaderService has no on-screen timestamp
                // parsing), so 0 — the column default — is already the honest answer
                // for them; nothing to backfill there.
                db.execSQL("UPDATE notifications SET timeExact = 1 WHERE source = 'noti'")
                db.setTransactionSuccessful()
            } finally {
                db.endTransaction()
            }
        }
        // version 3 -> 4: FTS5 search index (see G-18 / setupFts's own doc
        // comment for why this is entirely best-effort and never blocks the
        // upgrade). Deliberately NOT inside the v2->v3 transaction above —
        // setupFts already guards its own failure internally, and an FTS5
        // problem must never roll back the columns/backfill that DID
        // succeed for a device upgrading straight from v2.
        if (oldVersion < 4) {
            setupFts(db)
        }
    }

    /**
     * The framework default already throws SQLiteException on a downgrade
     * (installing an older app version over a newer database), which
     * [get]'s catch below already handles safely — the unreadable file gets
     * quarantined by rename, never deleted, and the app starts fresh. This
     * override exists only to give that catch a message it can tell apart
     * from an actual passphrase mismatch: the catch's notice was written for
     * "the Keystore key doesn't match", and a downgrade is a completely
     * different situation the owner would investigate differently — see G-26.
     */
    override fun onDowngrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        throw SQLiteException(
            "DOWNGRADE: installed app (schema v$newVersion) is older than the database (schema v$oldVersion)"
        )
    }

    /**
     * Copies noti.db (+ -journal/-wal/-shm, whichever exist) to a
     * `.pre-migration-vN-<timestamp>` sibling before onUpgrade touches
     * anything. Best-effort: a failure here logs and lets the migration
     * proceed rather than blocking the app from opening over a backup it
     * couldn't take — but it's tried, because this exact migration is the
     * one part of this release that couldn't be verified against a real
     * device before shipping.
     */
    private fun backupBeforeMigration(oldVersion: Int) {
        runCatching {
            val dbFile = appContext.getDatabasePath("noti.db")
            val backupBase = "${dbFile.path}.pre-migration-v$oldVersion-${System.currentTimeMillis()}"
            for (suffix in listOf("", "-journal", "-wal", "-shm")) {
                val src = File(dbFile.path + suffix)
                if (src.exists()) src.copyTo(File(backupBase + suffix), overwrite = true)
            }
        }.onFailure {
            android.util.Log.w("NotiStore", "pre-migration backup failed, proceeding anyway", it)
        }
    }

    /**
     * Insert one captured notification (background, app-wide).
     *
     * Returns true if this row was actually new (survived the dedupKey conflict
     * check), false if it was ignored as a duplicate. Callers that fan a single
     * notification out into several rows — see NotiLoggerService's MessagingStyle
     * extraction (G-37) — need this to tell a genuinely new message apart from a
     * historical one MessagingStyle re-hands them on every update, without
     * re-triggering things like read-aloud for messages already spoken.
     */
    fun insertNoti(pkg: String, appName: String, title: String, text: String, postTime: Long): Boolean {
        val values = ContentValues().apply {
            put("source", "noti")
            put("pkg", pkg)
            put("appName", appName)
            put("title", title)
            put("text", text)
            put("side", "")
            put("postTime", postTime)
            // postTime here IS a genuine sbn.postTime handed to us by the OS — the
            // one case in this whole pipeline where "postTime" already means what
            // it says. See NotiItem's doc comment.
            put("timeExact", 1)
            put("capturedAt", System.currentTimeMillis())
            put("extractionVersion", BuildConfig.VERSION_CODE)
            // Dedup on content plus a COARSE time bucket, not exact time and not
            // content alone. Content-only (no time at all) was tried — it collapses
            // a spam channel's identical repost, but it ALSO collapses a genuine
            // repeated reply ("ครับ") sent minutes or days apart into a single row,
            // permanently, with no record anywhere that it happened twice; unlike
            // every later stage in the pipeline, this one runs before anything else
            // ever sees the row, so there is nothing downstream that could recover
            // it. 5 minutes (the same "same real-world event" granularity
            // graph-index.mjs's buildTurns already uses on the PC side) still
            // collapses true instant re-delivery — the same notification reposted
            // twice in one burst — without erasing a repeat sent apart in time.
            // Promo-channel spam that reposts on a slower cadence than that is the
            // PC server's job now: dedupCleanup() there is restricted to rows the
            // noise classifier already flags as not a meaningful message, so it can
            // collapse a real spam blast across its whole history without this key
            // having to do that job by discarding real content on the phone.
            put("dedupKey", notiDedupKey(pkg, title, text, postTime))
        }
        val rowId = database.insertWithOnConflict(
            "notifications", null, values, SQLiteDatabase.CONFLICT_IGNORE
        )
        return rowId != -1L
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
                    // timeExact is 0/false here deliberately: r.postTime is the
                    // capture-tick wall clock (see MessengerReaderService — there is
                    // no on-screen timestamp parsing on-device), not an observed send
                    // time, and it's also the honest value for capturedAt since the
                    // two are the same wall-clock moment for this source.
                    put("capturedAt", r.postTime)
                    put("extractionVersion", BuildConfig.VERSION_CODE)
                    put("dedupKey", screenDedupKey(r))
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

    /**
     * Called by a capture service whenever it (re)connects — [lastHeartbeat] is
     * the timestamp it last confirmed a successful capture (0 if never). If the
     * gap since then is long enough to count as real (not just an ordinary
     * restart's few-second rebind — see [GAP_THRESHOLD_MS]), records it as a
     * row so a blind window becomes a visible fact in the archive instead of
     * indistinguishable silence — see G-28/G-29 in the capture-to-archive
     * integrity audit. Returns "now", which the caller should persist as the
     * new heartbeat baseline regardless of whether a gap was recorded.
     */
    fun recordGapIfAny(service: String, lastHeartbeat: Long): Long {
        val now = System.currentTimeMillis()
        // lastHeartbeat == 0 means "never recorded one yet" (fresh install, or a
        // service that has literally never captured anything) — not a real gap
        // since epoch, so nothing to report.
        if (lastHeartbeat > 0 && now - lastHeartbeat >= GAP_THRESHOLD_MS) {
            insertGap(service, lastHeartbeat, now)
        }
        return now
    }

    /**
     * A real row, source="gap", so it flows through search/export/upload
     * exactly like any other row with zero extra plumbing. The server side
     * (relations.mjs) excludes source="gap" rows from the relational/graph
     * ETL the same way it already excludes known system-app noise — a gap
     * marker isn't a conversation and shouldn't pollute thread views — while
     * staying durably recorded in the raw archive (data.jsonl) either way.
     */
    private fun insertGap(service: String, gapStartMs: Long, gapEndMs: Long) {
        val fmt = java.text.SimpleDateFormat("dd/MM/yy HH:mm", java.util.Locale.getDefault())
        val durationMin = (gapEndMs - gapStartMs) / 60_000
        val values = ContentValues().apply {
            put("source", "gap")
            put("pkg", "notikeeper.internal.gap")
            put("appName", "NotiKeeper")
            put("title", "Capture gap: $service")
            put(
                "text",
                "$service capture was not confirmed running from " +
                    "${fmt.format(java.util.Date(gapStartMs))} to " +
                    "${fmt.format(java.util.Date(gapEndMs))} (~${durationMin}m)"
            )
            put("side", "")
            put("postTime", gapEndMs)
            // gapEndMs is exactly when reconnection was detected — genuinely exact,
            // unlike a screen row's capture-tick approximation.
            put("timeExact", 1)
            put("capturedAt", gapEndMs)
            put("extractionVersion", BuildConfig.VERSION_CODE)
            put("dedupKey", gapDedupKey(service, gapStartMs, gapEndMs))
        }
        database.insertWithOnConflict("notifications", null, values, SQLiteDatabase.CONFLICT_IGNORE)
    }

    private fun cursorToNotiItem(c: android.database.Cursor): NotiItem = NotiItem(
        id = c.getLong(0),
        source = c.getString(1),
        pkg = c.getString(2),
        appName = c.getString(3),
        title = c.getString(4),
        text = c.getString(5),
        side = c.getString(6),
        postTime = c.getLong(7),
        timeExact = c.getInt(8) != 0,
        capturedAt = if (c.isNull(9)) null else c.getLong(9),
        extractionVersion = if (c.isNull(10)) null else c.getInt(10)
    )

    /**
     * Empty search = newest first. Otherwise match app/contact name, sender, or
     * message. Capped at [QUERY_LIMIT] per call — see the constant's own doc
     * comment for why the caller needs to know that number, not just this
     * function.
     *
     * [before], when given, is a (postTime, id) cursor from the last row of a
     * previous page — the same tie-break the ORDER BY already uses, so paging
     * through can't skip or repeat a row even when several share a postTime
     * (screen rows especially, all stamped with the same capture-tick wall
     * clock). Real pagination, not just a bigger single page: G-18 in the
     * capture-to-archive integrity audit flagged "no pagination" as a
     * separate problem from the unindexed LIKE scan itself, and one that
     * doesn't need a schema change to fix — this is the additive half of
     * that finding. The FTS5 index (see [hasFts]/setupFts) is the other
     * half: gated behind a runtime check rather than assumed, since this
     * exact SQLCipher build's FTS5 support couldn't be confirmed without a
     * device (see setupFts's doc comment) — a short or FTS-unavailable
     * search transparently falls back to the same LIKE scan this always
     * did, so there's no behavior this can regress, only a speedup it may
     * or may not actually get depending on the build it's running on.
     */
    fun query(search: String, before: Pair<Long, Long>? = null): List<NotiItem> {
        val (sql, args) = buildQuerySql(search, before, hasFts)
        val cursor = try {
            database.rawQuery(sql, args)
        } catch (e: SQLiteException) {
            // Belt and suspenders beyond hasFts itself: the FTS5 table existing
            // (what hasFts checks) doesn't guarantee every MATCH query against
            // it succeeds on every build. Fall back to the plain LIKE query
            // for this one call rather than the search breaking outright.
            android.util.Log.w("NotiStore", "FTS query failed, falling back to LIKE", e)
            val (fallbackSql, fallbackArgs) = buildQuerySql(search, before, hasFts = false)
            database.rawQuery(fallbackSql, fallbackArgs)
        }
        val result = ArrayList<NotiItem>()
        cursor.use {
            while (it.moveToNext()) result.add(cursorToNotiItem(it))
        }
        return result
    }

    /** Whether this database actually has the FTS5 search index — checked once
     *  per [NotiStore] instance (a fresh check on every query would defeat
     *  the point of avoiding a scan). See setupFts's doc comment for why
     *  this can legitimately be false even on a fully migrated database. */
    private val hasFts: Boolean by lazy {
        runCatching {
            database.rawQuery(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='notifications_fts'", null
            ).use { it.moveToFirst() }
        }.getOrDefault(false)
    }

    /**
     * Phase 2 of docs/ARCHITECTURE_CHANGE_REQUEST.md: deletes rows the PC has
     * durably acked (id <= [throughId]) AND that are older than
     * [retentionFloorMs] — the retention floor is kept regardless of ack
     * status, so a recent row is never pruned even seconds after the PC
     * confirms it, giving a safety margin against ack/prune bugs. Never
     * deletes anything the PC hasn't confirmed receiving. Returns the number
     * of rows deleted.
     */
    fun pruneAcked(throughId: Long, retentionFloorMs: Long): Int {
        if (throughId <= 0) return 0
        val cutoff = System.currentTimeMillis() - retentionFloorMs
        return database.delete(
            "notifications",
            "id <= ? AND postTime < ?",
            arrayOf(throughId.toString(), cutoff.toString())
        )
    }

    /**
     * Rows with id greater than [afterId], oldest first, capped at 20000.
     *
     * That cap is deliberate and fine for its real caller — upload, which bounds
     * each HTTP POST body (see /ingest's own 50MB limit) and naturally continues
     * from wherever the high-water mark left off on the next call. It is NOT
     * fine for export, which must produce the whole archive or say clearly what
     * it left out — [allRows] below is the uncapped, streaming path for that.
     */
    fun querySince(afterId: Long): List<NotiItem> {
        val cursor = database.rawQuery(
            "SELECT $ITEM_COLUMNS FROM notifications " +
                "WHERE id > ? ORDER BY id ASC LIMIT 20000",
            arrayOf(afterId.toString())
        )
        val result = ArrayList<NotiItem>()
        cursor.use {
            while (it.moveToNext()) result.add(cursorToNotiItem(it))
        }
        return result
    }

    /**
     * Every row, oldest id first, as a lazy sequence backed directly by a DB
     * cursor — no cap, and the full result is never materialized as a List the
     * way querySince's is. Exporter drives this straight into a file/stream
     * writer so a large archive never has to fit in memory either as rows or
     * as the serialized JSON/CSV built from them.
     *
     * The cursor is opened when the sequence starts being consumed and closed
     * (via [android.database.Cursor.use]) once it's exhausted OR if the
     * consumer stops early / throws — standard behavior for a `sequence {}`
     * builder wrapping a `use` block, since cancelling the underlying
     * coroutine still runs the `finally` inside it. Must be consumed
     * synchronously and to completion by its caller in one linear walk (which
     * every writer in Exporter.kt does) — do not store this sequence or
     * iterate it across suspension points.
     */
    fun allRows(): Sequence<NotiItem> = sequence {
        database.rawQuery(
            "SELECT $ITEM_COLUMNS FROM notifications ORDER BY id ASC",
            null
        ).use { cursor ->
            while (cursor.moveToNext()) yield(cursorToNotiItem(cursor))
        }
    }

    /** Every message in one conversation (same pkg + title), newest first — for the thread detail view. */
    fun threadMessages(pkg: String, title: String): List<NotiItem> {
        val cursor = database.rawQuery(
            "SELECT $ITEM_COLUMNS FROM notifications " +
                "WHERE pkg = ? AND title = ? ORDER BY postTime DESC, id DESC LIMIT 2000",
            arrayOf(pkg, title)
        )
        val result = ArrayList<NotiItem>()
        cursor.use {
            while (it.moveToNext()) result.add(cursorToNotiItem(it))
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

    /** Total rows stored. Used to show the real count in the "clear everything" confirmation. */
    fun count(): Long =
        database.rawQuery("SELECT COUNT(*) FROM notifications", null).use {
            if (it.moveToNext()) it.getLong(0) else 0L
        }

    fun clear() {
        database.delete("notifications", null, null)
    }

    companion object {
        /**
         * The row cap on [query] (and the newest-first-with-no-search case).
         * Public so a caller can tell when a result set was actually truncated
         * (`items.size == QUERY_LIMIT`) rather than showing "unlimited search"
         * when it silently isn't — see G-18 in the capture-to-archive
         * integrity audit. Not exact: a search that happens to match exactly
         * this many rows, no more, reads identically to one that was capped.
         * That's a deliberate trade — a rare false "might be more" notice is a
         * far safer failure than the alternative, which was never saying
         * anything at all.
         */
        const val QUERY_LIMIT = 5000

        @Volatile
        private var instance: NotiStore? = null

        /**
         * Set once, at most, per process — by [get] below, if opening the
         * existing database ever fails. Null the rest of the time. A UI screen
         * reads this after calling [get] and should show it once, then call
         * [clearRecoveryNotice] so it doesn't reappear on the next resume.
         */
        @Volatile
        var lastRecoveryNotice: String? = null
            private set

        fun clearRecoveryNotice() { lastRecoveryNotice = null }

        fun get(context: Context): NotiStore =
            instance ?: synchronized(this) {
                instance ?: run {
                    val appCtx = context.applicationContext
                    SQLiteDatabase.loadLibs(appCtx)
                    val passphrase = DbKey.getOrCreate(appCtx)
                    val store = try {
                        NotiStore(appCtx, passphrase).also { it.database.rawQuery("SELECT 1", null).close() }
                    } catch (e: SQLiteException) {
                        // The on-disk DB doesn't open with the current passphrase —
                        // almost always a Keystore key loss/reset (SecureStore's
                        // isolated db_pass store failing to decrypt, or a factory
                        // reset / restore mismatch; see SECURITY.md). Narrowed from
                        // catching every Throwable: a transient I/O error, a full
                        // disk, or an OOM during this probe query is NOT "the
                        // passphrase is wrong" and must not trigger what follows.
                        //
                        // Move the unreadable file aside — never delete it. It may
                        // still hold years of archive; someone with the old
                        // Keystore key (a restored backup, a reinstalled matching
                        // key alias) could still recover it later, and even
                        // without that, deleting silently is strictly worse than
                        // deleting-with-a-name-you-can-find. The app still starts
                        // usable, on a fresh empty database with the current key.
                        val dbFile = appCtx.getDatabasePath("noti.db")
                        val quarantineBase = "${dbFile.path}.unreadable-${System.currentTimeMillis()}"
                        for (suffix in listOf("", "-journal", "-wal", "-shm")) {
                            val src = File(dbFile.path + suffix)
                            if (src.exists()) src.renameTo(File(quarantineBase + suffix))
                        }
                        // onDowngrade (above) throws a recognizably-tagged SQLiteException
                        // for exactly this branch, so a stale-app-version cause doesn't get
                        // misreported as a Keystore key problem — see G-26.
                        lastRecoveryNotice = if (e.message?.startsWith("DOWNGRADE:") == true)
                            "แอปรุ่นนี้เก่ากว่าฐานข้อมูลเดิม (ติดตั้งแอปรุ่นเก่าทับรุ่นใหม่กว่า) — " +
                                "เริ่มฐานข้อมูลใหม่แล้ว ไฟล์เดิมสำรองไว้ที่ ${File(quarantineBase).name}"
                        else
                            "เปิดฐานข้อมูลเดิมไม่ได้ (กุญแจไม่ตรง) — " +
                                "เริ่มฐานข้อมูลใหม่แล้ว ไฟล์เดิมสำรองไว้ที่ ${File(quarantineBase).name}"
                        NotiStore(appCtx, passphrase)
                    }
                    instance = store
                    store
                }
            }
    }
}
