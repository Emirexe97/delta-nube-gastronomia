import { QueryClient } from "@tanstack/react-query";
import type { BootstrapDto, OrderDto } from "@gastronomy/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { createDemoApi, type DemoStorage } from "./demo/demo-api";
import { bootstrapKey, updateDraftOrderCache } from "./order-entry-cache";

class MemoryStorage implements DemoStorage {
  private values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}

const clients: QueryClient[] = [];
afterEach(() => {
  clients.splice(0).forEach((client) => client.clear());
});

async function fixture() {
  const api = createDemoApi(new MemoryStorage());
  const initial = await api.bootstrap();
  const freeTable = initial.tables.find(
    (table) => table.active && !table.currentOrderId,
  )!;
  const draft = await api.createOrder({
    type: "DINE_IN",
    tableId: freeTable.id,
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  client.setQueryData(bootstrapKey, await api.bootstrap());
  const cached = client.getQueryData<BootstrapDto>(bootstrapKey)!;
  const before = cached.orders.find((order) => order.id === draft.id)!;
  const product = cached.products.find(
    (item) => item.active && !item.comboDefinition,
  )!;
  const updated = await api.addOrderItem({
    orderId: draft.id,
    productId: product.id,
    quantity: 1,
  });
  return { api, client, cached, before, updated };
}

describe("authoritative draft line cache", () => {
  it("uses the saved order and table total without reloading unrelated data", async () => {
    const { api, client, cached, before, updated } = await fixture();
    expect(updateDraftOrderCache(client, before, updated)).toBe(true);
    const next = client.getQueryData<BootstrapDto>(bootstrapKey)!;
    expect(next.orders.find((order) => order.id === before.id)).toEqual(
      updated,
    );
    expect(
      next.tables.find((table) => table.id === before.tableId)
        ?.currentTotalMinor,
    ).toBe(updated.totalMinor);
    for (const key of [
      "products",
      "categories",
      "cashSession",
      "dashboard",
      "printJobs",
      "deliveryLedger",
    ] as const)
      expect(next[key]).toBe(cached[key]);
    for (const order of cached.orders.filter((order) => order.id !== before.id))
      expect(next.orders.find((entry) => entry.id === order.id)).toBe(order);
    expect(next.orders.find((order) => order.id === before.id)).toEqual(
      (await api.bootstrap()).orders.find((order) => order.id === before.id),
    );
  });

  it("declines confirmed orders, payment changes and out-of-shift orders", async () => {
    const { client, cached, before, updated } = await fixture();
    for (const response of [
      { ...updated, lifecycleStatus: "CONFIRMED" as const },
      { ...updated, paidMinor: 1 },
      { ...updated, cashSessionCreatedId: "another-shift" },
      { ...updated, operationalStatus: "DELIVERED" as const },
      { ...updated, tableId: "another-table" },
      { ...updated, updatedAt: "2000-01-01T00:00:00.000Z" },
    ])
      expect(updateDraftOrderCache(client, before, response)).toBe(false);
    expect(client.getQueryData(bootstrapKey)).toBe(cached);
  });

  it("does not overwrite another mutation or an external update of the same order", async () => {
    const { client, cached, before, updated } = await fixture();
    client.setQueryData(bootstrapKey, {
      ...cached,
      orders: cached.orders.map((order) =>
        order.id === before.id
          ? { ...order, notes: "Changed concurrently" }
          : order,
      ),
    });
    const concurrent = client.getQueryData(bootstrapKey);
    expect(updateDraftOrderCache(client, before, updated)).toBe(false);
    expect(client.getQueryData(bootstrapKey)).toBe(concurrent);
  });

  it("does not consume an external invalidation", async () => {
    const { client, cached, before, updated } = await fixture();
    await client.invalidateQueries({
      queryKey: bootstrapKey,
      refetchType: "none",
    });
    expect(updateDraftOrderCache(client, before, updated)).toBe(false);
    expect(client.getQueryState(bootstrapKey)?.isInvalidated).toBe(true);
    expect(client.getQueryData(bootstrapKey)).toBe(cached);
  });

  it("keeps the full refresh path while an authoritative read is in flight", async () => {
    const { client, cached, before, updated } = await fixture();
    const fetching = client
      .fetchQuery({
        queryKey: bootstrapKey,
        queryFn: () => new Promise<BootstrapDto>(() => {}),
      })
      .catch(() => undefined);
    expect(client.getQueryState(bootstrapKey)?.fetchStatus).toBe("fetching");
    expect(updateDraftOrderCache(client, before, updated)).toBe(false);
    expect(client.getQueryData(bootstrapKey)).toBe(cached);
    await client.cancelQueries({ queryKey: bootstrapKey });
    await fetching;
  });

  it("declines missing cache, missing snapshot, closed cash and reassigned table", async () => {
    const { client, cached, before, updated } = await fixture();
    expect(updateDraftOrderCache(client, undefined, updated)).toBe(false);
    client.setQueryData(bootstrapKey, { ...cached, cashSession: null });
    expect(updateDraftOrderCache(client, before, updated)).toBe(false);
    client.setQueryData(bootstrapKey, {
      ...cached,
      tables: cached.tables.map((table) =>
        table.id === before.tableId
          ? { ...table, currentOrderId: "other-order" }
          : table,
      ),
    });
    expect(updateDraftOrderCache(client, before, updated)).toBe(false);
    client.removeQueries({ queryKey: bootstrapKey });
    expect(updateDraftOrderCache(client, before, updated)).toBe(false);
  });

  it("does not change table references for a takeaway draft", async () => {
    const { client, cached, before, updated } = await fixture();
    const takeaway: OrderDto = {
      ...before,
      type: "TAKEAWAY",
      tableId: null,
      tableNumber: null,
    };
    client.setQueryData(bootstrapKey, { ...cached, orders: [takeaway] });
    const snapshot = client.getQueryData<BootstrapDto>(bootstrapKey)!;
    expect(
      updateDraftOrderCache(client, snapshot.orders[0], {
        ...updated,
        type: "TAKEAWAY",
        tableId: null,
        tableNumber: null,
      }),
    ).toBe(true);
    expect(client.getQueryData<BootstrapDto>(bootstrapKey)!.tables).toBe(
      snapshot.tables,
    );
  });
});
