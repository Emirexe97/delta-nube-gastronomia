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

describe("informe financiero demo", () => {
  it("conserva venta recobrada y muestra agenda con vencimiento originado antes del rango", async () => {
    const api = createDemoApi(new MemoryStorage());
    const session = (await api.bootstrap()).cashSession!;
    const before = await api.getFinanceReport({
      from: session.businessDate,
      to: session.businessDate,
    });
    const product = (await api.bootstrap()).products.find(
      (item) => item.active,
    )!;
    let order = await api.createOrder({
      type: "TAKEAWAY",
      customerName: "Informe",
      customerPhone: "11 5555-0000",
    });
    await api.addOrderItem({ orderId: order.id, productId: product.id });
    order = await api.confirmOrder({ orderId: order.id });
    const paid = await api.payOrder({
      orderId: order.id,
      payments: [{ methodCode: "CASH", amountMinor: order.totalMinor }],
    });
    await api.refundPayment({
      orderId: order.id,
      paymentId: paid.payments[0]!.id,
      amountMinor: 100_000,
      reason: "Cambio de medio",
      authorizerPin: "1234",
    });
    await api.payOrder({
      orderId: order.id,
      payments: [{ methodCode: "TRANSFER", amountMinor: 100_000 }],
    });
    const yesterday = new Date(`${session.businessDate}T00:00:00Z`);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const expense = await api.createFinanceExpense({
      title: "Servicio anterior",
      category: "Servicios",
      kind: "GENERAL",
      amountMinor: 80_000,
      incurredOn: yesterday.toISOString().slice(0, 10),
      dueOn: session.businessDate,
      authorizerPin: "1234",
    });
    const report = await api.getFinanceReport({
      from: session.businessDate,
      to: session.businessDate,
    });
    expect(report.salesMinor).toBe(before.salesMinor + order.totalMinor);
    expect(
      report.orderMoneyDetails.find((item) => item.orderId === order.id)
        ?.recoveredMinor,
    ).toBe(100_000);
    expect(
      report.orderMoneyDetails.find((item) => item.orderId === order.id)
        ?.effectiveRefundMinor,
    ).toBe(0);
    expect(report.dueAgenda.some((item) => item.id === expense.id)).toBe(true);
    expect(
      report.channelMargins.some((item) => item.channel === "TAKEAWAY"),
    ).toBe(true);
    expect(
      report.orderMoneyDetails.find((item) => item.orderId === order.id)
        ?.productSales?.[0]?.salesMinor,
    ).toBeGreaterThan(0);
    await api.payFinanceExpense({
      expenseId: expense.id,
      paymentMethodCode: "CASH",
      fromCash: true,
      authorizerPin: "1234",
    });
    const paidReport = await api.getFinanceReport({
      from: session.businessDate,
      to: session.businessDate,
    });
    expect(paidReport.paidAgenda.some((item) => item.id === expense.id)).toBe(
      true,
    );
    expect(paidReport.dueAgenda.some((item) => item.id === expense.id)).toBe(
      false,
    );
  });
});
