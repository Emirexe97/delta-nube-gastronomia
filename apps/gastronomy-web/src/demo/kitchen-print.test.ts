import { describe, expect, it } from "vitest";
import { getKitchenAdditions } from "@gastronomy/domain";
import { createDemoApi, DEMO_STORAGE_KEY, type DemoStorage } from "./demo-api";

class MemoryStorage implements DemoStorage {
  values = new Map<string, string>();
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

async function setup() {
  const storage = new MemoryStorage();
  const api = createDemoApi(storage);
  const order = await api.createOrder({
    type: "TAKEAWAY",
    customerName: "Cocina",
    customerPhone: "111",
  });
  const updated = await api.addOrderItem({
    orderId: order.id,
    productId: "prod-muzza",
    quantity: 2,
  });
  const itemId = updated.items[0]!.id;
  await api.confirmOrder({ orderId: order.id });
  await api.printOrder({ orderId: order.id, kind: "KITCHEN_ORDER" });
  return { storage, api, orderId: order.id, itemId };
}

describe("demo kitchen print snapshots", () => {
  it("prints differences, keeps bills separate and persists the baseline", async () => {
    const { storage, api, orderId, itemId } = await setup();
    await api.updateOrderItemQuantity({ orderId, itemId, quantity: 3 });
    const updated = await api.addOrderItem({
      orderId,
      productId: "prod-muzza",
      quantity: 1,
      notes: "sin ajo",
    });
    const pending = getKitchenAdditions(updated);
    expect(pending.map((item) => item.quantity)).toEqual([1, 1]);
    await api.printOrder({ orderId, kind: "CUSTOMER_BILL" });
    expect(getKitchenAdditions(await api.getOrder({ orderId }))).toEqual(
      pending,
    );

    const job = await api.printOrder({
      orderId,
      kind: "KITCHEN_ORDER",
      kitchenScope: "ADDED",
    });
    const saved = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
    expect(saved.printSnapshots[job.jobId].ticket.items).toEqual(pending);
    expect(saved.printSnapshots[job.jobId].ticket.kitchenPrintScope).toBe(
      "ADDED",
    );
    const reopened = createDemoApi(storage);
    expect(getKitchenAdditions(await reopened.getOrder({ orderId }))).toEqual(
      [],
    );
    await expect(
      reopened.printOrder({
        orderId,
        kind: "KITCHEN_ORDER",
        kitchenScope: "ADDED",
      }),
    ).rejects.toThrow(/No hay productos/);
    await expect(
      reopened.printOrder({
        orderId,
        kind: "CUSTOMER_BILL",
        kitchenScope: "ADDED",
      }),
    ).rejects.toThrow(/sólo/);
  });

  it("keeps failed quantities pending and reuses the original snapshot on retry", async () => {
    const { storage, api, orderId, itemId } = await setup();
    await api.updateOrderItemQuantity({ orderId, itemId, quantity: 3 });
    const job = await api.printOrder({
      orderId,
      kind: "KITCHEN_ORDER",
      kitchenScope: "ADDED",
    });
    const saved = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
    saved.data.printJobs.find(
      (candidate: { id: string }) => candidate.id === job.jobId,
    ).status = "FAILED";
    storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(saved));
    const reopened = createDemoApi(storage);
    expect(
      getKitchenAdditions(await reopened.getOrder({ orderId }))[0]!.quantity,
    ).toBe(1);
    await reopened.updateOrderItemQuantity({ orderId, itemId, quantity: 4 });
    await reopened.retryPrint({ jobId: job.jobId });
    expect(
      getKitchenAdditions(await reopened.getOrder({ orderId }))[0]!.quantity,
    ).toBe(1);
  });

  it("requires a complete print to establish a baseline for legacy kitchen prints", async () => {
    const { storage, orderId } = await setup();
    const saved = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
    delete saved.printSnapshots;
    storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(saved));
    const api = createDemoApi(storage);
    expect(
      (await api.getOrder({ orderId })).kitchenPrintedQuantities,
    ).toBeNull();
    await expect(
      api.printOrder({ orderId, kind: "KITCHEN_ORDER", kitchenScope: "ADDED" }),
    ).rejects.toThrow(/completa/);
    await api.printOrder({ orderId, kind: "KITCHEN_ORDER" });
    expect(getKitchenAdditions(await api.getOrder({ orderId }))).toEqual([]);
  });
});
