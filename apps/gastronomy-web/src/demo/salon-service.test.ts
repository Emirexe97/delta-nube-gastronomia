import { describe, expect, it } from "vitest";
import {
  createDemoApi,
  DEMO_STORAGE_KEY,
  type DemoStorage,
} from "./demo-api";

class MemoryStorage implements DemoStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

async function setup() {
  const storage = new MemoryStorage();
  const api = createDemoApi(storage);
  let data = await api.bootstrap();
  if (!data.cashSession)
    await api.openCashSession({ openingAmountMinor: 10_000 });
  data = await api.bootstrap();
  const table = await api.ensureTable({ number: 91 });
  const draft = await api.createOrder({ type: "DINE_IN", tableId: table.id, idempotencyKey: "salon-service-order" });
  const product = data.products.find((candidate) => candidate.active)!;
  const order = await api.addOrderItem({ orderId: draft.id, productId: product.id });
  await api.confirmOrder({ orderId: draft.id, idempotencyKey: "salon-service-confirm" });
  return { api, storage, orderId: order.id, productId: product.id };
}

function persistedOrder(storage: MemoryStorage, orderId: string) {
  const state = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
  const order = state.data.orders.find((candidate: { id: string }) => candidate.id === orderId);
  return { state, order };
}

describe("servicio de salón en demo", () => {
  it("inicia el reloj al primer ítem, lo conserva al sumar y nunca lo inicia en mesa vacía", async () => {
    const { api, storage, orderId, productId } = await setup();
    let { order } = persistedOrder(storage, orderId);
    expect(order.servicePendingSince).toEqual(expect.any(String));
    expect(order.serviceRevision).toBe(1);
    const firstPending = order.servicePendingSince;

    await api.addOrderItem({ orderId, productId });
    ({ order } = persistedOrder(storage, orderId));
    expect(order.servicePendingSince).toBe(firstPending);
    expect(order.serviceRevision).toBe(2);

    const data = await api.bootstrap();
    const otherTable = await api.ensureTable({ number: 92 });
    const empty = await api.createOrder({ type: "DINE_IN", tableId: otherTable.id, idempotencyKey: "empty-service-order" });
    expect(persistedOrder(storage, empty.id).order.servicePendingSince).toBeNull();
    expect(data.tables).toBeDefined();
  });

  it("marca servido con revisión esperada y el nuevo consumo abre un ciclo nuevo sin pago/cierre", async () => {
    const { api, storage, orderId, productId } = await setup();
    const before = persistedOrder(storage, orderId).order;
    const served = await api.markOrderServed({ orderId, expectedServiceRevision: before.serviceRevision, idempotencyKey: "serve-once" });
    expect(served).toMatchObject({ servedAt: expect.any(String), servicePendingSince: null, serviceRevision: before.serviceRevision + 1 });
    const duplicate = await api.markOrderServed({ orderId, expectedServiceRevision: served.serviceRevision!, idempotencyKey: "serve-again" });
    expect(duplicate.serviceRevision).toBe(served.serviceRevision);
    const audit = await api.getAuditLog({ search: orderId, limit: 10 });
    const servedAudit = audit.find((entry) => entry.action === "ORDER_SERVED");
    expect(servedAudit).toMatchObject({
      entityType: "ORDER",
      entityId: orderId,
      permissionUsed: "orders.edit",
    });
    expect(JSON.parse(servedAudit!.beforeJson!)).toMatchObject({ servicePendingSince: expect.any(String) });
    expect(JSON.parse(servedAudit!.afterJson!)).toMatchObject({ servicePendingSince: null, serviceRevision: served.serviceRevision });
    const reopened = await api.addOrderItem({ orderId, productId });
    expect(reopened.servicePendingSince).toEqual(expect.any(String));
    expect(Date.parse(reopened.servicePendingSince!)).toBeGreaterThanOrEqual(Date.parse(served.servedAt!));
    expect(reopened.servedAt).toBeNull();
    expect(reopened.paidMinor).toBe(before.paidMinor);
    expect(reopened.lifecycleStatus).toBe("CONFIRMED");
  });

  it("permite marcar servido un pedido pagado sin alterar pagos ni caja", async () => {
    const { api, storage, orderId } = await setup();
    const order = persistedOrder(storage, orderId).order;
    await api.payOrder({
      orderId,
      idempotencyKey: "salon-service-payment",
      payments: [{ methodCode: "CASH", amountMinor: order.totalMinor }],
    });
    const paidOrder = persistedOrder(storage, orderId).order;
    const cashBefore = (await api.bootstrap()).cashSession!;

    const served = await api.markOrderServed({
      orderId,
      expectedServiceRevision: paidOrder.serviceRevision,
      idempotencyKey: "serve-paid-order",
    });
    const cashAfter = (await api.bootstrap()).cashSession!;
    const storedAfter = persistedOrder(storage, orderId).order;
    expect(served.servedAt).toEqual(expect.any(String));
    expect(storedAfter.paidMinor).toBe(paidOrder.paidMinor);
    expect(storedAfter.payments).toEqual(paidOrder.payments);
    expect(cashAfter.expectedAmountMinor).toBe(cashBefore.expectedAmountMinor);
    expect(cashAfter.movements).toEqual(cashBefore.movements);
  });

  it("al quitar el último producto limpia ambas marcas e incrementa la revisión", async () => {
    const { api, storage, orderId } = await setup();
    const before = persistedOrder(storage, orderId).order;
    await api.removeOrderItem({ orderId, itemId: before.items[0].id });
    const after = persistedOrder(storage, orderId).order;
    expect(after.items).toHaveLength(0);
    expect(after.servicePendingSince).toBeNull();
    expect(after.servedAt).toBeNull();
    expect(after.serviceRevision).toBe(before.serviceRevision + 1);
  });

  it("solo nueva cantidad o mitad-y-mitad reabre; bajar cantidad o editar notas no reinicia reloj", async () => {
    const { api, storage, orderId } = await setup();
    const data = await api.bootstrap();
    let order = persistedOrder(storage, orderId).order;
    const itemId = order.items[0].id;
    const pendingSince = order.servicePendingSince;

    order = await api.updateOrderItemQuantity({ orderId, itemId, quantity: 2 });
    expect(order.serviceRevision).toBe(2);
    expect(order.servicePendingSince).toBe(pendingSince);
    await api.updateOrderItemNotes({ orderId, itemId, notes: "sin sal" });
    let stored = persistedOrder(storage, orderId).order;
    expect(stored.serviceRevision).toBe(2);
    expect(stored.servicePendingSince).toBe(pendingSince);

    order = await api.updateOrderItemQuantity({ orderId, itemId, quantity: 1 });
    expect(order.serviceRevision).toBe(2);
    expect(order.servicePendingSince).toBe(pendingSince);

    const halves = data.products.filter((candidate) => candidate.active).slice(0, 2);
    await api.addHalfAndHalfItem({ orderId, firstProductId: halves[0]!.id, secondProductId: halves[1]!.id });
    stored = persistedOrder(storage, orderId).order;
    expect(stored.serviceRevision).toBe(3);
    expect(stored.servicePendingSince).toBe(pendingSince);
  });

  it("rechaza revisión obsoleta y replay de servido no borra un ciclo posterior", async () => {
    const { api, storage, orderId, productId } = await setup();
    const initial = persistedOrder(storage, orderId).order;
    const request = { orderId, expectedServiceRevision: initial.serviceRevision, idempotencyKey: "serve-replay" };
    await api.markOrderServed(request);
    await api.addOrderItem({ orderId, productId });
    const reopened = persistedOrder(storage, orderId).order;
    const replay = await api.markOrderServed(request);
    expect(replay.serviceRevision).toBe(initial.serviceRevision + 1);
    expect(persistedOrder(storage, orderId).order.servicePendingSince).toBe(reopened.servicePendingSince);
    await expect(api.markOrderServed({ orderId, expectedServiceRevision: initial.serviceRevision, idempotencyKey: "serve-stale" })).rejects.toThrow(/servicio cambió/i);
  });

  it("exige orders.edit antes de procesar incluso un replay y no cambia datos al rechazar", async () => {
    const { api, storage, orderId } = await setup();
    const order = persistedOrder(storage, orderId).order;
    const request = { orderId, expectedServiceRevision: order.serviceRevision, idempotencyKey: "restricted-service" };
    await api.markOrderServed(request);

    const { state } = persistedOrder(storage, orderId);
    state.data.currentUser.permissions = [];
    storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(state));
    const restrictedApi = createDemoApi(storage);
    const before = persistedOrder(storage, orderId);
    await expect(restrictedApi.markOrderServed(request)).rejects.toThrow(/permiso/i);
    const after = persistedOrder(storage, orderId);
    expect(after.order).toEqual(before.order);
    expect(after.state.audit).toEqual(before.state.audit);
    expect(after.state.serviceReceipts).toEqual(before.state.serviceReceipts);
  });

  it("normaliza pedidos activos legacy con ítems al timestamp de creación", async () => {
    const { api, storage, orderId } = await setup();
    const { state, order } = persistedOrder(storage, orderId);
    const createdAt = order.createdAt;
    delete order.servicePendingSince;
    delete order.servedAt;
    delete order.serviceRevision;
    storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(state));

    const reloaded = createDemoApi(storage);
    const legacy = (await reloaded.bootstrap()).orders.find((candidate) => candidate.id === orderId)!;
    expect(legacy.servicePendingSince).toBe(createdAt);
    expect(legacy.servedAt).toBeNull();
    expect(legacy.serviceRevision).toBe(1);
  });

  it("no inicializa reloj ni revisión en legacy vacío, draft, terminal o fuera de salón", async () => {
    const { storage, orderId } = await setup();
    const { state, order: source } = persistedOrder(storage, orderId);
    const variants = [
      { id: "legacy-empty", type: "DINE_IN", lifecycleStatus: "CONFIRMED", operationalStatus: "IN_PREPARATION", items: [] },
      { id: "legacy-draft", type: "DINE_IN", lifecycleStatus: "DRAFT", operationalStatus: "PENDING", items: source.items },
      { id: "legacy-terminal", type: "DINE_IN", lifecycleStatus: "CONFIRMED", operationalStatus: "DELIVERED", items: source.items },
      { id: "legacy-takeaway", type: "TAKEAWAY", lifecycleStatus: "CONFIRMED", operationalStatus: "IN_PREPARATION", items: source.items },
    ] as const;
    for (const variant of variants) {
      const legacy = structuredClone(source);
      Object.assign(legacy, variant);
      delete legacy.servicePendingSince;
      delete legacy.servedAt;
      delete legacy.serviceRevision;
      state.data.orders.push(legacy);
    }
    storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(state));

    createDemoApi(storage);
    const normalized = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
    for (const variant of variants) {
      const legacy = normalized.data.orders.find((candidate: { id: string }) => candidate.id === variant.id);
      expect(legacy).toMatchObject({ servicePendingSince: null, servedAt: null, serviceRevision: 0 });
    }
  });
});
