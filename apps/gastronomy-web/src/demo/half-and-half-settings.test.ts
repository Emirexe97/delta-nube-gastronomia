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

describe("configuración de pizzas mitad y mitad en demo", () => {
  it("habilita la función por defecto", async () => {
    const data = await createDemoApi(new MemoryStorage()).bootstrap();
    expect(data.settings.halfAndHalfEnabled).toBe(true);
  });

  it("conserva habilitada la opción al cargar datos demo legados sin el campo", async () => {
    const storage = new MemoryStorage();
    await createDemoApi(storage).bootstrap();
    const saved = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
    delete saved.data.settings.halfAndHalfEnabled;
    storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(saved));
    expect(
      (await createDemoApi(storage).bootstrap()).settings.halfAndHalfEnabled,
    ).toBe(true);
  });

  it("permite volver a habilitar la función", async () => {
    const api = createDemoApi(new MemoryStorage());
    const data = await api.bootstrap();
    const settings = data.settings;
    await api.saveSettings({ ...settings, halfAndHalfEnabled: false });
    await api.saveSettings({ ...settings, halfAndHalfEnabled: true });
    expect((await api.bootstrap()).settings.halfAndHalfEnabled).toBe(true);
    const order = await api.createOrder({ type: "TAKEAWAY" });
    const pizzas = data.products.filter(
      (item) => item.active && item.categoryId === "cat-pizzas",
    );
    const updated = await api.addHalfAndHalfItem({
      orderId: order.id,
      firstProductId: pizzas[0]!.id,
      secondProductId: pizzas[1]!.id,
    });
    expect(updated.items[0]?.halves).toHaveLength(2);
  });

  it("rechaza altas mitad y mitad sin modificar el pedido cuando está deshabilitada", async () => {
    const storage = new MemoryStorage();
    const api = createDemoApi(storage);
    const data = await api.bootstrap();
    const order = await api.createOrder({ type: "TAKEAWAY" });
    await api.saveSettings({ ...data.settings, halfAndHalfEnabled: false });
    const before = await api.getOrder({ orderId: order.id });
    expect(
      (await createDemoApi(storage).bootstrap()).settings.halfAndHalfEnabled,
    ).toBe(false);
    const pizzas = data.products.filter(
      (item) => item.active && item.categoryId === "cat-pizzas",
    );
    await expect(
      api.addHalfAndHalfItem({
        orderId: order.id,
        firstProductId: pizzas[0]!.id,
        secondProductId: pizzas[1]!.id,
      }),
    ).rejects.toThrow(/deshabilitadas/);
    expect(await api.getOrder({ orderId: order.id })).toEqual(before);
  });

  it("conserva combinaciones existentes y permite agregar productos comunes al deshabilitar", async () => {
    const api = createDemoApi(new MemoryStorage());
    const data = await api.bootstrap();
    const order = await api.createOrder({ type: "TAKEAWAY" });
    const pizzas = data.products.filter(
      (item) => item.active && item.categoryId === "cat-pizzas",
    );
    await api.addHalfAndHalfItem({
      orderId: order.id,
      firstProductId: pizzas[0]!.id,
      secondProductId: pizzas[1]!.id,
    });
    await api.saveSettings({ ...data.settings, halfAndHalfEnabled: false });
    const before = await api.getOrder({ orderId: order.id });
    expect(before.items[0]?.halves).toHaveLength(2);
    const ordinary = data.products.find(
      (item) => item.active && item.categoryId !== "cat-pizzas",
    )!;
    const after = await api.addOrderItem({
      orderId: order.id,
      productId: ordinary.id,
    });
    expect(after.items.some((item) => item.halves.length === 2)).toBe(true);
    expect(after.items).toHaveLength(before.items.length + 1);
  });
});
