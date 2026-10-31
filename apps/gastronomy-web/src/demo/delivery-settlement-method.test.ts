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

async function delivery(
  api: ReturnType<typeof createDemoApi>,
  collectedByDriver: boolean,
) {
  const current = await api.bootstrap();
  await api.saveSettings({
    ...current.settings,
    deliverySettlementEnabled: true,
    deliveryFeeBelongsToDriver: true,
    deliveryDriverPaymentMode: "ACCUMULATED",
  });
  const driver = await api.createDriver({
    fullName: `Chofer ${collectedByDriver}`,
    authorizerPin: "1234",
  });
  const order = await api.createOrder({
    type: "DELIVERY",
    customerName: "Cliente real",
    customerPhone: "1122334455",
    deliveryAddress: "Calle 123",
    deliveryFeeMinor: 200_000,
    driverUserId: driver.id,
  });
  const populated = await api.addOrderItem({
    orderId: order.id,
    productId: "prod-muzza",
  });
  await api.confirmOrder({ orderId: order.id });
  await api.payOrder({
    orderId: order.id,
    ...(collectedByDriver ? { collectedByDriver: true } : {}),
    payments: [
      {
        methodCode: collectedByDriver ? "CASH" : "TRANSFER",
        amountMinor: populated.totalMinor,
      },
    ],
  });
  await api.updateOrderStatus({
    orderId: order.id,
    status: "OUT_FOR_DELIVERY",
  });
  await api.updateOrderStatus({ orderId: order.id, status: "DELIVERED" });
  return order.id;
}

describe("liquidación demo por medio de pago", () => {
  it.each(["CASH", "TRANSFER"] as const)(
    "registra lote de entradas y salidas con %s, revierte y recarga",
    async (method) => {
      const storage = new MemoryStorage();
      const api = createDemoApi(storage);
      await api.bootstrap();
      const incomingOrderId = await delivery(api, true);
      const outgoingOrderId = await delivery(api, false);
      if (method === "CASH")
        await api.registerCashMovement({
          type: "INCOME",
          amountMinor: 1_000_000,
          paymentMethodCode: "CASH",
          reason: "Fondos de prueba",
        });
      const pending = (await api.bootstrap()).deliveryLedger.filter((row) =>
        [incomingOrderId, outgoingOrderId].includes(row.orderId),
      );
      expect(pending.map((row) => row.direction).sort()).toEqual([
        "BUSINESS_OWES_DRIVER",
        "DRIVER_OWES_BUSINESS",
      ]);
      const before = (await api.bootstrap()).cashSession!;
      await api.settleDelivery({
        ledgerIds: pending.map((row) => row.id),
        reason: "Rendición",
        authorizerPin: "1234",
        paymentMethodCode: method,
      });
      const saved = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
      const movements = saved.movements.slice(-2);
      expect(
        movements
          .map((item: any) => [
            item.type,
            item.paymentMethodCode,
            item.affectsCash,
          ])
          .sort(),
      ).toEqual(
        [
          ["EXPENSE", method, method === "CASH"],
          ["INCOME", method, method === "CASH"],
        ].sort(),
      );
      expect(movements[0].createdAt).toBe(movements[1].createdAt);
      const ledgers = saved.data.deliveryLedger.filter((row: any) =>
        pending.some((item) => item.id === row.id),
      );
      expect(
        ledgers.every((row: any) => row.settledAt === movements[0].createdAt),
      ).toBe(true);
      const after = (await api.bootstrap()).cashSession!;
      if (method === "CASH") {
        const income = pending.find(
          (row) => row.direction === "DRIVER_OWES_BUSINESS",
        )!.amountDueMinor;
        const expense = pending.find(
          (row) => row.direction === "BUSINESS_OWES_DRIVER",
        )!.amountDueMinor;
        expect(after.expectedAmountMinor).toBe(
          before.expectedAmountMinor + income - expense,
        );
        expect(after.cashIncomeMinor).toBe(
          (before.cashIncomeMinor ?? 0) + income,
        );
        expect(after.cashExpenseMinor).toBe(
          (before.cashExpenseMinor ?? 0) + expense,
        );
      } else {
        expect(after.expectedAmountMinor).toBe(before.expectedAmountMinor);
        expect(after.cashIncomeMinor).toBe(before.cashIncomeMinor);
        expect(after.cashExpenseMinor).toBe(before.cashExpenseMinor);
      }
      const outgoingLedger = pending.find(
        (row) => row.direction === "BUSINESS_OWES_DRIVER",
      )!;
      const original = movements.find(
        (movement: any) => movement.orderId === outgoingLedger.orderId,
      )!;
      await api.reverseDeliverySettlement({
        ledgerId: outgoingLedger.id,
        reason: "Revisión",
        authorizerPin: "1234",
      });
      const reopened = createDemoApi(storage);
      const reversed = JSON.parse(
        storage.getItem(DEMO_STORAGE_KEY)!,
      ).movements.at(-1);
      expect(reversed).toMatchObject({
        type: "INCOME",
        affectsCash: method === "CASH",
        paymentMethodCode: method,
        referenceId: original.id,
      });
      const afterReverse = (await reopened.bootstrap()).cashSession!;
      expect(afterReverse.expectedAmountMinor).toBe(
        method === "CASH"
          ? after.expectedAmountMinor + outgoingLedger.amountDueMinor
          : after.expectedAmountMinor,
      );
      await reopened.settleDelivery({
        ledgerIds: [outgoingLedger.id],
        reason: "Nueva rendición",
        authorizerPin: "1234",
        paymentMethodCode: method,
      });
      expect(
        (await reopened.bootstrap()).deliveryLedger.find(
          (row) => row.id === outgoingLedger.id,
        )?.status,
      ).toBe("SETTLED");
    },
  );

  it.each(["ACCOUNT", "", "MISSING", "INACTIVE"])(
    "rechaza método %j sin mutar estado",
    async (method) => {
      const storage = new MemoryStorage();
      const api = createDemoApi(storage);
      await api.bootstrap();
      const orderId = await delivery(api, true);
      if (method === "INACTIVE") {
        const saved = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
        saved.data.paymentMethods.find(
          (item: any) => item.code === "TRANSFER",
        ).active = false;
        storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(saved));
      }
      const ledger = (
        await createDemoApi(storage).bootstrap()
      ).deliveryLedger.find((row) => row.orderId === orderId)!;
      const before = storage.getItem(DEMO_STORAGE_KEY);
      const paymentMethodCode = method === "INACTIVE" ? "TRANSFER" : method;
      const attemptApi = method === "INACTIVE" ? createDemoApi(storage) : api;
      await expect(
        attemptApi.settleDelivery({
          ledgerIds: [ledger.id],
          reason: "Rendición",
          authorizerPin: "1234",
          paymentMethodCode,
        }),
      ).rejects.toThrow();
      expect(storage.getItem(DEMO_STORAGE_KEY)).toBe(before);
    },
  );

  it("impide revertir directamente un movimiento de liquidación sin cambiar ledger ni caja", async () => {
    const storage = new MemoryStorage();
    const api = createDemoApi(storage);
    await api.bootstrap();
    const orderId = await delivery(api, true);
    const ledger = (await api.bootstrap()).deliveryLedger.find(
      (row) => row.orderId === orderId,
    )!;
    await api.settleDelivery({
      ledgerIds: [ledger.id],
      reason: "Rendición",
      authorizerPin: "1234",
    });
    const saved = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
    const movement = saved.movements.at(-1);
    const before = storage.getItem(DEMO_STORAGE_KEY);
    await expect(
      api.reverseCashMovement({
        movementId: movement.id,
        reason: "No",
        authorizerPin: "1234",
      }),
    ).rejects.toThrow(
      "Este movimiento corresponde a una liquidación de reparto. Revertí la liquidación desde Repartidores.",
    );
    expect(storage.getItem(DEMO_STORAGE_KEY)).toBe(before);
  });
});
