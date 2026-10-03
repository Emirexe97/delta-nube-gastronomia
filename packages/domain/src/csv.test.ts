import assert from "node:assert/strict";
import test from "node:test";
import { csvCell } from "./csv";

test("csvCell quotes, escapes and neutralizes formula-like text", () => {
  assert.equal(csvCell('hello, "world"'), '"hello, ""world"""');
  assert.equal(csvCell(" \t=1+1"), '"\' \t=1+1"');
  assert.equal(csvCell("-5"), '"\'-5"');
  assert.equal(csvCell(-5), '"-5"');
});
