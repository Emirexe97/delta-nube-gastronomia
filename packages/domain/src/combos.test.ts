import test from "node:test";
import assert from "node:assert/strict";
import type { ComboDefinitionDto } from "@gastronomy/contracts";
import {
  assertComboDefinition,
  calculateComboPrice,
  assertComboLineAmount,
} from "./combos";

const valid: ComboDefinitionDto = {
  slots: [{ id: "drink", name: "Bebida", quantity: 2, productIds: ["cola"] }],
};

test("rejects unsafe combo line/order amounts and stock multipliers", () => {
  assert.doesNotThrow(() => assertComboLineAmount(1000, 99, 2000, 3000));
  assert.throws(
    () => assertComboLineAmount(100_000_000_000_000, 99),
    /rango seguro/,
  );
  assert.throws(
    () => assertComboLineAmount(1000, 1, Number.MAX_SAFE_INTEGER),
    /rango seguro/,
  );
  assert.throws(
    () => assertComboLineAmount(0, Number.MAX_SAFE_INTEGER),
    /rango seguro/,
  );
});

test("validates combo limits, unique slots and no nesting/self", () => {
  assert.doesNotThrow(() =>
    assertComboDefinition(valid, "meal", [{ id: "cola" }]),
  );
  assert.throws(() =>
    assertComboDefinition({ slots: [{ ...valid.slots[0]!, quantity: 0 }] }),
  );
  assert.throws(() =>
    assertComboDefinition({ slots: [valid.slots[0]!, valid.slots[0]!] }),
  );
  assert.throws(() => assertComboDefinition(valid, "cola"));
  assert.throws(() =>
    assertComboDefinition(valid, "meal", [
      { id: "cola", comboDefinition: valid },
    ]),
  );
});

test("prices base once plus each component extra multiplied by slot quantity", () => {
  assert.equal(
    calculateComboPrice(1000, [
      { quantity: 2, modifiers: [{ unitPriceMinorSnapshot: 75 }] },
    ]),
    1150,
  );
  assert.throws(() =>
    calculateComboPrice(Number.MAX_SAFE_INTEGER, [
      { quantity: 2, modifiers: [{ unitPriceMinorSnapshot: 1 }] },
    ]),
  );
});
