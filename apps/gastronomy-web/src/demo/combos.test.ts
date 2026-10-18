import { expect, it } from "vitest";
import { createDemoApi, type DemoStorage } from "./demo-api";

class Storage implements DemoStorage {
  raw: string | null = null;
  writes = 0;
  getItem() {
    return this.raw;
  }
  setItem(_key: string, value: string) {
    this.writes++;
    this.raw = value;
  }
  removeItem() {
    this.raw = null;
  }
}

it("demo createCombo validates before mutation and replays the same idempotency key", async () => {
  const storage = new Storage();
  const api = createDemoApi(storage);
  const category = await api.createCategory({ name: "Alta combo" });
  const component = await api.createProduct({
    categoryId: category.id,
    name: "Componente",
    prices: ["SALON", "TAKEAWAY", "DELIVERY"].map((priceListCode) => ({
      priceListCode: priceListCode as "SALON" | "TAKEAWAY" | "DELIVERY",
      amountMinor: 5000,
    })),
  });
  const input = {
    categoryId: category.id,
    name: "Combo atómico",
    prices: ["SALON", "TAKEAWAY", "DELIVERY"].map((priceListCode) => ({
      priceListCode: priceListCode as "SALON" | "TAKEAWAY" | "DELIVERY",
      amountMinor: 9000,
    })),
    definition: { slots: [{ id: "main", name: "Principal", quantity: 1, productIds: [component.id] }] },
    reason: "Alta combo",
    authorizerPin: "1234",
    idempotencyKey: "demo-create-combo",
  };
  const created = await api.createCombo(input);
  expect(created.comboDefinition).toEqual(input.definition);
  expect(await api.createCombo(input)).toEqual(created);
  await expect(api.createCombo({ ...input, name: "Otro nombre" })).rejects.toThrow(/idempotencia/i);
  expect((await api.bootstrap()).products.filter((product) => product.name === input.name)).toHaveLength(1);
  const writesBeforeInvalid = storage.writes;
  await expect(api.createCombo({ ...input, idempotencyKey: "demo-invalid-combo", authorizerPin: "0000" })).rejects.toThrow(/PIN/i);
  await expect(api.createCombo({ ...input, idempotencyKey: "demo-invalid-definition", definition: { slots: [{ id: "bad", name: "Mala", quantity: 1, productIds: ["missing"] }] } })).rejects.toThrow();
  expect(storage.writes).toBe(writesBeforeInvalid);
  expect((await api.bootstrap()).products.filter((product) => product.name === input.name)).toHaveLength(1);
});

async function seed(name: string, stock: number) {
  const storage = new Storage();
  const api = createDemoApi(storage);
  let bootstrap = await api.bootstrap();
  await api.saveSettings({ ...bootstrap.settings, stockEnabled: true });
  const category = await api.createCategory({
    name,
    stockControlEnabled: false,
  });
  const prices = ["SALON", "TAKEAWAY", "DELIVERY"].map((priceListCode) => ({
    priceListCode: priceListCode as "SALON" | "TAKEAWAY" | "DELIVERY",
    amountMinor: 10000,
  }));
  const component = await api.createProduct({
    categoryId: category.id,
    name: `${name} componente`,
    prices,
  });
  const combo = await api.createProduct({
    categoryId: category.id,
    name: `${name} combo`,
    prices,
  });
  await api.adjustStock({
    productId: component.id,
    newStockMinor: stock,
    reason: "combo test",
    authorizerPin: "1234",
  });
  await api.setFinanceProductCost({
    productId: component.id,
    unitCostMinor: 700,
  });
  await api.configureProductCombo({
    productId: combo.id,
    definition: {
      slots: [
        {
          id: "main",
          name: "Principal",
          quantity: 2,
          productIds: [component.id],
        },
      ],
    },
    reason: "combo test",
    authorizerPin: "1234",
    idempotencyKey: `${name}-config`,
  });
  bootstrap = await api.bootstrap();
  return {
    storage,
    api,
    component: bootstrap.products.find((p) => p.id === component.id)!,
    combo: bootstrap.products.find((p) => p.id === combo.id)!,
  };
}

it("demo combo snapshots global extras, calculates price, and consumes/releases component stock", async () => {
  const { storage, api, component, combo } = await seed("Combo demo", 10000);
  const extra = await api.createModifier({
    groupName: "Extras combo",
    name: "Extra demo",
    priceMinor: 2000,
  });
  const table = await api.ensureTable({ number: 1 });
  const order = await api.createOrder({ type: "DINE_IN", tableId: table.id });
  const addInput = {
    orderId: order.id,
    comboProductId: combo.id,
    selections: [
      { slotId: "main", productId: component.id, modifierIds: [extra.id] },
    ],
    idempotencyKey: "combo-add",
  };
  const added = await api.addComboItem(addInput);
  expect(added.items[0]!.unitPriceMinorSnapshot).toBe(
    combo.prices.find((p) => p.priceListCode === "SALON")!.amountMinor + 4000,
  );
  expect(added.items[0]!.comboComponents?.[0]?.modifiers[0]?.nameSnapshot).toBe(
    extra.name,
  );
  expect(await api.addComboItem(addInput)).toEqual(added);
  const confirmed = await api.confirmOrder({ orderId: order.id });
  expect(
    (await api.bootstrap()).products.find((p) => p.id === component.id)!
      .stockMinor,
  ).toBe(8000);
  const second = await api.addComboItem({
    orderId: order.id,
    comboProductId: combo.id,
    selections: [{ slotId: "main", productId: component.id }],
  });
  await api.updateOrderItemQuantity({
    orderId: order.id,
    itemId: added.items[0]!.id,
    quantity: 2,
  });
  expect(
    (await api.bootstrap()).products.find((p) => p.id === component.id)!
      .stockMinor,
  ).toBe(4000);
  await api.updateOrderItemQuantity({
    orderId: order.id,
    itemId: added.items[0]!.id,
    quantity: 1,
  });
  await api.removeOrderItem({ orderId: order.id, itemId: added.items[0]!.id });
  expect(
    (await api.bootstrap()).products.find((p) => p.id === component.id)!
      .stockMinor,
  ).toBe(8000);
  await api.cancelOrder({
    orderId: order.id,
    reason: "combo test",
    authorizerPin: "1234",
  });
  expect(
    (await api.bootstrap()).products.find((p) => p.id === component.id)!
      .stockMinor,
  ).toBe(10000);
  const saved = JSON.parse(storage.raw!) as {
    financeItemCosts: Record<string, { unitCostMinor: number | null }>;
  };
  expect(saved.financeItemCosts[confirmed.items[0]!.id]?.unitCostMinor).toBe(
    1400,
  );
  await api.configureProductCombo({
    productId: combo.id,
    definition: null,
    reason: "remove template",
    authorizerPin: "1234",
  });
  expect(
    (await api.getOrder({ orderId: order.id })).items.find(
      (item) => item.id === second.items.at(-1)!.id,
    )?.comboComponents?.[0]?.nameSnapshot,
  ).toBe(component.name);
});

it("demo rejects insufficient stock atomically and blocks normal/half-and-half combo bypasses", async () => {
  const { api, component, combo } = await seed("Combo rollback", 1000);
  await expect(
    api.createPurchase({
      supplierName: "Proveedor",
      items: [{ productId: combo.id, quantityMinor: 1000, unitCostMinor: 100 }],
      authorizerPin: "1234",
    }),
  ).rejects.toThrow(/compra de los componentes/);
  const table = await api.ensureTable({ number: 1 });
  const order = await api.createOrder({ type: "DINE_IN", tableId: table.id });
  await expect(
    api.addOrderItem({ orderId: order.id, productId: combo.id }),
  ).rejects.toThrow(/addComboItem/);
  await expect(
    api.addHalfAndHalfItem({
      orderId: order.id,
      firstProductId: combo.id,
      secondProductId: component.id,
    }),
  ).rejects.toThrow(/combos no pueden/i);
  await api.addComboItem({
    orderId: order.id,
    comboProductId: combo.id,
    selections: [{ slotId: "main", productId: component.id }],
  });
  await expect(api.confirmOrder({ orderId: order.id })).rejects.toThrow(
    /stock insuficiente/i,
  );
  expect((await api.getOrder({ orderId: order.id })).lifecycleStatus).toBe(
    "DRAFT",
  );
  expect(
    (await api.bootstrap()).products.find((p) => p.id === component.id)!
      .stockMinor,
  ).toBe(1000);
});
