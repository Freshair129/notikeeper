package com.example.notikeeper.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Pins down ftsMatchExpr — the FTS5 MATCH expression builder behind G-18's
 * search index. Deliberately mirrors relations.mjs's ftsQuery() on the
 * server side (same reasoning documented there); these tests exist so the
 * two can't silently drift apart, and so a malformed expression (unescaped
 * quote, empty OR clause) is caught here rather than as a runtime FTS5
 * syntax error this session has no device to reproduce.
 */
class FtsMatchExprTest {

    @Test
    fun `text under 3 characters returns null -- trigram can't usefully match it`() {
        assertNull(ftsMatchExpr(""))
        assertNull(ftsMatchExpr("a"))
        assertNull(ftsMatchExpr("hi"))
        assertNull(ftsMatchExpr("  "))
    }

    @Test
    fun `exactly 3 characters is the boundary -- kept, not dropped`() {
        assertEquals("\"hey\"", ftsMatchExpr("hey"))
    }

    @Test
    fun `a single word is wrapped in quotes as one phrase`() {
        assertEquals("\"dinner\"", ftsMatchExpr("dinner"))
    }

    @Test
    fun `multiple words become quoted phrases OR'd together`() {
        assertEquals("\"the\" OR \"dinner\" OR \"party\"", ftsMatchExpr("the dinner party"))
    }

    @Test
    fun `words under 3 characters are dropped, longer ones kept`() {
        assertEquals("\"dinner\" OR \"party\"", ftsMatchExpr("is it a dinner party"))
    }

    @Test
    fun `if every word is too short, falls back to matching the whole trimmed string as one phrase`() {
        // Every individual word is under 3 chars, but the whole string (with
        // spaces) is long enough overall -- matches relations.mjs's ftsQuery
        // behavior: `parts.length ? parts : [t]`.
        assertEquals("\"a b\"", ftsMatchExpr("a b"))
    }

    @Test
    fun `continuous script with no spaces -- e_g_ Thai -- matches as one whole phrase`() {
        // Thai has no inter-word spaces, so splitting on whitespace yields
        // one "word" that IS the whole string -- same effective behavior as
        // the whole-string fallback above, just via the normal word-split
        // path since there's nothing to split on.
        assertEquals("\"ทานข้าวหรือยัง\"", ftsMatchExpr("ทานข้าวหรือยัง"))
    }

    @Test
    fun `a literal double-quote in the search text is escaped, not left to break the FTS5 expression`() {
        // Splits on whitespace first (same as any multi-word search), so the
        // quoted word becomes its own escaped phrase rather than the whole
        // string staying together: say / "hi" / now -> three OR'd phrases,
        // with the middle one's embedded quotes doubled per FTS5 escaping.
        assertEquals("\"say\" OR \"\"\"hi\"\"\" OR \"now\"", ftsMatchExpr("""say "hi" now"""))
    }

    @Test
    fun `leading and trailing whitespace is trimmed before length and splitting decisions`() {
        assertEquals("\"dinner\"", ftsMatchExpr("  dinner  "))
    }

    @Test
    fun `multiple internal spaces between words don't produce empty phrases`() {
        assertEquals("\"dinner\" OR \"party\"", ftsMatchExpr("dinner    party"))
    }
}
