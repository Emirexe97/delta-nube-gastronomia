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
    resolvePrinterTarget({ ...profile, deviceName: "Kitchen-Printer" }, devices, true),
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
