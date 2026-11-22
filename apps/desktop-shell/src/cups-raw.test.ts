import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
// @ts-expect-error Node 24 runs TypeScript test files directly.
import { printCupsRaw } from "./cups-raw.ts";

function fakeRunner({ exitCode = 0, stderrText = "" } = {}) {
  const calls: Array<{
    command: string;
    args: string[];
    options: unknown;
    data: Buffer;
  }> = [];
  const runner = ((command: string, args: string[], options: unknown) => {
    const child = new EventEmitter() as EventEmitter & {
      stdin: PassThrough;
      stderr: PassThrough;
      kill: () => void;
    };
    child.stdin = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => undefined;
    const chunks: Buffer[] = [];
    child.stdin.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    child.stdin.once("finish", () => {
      calls.push({ command, args, options, data: Buffer.concat(chunks) });
      if (stderrText) child.stderr.write(stderrText);
      child.emit("close", exitCode, null);
    });
    return child;
  }) as never;
  return { calls, runner };
}

test("submits one explicit raw CUPS job with binary stdin and one copy", async () => {
  const { calls, runner } = fakeRunner();
  const data = Buffer.from([0x1b, 0x40, 0x00, 0xff]);
  await printCupsRaw("Kitchen_Printer", data, runner);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.command, "/usr/bin/lp");
  assert.deepEqual(calls[0]?.args, [
    "-d",
    "Kitchen_Printer",
    "-o",
    "raw",
    "-o",
    "job-sheets=none,none",
    "-n",
    "1",
    "-t",
    "Delta Nube - Ticket",
    "-",
  ]);
  assert.deepEqual(calls[0]?.options, {
    shell: false,
    stdio: ["pipe", "ignore", "pipe"],
  });
  assert.deepEqual(calls[0]?.data, data);
});

test("reports a bounded stderr message when lp exits unsuccessfully", async () => {
  const { runner } = fakeRunner({
    exitCode: 7,
    stderrText: `${"x".repeat(2_100)} tail`,
  });
  await assert.rejects(
    printCupsRaw("Kitchen", Buffer.from([1]), runner),
    (error: Error) => {
      assert.match(error.message, /código 7/);
      assert.ok(error.message.length < 2_100);
      assert.doesNotMatch(error.message, /tail/);
      return true;
    },
  );
});

test("rejects empty, NUL, and option-shaped destinations before spawning", async () => {
  const { calls, runner } = fakeRunner();
  for (const destination of [
    "",
    "   ",
    "Bad\0Queue",
    "-o",
    "Bad Queue",
    "Bad/Queue",
    "Bad#Queue",
  ]) {
    await assert.rejects(printCupsRaw(destination, Buffer.from([1]), runner));
  }
  assert.equal(calls.length, 0);
});

test("reports a process spawn failure", async () => {
  const runner = (() => {
    throw new Error("ENOENT");
  }) as never;
  await assert.rejects(
    printCupsRaw("Kitchen", Buffer.from([1]), runner),
    /No se pudo iniciar lp: ENOENT/,
  );
});

test("reports an asynchronous child process error", async () => {
  const child = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stderr: PassThrough;
    kill: () => void;
  };
  child.stdin = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => undefined;
  const runner = (() => {
    setImmediate(() => child.emit("error", new Error("spawn failed")));
    return child;
  }) as never;
  await assert.rejects(
    printCupsRaw("Kitchen", Buffer.from([1]), runner),
    /No se pudo iniciar lp: spawn failed/,
  );
});

test("reports an asynchronous stdin piping error", async () => {
  const child = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stderr: PassThrough;
    kill: () => void;
  };
  child.stdin = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => undefined;
  const runner = (() => {
    setImmediate(() => child.stdin.destroy(new Error("pipe failed")));
    return child;
  }) as never;
  await assert.rejects(
    printCupsRaw("Kitchen", Buffer.from([1]), runner),
    /No se pudo enviar el ticket a CUPS: pipe failed/,
  );
});
