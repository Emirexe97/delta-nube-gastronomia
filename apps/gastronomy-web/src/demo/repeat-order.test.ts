import { expect, it } from "vitest";
import { createDemoApi, DEMO_STORAGE_KEY, type DemoStorage } from "./demo-api";

class Storage implements DemoStorage {
  raw: string | null = null;
  fail = false;
  writes = 0;
  getItem() {
    return this.raw;
  }
  setItem(_key: string, value: string) {
    if (this.fail) throw new Error("storage failure");
    this.writes += 1;
    this.raw = value;
  }
  removeItem() {
    this.raw = null;
  }
}

async function seed() {
  const storage = new Storage();
  const api = createDemoApi(storage);
  let data = await api.bootstrap();
  if (!data.cashSession) {
    await api.openCashSession({ openingAmountMinor: 0 });
    data = await api.bootstrap();
  }
  const product = data.products.find(
    (candidate) => candidate.active && !candidate.comboDefinition,
  )!;
  const customer = await api.createCustomer({
    name: "Cliente repetido",
    phone: "1155558484",
    addresses: [
      { label: "Casa", address: "Casa actual", deliveryFeeMinor: 30000 },
    ],
  });
  const source = await api.createOrder({
    type: "TAKEAWAY",
    customerId: customer.id,
    notes: "no copiar",
    scheduled: true,
    promisedAt: "2030-01-01T15:00:00Z",
  });
  await api.addOrderItem({
    orderId: source.id,
    productId: product.id,
    quantity: 1,
  });
  await api.confirmOrder({ orderId: source.id });
  return {
    storage,
    api,
    product,
    customer,
    source,
    input: {
      sourceOrderId: source.id,
      customerId: customer.id,
      type: "TAKEAWAY" as const,
      idempotencyKey: "repeat-demo",
    },
  };
}

it("repeats with current prices and customer address into one fresh draft, one published write, and stable replay", async () => {
  const f = await seed();
  const saved = JSON.parse(f.storage.raw!);
  for (const price of saved.data.products.find(
    (product: { id: string }) => product.id === f.product.id,
  ).prices)
    price.amountMinor = 14000;
  f.storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(saved));
  const api = createDemoApi(f.storage);
  const before = await api.getOrder({ orderId: f.source.id });
  const writes = f.storage.writes;
  const result = await api.repeatOrder(f.input);
  expect(f.storage.writes).toBe(writes + 1);
  expect(result.items[0]!.unitPriceMinorSnapshot).toBe(14000);
  expect(result.lifecycleStatus).toBe("DRAFT");
  expect(result.paymentStatus).toBe("UNPAID");
  expect(result.paidMinor).toBe(0);
  expect(result.discountMinor).toBe(0);
  expect(result.depositMinor).toBe(0);
  expect(result.notes).toBeNull();
  expect(result.promisedAt).toBeNull();
  expect(result.scheduled).toBe(false);
  expect(result.tableId).toBeNull();
  expect(result.driverUserId).toBeNull();
  expect(result.payments).toEqual([]);
  expect(await api.getOrder({ orderId: f.source.id })).toEqual(before);
  expect(await api.repeatOrder(f.input)).toEqual(result);
  await expect(
    api.repeatOrder({ ...f.input, type: "DELIVERY" }),
  ).rejects.toThrow(/idempotencia/);
  const delivery = await api.repeatOrder({
    ...f.input,
    idempotencyKey: "repeat-delivery",
    type: "DELIVERY",
    customerAddressId: f.customer.addresses[0]!.id,
  });
  expect(delivery.deliveryAddressSnapshot).toBe("Casa actual");
  expect(delivery.deliveryFeeMinor).toBe(30000);
});

it("failed preflight or persistence leaves no repeated draft or partial real storage", async () => {
  const f = await seed();
  const raw = f.storage.raw;
  await expect(
    f.api.repeatOrder({
      ...f.input,
      type: "DELIVERY",
      customerAddressId: "gone",
    }),
  ).rejects.toThrow(/dirección/);
  expect(f.storage.raw).toBe(raw);
  f.storage.fail = true;
  await expect(f.api.repeatOrder(f.input)).rejects.toThrow(/storage failure/);
  expect(f.storage.raw).toBe(raw);
  f.storage.fail = false;
  const beforeOrders = (JSON.parse(raw!).data.orders as { id: string }[]).map(
    (order) => order.id,
  );
  const afterOrders = (await f.api.bootstrap()).orders.map((order) => order.id);
  expect(afterOrders.every((id) => beforeOrders.includes(id))).toBe(true);
});

it("refuses stale products and permission loss even for a previously successful receipt", async () => {
  const f = await seed();
  await f.api.repeatOrder(f.input);
  let saved = JSON.parse(f.storage.raw!);
  saved.data.currentUser.permissions = [];
  f.storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(saved));
  let api = createDemoApi(f.storage);
  await expect(api.repeatOrder(f.input)).rejects.toThrow(/permiso/);
  saved = JSON.parse(f.storage.raw!);
  saved.data.currentUser.permissions = ["orders.create"];
  saved.data.products.find(
    (product: { id: string }) => product.id === f.product.id,
  ).active = false;
  f.storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(saved));
  api = createDemoApi(f.storage);
  const before = f.storage.raw;
  await expect(
    api.repeatOrder({ ...f.input, idempotencyKey: "inactive" }),
  ).rejects.toThrow(/no está disponible/);
  expect(f.storage.raw).toBe(before);
});
