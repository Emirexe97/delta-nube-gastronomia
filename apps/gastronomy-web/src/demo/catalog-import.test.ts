import { describe, expect, it } from "vitest";
import { createDemoApi, DEMO_STORAGE_KEY, type DemoStorage } from "./demo-api";

class Storage implements DemoStorage {
  value: string | null = null;
  fail = false;
  getItem() { return this.value; }
  setItem(_key: string, value: string) { if (this.fail) throw new Error("Sin espacio"); this.value = value; }
  removeItem() { this.value = null; }
}
const key = "8d18e3cb-e198-4d82-aa45-820f8a8fe640";

describe("Importación CSV en demo", () => {
  it("persiste un lote atómico, conserva lo existente y reproduce los mismos IDs tras reabrir", async () => {
    const storage = new Storage();
    const api = createDemoApi(storage);
    const stock = await api.createCategory({ name: "Importación con stock", stockControlEnabled: true });
    const free = await api.createCategory({ name: "Importación sin stock", stockControlEnabled: false });
    const before = await api.bootstrap();
    const input = { idempotencyKey: key, rows: [
      { code: "IMP-A", name: "Nuevo A", categoryId: stock.id, basePriceMinor: 12345 },
      { code: "IMP-B", name: "Nuevo B", categoryId: free.id, basePriceMinor: 0 },
    ] };
    const created = await api.importProducts(input);
    expect(created.map(p => p.stockMinor)).toEqual([0, null]);
    expect(created[0]?.priceBook).toEqual({ baseMinor: 12345, overrides: {} });
    expect(created.every(p => p.active && !p.parentProductId && !p.comboDefinition)).toBe(true);
    const after = await api.bootstrap();
    expect(after.products.filter(p => before.products.some(old => old.id === p.id))).toEqual(before.products);
    expect(after.orders).toEqual(before.orders);
    expect(after.products).toHaveLength(before.products.length + 2);
    expect(await api.importProducts(input)).toEqual(created);
    const reopened = createDemoApi(storage);
    expect(await reopened.importProducts(input)).toEqual(created);
    await expect(reopened.importProducts({ ...input, rows: [{ ...input.rows[0]!, name: "Otro" }] })).rejects.toThrow(/datos diferentes/);
    await expect(reopened.importProducts({ ...input, idempotencyKey: crypto.randomUUID() })).rejects.toThrow(/ya existe/);
    expect((await reopened.bootstrap()).products).toHaveLength(after.products.length);
  });

  it("un fallo de almacenamiento no aplica productos ni recibos en memoria", async () => {
    const storage = new Storage();
    const api = createDemoApi(storage);
    const before = await api.bootstrap();
    const saved = storage.value;
    const input = { idempotencyKey: key, rows: [{ code: "FAIL-1", name: "No parcial", categoryId: before.categories[0]!.id, basePriceMinor: 100 }] };
    storage.fail = true;
    await expect(api.importProducts(input)).rejects.toThrow("Sin espacio");
    expect(storage.value).toBe(saved);
    storage.fail = false;
    expect((await api.bootstrap()).products).toEqual(before.products);
    const created = await api.importProducts(input);
    expect(created).toHaveLength(1);
    expect(await api.importProducts(input)).toEqual(created);
  });

  it("rechaza todo el lote con categoría inválida, duplicados o datos fuera de contrato", async () => {
    const storage = new Storage();
    const api = createDemoApi(storage);
    const before = await api.bootstrap();
    const row = { code: "NEW-1", name: "Producto", categoryId: before.categories[0]!.id, basePriceMinor: 100 };
    const saved = storage.value;
    await expect(api.importProducts({ idempotencyKey: key, rows: [row, { ...row, code: "NEW-2", categoryId: "missing" }] })).rejects.toThrow(/categoría/);
    await expect(api.importProducts({ idempotencyKey: key, rows: [row, { ...row, code: "new-1" }] })).rejects.toThrow(/repetido/);
    await expect(api.importProducts({ idempotencyKey: key, rows: [{ ...row, basePriceMinor: -1 }] })).rejects.toThrow(/precio/);
    expect(storage.value).toBe(saved);
    expect((await api.bootstrap()).products).toEqual(before.products);
  });

  it("comprueba permiso incluso antes de reproducir un recibo existente", async () => {
    const storage = new Storage();
    const api = createDemoApi(storage);
    const categoryId = (await api.bootstrap()).categories[0]!.id;
    const input = { idempotencyKey: key, rows: [{ code: "PERM-1", name: "Protegido", categoryId, basePriceMinor: 100 }] };
    await api.importProducts(input);
    const saved = JSON.parse(storage.getItem()!);
    saved.data.currentUser.permissions = [];
    storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(saved));
    const restricted = createDemoApi(storage);
    await expect(restricted.importProducts(input)).rejects.toThrow(/permiso/);
  });
});
