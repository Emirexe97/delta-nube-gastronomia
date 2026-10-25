import test from "node:test";
import assert from "node:assert/strict";
import type { OrderItemDto } from "@gastronomy/contracts";
import { getKitchenAdditions } from "./kitchen-print";

const item = (id: string, quantity: number): OrderItemDto => ({
  id,
  quantity,
  productId: "same-product",
  productNameSnapshot: "Pizza",
  unitPriceMinorSnapshot: 1000,
  discountMinorSnapshot: 0,
  notes: "sin ajo",
  halves: [],
  modifiers: [],
  lineTotalMinor: quantity * 1000,
});

test("kitchen additions distinguish line IDs, increases, decreases and unchanged quantities", () => {
  const order = {
    items: [
      item("increased", 3),
      item("unchanged", 2),
      item("decreased", 1),
      item("new-line", 2),
    ],
    kitchenPrintedQuantities: {
      increased: 2,
      unchanged: 2,
      decreased: 3,
      removed: 1,
    },
  };
  const before = structuredClone(order);
  assert.deepEqual(getKitchenAdditions(order), [
    item("increased", 1),
    item("new-line", 2),
  ]);
  assert.deepEqual(order, before);
});

test("a missing legacy baseline cannot infer additions; a new unprinted order has all items pending", () => {
  const items = [item("first", 2)];
  assert.deepEqual(
    getKitchenAdditions({ items, kitchenPrintedQuantities: null }),
    [],
  );
  assert.deepEqual(getKitchenAdditions({ items }), []);
  assert.deepEqual(
    getKitchenAdditions({ items, kitchenPrintedQuantities: {} }),
    items,
  );
});
