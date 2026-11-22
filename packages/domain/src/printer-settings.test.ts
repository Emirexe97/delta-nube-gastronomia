import assert from "node:assert/strict";
import test from "node:test";
import { isDirectKitchenPrinterConfigured } from "./printer-settings";

test("direct kitchen printing requires a named device for both direct modes", () => {
  assert.equal(isDirectKitchenPrinterConfigured({ mode: "SYSTEM_DIRECT", deviceName: " Cocina " }), true);
  assert.equal(isDirectKitchenPrinterConfigured({ mode: "ESC_POS", deviceName: " Cocina " }), true);
  assert.equal(isDirectKitchenPrinterConfigured({ mode: "ESC_POS", deviceName: " " }), false);
  assert.equal(isDirectKitchenPrinterConfigured({ mode: "SYSTEM_DIALOG", deviceName: "Cocina" }), false);
});
