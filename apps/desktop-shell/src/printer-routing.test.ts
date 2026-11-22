import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node 24 runs TypeScript test files directly.
import { resolvePrinterTarget } from "./printer-routing.ts";
import type { PrinterProfileDto } from "@gastronomy/contracts";

const profile: PrinterProfileDto = {
  profileName: "Comanda cocina",
  deviceName: "",
  mode: "SYSTEM_DIRECT",
  paperWidth: "80mm",
  charsPerLine: 42,
  copies: 1,
  cutter: true,
  cutMode: "PARTIAL",
  feedLinesBeforeCut: 2,
};
const devices = [
  { name: "Kitchen-Printer", isDefault: false },
  { name: "Default-Office", isDefault: true },
];

test("a mozo/kitchen direct ticket requires an explicitly selected device", () => {
  assert.equal(resolvePrinterTarget(profile, devices, true), null);
  assert.equal(
    resolvePrinterTarget(
      { ...profile, deviceName: "Kitchen-Printer" },
      devices,
      true,
    ),
    "Kitchen-Printer",
  );
  assert.equal(
    resolvePrinterTarget({ ...profile, deviceName: "Missing" }, devices, true),
    null,
  );
});

test("profiles that allow the system default keep their existing fallback", () => {
  assert.equal(resolvePrinterTarget(profile, devices), "Default-Office");
});

test("macOS graphic jobs reject a RAW queue, and ESC/POS requires its explicit name", () => {
  const raw = {
    name: "POS80_USB",
    isDefault: true,
    options: { "printer-make-and-model": "Local Raw Printer" },
  };
  assert.throws(
    () => resolvePrinterTarget(profile, [raw], false, "darwin"),
    /ESC\/POS/,
  );
  const thermal = { ...profile, mode: "ESC_POS" as const };
  assert.equal(resolvePrinterTarget(thermal, [raw], false, "darwin"), null);
  assert.equal(
    resolvePrinterTarget(
      { ...thermal, deviceName: raw.name },
      [raw],
      false,
      "darwin",
    ),
    raw.name,
  );
  assert.equal(resolvePrinterTarget(profile, [raw], false, "win32"), raw.name);
  assert.equal(
    resolvePrinterTarget(profile, devices, false, "darwin"),
    "Default-Office",
  );
});

test("macOS does not enqueue another thermal job on a reported offline or stopped queue", () => {
  const thermal = {
    ...profile,
    mode: "ESC_POS" as const,
    deviceName: "Thermal",
  };
  for (const options of [
    { "printer-state-reasons": "offline-report" },
    { "printer-state": "5" },
    { "printer-is-accepting-jobs": "false" },
  ]) {
    assert.throws(
      () =>
        resolvePrinterTarget(
          thermal,
          [{ name: "Thermal", options }],
          false,
          "darwin",
        ),
      /sin conexión/,
    );
  }
  assert.equal(
    resolvePrinterTarget(
      thermal,
      [{ name: "Thermal", options: { "printer-state-reasons": "none" } }],
      false,
      "darwin",
    ),
    "Thermal",
  );
});
