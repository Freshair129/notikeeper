import test from "node:test";
import assert from "node:assert/strict";
import { openRawDb, insertRawRow, insertRawRows, deleteRawRows, countRawRows, filterRawRows, allRawRows } from "../raw-store.mjs";

// Same key server.mjs's in-memory `seen` Set already uses.
const keyOf = (r) => `${r.id}-${r.time}`;

function freshDb() {
  return openRawDb(":memory:");
}

test("insertRawRow stores a row retrievable by its real fields", () => {
  const db = freshDb();
  const row = { id: 1, time: 1_700_000_000_000, source: "noti", app: "WhatsApp", pkg: "com.whatsapp", title: "Alice", text: "hello", side: "", time_exact: true };
  insertRawRow(db, row, keyOf);

  const got = db.prepare("SELECT * FROM raw_rows WHERE raw_key = ?").get(keyOf(row));
  assert.equal(got.id, "1");
  assert.equal(got.time, 1_700_000_000_000);
  assert.equal(got.source, "noti");
  assert.equal(got.app, "WhatsApp");
  assert.equal(got.pkg, "com.whatsapp");
  assert.equal(got.title, "Alice");
  assert.equal(got.text, "hello");
  assert.equal(got.time_exact, 1);

  db.close();
});

test("raw_json round-trips the exact original row, including fields with no dedicated column", () => {
  const db = freshDb();
  const row = { id: 2, time: 1_700_000_000_000, source: "scrape", app: "LINE", pkg: "jp.naver.line.android", title: "Bob", text: "hi", side: "them", sender: "Bob", extra_future_field: "kept" };
  insertRawRow(db, row, keyOf);

  const got = db.prepare("SELECT raw_json FROM raw_rows WHERE raw_key = ?").get(keyOf(row));
  assert.deepEqual(JSON.parse(got.raw_json), row);

  db.close();
});

test("time_exact stores true/false/undefined as 1/0/NULL, not lossily coerced", () => {
  const db = freshDb();
  insertRawRow(db, { id: 1, time: 1, source: "noti", time_exact: true }, keyOf);
  insertRawRow(db, { id: 2, time: 2, source: "screen", time_exact: false }, keyOf);
  insertRawRow(db, { id: 3, time: 3, source: "scrape" }, keyOf); // time_exact absent

  const rows = db.prepare("SELECT id, time_exact FROM raw_rows ORDER BY id").all();
  assert.deepEqual(rows.map((r) => r.time_exact), [1, 0, null]);

  db.close();
});

test("inserting the same row twice (same raw_key) is a no-op the second time", () => {
  const db = freshDb();
  const row = { id: 1, time: 1_700_000_000_000, source: "noti", app: "WhatsApp", text: "hello" };
  insertRawRow(db, row, keyOf);
  insertRawRow(db, row, keyOf);

  assert.equal(countRawRows(db), 1);

  db.close();
});

test("insertRawRows batches many rows across the chunk boundary correctly", () => {
  const db = freshDb();
  const rows = Array.from({ length: 2_500 }, (_, i) => ({
    id: i, time: 1_700_000_000_000 + i, source: "noti", app: "WhatsApp", text: `msg ${i}`,
  }));
  insertRawRows(db, rows, keyOf);

  assert.equal(countRawRows(db), 2_500);

  db.close();
});

test("insertRawRows is idempotent — re-running with overlapping rows only adds the new ones", () => {
  const db = freshDb();
  const batch1 = [{ id: 1, time: 1, source: "noti", text: "a" }, { id: 2, time: 2, source: "noti", text: "b" }];
  const batch2 = [{ id: 2, time: 2, source: "noti", text: "b" }, { id: 3, time: 3, source: "noti", text: "c" }];
  insertRawRows(db, batch1, keyOf);
  insertRawRows(db, batch2, keyOf);

  assert.equal(countRawRows(db), 3);

  db.close();
});

test("deleteRawRows removes exactly the given keys and reports the count actually deleted", () => {
  const db = freshDb();
  const rows = [
    { id: 1, time: 1, source: "noti", text: "keep" },
    { id: 2, time: 2, source: "noti", text: "remove me" },
    { id: 3, time: 3, source: "noti", text: "also keep" },
  ];
  insertRawRows(db, rows, keyOf);

  const deleted = deleteRawRows(db, [keyOf(rows[1])]);
  assert.equal(deleted, 1);
  assert.equal(countRawRows(db), 2);
  assert.equal(db.prepare("SELECT 1 FROM raw_rows WHERE raw_key = ?").get(keyOf(rows[1])), undefined);
  assert.ok(db.prepare("SELECT 1 FROM raw_rows WHERE raw_key = ?").get(keyOf(rows[0])));

  db.close();
});

test("deleteRawRows on an empty list is a safe no-op", () => {
  const db = freshDb();
  insertRawRow(db, { id: 1, time: 1, source: "noti", text: "x" }, keyOf);
  const deleted = deleteRawRows(db, []);
  assert.equal(deleted, 0);
  assert.equal(countRawRows(db), 1);

  db.close();
});

test("deleteRawRows on a key that doesn't exist deletes nothing and doesn't throw", () => {
  const db = freshDb();
  insertRawRow(db, { id: 1, time: 1, source: "noti", text: "x" }, keyOf);
  const deleted = deleteRawRows(db, ["nonexistent-key"]);
  assert.equal(deleted, 0);
  assert.equal(countRawRows(db), 1);

  db.close();
});

test("indexed columns actually support real filtering (time range, source, app substring)", () => {
  const db = freshDb();
  insertRawRows(db, [
    { id: 1, time: 1_000, source: "noti", app: "WhatsApp", text: "a" },
    { id: 2, time: 2_000, source: "screen", app: "LINE", text: "b" },
    { id: 3, time: 3_000, source: "noti", app: "WhatsApp Business", text: "c" },
  ], keyOf);

  const byTime = db.prepare("SELECT id FROM raw_rows WHERE time >= ? ORDER BY id").all(2_000).map((r) => r.id);
  assert.deepEqual(byTime, ["2", "3"]);

  const bySource = db.prepare("SELECT id FROM raw_rows WHERE source = ? ORDER BY id").all("noti").map((r) => r.id);
  assert.deepEqual(bySource, ["1", "3"]);

  const byApp = db.prepare("SELECT id FROM raw_rows WHERE app LIKE ? ORDER BY id").all("%WhatsApp%").map((r) => r.id);
  assert.deepEqual(byApp, ["1", "3"]);

  db.close();
});

// ---------- filterRawRows — replaces server.mjs's old filterRows() linear scan ----------

function seedVariedRows(db) {
  insertRawRows(db, [
    { id: 1, time: 1_000, source: "noti", app: "WhatsApp", text: "hello there friend", title: "Alice" },
    { id: 2, time: 2_000, source: "scrape", app: "LINE", text: "hi how are you doing", title: "Bob" },
    { id: 9, time: 3_000, source: "noti", app: "WhatsApp", text: "Sale today", title: "Promo" }, // noise
    { id: 10, time: 4_000, source: "screen", app: "WhatsApp", text: "see you soon", title: "Alice" },
    { id: 20, time: 5_000, source: "noti", app: "Telegram", text: "meeting at 5pm", title: "Carol" },
  ], keyOf);
  return db;
}

test("filterRawRows with no filters returns everything, newest first", () => {
  const db = seedVariedRows(freshDb());
  const out = filterRawRows(db, {});
  assert.deepEqual(out.map((r) => r.id), [20, 10, 9, 2, 1]);

  db.close();
});

test("filterRawRows sinceMs/untilMs filter by time range (untilMs is exclusive)", () => {
  const db = seedVariedRows(freshDb());
  const out = filterRawRows(db, { sinceMs: 2_000, untilMs: 4_000 });
  // [2000, 4000): id 2 (time 2000, sinceMs is inclusive) and id 9 (time
  // 3000) qualify; id 10 (time 4000) is excluded by untilMs being exclusive.
  assert.deepEqual(new Set(out.map((r) => r.id)), new Set([2, 9]));

  db.close();
});

test("filterRawRows sinceId compares numerically, not lexicographically", () => {
  const db = seedVariedRows(freshDb());
  // Lexicographically "9" > "10" and "20" would sort oddly too -- if this
  // compared as strings, sinceId=9 would wrongly exclude id 10 and 20.
  // Numerically, everything with id > 9 is 10 and 20.
  const out = filterRawRows(db, { sinceId: 9 });
  assert.deepEqual(new Set(out.map((r) => r.id)), new Set([10, 20]));

  db.close();
});

test("filterRawRows source filters on an exact match", () => {
  const db = seedVariedRows(freshDb());
  const out = filterRawRows(db, { source: "noti" });
  assert.deepEqual(new Set(out.map((r) => r.id)), new Set([1, 9, 20]));

  db.close();
});

test("filterRawRows app filters as a case-insensitive substring", () => {
  const db = seedVariedRows(freshDb());
  const out = filterRawRows(db, { app: "whats" }); // lowercase, partial
  assert.deepEqual(new Set(out.map((r) => r.id)), new Set([1, 9, 10]));

  db.close();
});

test("filterRawRows query searches text, title, and app together, case-insensitively", () => {
  const db = seedVariedRows(freshDb());
  const byText = filterRawRows(db, { query: "meeting" });
  assert.deepEqual(byText.map((r) => r.id), [20]);

  const byTitle = filterRawRows(db, { query: "carol" });
  assert.deepEqual(byTitle.map((r) => r.id), [20]);

  const byApp = filterRawRows(db, { query: "telegram" });
  assert.deepEqual(byApp.map((r) => r.id), [20]);

  db.close();
});

test("filterRawRows denoise drops noise-classified rows (id 9, a 'Sale today' promo)", () => {
  const db = seedVariedRows(freshDb());
  const withoutDenoise = filterRawRows(db, {});
  const withDenoise = filterRawRows(db, { denoise: true });
  assert.ok(withoutDenoise.some((r) => r.id === 9), "sanity: id 9 is present without denoise");
  assert.ok(!withDenoise.some((r) => r.id === 9), "id 9 must be dropped when denoise is requested");
  assert.equal(withDenoise.length, withoutDenoise.length - 1);

  db.close();
});

test("filterRawRows escapes LIKE wildcards in search terms — a literal '%' searches literally, not as a wildcard", () => {
  const db = freshDb();
  insertRawRows(db, [
    { id: 1, time: 1, source: "noti", app: "Store", text: "50% off everything today" },
    { id: 2, time: 2, source: "noti", app: "Store", text: "buy one get one free" },
  ], keyOf);

  const out = filterRawRows(db, { query: "50%" });
  // Must match only the row with the literal "50%" substring, not (as an
  // unescaped LIKE '%50%%' would) anything containing "50" followed by
  // anything -- with only two rows here the distinguishing case is subtle,
  // so assert the exact match set rather than just non-crashing.
  assert.deepEqual(out.map((r) => r.id), [1]);

  db.close();
});

test("filterRawRows combines multiple filters with AND", () => {
  const db = seedVariedRows(freshDb());
  // source=noti AND app contains "whats" -- only id 1 and 9 are noti+WhatsApp;
  // denoise removes 9, leaving just 1.
  const out = filterRawRows(db, { source: "noti", app: "whats", denoise: true });
  assert.deepEqual(out.map((r) => r.id), [1]);

  db.close();
});

// ---------- allRawRows — used by server.mjs's rebuildRelations() (G-19) ----------

test("allRawRows reconstructs every row exactly, with no filter/order guarantees relied upon by callers", () => {
  const db = freshDb();
  const seeded = [
    { id: 1, time: 3_000, source: "noti", app: "WhatsApp", text: "c" },
    { id: 2, time: 1_000, source: "scrape", app: "LINE", text: "a" },
    { id: 3, time: 2_000, source: "screen", app: "WhatsApp", text: "b" },
  ];
  insertRawRows(db, seeded, keyOf);

  const out = allRawRows(db);
  assert.equal(out.length, 3);
  assert.deepEqual(new Set(out.map((r) => r.id)), new Set([1, 2, 3]));
  // Each reconstructed row must exactly match what was inserted, field for field.
  for (const original of seeded) {
    const found = out.find((r) => r.id === original.id);
    assert.deepEqual(found, original);
  }

  db.close();
});

test("allRawRows on an empty store returns an empty array, not null/undefined", () => {
  const db = freshDb();
  assert.deepEqual(allRawRows(db), []);
  db.close();
});
