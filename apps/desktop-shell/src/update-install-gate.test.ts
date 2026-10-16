import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node 24 runs TypeScript test files directly.
import { UpdateInstallGate } from "./update-install-gate.ts";

const closed = () => ({ permitted: true, cashOpen: false });

test("update gate rejects open cash and unauthorized install without locking operations", () => {
  const gate = new UpdateInstallGate();
  assert.throws(
    () => gate.beginInstall(() => ({ permitted: true, cashOpen: true })),
    /Cerrá la caja/,
  );
  assert.throws(
    () => gate.beginInstall(() => ({ permitted: false, cashOpen: false })),
    /permiso/,
  );
  gate.enterOperation()();
  assert.equal(gate.installationInProgress, false);
});

test("update gate holds operations including async preflight, printing and licensing until settled", async () => {
  const gate = new UpdateInstallGate();
  const release = gate.enterOperation();
  await Promise.resolve();
  assert.throws(() => gate.beginInstall(closed), /Esperá/);
  assert.throws(() => gate.beginRestore(), /Esperá/);
  release();
  release(); // cleanup is idempotent
  gate.beginInstall(closed);
  assert.throws(() => gate.enterOperation(), /actualización/);
  assert.throws(() => gate.beginRestore(), /Esperá/);
  assert.throws(() => gate.beginInstall(closed), /Esperá/);
});

test("restore blocks update admission; install error releases admission for subsequent work", () => {
  const gate = new UpdateInstallGate();
  gate.beginRestore();
  assert.throws(() => gate.beginInstall(closed), /Esperá/);
  assert.throws(() => gate.enterOperation(), /restauración/);
  gate.endRestore();
  gate.beginInstall(closed);
  gate.cancelInstall();
  gate.enterOperation()();
  gate.beginRestore();
  gate.endRestore();
  gate.beginInstall(closed);
  assert.equal(gate.installationInProgress, true);
});
