import test from "node:test";
import assert from "node:assert/strict";
import { buildTurns } from "../graph-index.mjs";

const sqlite = (rows) => ({
  prepare(sql) {
    assert.match(sql, /WHERE source IN \('scrape', 'adb-scrape'\)/);
    return { all: () => rows.filter((row) => row.source === "scrape" || row.source === "adb-scrape") };
  },
});

test("buildTurns keeps scrape AND adb-scrape rows, merges same speaker fragments within five minutes", () => {
  // scraper.mjs/scrape-all.mjs (source: "scrape") and adb-scraper.mjs (source:
  // "adb-scrape") are two different scraper implementations producing the
  // same kind of observation — a PC-driven scroll-scrape of one conversation
  // — so a fragment from either must merge into the same turn as its
  // neighbors. Before this fix, buildTurns' SQL filtered on source='scrape'
  // alone, which silently excluded every row the current scraper (adb-scrape)
  // has ever produced from semantic search — see G-22 in the capture-to-
  // archive integrity audit. id 3 below is the regression check for that.
  const turns = buildTurns(sqlite([
    { id: 1, thread_id: 10, sender_id: 2, side: "them", text: "hello", time: 1_000, source: "scrape" },
    { id: 2, thread_id: 10, sender_id: 2, side: "them", text: "there", time: 2_000, source: "scrape" },
    { id: 3, thread_id: 10, sender_id: 2, side: "them", text: "friend", time: 3_000, source: "adb-scrape" },
    { id: 4, thread_id: 10, sender_id: 2, side: "them", text: "ignored", time: 4_000, source: "screen" },
    { id: 5, thread_id: 10, sender_id: 2, side: "them", text: "ignored", time: 5_000, source: "noti" },
  ]));

  assert.deepEqual(turns.map(({ repId, ids, text }) => ({ repId, ids, text })), [
    { repId: 1, ids: [1, 2, 3], text: "hello there friend" },
  ]);
});

test("buildTurns splits at sender, side, thread, and five-minute boundaries", () => {
  const turns = buildTurns(sqlite([
    { id: 1, thread_id: 10, sender_id: 2, side: "them", text: "first turn", time: 0, source: "scrape" },
    { id: 2, thread_id: 10, sender_id: 3, side: "them", text: "other sender", time: 1, source: "scrape" },
    { id: 3, thread_id: 10, sender_id: 3, side: "me", text: "other side", time: 2, source: "scrape" },
    { id: 4, thread_id: 11, sender_id: 3, side: "me", text: "other thread", time: 3, source: "scrape" },
    { id: 5, thread_id: 11, sender_id: 3, side: "me", text: "after window", time: 300_004, source: "scrape" },
  ]));

  assert.deepEqual(turns.map((turn) => turn.repId), [1, 2, 3, 4, 5]);
});

test("buildTurns drops short fragments and short final turns with current defaults", () => {
  const turns = buildTurns(sqlite([
    { id: 1, thread_id: 10, sender_id: 2, side: "them", text: "x", time: 0, source: "scrape" },
    { id: 2, thread_id: 10, sender_id: 2, side: "them", text: "short", time: 1, source: "scrape" },
    { id: 3, thread_id: 10, sender_id: 2, side: "me", text: "long enough", time: 2, source: "scrape" },
  ]));

  assert.deepEqual(turns.map(({ repId, ids, text }) => ({ repId, ids, text })), [
    { repId: 3, ids: [3], text: "long enough" },
  ]);
});
