import { QueryClient } from "@tanstack/react-query";
import type { BootstrapDto, OrderDto } from "@gastronomy/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { createDemoApi, type DemoStorage } from "./demo/demo-api";
import { bootstrapKey } from "./order-entry-cache";
import { applySecondRoundOrderCache } from "./order-round-cache";

class Storage implements DemoStorage {
  getItem() {
    return null;
  }
  setItem() {}
  removeItem() {}
}
const clients: QueryClient[] = [];
afterEach(() => clients.splice(0).forEach((c) => c.clear()));

async function fixture() {
  const api = createDemoApi(new Storage());
  let initial = await api.bootstrap();
  const table = initial.tables.find((t) => t.active && !t.currentOrderId)!;
  const order = await api.createOrder({ type: "DINE_IN", tableId: table.id });
  const product = initial.products.find((p) => p.active && !p.comboDefinition)!;
  await api.addOrderItem({ orderId: order.id, productId: product.id });
  await api.confirmOrder({ orderId: order.id });
  const client = new QueryClient();
  clients.push(client);
  client.setQueryData(bootstrapKey, await api.bootstrap());
  const raw = client.getQueryData<BootstrapDto>(bootstrapKey)!;
  // The demo bridge intentionally has no optimistic version counter. Model the
  // authoritative native contract here; absent versions correctly take fallback.
  const before: BootstrapDto = {
    ...raw,
    orders: raw.orders.map((o) =>
      o.id === order.id ? { ...o, version: 1 } : o,
    ),
  };
  client.setQueryData(bootstrapKey, before);
  const cachedBefore = client.getQueryData<BootstrapDto>(bootstrapKey)!;
  const original = cachedBefore.orders.find((o) => o.id === order.id)!;
  const response = await api.addOrderItem({
    orderId: order.id,
    productId: product.id,
    quantity: 2,
  });
  const delta = await api.getOrderPrintState({
    orderId: order.id,
    includeConfirmation: true,
  });
  return {
    api,
    client,
    before: cachedBefore,
    original,
    response: { ...response, version: 2 },
    delta: { ...delta, order: { ...delta.order, version: 2 } },
    product,
  };
}

describe("confirmed dine-in second-round cache", () => {
  it("applies the authoritative order, stock, table and dashboard delta", async () => {
    const { api, client, before, original, response, delta, product } =
      await fixture();
    expect(
      applySecondRoundOrderCache(client, before, original, delta, response, {
        productId: product.id,
        quantity: 2,
      }),
    ).toBe(true);
    const next = client.getQueryData<BootstrapDto>(bootstrapKey)!;
    const full = await api.bootstrap();
    expect(next.orders.map(({ version: _v, ...o }) => o)).toEqual(full.orders);
    for (const key of ["products", "tables", "dashboard", "printJobs"] as const)
      expect(next[key]).toEqual(full[key]);
    expect(next.cashSession).toBe(before.cashSession);
    expect(next.categories).toBe(before.categories);
  });

  it("rejects stale snapshots, non-own edits, and mismatched authoritative responses", async () => {
    const { client, before, original, response, delta, product } =
      await fixture();
    expect(
      applySecondRoundOrderCache(
        client,
        before,
        original,
        {
          ...delta,
          order: { ...delta.order, version: delta.order.version + 2 },
        },
        response,
        { productId: product.id, quantity: 2 },
      ),
    ).toBe(false);
    expect(
      applySecondRoundOrderCache(
        client,
        before,
        original,
        delta,
        { ...response, notes: "Concurrent edit" },
        { productId: product.id, quantity: 2 },
      ),
    ).toBe(false);
    const changed: OrderDto = { ...original, notes: "changed" };
    const concurrent = {
      ...before,
      orders: before.orders.map((o) => (o.id === original.id ? changed : o)),
    };
    client.setQueryData(bootstrapKey, concurrent);
    expect(
      applySecondRoundOrderCache(client, concurrent, changed, delta, response, {
        productId: product.id,
        quantity: 2,
      }),
    ).toBe(false);
  });
});
