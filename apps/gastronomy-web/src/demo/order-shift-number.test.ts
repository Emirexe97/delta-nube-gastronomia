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

async function nextShift(api: ReturnType<typeof createDemoApi>) {
  const current = (await api.bootstrap()).cashSession!;
  await api.closeCashSession({
    countedAmountMinor: current.expectedAmountMinor,
    force: true,
    reason: "Cambio de turno",
    authorizerPin: "1234",
  });
  return api.openCashSession({ openingAmountMinor: 0 });
}

describe("numeración de pedidos por apertura de caja", () => {
  it("reinicia en 1 por turno y comparte contador entre salón, takeaway y delivery", async () => {
    const storage = new MemoryStorage();
    const api = createDemoApi(storage);
    const initialSession = (await api.bootstrap()).cashSession!;
    const initialOrders = (await api.bootstrap()).orders.map((order) => ({
      id: order.id,
      number: order.number,
    }));
    await nextShift(api);
    const availableTable = (await api.bootstrap()).tables.find(
      (table) => !table.currentOrderId,
    )!;
    const dineIn = await api.createOrder({
      type: "DINE_IN",
      tableId: availableTable.id,
    });
    expect(dineIn.number).toBe(1);
    expect(dineIn.tableNumber).toBe(availableTable.number);
    await api.discardDraftOrder({ orderId: dineIn.id });

    const takeaway = await api.createOrder({
      type: "TAKEAWAY",
      customerName: "Cliente turno",
      customerPhone: "11223344",
    });
    expect(takeaway.number).toBe(2);
    await api.addOrderItem({ orderId: takeaway.id, productId: "prod-muzza" });
    await api.confirmOrder({ orderId: takeaway.id });
    await api.cancelOrder({
      orderId: takeaway.id,
      reason: "Cancelado",
      authorizerPin: "1234",
    });

    const delivery = await api.createOrder({
      type: "DELIVERY",
      customerName: "Cliente turno",
      customerPhone: "11223344",
      deliveryAddress: "Calle 12",
    });
    expect(delivery.number).toBe(3);
    const reloaded = createDemoApi(storage);
    const continued = await reloaded.createOrder({
      type: "TAKEAWAY",
      customerName: "Cliente continuación",
      customerPhone: "11223344",
    });
    expect(continued.number).toBe(4);
    await nextShift(reloaded);
    const nextTurnOrder = await createDemoApi(storage).createOrder({
      type: "DELIVERY",
      customerName: "Cliente próximo turno",
      customerPhone: "11223344",
      deliveryAddress: "Calle 13",
    });
    expect(nextTurnOrder.number).toBe(1);

    const all = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!).data
      .orders as Array<{ id: string; number: number }>;
    expect(all.find((order) => order.id === delivery.id)?.number).toBe(3);
    expect(all.find((order) => order.id === continued.id)?.number).toBe(4);
    expect(all.find((order) => order.id === nextTurnOrder.id)?.number).toBe(1);
    expect(all.find((order) => order.id === initialOrders[0]!.id)?.number).toBe(
      initialOrders[0]!.number,
    );
    expect((await createDemoApi(storage).bootstrap()).cashSession!.id).not.toBe(
      initialSession.id,
    );
    expect(
      (await createDemoApi(storage).bootstrap()).tables.find(
        (table) => table.id === availableTable.id,
      )?.number,
    ).toBe(availableTable.number);
  });

  it("migra el máximo histórico de la sesión si falta el mapa de contadores", async () => {
    const storage = new MemoryStorage();
    const firstApi = createDemoApi(storage);
    const bootstrap = await firstApi.bootstrap();
    const state = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
    delete state.orderNumbersByCashSession;
    const sessionOrders = state.data.orders.filter(
      (order: any) => order.cashSessionCreatedId === bootstrap.cashSession!.id,
    );
    sessionOrders.forEach((order: any, index: number) => {
      order.number = 40 + index;
    });
    const maxHistoricalNumber = Math.max(
      ...sessionOrders.map((order: any) => order.number),
    );
    storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(state));

    const migratedApi = createDemoApi(storage);
    const next = await migratedApi.createOrder({
      type: "TAKEAWAY",
      customerName: "Cliente legacy",
      customerPhone: "11223344",
    });
    expect(next.number).toBe(maxHistoricalNumber + 1);
    const saved = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
    expect(saved.orderNumbersByCashSession[bootstrap.cashSession!.id]).toBe(
      maxHistoricalNumber + 1,
    );
  });
});
