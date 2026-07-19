import test from "node:test";
import assert from "node:assert/strict";
import { classifyNoise, isSharedChromeLabel } from "../noise.mjs";

test("classifyNoise preserves the existing row keep/drop boundary", () => {
  const fixtures = [
    { name: "noti message", row: { source: "noti", text: "hello there" }, tag: null },
    { name: "screen row", row: { source: "screen", text: "Messages" }, tag: null },
    { name: "scrape dialogue", row: { source: "scrape", text: "long enough dialogue" }, tag: null },
    { name: "Thai one-word reply", row: { source: "screen", text: "ครับ" }, tag: null },
    { name: "URL", row: { source: "noti", text: "https://example.test/sticker" }, tag: "sticker-url" },
    { name: "promo notification", row: { source: "noti", text: "Sale today" }, tag: "promo" },
    { name: "Messenger chrome text", row: { source: "screen", text: "Active now" }, tag: null },
  ];

  for (const { name, row, tag } of fixtures) {
    assert.equal(classifyNoise(row), tag, name);
  }
});

test("isSharedChromeLabel matches only the shared chrome vocabulary", () => {
  for (const label of ["Active now", "Sent", "GIF", "Camera"]) {
    assert.equal(isSharedChromeLabel(label), true, label);
  }
  for (const notChrome of ["Active", "hello world", "ครับ", ""]) {
    assert.equal(isSharedChromeLabel(notChrome), false, JSON.stringify(notChrome));
  }
});
