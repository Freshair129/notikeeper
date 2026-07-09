# RCA — On-device notification dedup keyed on time, so reposted spam stored as new rows

- **Symptom:** Spam/promo channels (e.g. LV177 on Telegram) that repost the exact same message repeatedly show up as many separate rows in the phone's archive and feed. The server-side cleanup removed them from the PC copy, but the phone's own `noti.db` kept accumulating them, and PC could not reach back to delete on-device rows.

- **Evidence:** `NotiStore.insertNoti()` built its UNIQUE dedup key as `"noti:$title:$text:$postTime"` ([NotiStore.kt:75](../../app/src/main/java/com/example/notikeeper/data/NotiStore.kt)). `postTime` is Android's notification post time, which is fresh on every repost. So two identical notifications an hour apart produced two different keys → both stored. (The `screen:` source key already excluded time — `"screen:$sender:$side:$text"` — so screen captures were never affected; only `noti` source had the bug.)

- **Root Cause:** The dedup key conflated *identity of content* with *time of arrival*. For a content archive, two identical notifications are the same logical message; the timestamp is metadata, not part of the message's identity.

- **Why it escaped detection:** The key was written when the only concern was "don't store the literal same notification object twice"; the repost-with-new-timestamp spam pattern wasn't anticipated. No test exercised "identical text, different time."

- **Prevention:** Key is now `"noti:$pkg:$title:$text"` — content identity only, plus `pkg` to avoid collisions across apps (matching the PC server's exact-match dedup semantics, so phone and PC stay consistent). Trade-off: a genuinely repeated short message ("ครับ", "555") is now also collapsed to one on the phone — but the PC store already does this, so it introduces no new divergence. Forward-looking only: rows already stored under the old time-inclusive key remain until a future maintenance pass (out of scope for this fix).
