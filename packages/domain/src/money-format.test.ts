import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { formatMoney } from "./money";

test("cached money formatting preserves the existing locale, currency and cents", () => {
  for (const currency of ["ARS", "USD", "EUR", "JPY", "ars"]) {
    for (const value of [0, -0, 1, 99, 100, 12345, -12345, 999999999, Number.MAX_SAFE_INTEGER]) {
      const expected = new Intl.NumberFormat("es-AR", {
        style: "currency", currency, minimumFractionDigits: 0, maximumFractionDigits: 2,
      }).format(value / 100);
      assert.equal(formatMoney(value, currency), expected);
    }
  }
  assert.throws(() => formatMoney(100, "invalid"), RangeError);
});

test("a repeated price list constructs only one formatter per currency", () => {
  const Original = Intl.NumberFormat;
  const constructor = mock.method(Intl, "NumberFormat", function (locale?: Intl.LocalesArgument, options?: Intl.NumberFormatOptions) {
    return new Original(locale, options);
  });
  try {
    for (let index = 0; index < 1000; index++) formatMoney(index * 123, "UYU");
    assert.equal(constructor.mock.callCount(), 1);
    formatMoney(1500, "BRL");
    assert.equal(constructor.mock.callCount(), 2);
  } finally { constructor.mock.restore(); }
});
