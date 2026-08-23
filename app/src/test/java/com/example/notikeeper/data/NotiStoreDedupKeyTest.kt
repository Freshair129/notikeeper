package com.example.notikeeper.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

/**
 * Pins down [notiDedupKey]/[screenDedupKey]/[gapDedupKey] — the UNIQUE index
 * every capture insert relies on to be idempotent. A behavior change here is
 * exactly the kind of thing that can silently start over-merging distinct
 * messages or under-merging true duplicates; see G-06/G-07/G-35 and G-33 in
 * the capture-to-archive integrity audit.
 */
class NotiStoreDedupKeyTest {

    // ---------- notiDedupKey ----------

    @Test
    fun `identical content in the same 5-minute bucket produces the same key`() {
        val t0 = 1_700_000_000_000L
        val t1 = t0 + 60_000L // 1 minute later, same bucket
        assertEquals(
            notiDedupKey("com.whatsapp", "Alice", "hello", t0),
            notiDedupKey("com.whatsapp", "Alice", "hello", t1)
        )
    }

    @Test
    fun `identical content across a bucket boundary produces different keys`() {
        val bucketMs = 5 * 60 * 1000L
        val t0 = 1_700_000_000_000L
        val t1 = t0 + bucketMs // exactly one bucket later
        assertNotEquals(
            notiDedupKey("com.whatsapp", "Alice", "hello", t0),
            notiDedupKey("com.whatsapp", "Alice", "hello", t1)
        )
    }

    @Test
    fun `different packages with identical title and text do not collide`() {
        // Two different apps both showing a message titled "Alice" / body "hello"
        // at the same instant must not merge into one row.
        assertNotEquals(
            notiDedupKey("com.whatsapp", "Alice", "hello", 1_700_000_000_000L),
            notiDedupKey("com.facebook.orca", "Alice", "hello", 1_700_000_000_000L)
        )
    }

    @Test
    fun `different text produces different keys`() {
        assertNotEquals(
            notiDedupKey("com.whatsapp", "Alice", "hello", 1_700_000_000_000L),
            notiDedupKey("com.whatsapp", "Alice", "goodbye", 1_700_000_000_000L)
        )
    }

    // ---------- screenDedupKey ----------

    @Test
    fun `screen key ignores pkg, appName, and postTime`() {
        // Deliberate: two capture ticks of the exact same visible bubble (same
        // conversation, side, text) must dedup even though postTime is a fresh
        // capture-tick wall clock every time — that's the whole point of the
        // LRU-backed re-scroll filter this key backs up.
        val a = ScreenRow("com.whatsapp", "WhatsApp", "Alice", "hi", "them", 1_000L)
        val b = ScreenRow("com.whatsapp", "WhatsApp", "Alice", "hi", "them", 999_999L)
        assertEquals(screenDedupKey(a), screenDedupKey(b))
    }

    @Test
    fun `screen key distinguishes side`() {
        val fromThem = ScreenRow("com.whatsapp", "WhatsApp", "Alice", "hi", "them", 1_000L)
        val fromMe = ScreenRow("com.whatsapp", "WhatsApp", "Alice", "hi", "me", 1_000L)
        assertNotEquals(screenDedupKey(fromThem), screenDedupKey(fromMe))
    }

    // ---------- gapDedupKey ----------

    @Test
    fun `gap key distinguishes service`() {
        assertNotEquals(
            gapDedupKey("noti", 1_000L, 2_000L),
            gapDedupKey("screen", 1_000L, 2_000L)
        )
    }

    @Test
    fun `identical gap window for the same service produces the same key`() {
        // Idempotency matters here specifically: onListenerConnected/onServiceConnected
        // can fire more than once for the same real gap (e.g. a quick double
        // rebind) and must not record it twice.
        assertEquals(
            gapDedupKey("noti", 1_000L, 2_000L),
            gapDedupKey("noti", 1_000L, 2_000L)
        )
    }
}
