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
}
