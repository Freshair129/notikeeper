package com.example.notikeeper.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Pins down buildQuerySql's SQL/args assembly — the keyset-pagination half
 * of G-18 in the capture-to-archive integrity audit ("no pagination"). A
 * mistake here (wrong bind-arg order, a missing tie-break) would either
 * throw at query time or silently skip/repeat rows across pages — neither
 * of which a JUnit test running against a real SQLiteDatabase would catch
 * any more reliably than this pure check does, and this runs without a
 * device.
 */
class NotiStoreQueryPagingTest {

    @Test
    fun `no search, no cursor -- first page, no WHERE clause`() {
        val (sql, args) = buildQuerySql("", before = null)
        assertFalse("first page must not filter on a cursor that doesn't exist yet", sql.contains("WHERE"))
        assertTrue(sql.contains("ORDER BY postTime DESC, id DESC"))
        assertEquals(0, args.size)
    }

    @Test
    fun `no search, with cursor -- WHERE is the keyset clause alone`() {
        val (sql, args) = buildQuerySql("", before = Pair(1_700_000_000_000L, 42L))
        assertTrue(sql.contains("WHERE (postTime < ? OR (postTime = ? AND id < ?))"))
        // Bind order must match placeholder order exactly: postTime, postTime, id.
        assertEquals(listOf("1700000000000", "1700000000000", "42"), args.toList())
    }

    @Test
    fun `search, no cursor -- WHERE is the three-field LIKE alone, unchanged from before pagination existed`() {
        val (sql, args) = buildQuerySql("hello", before = null)
        assertTrue(sql.contains("WHERE (appName LIKE ? OR title LIKE ? OR text LIKE ?)"))
        assertFalse("must not append a dangling AND with nothing after it", sql.contains("AND ("))
        assertEquals(listOf("%hello%", "%hello%", "%hello%"), args.toList())
    }

    @Test
    fun `search, with cursor -- LIKE clause and keyset clause are ANDed, args in matching order`() {
        val (sql, args) = buildQuerySql("hello", before = Pair(1_700_000_000_000L, 42L))
        assertTrue(sql.contains("WHERE (appName LIKE ? OR title LIKE ? OR text LIKE ?) AND (postTime < ? OR (postTime = ? AND id < ?))"))
        assertEquals(
            listOf("%hello%", "%hello%", "%hello%", "1700000000000", "1700000000000", "42"),
            args.toList()
        )
    }

    @Test
    fun `blank (whitespace-only) search is treated the same as empty search`() {
        val (blankSql, blankArgs) = buildQuerySql("   ", before = null)
        val (emptySql, emptyArgs) = buildQuerySql("", before = null)
        assertEquals(emptySql, blankSql)
        assertEquals(emptyArgs.toList(), blankArgs.toList())
    }

    @Test
    fun `LIMIT is always present and matches QUERY_LIMIT`() {
        val (sql, _) = buildQuerySql("anything", before = Pair(1L, 2L))
        assertTrue(sql.contains("LIMIT ${NotiStore.QUERY_LIMIT}"))
    }

    // ---------- hasFts = false (default) must never change — G-18's FTS index ----------

    @Test
    fun `hasFts defaults to false -- omitting it reproduces the exact plain-LIKE query`() {
        val withDefault = buildQuerySql("hello", before = Pair(1L, 2L))
        val withExplicitFalse = buildQuerySql("hello", before = Pair(1L, 2L), hasFts = false)
        assertEquals(withExplicitFalse.first, withDefault.first)
        assertEquals(withExplicitFalse.second.toList(), withDefault.second.toList())
        assertTrue("must still be the LIKE query, not FTS", withDefault.first.contains("LIKE ?"))
    }

    // ---------- hasFts = true ----------

    @Test
    fun `hasFts true, search long enough -- queries through notifications_fts, not LIKE`() {
        val (sql, args) = buildQuerySql("hello", before = null, hasFts = true)
        assertTrue(sql.contains("WHERE id IN (SELECT rowid FROM notifications_fts WHERE notifications_fts MATCH ?)"))
        assertFalse("must not also carry the LIKE clause", sql.contains("LIKE"))
        assertEquals(listOf("\"hello\""), args.toList())
    }

    @Test
    fun `hasFts true, search under 3 chars -- falls back to LIKE, trigram can't match that little text`() {
        val (sql, args) = buildQuerySql("hi", before = null, hasFts = true)
        assertTrue(sql.contains("WHERE (appName LIKE ? OR title LIKE ? OR text LIKE ?)"))
        assertEquals(listOf("%hi%", "%hi%", "%hi%"), args.toList())
    }

    @Test
    fun `hasFts true, blank search -- no WHERE at all, same as hasFts false`() {
        val (sql, args) = buildQuerySql("", before = null, hasFts = true)
        assertFalse(sql.contains("WHERE"))
        assertEquals(0, args.size)
    }

    @Test
    fun `hasFts true with a cursor -- FTS clause and keyset clause are ANDed, args in matching order`() {
        val (sql, args) = buildQuerySql("hello", before = Pair(1_700_000_000_000L, 42L), hasFts = true)
        assertTrue(sql.contains(
            "WHERE id IN (SELECT rowid FROM notifications_fts WHERE notifications_fts MATCH ?) " +
                "AND (postTime < ? OR (postTime = ? AND id < ?))"
        ))
        assertEquals(listOf("\"hello\"", "1700000000000", "1700000000000", "42"), args.toList())
    }

    @Test
    fun `hasFts true, multi-word search -- each 3+ char word becomes its own quoted OR'd phrase`() {
        val (_, args) = buildQuerySql("the dinner party", before = null, hasFts = true)
        // "the" is under 3 chars once trimmed? no -- "the" is 3 chars, kept. All three qualify.
        assertEquals(listOf("\"the\" OR \"dinner\" OR \"party\""), args.toList())
    }

    @Test
    fun `hasFts true, short words filtered but long ones kept`() {
        val (_, args) = buildQuerySql("is it dinner", before = null, hasFts = true)
        // "is" (2 chars) and "it" (2 chars) dropped; "dinner" (6 chars) kept.
        assertEquals(listOf("\"dinner\""), args.toList())
    }
}
