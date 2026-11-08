import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateBookPrice, applyBookAdjustment } from "./pricing";

test("las derivadas redondean al centavo y el precio propio no sigue la principal", () => {
  assert.equal(calculateBookPrice(999, 5000), 1499);
  assert.equal(calculateBookPrice(10000, -1250), 8750);
  assert.equal(calculateBookPrice(25000, 1000, 0), 0);
  assert.equal(calculateBookPrice(25000, 1000, 15000), 15000);
  assert.throws(() => calculateBookPrice(Number.MAX_SAFE_INTEGER, 1000));
  assert.throws(() => calculateBookPrice(100, -10001));
  assert.throws(() => calculateBookPrice(100, 0, -1));
});

test("redondea directamente al incremento en minor units con empate hacia arriba", () => {
  assert.equal(calculateBookPrice(10499, 0, undefined, 1000), 10000);
  assert.equal(calculateBookPrice(10500, 0, undefined, 1000), 11000);
  assert.equal(calculateBookPrice(14999, 0, undefined, 10000), 10000);
  assert.equal(calculateBookPrice(15000, 0, undefined, 10000), 20000);
  // Raw result is 499.5 minor units: rounding it to 500 first would make the
  // subsequent nearest-1000 rounding a tie (and incorrectly produce 1000).
  assert.equal(calculateBookPrice(333, 5000, undefined, 1000), 0);
  assert.equal(calculateBookPrice(10500, 0, 12345, 100000), 12345);
  assert.equal(calculateBookPrice(150000, 0, undefined, 100000), 200000);
  assert.equal(calculateBookPrice(150000, 0, 0, 100000), 0);
  assert.throws(() => calculateBookPrice(1, 0, undefined, 10 as never));
});

test("el lote respeta herencia y calcula selecciones simultáneas sobre los valores anteriores", () => {
  const books = [
    { id: "p", name: "Principal", adjustmentBps: 0, isBase: true },
    { id: "d", name: "Reparto", adjustmentBps: 1000, isBase: false },
    { id: "f", name: "Especial", adjustmentBps: -2000, isBase: false },
  ];
  const prior = { baseMinor: 10000, overrides: { f: 7000 } };
  assert.deepEqual(applyBookAdjustment(prior, books, ["p"], "PERCENTAGE", 10), {
    baseMinor: 11000,
    overrides: { f: 7000 },
  });
  assert.deepEqual(
    applyBookAdjustment(prior, books, ["p", "d"], "FIXED", 100),
    { baseMinor: 10100, overrides: { f: 7000, d: 11100 } },
  );
  assert.throws(() => applyBookAdjustment(prior, books, ["f"], "FIXED", -7001));
  const roundedBook = { ...books[1]!, roundingIncrementMinor: 10000 as const };
  assert.deepEqual(
    applyBookAdjustment(prior, [roundedBook], ["d"], "FIXED", 125),
    { baseMinor: 10000, overrides: { f: 7000, d: 10125 } },
  );
  assert.deepEqual(prior, { baseMinor: 10000, overrides: { f: 7000 } });
});
