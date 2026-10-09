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
    idempotencyKey: "purchase-seed",
    supplierName: "Proveedor original",
    invoiceNumber: "FAC-ORIGINAL",
    notes: "Nota original",
    authorizerPin: "1234",
    items: [{ productId: product.id, quantityMinor: 2_500, unitCostMinor: 10_000 }],
  });
  const base = {
    purchaseId: purchase.id,
    expectedRevision: 0,
    supplierName: "Proveedor rectificado",
    invoiceNumber: "FAC-CORRECTA",
    notes: "Comprobante reemitido",
    reason: "Datos del comprobante mal cargados",
    authorizerPin: "1234",
    idempotencyKey: "metadata-correction",
  };
  return { storage, api, productId: product.id, purchase, base };
};

describe("recuperación metadata-only de compras demo", () => {
  afterEach(() => vi.useRealTimers());

  it("corrige proveedor y comprobante con auditoría sin alterar snapshots económicos ni stock", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-09T15:00:00.000Z"));
    const { api, purchase, productId, base } = await setup();
    const beforeStock = (await api.bootstrap()).products.map(({ id, stockMinor }) => [id, stockMinor]);
    const bootstrap = await api.bootstrap();
    const cashBefore = await api.getCashSessionReport({ cashSessionId: bootstrap.cashSession!.id });
    const expensesBefore = await api.getFinanceReport({ from: bootstrap.cashSession!.businessDate, to: bootstrap.cashSession!.businessDate });

    const corrected = await api.correctPurchaseMetadata(base);
    expect(corrected).toMatchObject({
      id: purchase.id, supplierName: "Proveedor rectificado", invoiceNumber: "FAC-CORRECTA",
      notes: "Comprobante reemitido", revision: 1,
      totalMinor: purchase.totalMinor, createdAt: purchase.createdAt, createdByUserId: purchase.createdByUserId,
      items: purchase.items,
    });
    const audit = (await api.getAuditLog({ search: purchase.id, limit: 20 })).find((row) => row.action === "PURCHASE_METADATA_CORRECTED");
    expect(audit).toMatchObject({ entityType: "PURCHASE", entityId: purchase.id, reason: base.reason, permissionUsed: "purchases.manage" });
    expect(JSON.parse(audit!.beforeJson!)).toMatchObject({ supplierName: "Proveedor original", invoiceNumber: "FAC-ORIGINAL", notes: "Nota original" });
    expect(JSON.parse(audit!.afterJson!)).toMatchObject({ supplierName: "Proveedor rectificado", invoiceNumber: "FAC-CORRECTA", notes: "Comprobante reemitido" });
    expect((await api.listPurchases()).find((row) => row.id === purchase.id)).toEqual(corrected);
    expect((await api.bootstrap()).products.map(({ id, stockMinor }) => [id, stockMinor])).toEqual(beforeStock);
    expect((await api.bootstrap()).products.find((row) => row.id === productId)?.stockMinor).toBe(beforeStock.find(([id]) => id === productId)![1]);
    expect(await api.getCashSessionReport({ cashSessionId: bootstrap.cashSession!.id })).toEqual(cashBefore);
    expect(await api.getFinanceReport({ from: bootstrap.cashSession!.businessDate, to: bootstrap.cashSession!.businessDate })).toEqual(expensesBefore);
  });

  it("normaliza revisiones antiguas y permite omitir campos o limpiarlos explícitamente", async () => {
    const { api, purchase, base } = await setup();
    expect((await api.listPurchases()).find((row) => row.id === purchase.id)?.revision).toBe(0);
    const corrected = await api.correctPurchaseMetadata({ ...base, supplierName: "  Proveedor final  ", invoiceNumber: null, notes: "" });
    expect(corrected).toMatchObject({ supplierName: "Proveedor final", invoiceNumber: null, notes: null, revision: 1 });
    const preserved = await api.correctPurchaseMetadata({ ...base, expectedRevision: 1, supplierName: "Proveedor final 2", idempotencyKey: "metadata-2", invoiceNumber: undefined, notes: undefined });
    expect(preserved).toMatchObject({ invoiceNumber: null, notes: null, revision: 2 });
  });

  it("rechaza datos requeridos inválidos, PIN/permisos incorrectos y revisiones obsoletas", async () => {
    const { api, storage, base, purchase } = await setup();
    await expect(api.correctPurchaseMetadata({ ...base, supplierName: null as unknown as string })).rejects.toThrow();
    await expect(api.correctPurchaseMetadata({ ...base, notes: 9 as unknown as string })).rejects.toThrow();
    await expect(api.correctPurchaseMetadata({ ...base, supplierName: "  " })).rejects.toThrow();
    await expect(api.correctPurchaseMetadata({ ...base, reason: "  " })).rejects.toThrow();
    await expect(api.correctPurchaseMetadata({ ...base, supplierName: "x".repeat(161) })).rejects.toThrow();
    await expect(api.correctPurchaseMetadata({ ...base, invoiceNumber: "x".repeat(161) })).rejects.toThrow();
    await expect(api.correctPurchaseMetadata({ ...base, notes: "x".repeat(1001) })).rejects.toThrow();
    await expect(api.correctPurchaseMetadata({ ...base, expectedRevision: -1, idempotencyKey: "negative-revision" })).rejects.toThrow();
    await expect(api.correctPurchaseMetadata({ ...base, authorizerPin: "0000" })).rejects.toThrow();
    const saved = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
    saved.data.currentUser.permissions = ["purchases.view"];
    storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(saved));
    await expect(createDemoApi(storage).correctPurchaseMetadata({ ...base, idempotencyKey: "no-permission" })).rejects.toThrow(/permiso/i);
    const noAuthorizer = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
    for (const user of noAuthorizer.data.users) {
      if (user.permissions.includes("purchases.manage") || user.permissions.includes("*")) user.active = false;
    }
    // Restore operator permission but remove every active PIN-authorizer.
    noAuthorizer.data.currentUser.permissions = ["purchases.manage"];
    storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(noAuthorizer));
    await expect(createDemoApi(storage).correctPurchaseMetadata({ ...base, idempotencyKey: "no-active-authorizer" })).rejects.toThrow(/autorizar compras/i);
    // Restore manager and prove stale revisions cannot overwrite the first correction.
    saved.data.currentUser.permissions = ["purchases.manage"];
    storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(saved));
    const restoredApi = createDemoApi(storage);
    await restoredApi.correctPurchaseMetadata({ ...base, idempotencyKey: "first-revision" });
    await expect(restoredApi.correctPurchaseMetadata({ ...base, supplierName: "Sobrescritura", idempotencyKey: "stale-revision" })).rejects.toThrow(/revisión|cambió/i);
    expect((await restoredApi.listPurchases()).find((row) => row.id === purchase.id)?.supplierName).toBe("Proveedor rectificado");
  });

  it("replay devuelve el receipt original y no revierte una corrección posterior", async () => {
    const { api, storage, base, purchase } = await setup();
    const first = await api.correctPurchaseMetadata(base);
    expect(await api.correctPurchaseMetadata(base)).toEqual(first);
    await expect(api.correctPurchaseMetadata({ ...base, supplierName: "Datos distintos" })).rejects.toThrow(/idempotencia/i);
    const second = await api.correctPurchaseMetadata({ ...base, expectedRevision: 1, supplierName: "Segunda corrección", idempotencyKey: "metadata-second" });
    expect(second).toMatchObject({ revision: 2, supplierName: "Segunda corrección" });
    expect(await api.correctPurchaseMetadata(base)).toEqual(first);
    const saved = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
    saved.data.currentUser.permissions = ["purchases.view"];
    storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(saved));
    await expect(createDemoApi(storage).correctPurchaseMetadata(base)).rejects.toThrow(/permiso/i);
    expect((await api.listPurchases()).find((row) => row.id === purchase.id)).toEqual(second);
    expect((await api.getAuditLog({ search: purchase.id, limit: 20 })).filter((row) => row.action === "PURCHASE_METADATA_CORRECTED")).toHaveLength(2);
  });

  it("no modifica el recibo idempotente de la creación original", async () => {
    const { storage, purchase } = await setup();
    const legacyState = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
    delete legacyState.purchaseReceipts["purchase-seed"].result;
    storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(legacyState));
    const legacyApi = createDemoApi(storage);
    await legacyApi.correctPurchaseMetadata({ purchaseId: purchase.id, expectedRevision: 0, supplierName: "Proveedor rectificado", reason: "Corrección", authorizerPin: "1234", idempotencyKey: "without-optional-fields" });
    const reloadedApi = createDemoApi(storage);
    const originalReplay = await reloadedApi.createPurchase({
      idempotencyKey: "purchase-seed", supplierName: "Proveedor original", invoiceNumber: "FAC-ORIGINAL", notes: "Nota original", authorizerPin: "1234",
      items: [{ productId: "prod-muzza", quantityMinor: 2_500, unitCostMinor: 10_000 }],
    });
    expect(originalReplay).toEqual(purchase);
    expect(originalReplay.revision).toBeUndefined();
    expect((await reloadedApi.listPurchases()).find((row) => row.id === purchase.id)).toMatchObject({ supplierName: "Proveedor rectificado", revision: 1 });
    const persisted = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
    expect(persisted.purchaseReceipts["purchase-seed"].result).toEqual(purchase);
  });

  it("no modifica estado en entradas inválidas sin clave ni ante un fallo al persistir", async () => {
    const { api, storage, base, purchase } = await setup();
    const beforeRaw = storage.getItem(DEMO_STORAGE_KEY)!;
    const before = (await api.listPurchases()).find((row) => row.id === purchase.id);
    await expect(api.correctPurchaseMetadata({ ...base, supplierName: " ", idempotencyKey: undefined })).rejects.toThrow();
    expect(storage.getItem(DEMO_STORAGE_KEY)).toBe(beforeRaw);
    storage.failNextWrite = true;
    await expect(api.correctPurchaseMetadata(base)).rejects.toThrow("write failed");
    expect((await api.listPurchases()).find((row) => row.id === purchase.id)).toEqual(before);
    expect((await api.getAuditLog({ search: purchase.id, limit: 20 })).some((row) => row.action === "PURCHASE_METADATA_CORRECTED")).toBe(false);
    expect(await api.correctPurchaseMetadata(base)).toMatchObject({ revision: 1, supplierName: "Proveedor rectificado" });
  });
});

it("normaliza espacios antes de limitar proveedor y motivo como SQLite", async () => {
  const {api,base} = await setup();
  const corrected = await api.correctPurchaseMetadata({...base,supplierName:" ".repeat(100)+"x".repeat(160)+" ".repeat(100),reason:" ".repeat(100)+"r".repeat(500)+" ".repeat(100)});
  expect(corrected.supplierName).toBe("x".repeat(160));
  expect(corrected.revision).toBe(1);
});
