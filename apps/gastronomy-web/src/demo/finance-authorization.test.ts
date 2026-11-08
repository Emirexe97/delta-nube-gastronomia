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

describe("autorización demo de dinero", () => {
  it("valida PIN antes de mover fondos y no lo guarda en la persistencia", async () => {
    const storage = new MemoryStorage();
    const api = createDemoApi(storage);
    expect((await api.bootstrap()).cashSession?.status).toBe("OPEN");
    const movementInput = {
      type: "WITHDRAWAL" as const,
      amountMinor: 2_500,
      reason: "Retiro protegido",
      idempotencyKey: "auth-cash-withdrawal",
    };
    const beforeMovement = storage.getItem(DEMO_STORAGE_KEY);
    await expect(
      api.registerCashMovement({ ...movementInput, authorizerPin: "0000" }),
    ).rejects.toThrow(/PIN/i);
    expect(storage.getItem(DEMO_STORAGE_KEY)).toBe(beforeMovement);
    await api.registerCashMovement({ ...movementInput, authorizerPin: "1234" });

    const beforeExpense = storage.getItem(DEMO_STORAGE_KEY)!;
    const date = (await api.bootstrap()).cashSession!.businessDate;
    await expect(
      api.createFinanceExpense({
        title: "No autorizado",
        category: "Prueba",
        kind: "GENERAL",
        amountMinor: 1_000,
        incurredOn: date,
        dueOn: date,
        authorizerPin: "0000",
      }),
    ).rejects.toThrow(/PIN/i);
    expect(storage.getItem(DEMO_STORAGE_KEY)).toBe(beforeExpense);

    const expense = await api.createFinanceExpense({
      title: "Gasto autorizado",
      category: "Prueba",
      kind: "GENERAL",
      amountMinor: 1_000,
      incurredOn: date,
      dueOn: date,
      authorizerPin: "1234",
    });
    const saved = storage.getItem(DEMO_STORAGE_KEY)!;
    expect(saved).not.toContain("authorizerPin");
    expect(saved).not.toContain("1234");

    await api.payFinanceExpense({
      expenseId: expense.id,
      paymentMethodCode: "TRANSFER",
      fromCash: false,
      idempotencyKey: "auth-finance-payment",
      authorizerPin: "1234",
    });
    const paid = (
      await api.getFinanceReport({ from: date, to: date })
    ).expenses.find((item) => item.id === expense.id)!;
    await expect(
      api.unmarkFinanceExpensePayment({
        expenseId: expense.id,
        expectedRevision: paid.revision!,
        reason: "Deshacer",
        idempotencyKey: "auth-finance-unmark",
        authorizerPin: "0000",
      }),
    ).rejects.toThrow(/PIN/i);
    expect(
      (await api.getFinanceReport({ from: date, to: date })).expenses.find(
        (item) => item.id === expense.id,
      )?.paidAt,
    ).toBe(paid.paidAt);
  });
});
