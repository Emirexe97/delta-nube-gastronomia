import { QueryClient } from "@tanstack/react-query";
import type { BootstrapDto } from "@gastronomy/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { createDemoApi, type DemoStorage } from "./demo/demo-api";
import { bootstrapKey } from "./order-entry-cache";
import {
  cacheEnsuredTable,
  cacheOpenedTableOrder,
} from "./table-opening-cache";

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
afterEach(() => clients.splice(0).forEach((client) => client.clear()));

describe("targeted table opening cache", () => {
  it("adds a newly ensured table and then its committed order in sequence", async () => {
    const api = createDemoApi(new MemoryStorage());
    const client = new QueryClient();
    clients.push(client);
    const initial = await api.bootstrap();
    client.setQueryData(bootstrapKey, initial);
    const ensured = await api.ensureTable({ number: 987 });
    expect(cacheEnsuredTable(client, ensured)).toBe(true);
    const before = client
      .getQueryData<BootstrapDto>(bootstrapKey)!
      .tables.find((table) => table.id === ensured.id)!;
    const beforeBootstrap = client.getQueryData<BootstrapDto>(bootstrapKey)!;
    const order = await api.createOrder({
      type: "DINE_IN",
      tableId: ensured.id,
      waiterUserId: initial.users.find(
        (user) => user.active && user.roleCode === "WAITER",
      )?.id,
    });
    const detail = await api.getOrderPrintState({
      orderId: order.id,
      includeConfirmation: true,
    });
    expect(
      cacheOpenedTableOrder(client, order, before, detail, beforeBootstrap),
    ).toBe(true);
    const next = client.getQueryData<BootstrapDto>(bootstrapKey)!;
    const full = await api.bootstrap();
    expect(next.orders).toEqual(full.orders);
    expect(next.dashboard).toEqual(full.dashboard);
    expect(
      next.tables.find((table) => table.id === ensured.id)?.currentOrderId,
    ).toBe(order.id);
    expect(
      next.tables.find((table) => table.id === ensured.id)?.waiterName,
    ).toBe(order.waiterName);
  });

  it("declines a stale/occupied table cache and invalidated state", async () => {
    const api = createDemoApi(new MemoryStorage());
    const client = new QueryClient();
    clients.push(client);
    const initial = await api.bootstrap();
    client.setQueryData(bootstrapKey, initial);
    const free = initial.tables.find(
      (table) => table.active && !table.currentOrderId,
    )!;
    const committed = await api.createOrder({
      type: "DINE_IN",
      tableId: free.id,
    });
    const detail = await api.getOrderPrintState({
      orderId: committed.id,
      includeConfirmation: true,
    });
    expect(cacheOpenedTableOrder(client, committed, free, detail)).toBe(true);
    client.setQueryData(bootstrapKey, initial);
    client.invalidateQueries({ queryKey: bootstrapKey });
    expect(cacheOpenedTableOrder(client, committed, free)).toBe(false);
  });
});
