import { describe, expect, it } from "vitest";
import { createDemoApi, DEMO_STORAGE_KEY, type DemoStorage } from "./demo-api";

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

const setup = async () => {
  const storage = new MemoryStorage();
  const api = createDemoApi(storage);
  const bootstrap = await api.bootstrap();
  const product = bootstrap.products.find((row) => row.id === "prod-muzza")!;
  const replacement = bootstrap.products.find(
    (row) => row.id !== product.id && row.active,
  )!;
  const purchase = await api.createPurchase({
    idempotencyKey: "purchase-doc",
    supplierName: "Proveedor",
    invoiceNumber: null,
    notes: null,
    authorizerPin: "1234",
    items: [
      { productId: product.id, quantityMinor: 2_000, unitCostMinor: 10_000 },
    ],
  });
  return { storage, api, product, replacement, purchase };
};

describe("documentary purchase corrections in demo", () => {
  it("cancels without touching stock or cash, excludes finance total and replays idempotently", async () => {
    const { api, storage, product, purchase } = await setup();
    const stock = (await api.bootstrap()).products.find(
      (row) => row.id === product.id,
    )?.stockMinor;
    const cash = (await api.bootstrap()).cashSession;
    const from = purchase.createdAt.slice(0, 10);
    const reportBefore = await api.getFinanceReport({ from, to: from });
    const input = {
      purchaseId: purchase.id,
      expectedRevision: 0,
      reason: "Duplicada",
      authorizerPin: "1234",
      idempotencyKey: "cancel-one",
    };
    const cancelled = await api.cancelPurchase(input);
    expect(cancelled).toMatchObject({
      cancelledAt: expect.any(String),
      cancellationReason: "Duplicada",
      revision: 1,
    });
    expect(await api.cancelPurchase(input)).toEqual(cancelled);
    await expect(
      api.cancelPurchase({ ...input, reason: "different" }),
    ).rejects.toThrow(/idempotencia/i);
    expect(
      (await api.getFinanceReport({ from, to: from })).purchasesMinor,
    ).toBe(reportBefore.purchasesMinor - purchase.totalMinor);
    expect(
      (await api.bootstrap()).products.find((row) => row.id === product.id)
        ?.stockMinor,
    ).toBe(stock);
    expect((await api.bootstrap()).cashSession).toEqual(cash);
    await expect(
      api.correctPurchaseItemCost({
        purchaseId: purchase.id,
        purchaseItemId: purchase.items[0]!.id,
        expectedRevision: 1,
        unitCostMinor: 12_000,
        reason: "después de anular",
        authorizerPin: "1234",
        idempotencyKey: "after-cancel",
      }),
    ).rejects.toThrow(/anulada/i);
    const raw = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
    expect(
      raw.purchases.find((row: { id: string }) => row.id === purchase.id).items,
    ).toEqual(purchase.items);
    expect(raw.purchaseCancellations).toHaveLength(1);
  });

  it("reassigns future purchase cost references immutably without moving stock or changing existing cost snapshots", async () => {
    const { api, storage, product, replacement, purchase } = await setup();
    const originalStock = (await api.bootstrap()).products.map(
      ({ id, stockMinor }) => [id, stockMinor],
    );
    const corrected = await api.correctPurchaseItemProduct({
      purchaseId: purchase.id,
      purchaseItemId: purchase.items[0]!.id,
      expectedRevision: 0,
      productId: replacement.id,
      reason: "Producto equivocado",
      authorizerPin: "1234",
      idempotencyKey: "product-correction",
    });
    expect(corrected.items[0]).toMatchObject({
      productId: product.id,
      productName: product.name,
      effectiveProductId: replacement.id,
      effectiveProductName: replacement.name,
    });
    expect(
      (await api.bootstrap()).products.map(({ id, stockMinor }) => [
        id,
        stockMinor,
      ]),
    ).toEqual(originalStock);
    expect(await api.getFinanceProductCosts()).toContainEqual(
      expect.objectContaining({
        productId: replacement.id,
        unitCostMinor: 10_000,
        source: "PURCHASE",
      }),
    );
    await expect(
      api.cancelPurchase({
        purchaseId: purchase.id,
        expectedRevision: 0,
        reason: "stale",
        authorizerPin: "1234",
        idempotencyKey: "stale-cancel",
      }),
    ).rejects.toThrow(/cambió/i);
    const raw = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
    expect(raw.purchaseItemProductCorrections).toHaveLength(1);
    expect(raw.purchases[0].items[0].productId).toBe(product.id);
  });
});
