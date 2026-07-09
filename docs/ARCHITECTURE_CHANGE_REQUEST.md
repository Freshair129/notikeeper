# ARCHITECTURE_CHANGE_REQUEST — PC-as-SSOT with raw-authoritative sync

**Status:** APPROVED by owner (Boss) 2026-07-09. Implementation proceeding — non-destructive phases (1, 3, 4) first; Phase 2 (prune) deferred pending phase-1 hardening.
**Date:** 2026-07-09
**Requested by:** Boss (owner) · drafted by claude-code
**Local LLM for the Phase 4 quality-gate (owner decision):** `hf.co/iapp/chinda-qwen3-4b-gguf:Q4_K_M` (Thai-tuned Qwen3-4B, Q4_K_M) served via Ollama chat API. ~2.5GB; owner pulls it. Gate degrades gracefully if the model is absent.

---

## Reason

The current architecture treats each device's local store as its own island:
the phone's encrypted `noti.db` is the on-device archive, and the PC's
`data.jsonl` → `relations.db` → GenesisBlock pipeline is a *separate* copy fed
by uploads. This creates three problems the owner wants solved:

1. **Storage asymmetry.** The phone is storage-constrained; the PC has far
   more room. The phone shouldn't be the long-term home of the full archive.
2. **No canonical truth.** Cleanups (dedup, noise removal) done on the PC
   can't propagate back to the phone, and vice versa — the two drift.
3. **Parse-quality asymmetry.** The phone does lightweight on-device denoise;
   the PC runs the full pipeline (relational ETL, chrome filters, turn
   chunking, embeddings). Today these run independently with no notion of
   which interpretation wins.

The owner's decision (2026-07-09): **PC becomes the single source of truth
(SSOT) for the canonical, cleaned, embedded archive. The phone becomes a
capture device + rolling buffer.** Authority flows one direction along a clear
rule: **raw capture is authoritative from the phone; parsed/derived views are
authoritative from the PC.**

## Chosen design (of the two considered — see Alternatives)

**Raw = SSOT (one-way) + PC-parse-wins + LLM as quality-gate + embed on PC.**

Data flow:

```
PHONE (capture + buffer)                     PC (canonical SSOT)
─────────────────────────                    ─────────────────────────
capture raw (native, unchanged)
   │
light denoise → LOCAL feed only              (phone's parse is display-only,
   │                                          never authoritative)
buffer ~1h  ── upload RAW (+denoise hint) ──▶ /ingest (append-only raw truth)
   │                                            │
   │                                          re-parse raw with FULL pipeline
after PC acks a raw range,                      │  (relations ETL + chrome filter)
prune that range from phone  ◀── ack ────────   │
(reclaim storage)                               ├─ LLM quality-gate on AMBIGUOUS
                                                │   lines only (real msg vs chrome),
phone may PULL cleaned view                     │   native + semantic, one-directional
for display (read model)     ◀── clean view ──  │
                                                └─ embed clean turns (BGE-M3, PC/Ollama)
```

Key rules:
- The phone never sends its *parsed* output as authority — only raw, plus an
  optional denoise *hint* the PC may use or ignore.
- The PC **always wins on interpretation** because it runs the strictly more
  capable parser. There is no bidirectional diff, no SSOT election.
- The **LLM runs only on the PC, only on genuinely ambiguous lines**
  (is-this-a-real-message-or-chrome), as a one-directional quality gate on the
  PC parser — not as a mobile-vs-PC reconciler.
- **Embedding stays on the PC** (BGE-M3 via Ollama, ~190ms/embed). Edge
  embedding is rejected — see Alternatives.

## Impact

**Improves:**
- Phone storage bounded (rolling buffer, prune-after-ack).
- One canonical cleaned+embedded archive; no phone/PC drift.
- Raw is never lost (append-only on PC); all cleaning is reproducible from it.
- Cleanups (dedup, noise) done once on the PC are authoritative.

**Breaks / requires new work:**
- New **ack protocol**: PC must acknowledge ingested raw ranges so the phone
  knows what's safe to prune. Today `/ingest` returns a count, not a durable
  high-water mark the phone can trust for deletion.
- New **phone prune logic** in `NotiStore` + upload flow (`Exporter`,
  `MainActivity` auto-upload effect).
- New **PC clean-view read model** + endpoint if the phone is to pull it.
- New **LLM quality-gate** stage in the PC parse pipeline (local LLM;
  model + endpoint TBD).
- `NotiStore.onUpgrade` currently DROPs the table on version change — the
  prune/ack model needs a real migration story, not a wipe.

## Affected modules

- `app/.../data/NotiStore.kt` — buffer semantics, prune-after-ack, migration.
- `app/.../Exporter.kt`, `MainActivity.kt` — upload flow + ack handling + pull.
- `mcp-server/server.mjs` — `/ingest` ack high-water mark; clean-view endpoint.
- `mcp-server/relations.mjs` — LLM quality-gate hook in the parse path.
- `mcp-server/graph-index.mjs` — embed clean turns (already PC-side; unchanged
  location, but must run after the quality gate).
- **Frozen boundary touched:** Phase 1 (System Architecture) — the SSOT
  location and the capture/store separation are architectural.

## Migration plan (phased — each phase independently shippable)

1. **Ack + high-water mark.** PC durably records the max ingested `(id, time)`;
   `/ingest` returns it; phone stores it. No deletion yet — pure bookkeeping.
2. **Phone prune.** Phone deletes raw older than the acked high-water mark AND
   older than a retention floor (e.g. keep last 7 days regardless). Reversible
   because PC has the raw.
3. **PC clean-view read model + pull.** Phone can optionally pull the cleaned
   view for display; local feed switches from phone-parse to PC-view when online.
4. **LLM quality-gate.** Add the local-LLM ambiguity classifier to the PC parse
   path; gate embeddings behind it. Model chosen:
   `hf.co/iapp/chinda-qwen3-4b-gguf:Q4_K_M` via Ollama chat API. Verdicts are
   cached per `sha256(pkg|title|text)` so each unique line is classified once
   and the pipeline stays deterministic given the cache.

## Risks

- **Data loss window.** With a ~1h buffer, if the phone dies before upload, that
  hour of raw is unrecoverable (phone is the sole raw source until upload).
  Mitigation: shorter buffer / upload-on-charge / keep raw until acked (already
  in the plan — never prune un-acked).
- **Prune correctness.** A bug in the ack/prune logic could delete on-device raw
  the PC never actually received. Mitigation: prune only strictly below a
  *confirmed* high-water mark, plus a retention floor; extensive tests before
  phase 2 ships.
- **LLM nondeterminism.** A quality-gate LLM makes the parse path
  non-deterministic; two PC re-parses could differ. Mitigation: cache the LLM
  verdict per raw line (verdict keyed on content hash), so it's decided once and
  reused — the *pipeline* stays deterministic given the verdict cache.
- **`onUpgrade` wipes the DB today.** Phase 2+ needs a real migration or the
  first schema bump destroys the buffer. Must be fixed before prune ships.
- **GenesisBlock has no `deleteVector`.** Cleaned-then-changed content leaves
  orphan vectors; the collection must be rebuilt (already how it works). Edge
  embedding is impossible with BGE-M3 regardless.

## Alternatives considered

1. **Dual-parse + diff + LLM SSOT-election + bidirectional sync** (owner's
   initial sketch). *Rejected.* If both sides run the same deterministic parser
   the diff is always empty and the LLM never fires; if they run different
   parsers, "PC always wins" is simpler and strictly correct without a
   consensus protocol. The bidirectional election adds distributed-consensus
   complexity for a conflict that doesn't meaningfully exist (raw has one
   source; parse has one clearly-better parser). The genuinely useful role for
   the LLM — classifying ambiguous lines — is preserved here as a one-way
   quality gate, which is where it actually adds value.

2. **Embed on the edge device.** *Rejected.* BGE-M3 (~560M params, needs
   Ollama + ~2GB RAM) is impractical for continuous on-device capture (battery,
   thermals). Viable edge models are tiny (20–40M) and give materially worse
   Thai semantic quality — negating the reason BGE-M3 was chosen. Capture on
   edge, embed on PC.

3. **Status quo (independent islands).** *Rejected.* Does not solve storage
   asymmetry or drift; the whole reason for the request.

---

> Requires explicit owner approval before any change to the frozen Phase 1
> architecture. On approval, this becomes the reference for the phased
> implementation above, each phase tracked as its own TASK in the queue.
