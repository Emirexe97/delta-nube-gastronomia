import assert from "node:assert/strict";
import { test } from "node:test";
import { planLegacyChannelPrices } from "./legacy-channel-prices";

test("separa retiro cuando algún canal fuera de salón difiere y conserva importes iguales a salón", () => {
  assert.deepEqual(planLegacyChannelPrices([
    { id: "same", prices: { SALON: 100, TAKEAWAY: 100, DELIVERY: 100 } },
    { id: "diff", prices: { SALON: 200, TAKEAWAY: 220, DELIVERY: 230 } },
  ]), {
    separateTakeaway: true,
    products: [
      { id: "same", salon: 100, takeaway: 100, delivery: 100 },
      { id: "diff", salon: 200, takeaway: 220, delivery: 230 },
    ],
  });
});

test("resuelve canales ausentes con el otro off-premise, luego salón, preservando ceros", () => {
  assert.deepEqual(planLegacyChannelPrices([
    { id: "takeaway-only", prices: { TAKEAWAY: 0 } },
    { id: "delivery-only", prices: { DELIVERY: 25 } },
    { id: "salon-only", prices: { SALON: 30 } },
    { id: "empty", prices: {} },
  ]), {
    separateTakeaway: false,
    products: [
      { id: "takeaway-only", salon: 0, takeaway: 0, delivery: 0 },
      { id: "delivery-only", salon: 25, takeaway: 25, delivery: 25 },
      { id: "salon-only", salon: 30, takeaway: 30, delivery: 30 },
      { id: "empty", salon: 0, takeaway: 0, delivery: 0 },
    ],
  });
});
