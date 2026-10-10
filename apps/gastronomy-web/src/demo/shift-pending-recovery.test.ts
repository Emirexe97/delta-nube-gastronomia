import { describe, expect, it } from "vitest";
import { createDemoApi, type DemoStorage } from "./demo-api";

class MemoryStorage implements DemoStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

async function settleSeedDeliveries(api: ReturnType<typeof createDemoApi>) {
  const data = await api.bootstrap();
  for (const ledger of data.deliveryLedger.filter((row) => row.status === "PENDING")) {
    await api.settleDelivery({ ledgerIds: [ledger.id], reason: "Rendición del turno original", authorizerPin: "1234" });
  }
}

describe("recuperación de pendientes de turnos anteriores", () => {
  it("permite cerrar un turno vacío sin volver a forzar por pedidos históricos", async () => {
    const storage = new MemoryStorage();
    const api = createDemoApi(storage);
    const original = await api.bootstrap();
    const pending = original.orders.find((order) => !["DELIVERED", "CANCELLED"].includes(order.operationalStatus))!;
    expect(pending).toBeDefined();
    await settleSeedDeliveries(api);
    const settled = await api.bootstrap();
    await api.closeCashSession({ countedAmountMinor: settled.cashSession!.expectedAmountMinor, force: true, reason: "Pendientes registrados en el turno original", authorizerPin: "1234" });
    const reloaded = createDemoApi(storage);
    await reloaded.openCashSession({ openingAmountMinor: 0 });
    expect((await reloaded.bootstrap()).orders).toEqual([]);
    const closed = await reloaded.closeCashSession({ countedAmountMinor: 0 });
    expect(closed.status).toBe("CLOSED");
    expect(await reloaded.getOrder({ orderId: pending.id })).toMatchObject({ id: pending.id, operationalStatus: pending.operationalStatus, paymentStatus: pending.paymentStatus, totalMinor: pending.totalMinor, paidMinor: pending.paidMinor });
  });

  it("conserva la mesa histórica ocupada y permite finalizar su pedido pagado sin cobrar de nuevo", async () => {
    const api = createDemoApi(new MemoryStorage());
    await settleSeedDeliveries(api);
    const table = await api.ensureTable({ number: 31 });
    const draft = await api.createOrder({ type: "DINE_IN", tableId: table.id });
    const populated = await api.addOrderItem({ orderId: draft.id, productId: "prod-muzza" });
    await api.confirmOrder({ orderId: draft.id });
    const paid = await api.payOrder({ orderId: draft.id, payments: [{ methodCode: "CASH", amountMinor: populated.totalMinor }] });
    const original = await api.bootstrap();
    await api.closeCashSession({ countedAmountMinor: original.cashSession!.expectedAmountMinor, force: true, reason: "Mesa pagada pendiente de cierre", authorizerPin: "1234" });
    expect((await api.bootstrap()).tables.find((row) => row.id === table.id)?.currentOrderId).toBe(draft.id);
    await api.openCashSession({ openingAmountMinor: 0 });
    const nextTurn = await api.bootstrap();
    expect(nextTurn.orders).toEqual([]);
    expect(nextTurn.tables.find((row) => row.id === table.id)?.currentOrderId).toBe(draft.id);
    expect(await api.getOrder({ orderId: draft.id })).toMatchObject({ id: paid.id, operationalStatus: paid.operationalStatus, payments: paid.payments, totalMinor: paid.totalMinor, paidMinor: paid.paidMinor });
    const finished = await api.updateOrderStatus({ orderId: draft.id, status: "DELIVERED" });
    expect(finished.payments).toEqual(paid.payments);
    expect(finished.paidMinor).toBe(paid.paidMinor);
    expect((await api.bootstrap()).cashSession).toEqual(nextTurn.cashSession);
    expect((await api.bootstrap()).tables.find((row) => row.id === table.id)?.currentOrderId).toBeNull();
    await expect(api.closeCashSession({ countedAmountMinor: 0 })).resolves.toMatchObject({ status: "CLOSED" });
  });

  it("sigue bloqueando el cierre por un borrador del turno actual", async () => {
    const api = createDemoApi(new MemoryStorage());
    const original = await api.bootstrap();
    await api.closeCashSession({ countedAmountMinor: original.cashSession!.expectedAmountMinor, force: true, reason: "Turno original", authorizerPin: "1234" });
    await api.openCashSession({ openingAmountMinor: 0 });
    const draft = await api.createOrder({ type: "TAKEAWAY" });
    await expect(api.closeCashSession({ countedAmountMinor: 0 })).rejects.toThrow(/pedidos pendientes/i);
    expect((await api.bootstrap()).orders.map((order) => order.id)).toEqual([draft.id]);
    expect((await api.bootstrap()).cashSession?.status).toBe("OPEN");
  });
});
