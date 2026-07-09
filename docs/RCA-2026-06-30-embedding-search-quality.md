# Root Cause Analysis: Semantic Search and Graph View Polluted by Non-Conversational UI Chrome

**One-line summary:** The analytics embedding/graph pipeline indexed every captured accessibility-tree row as if it were a chat message at bubble granularity, so semantic search and the dashboard graph were dominated by Messenger UI chrome and fragmented dialogue.

| Field | Value |
|---|---|
| **Date** | 2026-06-30 |
| **Component** | `mcp-server` analytics / embedding pipeline (`graph-index.mjs`, `relations.mjs`, `server.mjs`) |
| **Severity** | High (core retrieval feature unusable; no data loss, no privacy breach) |
| **Status** | Resolved (with documented residual risk) |

---

## 1. Summary

NotiKeeper's semantic search returned noisy, irrelevant results and the dashboard graph rendered a node set full of UI-chrome and near-duplicate entities. The embedding stage (`embedMessages()` in `graph-index.mjs`) had no source filter and no fragment merging: its `SELECT id, text FROM messages ORDER BY id` query embedded the `messages` table one-vector-per-row across all 10,212 rows, of which 97.3% (9,933 rows) were non-conversational Messenger accessibility dumps and app notifications, and the remaining 2.7% of real dialogue was shattered into tiny same-timestamp bubbles by the ADB scraper. (In practice only 1,684 vectors actually persisted — the stale graph node-mirror capped `addVector`; see §9.) The fix replaces per-message embedding with a turn-based chunker that embeds only `scrape`-source dialogue, coalescing consecutive same-speaker fragments into 114 conversational turns. Search now returns relevant merged turns with zero chrome leakage.

## 2. Impact

- **Semantic search degraded to unusable.** Queries against the archive surfaced inbox chrome ("Seen by", "active now", "11:09 PM", "Chats, 12 unread, Tab 1 of 4"), GitHub CI spam, weather/promo notifications, and 1–2 word bubble fragments instead of coherent dialogue. With 97.3% of the embedded corpus being noise, relevant turns were buried.
- **Dashboard graph view degraded.** The graph rendered a node set dominated by junk thread titles and duplicate/near-duplicate "components", making the relationship view unreadable. (After the view-layer fix the same view returns 24 nodes / 20 edges; the pre-fix count was not separately measured.) Node labels were additionally near-invisible (near-black `#0F1B2D` text on the dark canvas).
- **Who was affected:** the device owner — the sole user — when using Claude (via the MCP tools) and the browser dashboard to search and explore their own captured message archive. No external users; this is a personal-use tool.

## 3. Detection

The evidence does not record a specific detection event; the following is inferred from the symptom class, not from a logged user report. The defect is one that surfaces through direct use rather than an automated alert (there is no monitoring on retrieval quality):

1. The **dashboard graph would have read as visually noisy** — far too many nodes, full of UI-chrome labels and duplicate-looking entities — because 97.3% of the indexed corpus was non-conversational.
2. **Search/chat results would not have matched the actual on-screen conversation** — returning interface text and fragments rather than dialogue.

Both symptoms point at the same data layer: the thing being indexed was not conversation. (No quoted user observation exists in the evidence; the absence of any retrieval-quality health metric is itself a contributing gap — see §10.)

## 4. Timeline (investigation and fix)

1. **Reproduce the corpus.** Queried `relations.db` `messages` table grouped by `source`: `screen=9813`, `scrape=279`, `noti=120` (total 10,212). Confirmed `screen` rows are full accessibility-tree dumps/notifications, not dialogue; only `scrape` rows are clean in-chat dialogue.
2. **Inspect the embed stage.** Read `git HEAD` `graph-index.mjs`: `embedMessages()` ran `SELECT id, text FROM messages ORDER BY id` and called `embed(r.text)` + `gdb.addVector(...)` for **every** row into `COLLECTION='messages'`, with no source filter, no merging, and raw text only (no sender/thread/side metadata). Only 1,684 of the 10,212 intended vectors actually persisted (the stale node-mirror rejected the rest).
3. **Quantify the noise.** 52.3% of all messages are <20 chars (5,344/10,212); within `scrape` dialogue specifically, 74.9% (209/279) are <20 chars — the fragmentation signature.
4. **Confirm fragmentation.** 269/279 scrape fragments (96.4%) sit in same-`(thread_id, time)` multi-message groups; worst case is the Faah Sky thread (id 60) with **153 consecutive scrape messages at one identical timestamp** (`1782670315071`).
5. **Implement turn-based chunking** (`buildTurns()`), embedding only `scrape` rows into a new `'turns'` collection.
6. **Hit and resolve secondary bugs:** GenesisBlock has no delete API (orphan vectors), Ollama drops requests under concurrency, and the graph node-mirror is stale.
7. **Verify** live via `curl` against `/api/graph/search` in both semantic and hybrid modes, plus direct `buildTurns()` reproduction and a chrome-leak probe.

## 5. Root Cause

**The ETL/index layer treated every captured accessibility row as a conversational message at message-bubble granularity.** The embedding unit was "one raw `messages` row → one vector," with no filter to distinguish dialogue from interface chrome and no merge step to reassemble dialogue that the scraper had split across bubbles. The vast majority of rows are accessibility-tree UI dumps, so the vector space — and therefore search and the graph — was overwhelmingly non-conversational. (The HEAD code's intent was to embed all 10,212 rows; only 1,684 actually persisted because the stale node-mirror rejected `addVector` for ids beyond its snapshot — see §9. The composition problem holds regardless: every persisted vector was a raw row, mostly chrome.)

**5-Whys:**

1. **Why was semantic search noisy?** Because the `'messages'` vector collection was dominated by non-conversational text (97.3% of the embedded set was chrome/notifications).
2. **Why was chrome in the vector collection?** Because `embedMessages()` embedded **every** row of the `messages` table with no `source` filter.
3. **Why did the `messages` table contain so much chrome?** Because `screen`-source rows (9,813 of 10,212) are full Messenger accessibility-tree dumps; the ETL chrome filter (`looksLikeChromeLabel` in `relations.mjs`) only strips the shortest button labels, so timestamp/status/notification lines survive into the table.
4. **Why was even the real dialogue low-quality?** Because the ADB scraper batch-captures a single spoken burst as many tiny bubbles that share one timestamp (74.9% of scrape rows <20 chars; up to 153 fragments at the same timestamp), and the pipeline never reassembled them — each fragment became its own weak vector.
5. **Why was the granularity "one row = one vector" in the first place?** Because the original design assumed every captured row was a discrete, self-contained message — an assumption that was false for both the `screen` source (chrome) and the `scrape` source (fragmented dialogue).

## 6. Contributing Factors

- **ADB batch-timestamp fragmentation.** The scraper assigns one timestamp to a whole scroll-captured burst, producing same-`(thread, time)` groups up to 153 messages large, fragmenting one utterance into many bubbles.
- **No source filter at embed time.** `embedMessages()` embedded all sources indiscriminately; the only chrome filtering (`relations.mjs:21-64`) ran at ETL time and stripped only the shortest labels.
- **GenesisBlock has no delete/drop vector API.** `index.d.ts` (lines 190–232) exposes only additive ops (`createCollection`, `addVector`, `addNode`, `supersedeNode`, `retractEdge`); grep for `delete|drop|remove|clear|purge|evict` returns zero matches. Re-embedding with shifted turn boundaries can only *add* vectors, never remove superseded ones — guaranteeing orphan accumulation.
- **Ollama embedding endpoint drops requests under concurrency.** At 16 parallel requests ~24/138 embeds failed (~17% loss), forcing a small batch size.
- **Stale graph node-mirror.** `graph.db` holds a 1,488-node / 3,418-edge snapshot vs ~10,960 entities in `relations.db`; `addVector` requires a pre-existing node, so any rep id newer than the snapshot fails with "node not found." (This is also why only 1,684 vectors persisted into the old `'messages'` collection rather than the intended 10,212.)

## 7. Resolution

### Primary fix — turn-based chunk refinement (`graph-index.mjs`)

- **`buildTurns()`** reads **only** `scrape`-source rows (`WHERE source='scrape' ORDER BY thread_id, time, id`), coalesces consecutive same-`(thread_id, side, sender_id)` fragments within `windowMs = 5 min` into one turn, drops fragments `< minFragChars=2`, de-dupes intra-turn repeats, and drops final turns `< minTurnChars=8`. `repId` = the first fragment's id (a real Message node). Result: of the 279 scrape rows, 250 fragments are consumed into **114 turns** (62 turns merge >1 fragment; turn length min/median/max = 8/27/194 chars). The other 9,933 rows (screen + noti) are excluded by the `WHERE source='scrape'` clause, not reduced.
- **New collection** `COLLECTION='turns'`; the old per-message `'messages'` collection is deliberately left in place because there is no delete API. `TURNS_PATH=./turns.json` persists the turn map.
- **`writeTurnMap()` / `turnMap()`** persist `turns.json` (keyed by `msgId(repId)` → merged text, fragment ids, thread/sender/side/time) and build the cached `{reps, fragToRep, repSet}` lookup. `turns.json` is the source of truth; the vector store is treated as append-only/untrustworthy. Added to `.gitignore`.
- **`embedMessages()` rewritten** to embed merged `turn.text` under `msgId(t.repId)`.

### Secondary fix 1 — orphan-vector masking (no delete API)

`searchSemantic()` over-fetches `k:Math.max(k*5, 80)` candidates (a floor of 80, so for small `k` the multiplier exceeds 5×), then drops any hit whose id is not in the current `repSet` (`if (repSet.size && !repSet.has(n.id)) continue;`), masking the orphan vectors that cannot be physically deleted. It overlays the merged turn text via `reps[n.id].text`. `searchHybridRRF()` lifts raw sparse (FTS) fragment ids to their turn rep via `fragToRep.get(id) || (repSet.has(id)?id:null)` and **drops fragments belonging to no turn** (i.e. chrome), so dense and sparse lists share one id-space; result labels changed to `["Message","Turn"]`.

### Secondary fix 2 — Ollama concurrency

`batchSize` lowered from 32 → **4**, with a comment recording that 16 parallel requests dropped ~24/138 embeds while 4 is clean.

### Related view-layer fixes (distinct from the data-quality fix)

- **Dashboard graph junk filter (`server.mjs`):** `GRAPH_JUNK_RE` / `GRAPH_JUNK_SET` / `isJunkTitle()` filter junk thread titles; `byName` dedups by keeping the highest `message_count` per name; `cleanThreads/cleanThreadIdSet/cleanParts` propagate the filter to participants so user nodes orphaned from junk threads are dropped too. The filtered `/api/graph/view` now returns 24 nodes / 20 edges.
- **Node label color (UI contrast, separate root cause):** `NODE_STYLE` `fontColor` `#0F1B2D` → `#E6EEF8` plus `nodes.font {color:'#E6EEF8', ...}` in `dashboard.html` vis-network options. This is a vis-network default-contrast bug, unrelated to chunking/embedding.

## 8. Verification

Reproduced live against the running server and DB:

- **Reduction confirmed:** `buildTurns(relations.db)` returns exactly **114 turns**; `turns.json` on disk has exactly 114 reps — a ~89.6× reduction vs the raw-row baseline.
- **Relevant query works:** `GET /api/graph/search?q=ตกเลือดไปโรงพยาบาล&mode=semantic` → `count=20`, **all `source=scrape`**, all full merged turns. Top hit `msg:1209` score 0.381 = a complete sentence about bleeding/calling a hospital car; `msg:1196` is a 190-char multi-fragment merged turn, proving coalescing.
- **Chrome probe clean (both modes):** query `"Seen by active now unread messages"` returns 20 hits in semantic and 20 in hybrid mode, 100% `source=scrape`, with **zero** hits containing inbox chrome (`Seen by` / `active now` / `Tab N` / `unread` / `Chats,`), verified by regex over hit text (0 matches).
- **Hybrid fusion neutralizes sparse chrome:** `searchLexical(db, 'Seen by')` returns its full default page of 50 FTS hits (the function's `limit` defaults to 50, and chrome is still in the sparse index — at least 268 messages contain "Seen"), yet hybrid mode surfaces **0** of them — the `fragToRep` drop-non-turn logic removes them.
- **Orphan-free at query time:** 20/20 semantic hits unique; orphan-leak check (hits outside current `turns.json` reps) = `[]`. The `repSet` filter masks all 456 orphan vectors.
- **Turn map sane:** 114 unique reps covering 250 fragment ids, 0 fragments claimed by >1 turn.

## 9. Residual Risk / Known-Not-Fixed

- **Filtering lives at the query/view layer, not the ETL/store layer.** `relations.db` and the graph node-mirror still physically hold all 9,813 `screen` chrome rows; only search and the dashboard view mask them. The sparse FTS index still contains chrome (at least 268 messages match "Seen"; `searchLexical("Seen by")` returns a full default page of 50).
- **Orphan vectors remain on disk.** The `'turns'` collection physically holds **570** vectors vs 114 current reps (**456 orphans**, masked at query time); the abandoned `'messages'` collection holds **1,684** unused vectors (that 1,684 — not the intended 10,212 — is all that ever persisted, because the stale node-mirror rejected `addVector` for ids beyond its snapshot). Total dead vectors in `graph.db` = **2,140**. No delete API exists to reclaim them. *(These live collection/snapshot counts come from the evidence session's `listCollections` / snapshot-load logs and `state.json`; they could not be independently re-verified at write time because the running server holds an exclusive lock on `graph.db`. They are internally consistent: 570−114=456, `logical_clock` 7787, and the three collections turns/default/messages match `state.json`.)*
- **Stale graph node-mirror not rebuilt.** `graph.db` snapshot = 1,488 nodes / 3,418 edges vs ~10,960 entities in `relations.db`; ~85% of message rows have no graph node. The scrape-only filter sidesteps this (scrape rows were captured early), but any future scrape ids beyond the snapshot would fail `addVector`.
- **ETL is stale relative to raw capture.** `relations.db` holds 10,212 messages; live `/api/stats` (reads `data.jsonl`) reports total **34,827** rows — the search corpus is ~24,615 rows behind the raw log. A re-ETL would reintroduce these issues at larger scale unless the source filter is pushed down first.
- **Thai sparse-search gap.** FTS5 uses a trigram tokenizer (correct for spaceless Thai), but the full query `ตกเลือดไปโรงพยาบาล` yields 0 FTS hits while the contiguous term `โรงพยาบาล` yields 30 — multi-word Thai queries lean entirely on the dense side.
- **Relation refinement not done:** 1↔1 thread/user pairs not collapsed; no explicit "Me" node; unicode-corrupted duplicate display names not entity-resolved.
- **Schema comment drift (cosmetic):** `relations.mjs` documents `messages.source` as `"noti" | "screen"` only, omitting the active `'scrape'` value.

## 10. Action Items / Prevention

| Item | Rationale | Priority |
|---|---|---|
| Push the `source`/junk filter down into ETL (`relations.mjs`) and the node-mirror, not just the search/view layer | Chrome still physically present in `relations.db`, FTS index, and graph mirror; a re-ETL would otherwise re-pollute everything | **P0** |
| Add periodic `graph.db` compaction / rebuild to purge orphan vectors (e.g. rebuild collection from `turns.json` into a fresh DB) | 2,140 dead vectors accumulate with no delete API; orphans grow on every re-embed and only query-time masking hides them | **P0** |
| Add a regression query-set for search quality (relevant + chrome-probe queries with expected/forbidden hits) run on every re-index | There is no retrieval-quality monitoring; an automated chrome-leak/relevance check would catch regressions on re-ETL before they reach the user | **P1** |
| Rebuild the graph node-mirror to match `relations.db`, then re-ETL the ~24,615-row backlog | `addVector` requires existing nodes; stale mirror silently drops newer reps (only 1,684/10,212 vectors persisted) and the corpus is 24k rows behind raw capture | **P1** |
| Embed sender/thread/side/time metadata into turn vectors (or as payload) | Current vectors carry merged text only; metadata would improve disambiguation and enable filtered retrieval | **P2** |
| Entity-resolution for unicode-corrupted / duplicate display names; collapse 1↔1 thread↔user; add explicit "Me" node | Graph still shows near-duplicate entities the name-dedup view only partially masks | **P2** |
| Fix stale schema comment to include `'scrape'` | Comment drift misleads future maintainers about valid `source` values | **P3** |

## 11. Lessons Learned

- **Capture granularity is not retrieval granularity.** An accessibility-tree row and a notification are not "messages"; treating raw capture rows as the embedding unit guaranteed a corpus that was 97.3% noise. Define the semantic unit (a conversational turn) explicitly and build it deliberately.
- **Filter at the source of truth, not at the edges.** Masking chrome only in search and the dashboard view left it live in `relations.db`, the FTS index, and the graph mirror — so every layer had to re-implement the filter and a re-ETL would undo the fix. Filtering belongs as far upstream as possible.
- **Append-only stores demand a single source of truth and idempotent rebuilds.** Because GenesisBlock cannot delete vectors, shifting turn boundaries permanently orphaned 2,140 vectors. `turns.json` as the authoritative rep set plus query-time `repSet` masking was the right mitigation, but the durable answer is rebuild-into-a-fresh-collection.
- **Know your infrastructure limits before designing the write path.** The no-delete API and the Ollama concurrency ceiling (~17% drop at 16 parallel) both forced design choices (new collection name, `batchSize=4`) that would have been cheaper to design for upfront than to discover mid-fix. The same stale node-mirror that broke `addVector` also silently capped the original embed at 1,684/10,212 vectors — a write path that fails partially and silently is its own hazard.
- **Measure the noise before trusting the index.** Simple distributional checks — source breakdown, length percentiles, same-timestamp burst sizes (up to 153) — exposed the root cause immediately and should be standing health metrics on any ingest pipeline. There was no retrieval-quality monitoring at all, so the defect was only ever going to surface through manual use.
