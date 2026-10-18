import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node 24 runs TypeScript test files directly.
import { measurePrintStage } from "./print-timing.ts";

test("timing records successful stage duration and bounded metadata only", async () => {
  const records: unknown[] = [];
  const value = await measurePrintStage(
    "loadURL",
    (record) => records.push(record),
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 12));
      return "loaded";
    },
  );
  assert.equal(value, "loaded");
  assert.equal(records.length, 1);
  const [record] = records as [
    {
      stage: string;
      durationMs: number;
      outcome: string;
      maxEventLoopDelayMs: number;
    },
  ];
  assert.equal(record.stage, "loadURL");
  assert.ok(record.durationMs >= 1 && record.durationMs < 1_000);
  assert.equal(record.outcome, "success");
  assert.ok(record.maxEventLoopDelayMs >= 0);
  assert.deepEqual(Object.keys(record).sort(), [
    "durationMs",
    "maxEventLoopDelayMs",
    "outcome",
    "stage",
  ]);
});

test("timing records failures and preserves the original error", async () => {
  const records: unknown[] = [];
  const expected = new Error("private order data");
  await assert.rejects(
    measurePrintStage(
      "nativeprint",
      (record) => records.push(record),
      async () => {
        throw expected;
      },
    ),
    (error) => error === expected,
  );
  assert.equal(records.length, 1);
  const [record] = records as [
    {
      stage: string;
      durationMs: number;
      outcome: string;
      maxEventLoopDelayMs: number;
    },
  ];
  assert.equal(record.stage, "nativeprint");
  assert.ok(record.durationMs >= 0);
  assert.equal(record.outcome, "error");
  assert.ok(record.maxEventLoopDelayMs >= 0);
});

test("resolved native callback failures can be recorded as errors", async () => {
  const records: unknown[] = [];
  const result = await measurePrintStage(
    "nativeprint",
    (record) => records.push(record),
    async () => ({ success: false, reason: "cancelled" }),
    (value) => (value.success ? "success" : "error"),
  );
  assert.equal(result.success, false);
  assert.equal((records[0] as { outcome: string }).outcome, "error");
});

test("observer failures cannot alter the measured operation", async () => {
  assert.equal(
    await measurePrintStage(
      "layout",
      () => {
        throw new Error("observer failure");
      },
      async () => 42,
    ),
    42,
  );
});
