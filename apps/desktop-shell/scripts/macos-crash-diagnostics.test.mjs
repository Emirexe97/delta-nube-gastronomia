import test from "node:test";
import assert from "node:assert/strict";
import { summarizeCrash } from "./macos-crash-diagnostics.mjs";

test("Mac IPS diagnostics extract the crashing thread from two JSON documents", () => {
  const report = {
    procName: "POS",
    exception: { signal: "SIGTRAP" },
    faultingThread: 1,
    threads: [
      { frames: [{ symbol: "unrelated" }] },
      { frames: [{ symbol: "crash" }] },
    ],
    usedImages: [{ name: "Electron", arch: "arm64", path: "private path" }],
  };
  const result = summarizeCrash("{}\n" + JSON.stringify(report));
  assert.equal(result.frames[0].symbol, "crash");
  assert.equal(result.exception.signal, "SIGTRAP");
  assert.deepEqual(result.images, [{ name: "Electron", arch: "arm64" }]);
});

test("single JSON reports and absent thread details are supported", () => {
  assert.equal(summarizeCrash('{"procName":"POS"}').procName, "POS");
  assert.equal(summarizeCrash('{"procName":"POS"}').frames, undefined);
});
