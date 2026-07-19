import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const serverSource = fs.readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
const noiseBlock = serverSource.match(/const NOISE_APPS[\s\S]*?\n}\n\nfunction sendJson/);
assert.ok(noiseBlock, "server noise classifier must remain available for characterization");
const classifyNoise = new Function(`${noiseBlock[0].replace(/\nfunction sendJson$/, "")}; return classifyNoise;`)();

test("shared chrome labels preserve the existing row keep/drop boundary", () => {
  const fixtures = [
    { name: "noti message", row: { source: "noti", text: "hello there" }, tag: null },
    { name: "screen row", row: { source: "screen", text: "Messages" }, tag: null },
    { name: "scrape dialogue", row: { source: "scrape", text: "long enough dialogue" }, tag: null },
    { name: "Thai one-word reply", row: { source: "screen", text: "ครับ" }, tag: null },
    { name: "URL", row: { source: "noti", text: "https://example.test/sticker" }, tag: "sticker-url" },
    { name: "promo notification", row: { source: "noti", text: "Sale today" }, tag: "promo" },
    { name: "Messenger chrome", row: { source: "screen", text: "Active now" }, tag: null },
  ];

  for (const { name, row, tag } of fixtures) {
    assert.equal(classifyNoise(row), tag, name);
  }
});
