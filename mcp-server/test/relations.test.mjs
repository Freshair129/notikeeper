import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { openDb, reindex, getThread, listThreads, listUsers } from "../relations.mjs";

/**
 * Exercises relations.mjs's ETL — parseRow + reindex — against a real
 * in-memory database. Server tests previously covered noise/graph/gate but
 * not ingest/ack/dedup/ETL; see G-33 in the capture-to-archive integrity
 * audit. Each test opens its own :memory: db so nothing here can touch the
 * real relations.db.
 */

function freshDb() {
  return openDb(":memory:");
}

test("reindex is idempotent: re-running with the same raw rows creates no duplicate messages", () => {
  const db = freshDb();
  const rows = [
    { id: 1, app: "WhatsApp", pkg: "com.whatsapp", title: "Alice", text: "hello there friend", side: null, time: 1_700_000_000_000, source: "noti" },
  ];

  const first = reindex(db, rows);
  const second = reindex(db, rows); // same raw ids -> raw_key already seen

  assert.equal(first.inserted, 1, "first run should insert the one row");
  assert.equal(second.inserted, 0, "second run over the same raw rows must insert nothing new");

  const count = db.prepare("SELECT COUNT(*) AS n FROM messages").get().n;
  assert.equal(count, 1, "exactly one message row must exist after both runs");

  db.close();
});

test("G-14: a row with no side and no sender evidence gets side = NULL, not defaulted to me", () => {
  const db = freshDb();
  const rows = [
    // A screen row with a real, non-chrome title/text but no side evidence
    // (side: null) and nothing that lets senderName be inferred either.
    { id: 1, app: "LINE", pkg: "jp.naver.line.android", title: "Random Group Chat XY", text: "just a message with no attribution", side: null, time: 1_700_000_000_000, source: "screen" },
  ];
  reindex(db, rows);

  const thread = listThreads(db)[0];
  assert.ok(thread, "the row should have produced a thread");
  const detail = getThread(db, thread.id);
  assert.equal(detail.messages.length, 1);
  assert.equal(detail.messages[0].side, null, "side must stay null, never default to 'me' with no evidence");

  db.close();
});

test("G-09: a noti-source row backfills timeExact = 1 even without an explicit time_exact field", () => {
  const db = freshDb();
  const rows = [
    { id: 1, app: "WhatsApp", pkg: "com.whatsapp", title: "Alice", text: "a genuine sbn.postTime backs this", side: null, time: 1_700_000_000_000, source: "noti" },
  ];
  reindex(db, rows);

  const thread = listThreads(db)[0];
  const detail = getThread(db, thread.id);
  assert.equal(detail.messages[0].time_exact, 1);

  db.close();
});

test("G-27: a second-precision raw time is normalized to milliseconds before storage", () => {
  const db = freshDb();
  const rows = [
    // 10-digit seconds epoch, same shape as the yuzup_raw.json example from
    // the audit — must land in messages.time as milliseconds, not verbatim.
    { id: 1, app: "Messenger", pkg: "com.facebook.orca", title: "Alice", text: "seconds precision import", side: null, time: 1783531579, source: "noti" },
  ];
  reindex(db, rows);

  const thread = listThreads(db)[0];
  const detail = getThread(db, thread.id);
  assert.equal(detail.messages[0].time, 1783531579000);

  db.close();
});

test("a millisecond raw time passes through unchanged", () => {
  const db = freshDb();
  const rows = [
    { id: 1, app: "Messenger", pkg: "com.facebook.orca", title: "Alice", text: "already milliseconds", side: null, time: 1782438502395, source: "noti" },
  ];
  reindex(db, rows);

  const thread = listThreads(db)[0];
  const detail = getThread(db, thread.id);
  assert.equal(detail.messages[0].time, 1782438502395);

  db.close();
});

test("a capture-gap marker row (source: 'gap') is skipped entirely, not turned into a thread", () => {
  const db = freshDb();
  const rows = [
    { id: 1, app: "NotiKeeper", pkg: "notikeeper.internal.gap", title: "Capture gap: noti", text: "noti capture was not confirmed running from ... to ...", side: "", time: 1_700_000_000_000, source: "gap" },
  ];
  const result = reindex(db, rows);

  assert.equal(result.inserted, 0);
  assert.equal(listThreads(db).length, 0);

  db.close();
});

test("empty app or empty text rows are skipped, not stored as a blank thread/message", () => {
  const db = freshDb();
  const rows = [
    { id: 1, app: "", pkg: "com.whatsapp", title: "Alice", text: "no app name", side: null, time: 1_700_000_000_000, source: "noti" },
    { id: 2, app: "WhatsApp", pkg: "com.whatsapp", title: "Alice", text: "", side: null, time: 1_700_000_000_001, source: "noti" },
  ];
  const result = reindex(db, rows);

  assert.equal(result.inserted, 0);

  db.close();
});

test("G-12: the same sender name in two different apps produces two separate user rows", () => {
  const db = freshDb();
  const rows = [
    { id: 1, app: "WhatsApp", pkg: "com.whatsapp", title: "Family", text: "Alice: dinner at 7", side: null, time: 1_700_000_000_000, source: "noti" },
    { id: 2, app: "LINE", pkg: "jp.naver.line.android", title: "Family", text: "Alice: dinner at 7", side: null, time: 1_700_000_000_001, source: "noti" },
  ];
  reindex(db, rows);

  const alices = listUsers(db).filter((u) => u.name === "Alice");
  assert.equal(alices.length, 2, "two different apps' Alice must be two distinct user rows");
  assert.deepEqual(new Set(alices.map((u) => u.app)), new Set(["WhatsApp", "LINE"]));

  db.close();
});

test("G-12: the same sender name within the same app still merges into one user row", () => {
  const db = freshDb();
  const rows = [
    { id: 1, app: "WhatsApp", pkg: "com.whatsapp", title: "Family", text: "Alice: dinner at 7", side: null, time: 1_700_000_000_000, source: "noti" },
    { id: 2, app: "WhatsApp", pkg: "com.whatsapp", title: "Work", text: "Alice: meeting moved", side: null, time: 1_700_000_000_001, source: "noti" },
  ];
  reindex(db, rows);

  const alices = listUsers(db).filter((u) => u.name === "Alice" && u.app === "WhatsApp");
  assert.equal(alices.length, 1, "same name within the same app is still one identity");
  assert.equal(alices[0].message_count, 2);

  db.close();
});

test("G-12 migration: an old-schema relations.db (users.name globally UNIQUE) is detected and rebuilt", () => {
  const tmpPath = path.join(os.tmpdir(), `notikeeper-g12-migration-test-${process.pid}-${Date.now()}.db`);
  try {
    // Seed a database matching the pre-G-12 schema, holding exactly the kind
    // of merged row (one "Alice" shared across apps) this migration exists
    // to stop happening.
    const seed = new Database(tmpPath);
    seed.exec(`
      CREATE TABLE apps (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, pkg TEXT);
      CREATE TABLE users (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE,
        first_seen INTEGER, last_seen INTEGER, message_count INTEGER DEFAULT 0
      );
    `);
    seed.prepare(
      "INSERT INTO users(name, first_seen, last_seen, message_count) VALUES (?, ?, ?, ?)"
    ).run("Alice", 1000, 1000, 5);
    seed.close();

    const db = openDb(tmpPath);

    const cols = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
    assert.ok(cols.includes("app_id"), "users table must gain app_id after migration");

    // The stale merged row must be gone entirely (wiped, not carried forward
    // half-migrated with no app_id value) — a fresh reindex from data.jsonl
    // is what's supposed to repopulate it, correctly scoped this time.
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users").get().n, 0);

    // And that fresh reindex against the migrated schema correctly
    // re-separates per-app identity straight from the raw rows.
    const rows = [
      { id: 1, app: "WhatsApp", pkg: "com.whatsapp", title: "Family", text: "Alice: hi", side: null, time: 1_700_000_000_000, source: "noti" },
      { id: 2, app: "LINE", pkg: "jp.naver.line.android", title: "Family", text: "Alice: hi", side: null, time: 1_700_000_000_001, source: "noti" },
    ];
    reindex(db, rows);
    assert.equal(listUsers(db).filter((u) => u.name === "Alice").length, 2);

    db.close();
  } finally {
    for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(tmpPath + suffix, { force: true });
  }
});
