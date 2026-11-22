import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node 24 runs TypeScript test files directly.
import { encodeEscPosTicket } from "./escpos-ticket.ts";

const profile = {
  profileName: "test",
  deviceName: "",
  mode: "ESC_POS" as const,
  paperWidth: "58mm" as const,
  charsPerLine: 32,
  copies: 1,
  cutter: false,
  cutMode: "PARTIAL" as const,
  feedLinesBeforeCut: 0,
};
const payload = (bytes: Buffer) => bytes.subarray(5);

test("encodes known Spanish and ticket glyphs as CP850 bytes", () => {
  const bytes = encodeEscPosTicket("Ññ½·×", profile);
  assert.deepEqual([...bytes.subarray(0, 5)], [0x1b, 0x40, 0x1b, 0x74, 2]);
  // CP850: Ñ=a5, ñ=a4, ½=ab, ·=fa, ×=9e.
  assert.deepEqual(
    payload(bytes),
    Buffer.from([0xa5, 0xa4, 0xab, 0xfa, 0x9e, 0x0a]),
  );
});

test("normalizes money spacing and common punctuation, and filters controls", () => {
  const bytes = encodeEscPosTicket(
    "Total $ 1.200,00 — “cafe” · si\u001b@\u0000\r\n\n  fin",
    profile,
  );
  assert.deepEqual(
    payload(bytes),
    Buffer.concat([
      Buffer.from('Total $ 1.200,00 - "cafe" '),
      Buffer.from([0xfa]), // CP850 middle dot.
      Buffer.from(" si\nfin\n"),
    ]),
  );
  assert.equal(payload(bytes).includes(0x1b), false);
});

test("wraps to paper/profile width with a minimum width for invalid values", () => {
  const tooWide = encodeEscPosTicket("123456789012345678901234567890123", {
    ...profile,
    charsPerLine: 99,
  });
  assert.equal(
    payload(tooWide).toString("latin1"),
    "12345678901234567890123456789012\n3\n",
  );

  const tooNarrow = encodeEscPosTicket("12345678901234567890123456789", {
    ...profile,
    charsPerLine: 2,
  });
  assert.equal(
    payload(tooNarrow).toString("latin1"),
    "12345678901234567890\n123456789\n",
  );
});

test("bounds copies and feed, and emits the configured cut for each copy", () => {
  const bytes = encodeEscPosTicket("A", {
    ...profile,
    copies: 20,
    cutter: true,
    cutMode: "PARTIAL",
    feedLinesBeforeCut: 9,
  });
  assert.equal(bytes.filter((byte) => byte === 0x1d).length, 3);
  assert.equal(bytes.filter((byte) => byte === 0x0a).length, 3 * 8 + 3);
  assert.deepEqual([...bytes.subarray(-3)], [0x1d, 0x56, 1]);

  const fullCut = encodeEscPosTicket("A", {
    ...profile,
    cutter: true,
    cutMode: "FULL",
  });
  assert.deepEqual([...fullCut.subarray(-3)], [0x1d, 0x56, 0]);
});

test("does not cut when disabled and separates uncutted copies", () => {
  const bytes = encodeEscPosTicket("A", { ...profile, copies: 2 });
  assert.equal(bytes.includes(0x1d), false);
  assert.equal(payload(bytes).toString("latin1"), "A\n\nA\n");
});
