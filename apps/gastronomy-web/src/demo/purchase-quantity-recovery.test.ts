import { afterEach, describe, expect, it, vi } from "vitest";
import { createDemoApi, DEMO_STORAGE_KEY, type DemoStorage } from "./demo-api";

class MemoryStorage implements DemoStorage {
  private values = new Map<string, string>();
  failNextWrite = false;
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) {
    if (this.failNextWrite) { this.failNextWrite = false; throw new Error("write failed"); }
    this.values.set(key, value);
  }
  removeItem(key: string) { this.values.delete(key); }
}

const setup = async () => {
  const storage = new MemoryStorage();
  const api = createDemoApi(storage);
  const product = (await api.bootstrap()).products.find((row) => row.id === "prod-muzza")!;
  const purchase = await api.createPurchase({
    idempotencyKey: "quantity-purchase", supplierName: "Proveedor original", invoiceNumber: "FAC-QTY", notes: null,
    authorizerPin: "1234", items: [{ productId: product.id, quantityMinor: 2_500, unitCostMinor: 10_000 }],
  });
  const base = {
    purchaseId: purchase.id, purchaseItemId: purchase.items[0]!.id, expectedRevision: 0,
    quantityMinor: 3_333, reason: "Cantidad recibida mal registrada", authorizerPin: "1234",
    idempotencyKey: "quantity-correction-1",
  };
  return { storage, api, purchase, productId: product.id, base };
};

describe("recuperación documental de cantidad de línea de compra demo", () => {
  afterEach(() => vi.useRealTimers());

  it("corrige cantidad e importe efectivo histórico sin cambiar snapshots ni stock", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-09T15:00:00.000Z"));
    const { api, storage, purchase, productId, base } = await setup();
    const productsBefore = (await api.bootstrap()).products;
    const bootstrap = await api.bootstrap();
    const cashBefore = await api.getCashSessionReport({ cashSessionId: bootstrap.cashSession!.id });
    const reportBefore = await api.getFinanceReport({ from: purchase.createdAt.slice(0, 10), to: purchase.createdAt.slice(0, 10) });
    const corrected = await api.correctPurchaseItemQuantity(base);
    expect(corrected).toMatchObject({ id: purchase.id, totalMinor: purchase.totalMinor, revision: 1, effectiveTotalMinor: 33_330 });
    expect(corrected.items[0]).toMatchObject({ id: purchase.items[0]!.id, quantityMinor: 2_500, lineTotalMinor: 25_000, effectiveQuantityMinor: 3_333 });
    expect((await api.listPurchases()).find((row) => row.id === purchase.id)).toEqual(corrected);
    const raw = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
    expect(raw.purchases.find((row: { id: string }) => row.id === purchase.id)).toMatchObject({ totalMinor: purchase.totalMinor, items: purchase.items, revision: 1 });
    expect(raw.purchaseItemQuantityCorrections).toHaveLength(1);
    expect((await api.bootstrap()).products.map(({ id, stockMinor }) => [id, stockMinor])).toEqual(productsBefore.map(({ id, stockMinor }) => [id, stockMinor]));
    expect((await api.bootstrap()).products.find((row) => row.id === productId)?.stockMinor).toBe(productsBefore.find((row) => row.id === productId)?.stockMinor);
    expect(await api.getCashSessionReport({ cashSessionId: bootstrap.cashSession!.id })).toEqual(cashBefore);
    const reportAfter = await api.getFinanceReport({ from: purchase.createdAt.slice(0, 10), to: purchase.createdAt.slice(0, 10) });
    expect(reportAfter.purchasesMinor).toBe(reportBefore.purchasesMinor + 8_330);
    expect(reportAfter.grossProfitMinor).toBe(reportBefore.grossProfitMinor);
    expect(reportAfter.estimatedOperatingProfitMinor).toBe(reportBefore.estimatedOperatingProfitMinor);
  });

  it("rechaza cantidad cero, negativa, fraccionaria, insegura, motivo inválido, PIN y permiso", async () => {
    const { api, storage, base } = await setup();
    for (const quantityMinor of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])
      await expect(api.correctPurchaseItemQuantity({ ...base, quantityMinor, idempotencyKey: `bad-${quantityMinor}` })).rejects.toThrow();
    await expect(api.correctPurchaseItemQuantity({ ...base, reason: "   " })).rejects.toThrow();
    await expect(api.correctPurchaseItemQuantity({ ...base, reason: "r".repeat(501) })).rejects.toThrow();
    await expect(api.correctPurchaseItemQuantity({ ...base, authorizerPin: "0000" })).rejects.toThrow();
    const state = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
    state.data.currentUser.permissions = ["purchases.view"];
    storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(state));
    await expect(createDemoApi(storage).correctPurchaseItemQuantity({ ...base, idempotencyKey: "no-permission" })).rejects.toThrow(/permiso/i);
  });

  it("rechaza cantidad idéntica y revisión obsoleta, pero admite revisión compartida posterior", async () => {
    const { api, purchase, base } = await setup();
    await expect(api.correctPurchaseItemQuantity({ ...base, quantityMinor: 2_500, idempotencyKey: "same-qty" })).rejects.toThrow();
    await api.correctPurchaseMetadata({ purchaseId: purchase.id, expectedRevision: 0, supplierName: "Proveedor actualizado", reason: "Ajuste documental", authorizerPin: "1234", idempotencyKey: "metadata-first" });
    await expect(api.correctPurchaseItemQuantity(base)).rejects.toThrow(/revisión|cambió/i);
    const corrected = await api.correctPurchaseItemQuantity({ ...base, expectedRevision: 1 });
    expect(corrected).toMatchObject({ revision: 2, supplierName: "Proveedor actualizado", effectiveTotalMinor: 33_330 });
  });

  it("es idempotente y el replay no revierte una corrección posterior", async () => {
    const { api, purchase, base } = await setup();
    const first = await api.correctPurchaseItemQuantity(base);
    expect(await api.correctPurchaseItemQuantity(base)).toEqual(first);
    await expect(api.correctPurchaseItemQuantity({ ...base, quantityMinor: 4_000 })).rejects.toThrow(/idempotencia/i);
    const second = await api.correctPurchaseItemQuantity({ ...base, expectedRevision: 1, quantityMinor: 4_000, idempotencyKey: "quantity-second" });
    expect(second).toMatchObject({ revision: 2, effectiveTotalMinor: 40_000 });
    expect(await api.correctPurchaseItemQuantity(base)).toEqual(first);
    expect((await api.listPurchases()).find((row) => row.id === purchase.id)).toEqual(second);
  });

  it("compone costo y cantidad en cualquier orden y conserva revisión común", async () => {
    const { api, purchase, base } = await setup();
    const costFirst = await api.correctPurchaseItemCost({ purchaseId: purchase.id, purchaseItemId: purchase.items[0]!.id, expectedRevision: 0, unitCostMinor: 20_001, reason: "Actualizar costo", authorizerPin: "1234", idempotencyKey: "cost-first" });
    const quantitySecond = await api.correctPurchaseItemQuantity({ ...base, expectedRevision: 1 });
    expect(quantitySecond).toMatchObject({ revision: 2, effectiveTotalMinor: 66_663 });
    expect(quantitySecond.items[0]).toMatchObject({ effectiveUnitCostMinor: 20_001, effectiveQuantityMinor: 3_333, effectiveLineTotalMinor: 66_663 });

    const { api: otherApi, purchase: otherPurchase, base: otherBase } = await setup();
    const quantityFirst = await otherApi.correctPurchaseItemQuantity(otherBase);
    const costSecond = await otherApi.correctPurchaseItemCost({ purchaseId: otherPurchase.id, purchaseItemId: otherPurchase.items[0]!.id, expectedRevision: 1, unitCostMinor: 20_001, reason: "Actualizar costo", authorizerPin: "1234", idempotencyKey: "cost-second" });
    expect(quantityFirst.revision).toBe(1);
    expect(costSecond).toMatchObject({ revision: 2, effectiveTotalMinor: 66_663 });
    expect(costFirst.revision).toBe(1);
  });

  it("no cambia la cantidad confirmada de una compra ni la recepción original idempotente", async () => {
    const { api, storage, purchase, base } = await setup();
    const beforeState = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
    delete beforeState.purchaseReceipts["quantity-purchase"].result;
    storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(beforeState));
    const restored = createDemoApi(storage);
    await restored.correctPurchaseItemQuantity(base);
    const replay = await createDemoApi(storage).createPurchase({ idempotencyKey: "quantity-purchase", supplierName: "Proveedor original", invoiceNumber: "FAC-QTY", notes: null, authorizerPin: "1234", items: [{ productId: "prod-muzza", quantityMinor: 2_500, unitCostMinor: 10_000 }] });
    expect(replay).toEqual(purchase);
    expect(replay.items[0]!.quantityMinor).toBe(2_500);
    expect((await restored.listPurchases()).find((row) => row.id === purchase.id)?.items[0]).toMatchObject({ quantityMinor: 2_500, effectiveQuantityMinor: 3_333 });
  });

  it("revierte estado y recibo si falla la persistencia", async () => {
    const { api, storage, purchase, base } = await setup();
    const before = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
    storage.failNextWrite = true;
    await expect(api.correctPurchaseItemQuantity(base)).rejects.toThrow("write failed");
    expect(JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!)).toEqual(before);
    expect((await api.listPurchases()).find((row) => row.id === purchase.id)?.revision).toBe(0);
    expect(await api.correctPurchaseItemQuantity(base)).toMatchObject({ revision: 1, effectiveTotalMinor: 33_330 });
  });

  it("mantiene intacto el importe legacy almacenado de una línea no corregida", async () => {
    const storage = new MemoryStorage();
    const api = createDemoApi(storage);
    const purchase = await api.createPurchase({
      idempotencyKey: "quantity-legacy-lines", supplierName: "Proveedor", authorizerPin: "1234",
      items: [{ productId: "prod-muzza", quantityMinor: 2_500, unitCostMinor: 10_000 }, { productId: "prod-napo", quantityMinor: 1_000, unitCostMinor: 11_111 }],
    });
    const state = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
    const rawPurchase = state.purchases.find((row: { id: string }) => row.id === purchase.id);
    rawPurchase.items[1].lineTotalMinor = 12_345;
    rawPurchase.totalMinor = rawPurchase.items[0].lineTotalMinor + 12_345;
    storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(state));
    const restored = createDemoApi(storage);
    const corrected = await restored.correctPurchaseItemQuantity({ purchaseId: purchase.id, purchaseItemId: purchase.items[0]!.id, expectedRevision: 0, quantityMinor: 3_333, reason: "Actualizar cantidad", authorizerPin: "1234", idempotencyKey: "qty-legacy-line" });
    expect(corrected.effectiveTotalMinor).toBe(33_330 + 12_345);
    expect(corrected.items[1]).toMatchObject({ lineTotalMinor: 12_345 });
  });
});
