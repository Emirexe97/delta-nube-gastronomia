import { describe, expect, it } from "vitest";
import { createDemoApi, type DemoStorage } from "./demo-api";

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

describe("auditoría de turnos delivery demo", () => {
  it("conserva pago inmediato de remuneración 2.000 en A y registra devolución en B", async () => {
    const api = createDemoApi(new MemoryStorage());
    await api.saveSettings({
      ...(await api.bootstrap()).settings,
      deliverySettlementEnabled: true,
      deliveryFeeBelongsToDriver: false,
      deliveryDriverPaymentMode: "ON_ORDER_PAYMENT",
    });
    const sessionA = (await api.bootstrap()).cashSession!;
    const driver = await api.createDriver({
      fullName: "Auditor Driver",
      authorizerPin: "1234",
    });
    let order = await api.createOrder({
      type: "DELIVERY",
      customerName: "Cliente Fee Cero",
      customerPhone: "11 5555 0000",
      deliveryAddress: "Calle 1",
      deliveryFeeMinor: 0,
      driverUserId: driver.id,
    });
    const product = (await api.bootstrap()).products.find(
      (item) => item.active,
    )!;
    await api.addOrderItem({ orderId: order.id, productId: product.id });
    order = await api.confirmOrder({ orderId: order.id });
    await api.assignDeliveryDriver({
      orderId: order.id,
      driverUserId: driver.id,
      driverRemunerationMinor: 200_000,
    });
    const paid = await api.payOrder({
      orderId: order.id,
      driverUserId: driver.id,
      payments: [{ methodCode: "CASH", amountMinor: order.totalMinor }],
      payDriverNow: true,
    });
    await api.updateOrderStatus({ orderId: order.id, status: "DELIVERED" });
    const auditA = await api.getShiftAudit({
      cashSessionId: sessionA.id,
      section: "movements",
      pageSize: 100,
    });
    expect(
      auditA.movements.some(
        (event) =>
          event.orderId === order.id &&
          event.label === "Egreso" &&
          event.amountMinor === -200_000,
      ),
    ).toBe(true);
    const ledgerA = (
      await api.getDeliveryShipments({
        scope: "ALL",
        query: String(order.number),
        pageSize: 20,
      })
    ).items.find((item) => item.orderId === order.id)!;
    expect(ledgerA.driverRemunerationMinor).toBe(200_000);
    await api.closeCashSession({
      countedAmountMinor: (await api.bootstrap()).cashSession!
        .expectedAmountMinor,
      force: true,
      reason: "Cierre A",
      authorizerPin: "1234",
    });
    await api.openCashSession({ openingAmountMinor: paid.totalMinor });
    const sessionB = (await api.bootstrap()).cashSession!;
    await api.refundPayment({
      orderId: order.id,
      paymentId: paid.payments[0]!.id,
      amountMinor: paid.payments[0]!.amountMinor,
      reason: "Devolución en B",
      authorizerPin: "1234",
      reverseDeliverySettlement: true,
    });
    const auditBA = await api.getShiftAudit({
      cashSessionId: sessionA.id,
      section: "movements",
      pageSize: 100,
    });
    const auditB = await api.getShiftAudit({
      cashSessionId: sessionB.id,
      section: "movements",
      pageSize: 100,
    });
    expect(
      auditBA.movements.some(
        (event) => event.label === "Egreso" && event.amountMinor === -200_000,
      ),
    ).toBe(true);
    expect(
      auditB.movements.some(
        (event) =>
          event.orderId === order.id &&
          event.label === "Devolución" &&
          event.amountMinor === -paid.payments[0]!.amountMinor,
      ),
    ).toBe(true);
    expect(
      (
        await api.getShiftOrderAudit({
          cashSessionId: sessionB.id,
          orderId: order.id,
        })
      ).order.id,
    ).toBe(order.id);
  });
});
