import test from "node:test";
import assert from "node:assert/strict";
import { looksLikeNameOrChromeShape } from "../llm-gate.mjs";

test("guardrail preserves real reply and preview shapes", () => {
  for (const text of ["ok", "thanks", "You: hello", "Draft: reply", "สวัสดี"]) {
    assert.equal(looksLikeNameOrChromeShape(text), false, text);
  }
});

test("guardrail rejects known chrome and name shapes", () => {
  for (const text of [
    "Netflix", "Go back", "CAISHEN WINS", "THB 5000", "f*******",
    "chinesewithmee", "AQI 42", "Boo", "Milk Jidapa",
  ]) {
    assert.equal(looksLikeNameOrChromeShape(text), true, text);
  }
});
