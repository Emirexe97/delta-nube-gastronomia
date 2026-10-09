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

const linkedExpense = async (paymentMethodCode: "CASH" | "TRANSFER") => {
  const storage = new MemoryStorage();
  const api = createDemoApi(storage);
  const date = (await api.bootstrap()).cashSession!.businessDate;
  const expense = await api.createFinanceExpense({
    title: `Gasto ${paymentMethodCode}`,
    category: "Pruebas",
    kind: "GENERAL",
    amountMinor: 1_000,
    incurredOn: date,
    dueOn: date,
  });
  await api.payFinanceExpense({
    expenseId: expense.id,
    paymentMethodCode,
    fromCash: true,
  });
  const saved = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
  const movementId = saved.financeExpenseMovements[expense.id] as string;
  return { storage, api, expense, movementId };
};

const FINANCE_REVERSAL_ERROR =
  "Este egreso corresponde a un gasto de Finanzas y no puede anularse como movimiento suelto.";

describe("guardas demo al anular movimientos de caja", () => {
  it("conserva la protección del cobro de cuenta corriente vinculado", async () => {
    const storage = new MemoryStorage();
    const api = createDemoApi(storage);
    const customer = await api.createCustomer({
      name: "Cliente prueba guarda",
      phone: "1144448888",
    });
    const product = (await api.bootstrap()).products.find(
      (item) => item.active,
    )!;
    const order = await api.createOrder({
      type: "TAKEAWAY",
      customerId: customer.id,
      customerName: customer.name,
      customerPhone: customer.phone,
    });
    const withItem = await api.addOrderItem({
      orderId: order.id,
      productId: product.id,
    });
    await api.confirmOrder({ orderId: order.id });
    await api.payOrder({
      orderId: order.id,
      payments: [{ methodCode: "ACCOUNT", amountMinor: withItem.totalMinor }],
    });
    await api.settleCustomerAccount({
      customerId: customer.id,
      methodCode: "CASH",
      amountMinor: 100,
    });
    const saved = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
    const movementId = saved.accountReceipts.at(-1).movementId as string;
    expect(movementId).toBeTruthy();
    const before = storage.getItem(DEMO_STORAGE_KEY);
    await expect(
      api.reverseCashMovement({
        movementId,
        reason: "No anular cobro vinculado",
        authorizerPin: "1234",
      }),
    ).rejects.toThrow(
      "Este ingreso corresponde a un cobro de cuenta corriente y no puede anularse como movimiento suelto.",
    );
    expect(storage.getItem(DEMO_STORAGE_KEY)).toBe(before);
  });
  it.each(["CASH", "TRANSFER"] as const)(
    "rechaza el movimiento %s ligado a Finanzas sin mutar estado ni en reintentos",
    async (paymentMethodCode) => {
      const { storage, api, movementId } =
        await linkedExpense(paymentMethodCode);
      const before = storage.getItem(DEMO_STORAGE_KEY);
      const reverse = (target: typeof api) =>
        target.reverseCashMovement({
          movementId,
          reason: "Intento directo",
          authorizerPin: "1234",
          idempotencyKey: `finance-reversal-${paymentMethodCode}`,
        });

      await expect(reverse(api)).rejects.toThrow(FINANCE_REVERSAL_ERROR);
      expect(storage.getItem(DEMO_STORAGE_KEY)).toBe(before);
      await expect(reverse(api)).rejects.toThrow(FINANCE_REVERSAL_ERROR);
      expect(storage.getItem(DEMO_STORAGE_KEY)).toBe(before);
      // Initialization normalizes persisted demo data; snapshot after reopening,
      // so we verify the rejected operation itself leaves every field unchanged.
      const reopened = createDemoApi(storage);
      const beforeReopenedAttempt = storage.getItem(DEMO_STORAGE_KEY);
      await expect(reverse(reopened)).rejects.toThrow(FINANCE_REVERSAL_ERROR);
      expect(storage.getItem(DEMO_STORAGE_KEY)).toBe(beforeReopenedAttempt);
    },
  );

  it("mantiene la reversión manual ordinaria y su rechazo por duplicado", async () => {
    const storage = new MemoryStorage();
    const api = createDemoApi(storage);
    const cash = (await api.bootstrap()).cashSession!;
    await api.registerCashMovement({
      type: "EXPENSE",
      amountMinor: 700,
      paymentMethodCode: "CASH",
      reason: "Gasto manual",
    });
    const reportBefore = await api.getCashSessionReport({
      cashSessionId: cash.id,
    });
    const original = reportBefore.movements.find(
      (item) => item.type === "EXPENSE" && item.amountMinor === 700,
    )!;
    const expectedBefore = reportBefore.session.expectedAmountMinor;
    const reversed = await api.reverseCashMovement({
      movementId: original.id,
      reason: "Corrección",
      authorizerPin: "1234",
    });
    expect(reversed.expectedAmountMinor).toBe(expectedBefore + 700);
    const after = await api.getCashSessionReport({ cashSessionId: cash.id });
    expect(after.movements).toContainEqual(
      expect.objectContaining({
        type: "INCOME",
        amountMinor: original.amountMinor,
        referenceId: original.id,
      }),
    );
    await expect(
      api.reverseCashMovement({
        movementId: original.id,
        reason: "Segundo intento",
        authorizerPin: "1234",
      }),
    ).rejects.toThrow("Este movimiento ya fue anulado.");
  });

  it("rechaza reversión manual cuando la caja está cerrada", async () => {
    const api = createDemoApi(new MemoryStorage());
    const cash = (await api.bootstrap()).cashSession!;
    await api.registerCashMovement({
      type: "INCOME",
      amountMinor: 300,
      paymentMethodCode: "CASH",
      reason: "Ingreso manual",
    });
    const movement = (
      await api.getCashSessionReport({
        cashSessionId: cash.id,
      })
    ).movements.find(
      (item) => item.type === "INCOME" && item.amountMinor === 300,
    )!;
    await api.closeCashSession({
      countedAmountMinor: (await api.bootstrap()).cashSession!
        .expectedAmountMinor,
      force: true,
      reason: "Cierre de prueba",
      authorizerPin: "1234",
    });
    await expect(
      api.reverseCashMovement({
        movementId: movement.id,
        reason: "Intento cerrado",
        authorizerPin: "1234",
      }),
    ).rejects.toThrow("Abrí una caja antes de anular movimientos.");
  });
});
