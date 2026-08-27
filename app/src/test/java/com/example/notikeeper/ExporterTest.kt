package com.example.notikeeper

import com.example.notikeeper.data.NotiItem
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.StringWriter

/**
 * Exercises Exporter.writeCsvRows end to end (real Writer, real NotiItem rows,
 * no Android framework involved) — CSV escaping and the export column set are
 * exactly the kind of pure logic G-33 in the capture-to-archive integrity
 * audit flags as testable without a device but previously untested.
 */
class ExporterTest {

    private fun item(
        id: Long = 1L,
        source: String = "noti",
        pkg: String = "com.whatsapp",
        appName: String = "WhatsApp",
        title: String = "Alice",
        text: String = "hello",
        side: String = "",
        postTime: Long = 1_700_000_000_000L,
        timeExact: Boolean = true,
        capturedAt: Long? = 1_700_000_000_500L,
        extractionVersion: Int? = 17
    ) = NotiItem(id, source, pkg, appName, title, text, side, postTime, timeExact, capturedAt, extractionVersion)

    @Test
    fun `header includes pkg`() {
        val writer = StringWriter()
        Exporter.writeCsvRows(writer, emptySequence())
        val header = writer.toString().lineSequence().first()
        assertEquals(
            "id,source,app,pkg,title,text,side,time,time_exact,captured_at,extraction_version",
            header
        )
    }

    @Test
    fun `returns the true row count`() {
        val writer = StringWriter()
        val count = Exporter.writeCsvRows(writer, sequenceOf(item(id = 1), item(id = 2), item(id = 3)))
        assertEquals(3, count)
    }

    @Test
    fun `plain fields are written unquoted`() {
        val writer = StringWriter()
        Exporter.writeCsvRows(writer, sequenceOf(item(pkg = "com.whatsapp", title = "Alice", text = "hello")))
        val dataLine = writer.toString().lineSequence().drop(1).first()
        assertEquals(
            "1,noti,WhatsApp,com.whatsapp,Alice,hello,,1700000000000,1,1700000000500,17",
            dataLine
        )
    }

    @Test
    fun `a field containing a comma is quoted`() {
        val writer = StringWriter()
        Exporter.writeCsvRows(writer, sequenceOf(item(text = "hi, how are you")))
        val dataLine = writer.toString().lineSequence().drop(1).first()
        assertTrue(dataLine.contains("\"hi, how are you\""))
    }

    @Test
    fun `a field containing a double quote is escaped by doubling it`() {
        val writer = StringWriter()
        Exporter.writeCsvRows(writer, sequenceOf(item(text = """say "hi" to her""")))
        val dataLine = writer.toString().lineSequence().drop(1).first()
        assertTrue(dataLine.contains("\"say \"\"hi\"\" to her\""))
    }

    @Test
    fun `a field containing a newline is quoted rather than breaking the row`() {
        val writer = StringWriter()
        val count = Exporter.writeCsvRows(writer, sequenceOf(item(text = "line one\nline two")))
        // The embedded newline must not be mistaken for a second data row.
        assertEquals(1, count)
        assertTrue(writer.toString().contains("\"line one\nline two\""))
    }

    @Test
    fun `a field needing no escaping is left unquoted even with unicode text`() {
        val writer = StringWriter()
        Exporter.writeCsvRows(writer, sequenceOf(item(text = "ทานข้าวหรือยัง")))
        val dataLine = writer.toString().lineSequence().drop(1).first()
        assertTrue(dataLine.contains(",ทานข้าวหรือยัง,"))
    }

    @Test
    fun `null capturedAt and extractionVersion render as empty fields, not the string null`() {
        val writer = StringWriter()
        Exporter.writeCsvRows(writer, sequenceOf(item(capturedAt = null, extractionVersion = null)))
        val dataLine = writer.toString().lineSequence().drop(1).first()
        assertTrue(dataLine.endsWith(",1700000000000,1,,"))
    }
}
