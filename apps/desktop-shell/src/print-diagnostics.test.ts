import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
// @ts-expect-error Node 24 runs TypeScript test files directly.
import { createPrintDiagnostics } from "./print-diagnostics.ts";

test("writes sanitized timing records with unique run ids", async () => {
  const directory = await mkdtemp(join(tmpdir(), "print-diagnostics-"));
  try {
    const diagnostics = createPrintDiagnostics(directory);
    const first = diagnostics.start();
    const second = diagnostics.start();
    first({
      stage: "layout",
      durationMs: 12.6,
      outcome: "success",
      maxEventLoopDelayMs: 2,
      // Runtime callers may pass additional data; the logger must discard it.
      html: "sensitive ticket",
      printer: "private device",
    } as never);
    second({
      stage: "nativeprint",
      durationMs: 42,
      outcome: "error",
      maxEventLoopDelayMs: 0,
    });
    await diagnostics.flush();

    const lines = (
      await readFile(join(directory, "print-timing.jsonl"), "utf8")
    )
      .trim()
      .split("\n");
    const records = lines.map((line) => JSON.parse(line));
    assert.equal(records.length, 2);
    assert.notEqual(records[0].runId, records[1].runId);
    assert.equal(records[0].stage, "layout");
    assert.equal(records[0].durationMs, 13);
    assert.equal(records[1].outcome, "error");
    for (const record of records) {
      assert.deepEqual(Object.keys(record).sort(), [
        "durationMs",
        "maxEventLoopDelayMs",
        "outcome",
        "runId",
        "stage",
        "time",
      ]);
      assert.ok(Number.isFinite(record.maxEventLoopDelayMs));
      assert.ok(record.maxEventLoopDelayMs >= 0);
      assert.ok(Number.isFinite(Date.parse(record.time)));
    }
    assert.ok(!JSON.stringify(records).includes("sensitive ticket"));
    assert.ok(!JSON.stringify(records).includes("private device"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rotates the active JSONL file at one megabyte", async () => {
  const directory = await mkdtemp(join(tmpdir(), "print-diagnostics-"));
  try {
    const diagnostics = createPrintDiagnostics(directory);
    const record = diagnostics.start();
    for (let batch = 0; batch < 100; batch++) {
      for (let index = 0; index < 100; index++) {
        record({
          stage: "loadURL",
          durationMs: 120,
          outcome: "success",
          maxEventLoopDelayMs: 0,
        });
      }
      await diagnostics.flush();
    }
    const active = await stat(join(directory, "print-timing.jsonl"));
    const previous = await stat(join(directory, "print-timing.jsonl.1"));
    assert.ok(active.size <= 1_000_000);
    assert.ok(previous.size <= 1_000_000);
    assert.ok(active.size > 0);
    assert.ok(previous.size > 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("swallows filesystem failures", async () => {
  const directory = await mkdtemp(join(tmpdir(), "print-diagnostics-"));
  try {
    const blockedPath = join(directory, "regular-file");
    await writeFile(blockedPath, "not a directory");
    const diagnostics = createPrintDiagnostics(join(blockedPath, "child"));
    assert.doesNotThrow(() => {
      diagnostics.start()({
        stage: "getPrinters",
        durationMs: 1,
        outcome: "error",
        maxEventLoopDelayMs: 0,
      });
    });
    await assert.doesNotReject(diagnostics.flush());
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
