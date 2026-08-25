import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { openDb, reindex, getThread, listThreads, listUsers, linkThreadAlias, findCrossStreamDuplicates, linkMessages } from "../relations.mjs";

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

function threadIdByName(db, name) {
  return listThreads(db).find((t) => t.name === name)?.id;
}

test("G-13: linking a renamed thread folds its history into the canonical thread's getThread()", () => {
  const db = freshDb();
  reindex(db, [
    { id: 1, app: "WhatsApp", pkg: "com.whatsapp", title: "Family", text: "Alice: old name, message one", side: null, time: 1_700_000_000_000, source: "noti" },
    { id: 2, app: "WhatsApp", pkg: "com.whatsapp", title: "Family 2024", text: "Alice: new name, message two", side: null, time: 1_700_000_100_000, source: "noti" },
  ]);
  const oldId = threadIdByName(db, "Family");
  const newId = threadIdByName(db, "Family 2024");
  assert.ok(oldId && newId, "both threads must exist before linking");

  linkThreadAlias(db, newId, oldId, "renamed 'Family' -> 'Family 2024'");

  const merged = getThread(db, newId);
  assert.equal(merged.messages.length, 2, "both threads' messages must appear under the canonical thread");
  assert.deepEqual(
    merged.messages.map((m) => m.text),
    ["Alice: old name, message one", "Alice: new name, message two"],
    "merged history must stay chronologically ordered across the two source threads"
  );
  assert.equal(merged.mergedFrom.length, 1);
  assert.equal(merged.mergedFrom[0].id, oldId);

  db.close();
});

test("G-13: listThreads no longer lists a thread once it's been aliased into another", () => {
  const db = freshDb();
  reindex(db, [
    { id: 1, app: "WhatsApp", pkg: "com.whatsapp", title: "Family", text: "Alice: old name", side: null, time: 1_700_000_000_000, source: "noti" },
    { id: 2, app: "WhatsApp", pkg: "com.whatsapp", title: "Family 2024", text: "Alice: new name", side: null, time: 1_700_000_100_000, source: "noti" },
  ]);
  const oldId = threadIdByName(db, "Family");
  const newId = threadIdByName(db, "Family 2024");

  assert.equal(listThreads(db).length, 2, "sanity: both threads listed before linking");
  linkThreadAlias(db, newId, oldId);
  const names = listThreads(db).map((t) => t.name);
  assert.deepEqual(names, ["Family 2024"], "the aliased-away old thread must not appear as a separate conversation");

  db.close();
});

test("G-13: a thread cannot be aliased to itself", () => {
  const db = freshDb();
  reindex(db, [
    { id: 1, app: "WhatsApp", pkg: "com.whatsapp", title: "Family", text: "hi", side: null, time: 1_700_000_000_000, source: "scrape" },
  ]);
  const id = threadIdByName(db, "Family");
  assert.throws(() => linkThreadAlias(db, id, id));

  db.close();
});

test("G-13: linking a nonexistent thread id throws rather than silently creating a dangling alias", () => {
  const db = freshDb();
  reindex(db, [
    { id: 1, app: "WhatsApp", pkg: "com.whatsapp", title: "Family", text: "hi", side: null, time: 1_700_000_000_000, source: "scrape" },
  ]);
  const id = threadIdByName(db, "Family");
  assert.throws(() => linkThreadAlias(db, id, 999999));
  assert.throws(() => linkThreadAlias(db, 999999, id));

  db.close();
});

test("G-13: a rename chain (A->B, then B->C) flattens so C's history includes A without a second hop", () => {
  const db = freshDb();
  reindex(db, [
    { id: 1, app: "WhatsApp", pkg: "com.whatsapp", title: "Family v1", text: "scrape: v1", side: null, time: 1_700_000_000_000, source: "scrape" },
    { id: 2, app: "WhatsApp", pkg: "com.whatsapp", title: "Family v2", text: "scrape: v2", side: null, time: 1_700_000_100_000, source: "scrape" },
    { id: 3, app: "WhatsApp", pkg: "com.whatsapp", title: "Family v3", text: "scrape: v3", side: null, time: 1_700_000_200_000, source: "scrape" },
  ]);
  const v1 = threadIdByName(db, "Family v1");
  const v2 = threadIdByName(db, "Family v2");
  const v3 = threadIdByName(db, "Family v3");

  linkThreadAlias(db, v2, v1, "v1 -> v2");
  linkThreadAlias(db, v3, v2, "v2 -> v3");

  const merged = getThread(db, v3);
  assert.equal(merged.messages.length, 3, "all three renames' history must be reachable from the latest name");
  assert.deepEqual(new Set(merged.mergedFrom.map((t) => t.id)), new Set([v1, v2]));

  db.close();
});

test("G-13: re-pointing an already-aliased thread to an unrelated canonical is rejected", () => {
  const db = freshDb();
  reindex(db, [
    { id: 1, app: "WhatsApp", pkg: "com.whatsapp", title: "A", text: "a", side: null, time: 1_700_000_000_000, source: "scrape" },
    { id: 2, app: "WhatsApp", pkg: "com.whatsapp", title: "B", text: "b", side: null, time: 1_700_000_100_000, source: "scrape" },
    { id: 3, app: "WhatsApp", pkg: "com.whatsapp", title: "C", text: "c", side: null, time: 1_700_000_200_000, source: "scrape" },
  ]);
  const a = threadIdByName(db, "A");
  const b = threadIdByName(db, "B");
  const c = threadIdByName(db, "C");

  linkThreadAlias(db, b, a); // a is now aliased to b
  assert.throws(() => linkThreadAlias(db, c, a)); // re-pointing a straight to an unrelated c must fail

  db.close();
});

// ---------- findCrossStreamDuplicates / linkMessages (G-20) ----------

function messageIdByText(db, threadId, text) {
  return getThread(db, threadId).messages.find((m) => m.text === text)?.id;
}

function seedCrossStreamThread(db) {
  reindex(db, [
    // A notification preview and the screen reader's fuller capture of the
    // same real message, 30s apart, notification text a prefix of the
    // screen-captured one.
    { id: 1, app: "WhatsApp", pkg: "com.whatsapp", title: "Family Chat Group", text: "Alice: dinner at 7", side: null, time: 1_700_000_000_000, source: "noti" },
    { id: 2, app: "WhatsApp", pkg: "com.whatsapp", title: "Family Chat Group", text: "Alice: dinner at 7 tonight, don't be late", side: "them", time: 1_700_000_030_000, source: "screen" },
    // A completely different, unrelated message shortly after -- must never
    // be treated as a candidate pair with anything above.
    { id: 3, app: "WhatsApp", pkg: "com.whatsapp", title: "Family Chat Group", text: "Bob: sounds good see you then", side: null, time: 1_700_000_060_000, source: "noti" },
    // Same text, same source (both noti) -- not cross-stream, must be excluded.
    { id: 4, app: "WhatsApp", pkg: "com.whatsapp", title: "Family Chat Group", text: "Bob: sounds good see you then", side: null, time: 1_700_000_090_000, source: "noti" },
    // Identical text, different source, but 10 minutes apart -- outside the
    // default 3-minute window, must be excluded.
    { id: 5, app: "WhatsApp", pkg: "com.whatsapp", title: "Family Chat Group", text: "identical far apart text here", side: null, time: 1_700_000_120_000, source: "noti" },
    { id: 6, app: "WhatsApp", pkg: "com.whatsapp", title: "Family Chat Group", text: "identical far apart text here", side: "them", time: 1_700_000_720_000, source: "screen" },
  ]);
  return threadIdByName(db, "Family Chat Group");
}

test("G-20: findCrossStreamDuplicates surfaces a prefix-matched, close-in-time, different-source pair", () => {
  const db = freshDb();
  const threadId = seedCrossStreamThread(db);
  const pairs = findCrossStreamDuplicates(db, threadId);

  const found = pairs.find((p) => p.text1.includes("dinner at 7") || p.text2.includes("dinner at 7"));
  assert.ok(found, "the notification/screen prefix pair must be surfaced");
  assert.notEqual(found.source1, found.source2, "a candidate pair must always be cross-stream");

  db.close();
});

test("G-20: same-source pairs and far-apart-in-time pairs are never surfaced as candidates", () => {
  const db = freshDb();
  const threadId = seedCrossStreamThread(db);
  const pairs = findCrossStreamDuplicates(db, threadId);

  const sameSourcePair = pairs.some((p) => p.text1 === "Bob: sounds good see you then");
  assert.equal(sameSourcePair, false, "two noti-source rows must never be a candidate pair, even with identical text");

  const farApartPair = pairs.some((p) => p.text1 === "identical far apart text here");
  assert.equal(farApartPair, false, "identical text 10 minutes apart is outside the default window");

  db.close();
});

test("G-20: an unrelated message is never surfaced as a candidate with anything", () => {
  const db = freshDb();
  const threadId = seedCrossStreamThread(db);
  const pairs = findCrossStreamDuplicates(db, threadId);

  const bobInvolved = pairs.some((p) => p.text1.startsWith("Bob:") || p.text2.startsWith("Bob:"));
  assert.equal(bobInvolved, false);

  db.close();
});

test("G-20: a custom windowMs widens or narrows the time-proximity check", () => {
  const db = freshDb();
  const threadId = seedCrossStreamThread(db);

  const narrow = findCrossStreamDuplicates(db, threadId, { windowMs: 5_000 });
  assert.equal(narrow.some((p) => p.text1.includes("dinner at 7") || p.text2.includes("dinner at 7")), false,
    "a 5s window must exclude the 30s-apart dinner pair");

  const wide = findCrossStreamDuplicates(db, threadId, { windowMs: 700_000 });
  assert.ok(wide.some((p) => p.text1 === "identical far apart text here" || p.text2 === "identical far apart text here"),
    "a wide enough window must include the far-apart identical-text pair");

  db.close();
});

test("G-20: linkMessages records a link and getThread reflects it via duplicateOfId", () => {
  const db = freshDb();
  const threadId = seedCrossStreamThread(db);
  const canonicalId = messageIdByText(db, threadId, "Alice: dinner at 7 tonight, don't be late");
  const dupId = messageIdByText(db, threadId, "Alice: dinner at 7");

  linkMessages(db, canonicalId, dupId, "notification preview of the screen-captured message");

  const messages = getThread(db, threadId).messages;
  const dupRow = messages.find((m) => m.id === dupId);
  const canonicalRow = messages.find((m) => m.id === canonicalId);
  assert.equal(dupRow.duplicateOfId, canonicalId);
  assert.equal(canonicalRow.duplicateOfId, null, "the canonical message itself must not be marked as a duplicate");
  // Both rows must still exist -- linking never deletes or hides either one.
  assert.equal(messages.length, 6);

  db.close();
});

test("G-20: an already-linked pair no longer appears in findCrossStreamDuplicates", () => {
  const db = freshDb();
  const threadId = seedCrossStreamThread(db);
  const canonicalId = messageIdByText(db, threadId, "Alice: dinner at 7 tonight, don't be late");
  const dupId = messageIdByText(db, threadId, "Alice: dinner at 7");

  linkMessages(db, canonicalId, dupId);
  const pairs = findCrossStreamDuplicates(db, threadId);
  assert.equal(pairs.some((p) => p.id1 === dupId || p.id2 === dupId), false);

  db.close();
});

test("G-20: linkMessages rejects a self-link and a nonexistent message id", () => {
  const db = freshDb();
  const threadId = seedCrossStreamThread(db);
  const id = messageIdByText(db, threadId, "Bob: sounds good see you then");

  assert.throws(() => linkMessages(db, id, id));
  assert.throws(() => linkMessages(db, id, 999999));
  assert.throws(() => linkMessages(db, 999999, id));

  db.close();
});

test("G-20: re-pointing an already-linked message to an unrelated canonical is rejected", () => {
  const db = freshDb();
  const threadId = seedCrossStreamThread(db);
  const a = messageIdByText(db, threadId, "Alice: dinner at 7 tonight, don't be late");
  const b = messageIdByText(db, threadId, "Alice: dinner at 7");
  const c = messageIdByText(db, threadId, "Bob: sounds good see you then");

  linkMessages(db, a, b); // b is now a duplicate of a
  assert.throws(() => linkMessages(db, c, b)); // re-pointing b straight to an unrelated c must fail

  db.close();
});

test("G-20: a literal '%' in message text does not break the prefix match (no LIKE wildcard involved)", () => {
  const db = freshDb();
  reindex(db, [
    { id: 1, app: "Store", pkg: "com.store", title: "Flash Deals Today", text: "50% off everything", side: null, time: 1_700_000_000_000, source: "noti" },
    { id: 2, app: "Store", pkg: "com.store", title: "Flash Deals Today", text: "50% off everything today only, hurry", side: "them", time: 1_700_000_010_000, source: "screen" },
  ]);
  const threadId = threadIdByName(db, "Flash Deals Today");
  const pairs = findCrossStreamDuplicates(db, threadId);
  assert.equal(pairs.length, 1, "the literal-percent prefix pair must still be found");
  assert.equal(pairs[0].text1, "50% off everything");

  db.close();
});
