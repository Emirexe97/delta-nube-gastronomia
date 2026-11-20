import { QueryClient } from "@tanstack/react-query";
import type { BootstrapDto } from "@gastronomy/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { createDemoApi, type DemoStorage } from "./demo/demo-api";
import { bootstrapKey } from "./order-entry-cache";
import { addTakeawayDraftToCache } from "./takeaway-draft-cache";

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

async function fixture() {
  const api = createDemoApi(new MemoryStorage());
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  const before = await api.bootstrap();
  client.setQueryData(bootstrapKey, before);
  const created = await api.createOrder({ type: "TAKEAWAY" });
  return { client, before, created };
}

describe("puntual TAKEAWAY draft cache", () => {
  it("adds only the committed draft and retains unrelated bootstrap references", async () => {
    const { client, before, created } = await fixture();
    expect(addTakeawayDraftToCache(client, before, created)).toBe(true);
    const after = client.getQueryData<BootstrapDto>(bootstrapKey)!;
    expect(after.orders.find((row) => row.id === created.id)).toEqual(created);
    expect(after.orders.filter((row) => row.id !== created.id)).toEqual(
      before.orders,
    );
    expect(after.products).toBe(before.products);
    expect(after.tables).toBe(before.tables);
    expect(after.cashSession).toBe(before.cashSession);
  });

  it("declines a changed, invalidated, fetching, or missing snapshot", async () => {
    const { client, before, created } = await fixture();
    client.setQueryData(bootstrapKey, {
      ...before,
      orders: before.orders.slice(1),
    });
    expect(addTakeawayDraftToCache(client, before, created)).toBe(false);
    client.setQueryData(bootstrapKey, before);
    await client.invalidateQueries({
      queryKey: bootstrapKey,
      refetchType: "none",
    });
    expect(addTakeawayDraftToCache(client, before, created)).toBe(false);
    expect(addTakeawayDraftToCache(client, undefined, created)).toBe(false);
  });

  it("declines a closed cash session, duplicate id, or non-draft/non-takeaway response", async () => {
    const { client, before, created } = await fixture();
    for (const unsafe of [
      { ...created, type: "DELIVERY" as const },
      { ...created, lifecycleStatus: "CONFIRMED" as const },
      { ...created, paidMinor: 1 },
      { ...created, tableId: "table" },
      { ...created, cashSessionCreatedId: "another-session" },
    ])
      expect(addTakeawayDraftToCache(client, before, unsafe)).toBe(false);
    client.setQueryData(bootstrapKey, {
      ...before,
      cashSession: { ...before.cashSession!, status: "CLOSED" },
    });
    expect(
      addTakeawayDraftToCache(
        client,
        client.getQueryData(bootstrapKey),
        created,
      ),
    ).toBe(false);
    client.setQueryData(bootstrapKey, before);
    client.setQueryData(bootstrapKey, {
      ...before,
      orders: [...before.orders, created],
    });
    expect(
      addTakeawayDraftToCache(
        client,
        client.getQueryData(bootstrapKey),
        created,
      ),
    ).toBe(false);
  });
});
