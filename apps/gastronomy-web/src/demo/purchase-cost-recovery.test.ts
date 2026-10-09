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
    idempotencyKey: "cost-purchase",
    supplierName: "Proveedor original", invoiceNumber: "FAC-COSTO", notes: null,
    authorizerPin: "1234",
    items: [{ productId: product.id, quantityMinor: 2_500, unitCostMinor: 10_000 }],
  });
  const base = {
    purchaseId: purchase.id, purchaseItemId: purchase.items[0]!.id, expectedRevision: 0,
    unitCostMinor: 20_001, reason: "Costo unitario mal registrado", authorizerPin: "1234",
    idempotencyKey: "cost-correction-1",
  };
  return { storage, api, productId: product.id, purchase, base };
};

describe("recuperación de costo de una línea de compra demo", () => {
  afterEach(() => vi.useRealTimers());

  it("corrige el costo efectivo con redondeo y mantiene intactos los snapshots originales y flujos operativos", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-09T15:00:00.000Z"));
    const { api, storage, purchase, productId, base } = await setup();
    const productsBefore = (await api.bootstrap()).products;
    const bootstrap = await api.bootstrap();
    const cashBefore = await api.getCashSessionReport({ cashSessionId: bootstrap.cashSession!.id });
    const reportBefore = await api.getFinanceReport({ from: purchase.createdAt.slice(0, 10), to: purchase.createdAt.slice(0, 10) });
    const corrected = await api.correctPurchaseItemCost(base);
    expect(corrected).toMatchObject({ id: purchase.id, totalMinor: purchase.totalMinor, revision: 1 });
    expect(corrected.items[0]).toMatchObject({ id: purchase.items[0]!.id, unitCostMinor: 10_000, lineTotalMinor: 25_000, effectiveUnitCostMinor: 20_001, effectiveLineTotalMinor: 50_003 });
    expect(corrected.effectiveTotalMinor).toBe(50_003);
    expect((await api.listPurchases()).find((row) => row.id === purchase.id)).toEqual(corrected);
    expect((await api.bootstrap()).products.map(({ id, stockMinor }) => [id, stockMinor])).toEqual(productsBefore.map(({ id, stockMinor }) => [id, stockMinor]));
    expect(await api.getCashSessionReport({ cashSessionId: bootstrap.cashSession!.id })).toEqual(cashBefore);
    const reportAfter = await api.getFinanceReport({ from: purchase.createdAt.slice(0, 10), to: purchase.createdAt.slice(0, 10) });
    expect(reportAfter.purchasesMinor).toBe(reportBefore.purchasesMinor + 25_003);
    expect(reportAfter.grossProfitMinor).toBe(reportBefore.grossProfitMinor);
    expect(reportAfter.estimatedOperatingProfitMinor).toBe(reportBefore.estimatedOperatingProfitMinor);
    const persisted = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
    const rawPurchase = persisted.purchases.find((row: { id: string }) => row.id === purchase.id);
    expect(rawPurchase).toMatchObject({ totalMinor: purchase.totalMinor, items: purchase.items, revision: 1 });
    expect(persisted.purchaseItemCostCorrections).toHaveLength(1);
    expect(persisted.purchaseItemCostCorrections[0]).toMatchObject({ purchaseId: purchase.id, purchaseItemId: purchase.items[0]!.id, previousUnitCostMinor: 10_000, correctedUnitCostMinor: 20_001, previousLineTotalMinor: 25_000, correctedLineTotalMinor: 50_003, purchaseRevision: 1, reason: base.reason });
    expect((await api.bootstrap()).products.find((row) => row.id === productId)?.stockMinor).toBe(productsBefore.find((row) => row.id === productId)?.stockMinor);
  });

  it("rechaza costo/revisión/motivo inválidos, cambios sin diferencia y exige permisos y PIN", async () => {
    const { api, storage, base } = await setup();
    for (const unitCostMinor of [-1, 1.2, Number.MAX_SAFE_INTEGER + 1])
      await expect(api.correctPurchaseItemCost({ ...base, unitCostMinor, idempotencyKey: `bad-${unitCostMinor}` })).rejects.toThrow();
    await expect(api.correctPurchaseItemCost({ ...base, reason: "   " })).rejects.toThrow();
    await expect(api.correctPurchaseItemCost({ ...base, reason: "r".repeat(501) })).rejects.toThrow();
    await expect(api.correctPurchaseItemCost({ ...base, authorizerPin: "0000" })).rejects.toThrow();
    await expect(api.correctPurchaseItemCost({ ...base, unitCostMinor: 10_000, idempotencyKey: "same-cost" })).rejects.toThrow();
    const changed = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
    changed.data.currentUser.permissions = ["purchases.view"];
    storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(changed));
    await expect(createDemoApi(storage).correctPurchaseItemCost({ ...base, idempotencyKey: "no-permission" })).rejects.toThrow(/permiso/i);
  });

  it("es idempotente, serializa revisiones y no altera compras tras falla de persistencia", async () => {
    const { api, storage, purchase, base } = await setup();
    const before = (await api.listPurchases()).find((row) => row.id === purchase.id);
    const first = await api.correctPurchaseItemCost(base);
    expect(await api.correctPurchaseItemCost(base)).toEqual(first);
    await expect(api.correctPurchaseItemCost({ ...base, unitCostMinor: 30_000 })).rejects.toThrow(/idempotencia/i);
    await expect(api.correctPurchaseItemCost({ ...base, expectedRevision: 0, unitCostMinor: 30_000, idempotencyKey: "stale" })).rejects.toThrow(/revisión|cambió/i);
    const second = await api.correctPurchaseItemCost({ ...base, expectedRevision: 1, unitCostMinor: 30_000, idempotencyKey: "second" });
    expect(second.revision).toBe(2);
    expect(await api.correctPurchaseItemCost(base)).toEqual(first);
    const rawBeforeFailure = storage.getItem(DEMO_STORAGE_KEY);
    storage.failNextWrite = true;
    await expect(api.correctPurchaseItemCost({ ...base, expectedRevision: 2, unitCostMinor: 40_000, idempotencyKey: "failed-save" })).rejects.toThrow("write failed");
    expect(storage.getItem(DEMO_STORAGE_KEY)).toBe(rawBeforeFailure);
    expect((await api.listPurchases()).find((row) => row.id === purchase.id)).toEqual(second);
    expect(before?.items[0]?.unitCostMinor).toBe(10_000);
  });

  it("el último costo de compra afecta costos actuales sin pisar un costo manual", async () => {
    const { api, productId, base } = await setup();
    await api.correctPurchaseItemCost(base);
    expect(await api.getFinanceProductCosts()).toContainEqual(expect.objectContaining({ productId, unitCostMinor: 20_001 }));
    await api.setFinanceProductCost({ productId, unitCostMinor: 7_777 });
    expect(await api.getFinanceProductCosts()).toContainEqual(expect.objectContaining({ productId, unitCostMinor: 7_777, source: "MANUAL" }));
    await api.setFinanceProductCost({ productId, unitCostMinor: null });
    expect(await api.getFinanceProductCosts()).toContainEqual(expect.objectContaining({ productId, unitCostMinor: 20_001, source: "PURCHASE" }));
  });

  it("permite costo cero y redondea cantidades fraccionarias al menor", async () => {
    const { api, purchase, base } = await setup();
    const corrected = await api.correctPurchaseItemCost({ ...base, unitCostMinor: 0 });
    expect(corrected.items[0]).toMatchObject({ effectiveUnitCostMinor: 0, effectiveLineTotalMinor: 0 });
    expect(corrected.effectiveTotalMinor).toBe(0);
    expect(purchase.items[0]!.lineTotalMinor).toBe(25_000);
  });

  it("rechaza desborde del total de línea y no consume revisión", async () => {
    const { api, purchase, base } = await setup();
    await expect(api.correctPurchaseItemCost({ ...base, unitCostMinor: Number.MAX_SAFE_INTEGER, idempotencyKey: "overflow" })).rejects.toThrow(/rango|compra/i);
    expect((await api.listPurchases()).find((row) => row.id === purchase.id)?.revision).toBe(0);
    expect(await api.correctPurchaseItemCost(base)).toMatchObject({ revision: 1 });
  });

  it("rechaza revisión máxima o cantidad histórica corrupta sin cambiar el estado", async () => {
    const { api, storage, purchase, base } = await setup();
    const initial = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
    initial.purchases.find((row: { id: string }) => row.id === purchase.id).revision = Number.MAX_SAFE_INTEGER;
    storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(initial));
    await expect(createDemoApi(storage).correctPurchaseItemCost({ ...base, expectedRevision: Number.MAX_SAFE_INTEGER, idempotencyKey: "max-revision" })).rejects.toThrow(/revisión|cambió/i);
    const corrupted = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
    corrupted.purchases.find((row: { id: string }) => row.id === purchase.id).revision = 0;
    corrupted.purchases.find((row: { id: string }) => row.id === purchase.id).items[0].quantityMinor = Number.MAX_SAFE_INTEGER + 1;
    storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(corrupted));
    const corruptedApi = createDemoApi(storage);
    const before = storage.getItem(DEMO_STORAGE_KEY);
    await expect(corruptedApi.correctPurchaseItemCost(base)).rejects.toThrow(/cantidad/i);
    expect(storage.getItem(DEMO_STORAGE_KEY)).toBe(before);
  });

  it("no requiere clave de idempotencia y las entradas inválidas sin clave no tocan estado", async () => {
    const { storage, base, purchase } = await setup();
    const api = createDemoApi(storage);
    const before = storage.getItem(DEMO_STORAGE_KEY);
    await expect(api.correctPurchaseItemCost({ ...base, unitCostMinor: -1, idempotencyKey: undefined })).rejects.toThrow();
    expect(storage.getItem(DEMO_STORAGE_KEY)).toBe(before);
    const result = await api.correctPurchaseItemCost({ ...base, idempotencyKey: undefined });
    expect(result).toMatchObject({ id: purchase.id, revision: 1 });
    expect((await createDemoApi(storage).listPurchases()).find((row) => row.id === purchase.id)?.effectiveTotalMinor).toBe(50_003);
  });

  it("conserva el total original almacenado de líneas no corregidas", async () => {
    const storage = new MemoryStorage();
    const api = createDemoApi(storage);
    const products = (await api.bootstrap()).products;
    const purchase = await api.createPurchase({
      idempotencyKey: "legacy-rounded-lines", supplierName: "Proveedor", authorizerPin: "1234",
      items: [
        { productId: "prod-muzza", quantityMinor: 2_500, unitCostMinor: 10_000 },
        { productId: "prod-napo", quantityMinor: 1_000, unitCostMinor: 11_111 },
      ],
    });
    expect(products.some((row) => row.id === "prod-napo")).toBe(true);
    const raw = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
    const rawPurchase = raw.purchases.find((row: { id: string }) => row.id === purchase.id);
    rawPurchase.items[1].lineTotalMinor = 12_345;
    rawPurchase.totalMinor = rawPurchase.items[0].lineTotalMinor + 12_345;
    storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(raw));
    const restoredApi = createDemoApi(storage);
    const corrected = await restoredApi.correctPurchaseItemCost({
      purchaseId: purchase.id, purchaseItemId: purchase.items[0]!.id, expectedRevision: 0,
      unitCostMinor: 20_001, reason: "Actualizar costo", authorizerPin: "1234", idempotencyKey: "legacy-other-line",
    });
    expect(corrected.effectiveTotalMinor).toBe(50_003 + 12_345);
    expect(corrected.items[1]).toEqual(expect.objectContaining({ lineTotalMinor: 12_345 }));
  });

  it("rechaza un total del período que excede el rango seguro aunque cada compra sea segura", async () => {
    const { storage, purchase } = await setup();
    const state = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
    const original = state.purchases.find((row: { id: string }) => row.id === purchase.id);
    original.totalMinor = Number.MAX_SAFE_INTEGER;
    const second = structuredClone(original);
    second.id = `${original.id}-second`;
    second.createdAt = purchase.createdAt;
    state.purchases.push(second);
    storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(state));
    const api = createDemoApi(storage);
    const date = purchase.createdAt.slice(0, 10);
    await expect(api.getFinanceReport({ from: date, to: date })).rejects.toThrow(/rango/i);
  });

  it("preserva la creación idempotente legacy y la metadata al alternar correcciones de costo", async () => {
    const { api, storage, purchase, base } = await setup();
    const state = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
    delete state.purchaseReceipts["cost-purchase"].result;
    storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(state));
    const restored = createDemoApi(storage);
    const one = await restored.correctPurchaseItemCost(base);
    const metadata = await restored.correctPurchaseMetadata({ purchaseId: purchase.id, expectedRevision: 1, supplierName: "Proveedor corregido", reason: "Nombre de proveedor incorrecto", authorizerPin: "1234", idempotencyKey: "metadata-after-cost" });
    expect(metadata).toMatchObject({ revision: 2, supplierName: "Proveedor corregido", effectiveTotalMinor: 50_003 });
    const two = await restored.correctPurchaseItemCost({ ...base, expectedRevision: 2, unitCostMinor: 30_000, idempotencyKey: "cost-second" });
    expect(two).toMatchObject({ revision: 3, supplierName: "Proveedor corregido", effectiveTotalMinor: 75_000 });
    const replay = await createDemoApi(storage).createPurchase({ idempotencyKey: "cost-purchase", supplierName: "Proveedor original", invoiceNumber: "FAC-COSTO", notes: null, authorizerPin: "1234", items: [{ productId: "prod-muzza", quantityMinor: 2_500, unitCostMinor: 10_000 }] });
    expect(replay).toEqual(purchase);
    expect(await restored.correctPurchaseItemCost(base)).toEqual(one);
  });

  it("no autoriza la corrección si todo manager activo fue deshabilitado", async () => {
    const { storage, base } = await setup();
    const state = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
    for (const user of state.data.users) if (user.permissions.includes("purchases.manage") || user.permissions.includes("*")) user.active = false;
    state.data.currentUser.permissions = ["purchases.manage"];
    storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(state));
    await expect(createDemoApi(storage).correctPurchaseItemCost({ ...base, idempotencyKey: "inactive-manager" })).rejects.toThrow(/autorizar compras/i);
  });
});
