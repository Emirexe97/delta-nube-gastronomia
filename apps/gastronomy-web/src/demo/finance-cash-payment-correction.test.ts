import { describe, expect, it } from "vitest";
import { createDemoApi, DEMO_STORAGE_KEY, type DemoStorage } from "./demo-api";

class MemoryStorage implements DemoStorage {
  values = new Map<string, string>();
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

async function setup() {
  const storage = new MemoryStorage();
  const api = createDemoApi(storage);
  const bootstrap = await api.bootstrap();
  const expense = await api.createFinanceExpense({
    title: "Pago de caja a corregir",
    category: "Pruebas",
    kind: "GENERAL",
    amountMinor: 12500,
    incurredOn: bootstrap.cashSession!.businessDate,
    dueOn: bootstrap.cashSession!.businessDate,
    idempotencyKey: "create-expense",
  });
  const paid = await api.payFinanceExpense({
    expenseId: expense.id,
    paymentMethodCode: "CASH",
    fromCash: true,
    expectedRevision: expense.revision ?? 0,
    idempotencyKey: "pay-expense",
  });
  return { storage, api, expense, paid };
}

describe("corrección de pago de gasto desde caja en demo", () => {
  it("compensa una salida CASH sin reescribirla, limpia pago y guarda procedencia/auditoría", async () => {
    const { storage, api, expense, paid } = await setup();
    const original = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
    const movementId = original.financeExpenseMovements[expense.id];
    const originalMovement = original.movements.find(
      (m: { id: string }) => m.id === movementId,
    );
    const corrected = await api.correctFinanceExpenseCashPayment({
      expenseId: expense.id,
      expectedRevision: paid.revision!,
      reason: "Se pagó por error",
      authorizerPin: "1234",
      idempotencyKey: "correct-1",
    });
    expect(corrected).toMatchObject({
      paidAt: null,
      paymentMethodCode: null,
      revision: paid.revision! + 1,
    });
    expect(corrected.cashPaymentCorrection).toBeNull();
    const state = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
    expect(
      state.movements.find((m: { id: string }) => m.id === movementId),
    ).toEqual(originalMovement);
    const compensation = state.movements.find(
      (m: { referenceId?: string; type: string }) =>
        m.referenceId === movementId && m.type === "INCOME",
    );
    expect(compensation).toMatchObject({
      amountMinor: 12500,
      paymentMethodCode: "CASH",
      affectsCash: true,
    });
    expect(state.financeExpenseMovements[expense.id]).toBeUndefined();
    expect(state.data.cashSession.expectedAmountMinor).toBe(
      original.data.cashSession.expectedAmountMinor + 12500,
    );
    expect(state.data.products).toEqual(original.data.products);
    const report = await createDemoApi(storage).getFinanceReport({
      from: expense.incurredOn,
      to: expense.incurredOn,
    });
    expect(
      report.expenses.find((item) => item.id === expense.id),
    ).toMatchObject({
      paidAt: null,
      amountMinor: 12500,
      cashPaymentCorrection: null,
    });
    expect(report.unpaidMinor).toBe(
      report.expenses
        .filter((item) => !item.paidAt && !item.cancelledAt)
        .reduce((sum, item) => sum + item.amountMinor, 0),
    );
    expect(state.financeExpensePaymentCorrections).toHaveLength(1);
    expect(state.audit[0]).toMatchObject({
      action: "FINANCE_EXPENSE_CASH_PAYMENT_CORRECTED",
      permissionUsed: "finance.manage",
    });
    expect(JSON.parse(state.audit[0].beforeJson)).toMatchObject({
      expense: paid,
      authorizerUserId: expect.any(String),
      authorizerPermission: "cash.expense",
      correction: {
        originalMovementId: movementId,
        compensationMovementId: compensation.id,
        reason: "Se pagó por error",
      },
    });
    expect(JSON.parse(state.audit[0].afterJson)).toMatchObject({
      expense: corrected,
      authorizerUserId: expect.any(String),
      authorizerPermission: "cash.expense",
    });
  });

  it("exige clave nueva, aplica permiso y PIN antes del replay y no muta en rechazos", async () => {
    const { storage, api, expense, paid } = await setup();
    const snapshot = storage.getItem(DEMO_STORAGE_KEY);
    await expect(
      api.correctFinanceExpenseCashPayment({
        expenseId: expense.id,
        expectedRevision: paid.revision!,
        reason: "Error",
        authorizerPin: "0000",
        idempotencyKey: "bad-pin",
      }),
    ).rejects.toThrow(/PIN/i);
    expect(storage.getItem(DEMO_STORAGE_KEY)).toBe(snapshot);
    await expect(
      api.correctFinanceExpenseCashPayment({
        expenseId: expense.id,
        expectedRevision: 0,
        reason: "Error",
        authorizerPin: "1234",
        idempotencyKey: "stale",
      }),
    ).rejects.toThrow(/cambió/i);
    expect(storage.getItem(DEMO_STORAGE_KEY)).toBe(snapshot);
    await expect(
      api.correctFinanceExpenseCashPayment({
        expenseId: expense.id,
        expectedRevision: paid.revision!,
        reason: "Error",
        authorizerPin: "1234",
        idempotencyKey: "pay-expense",
      }),
    ).rejects.toThrow(/clave.*diferentes/i);
    expect(storage.getItem(DEMO_STORAGE_KEY)).toBe(snapshot);
  });

  it("protege tanto la salida financiera original como su compensación ante reversión genérica", async () => {
    const { storage, api, expense, paid } = await setup();
    const corrected = await api.correctFinanceExpenseCashPayment({
      expenseId: expense.id,
      expectedRevision: paid.revision!,
      reason: "Error",
      authorizerPin: "1234",
      idempotencyKey: "correct",
    });
    const state = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
    const record = state.financeExpensePaymentCorrections[0];
    const comp = state.movements.find(
      (m: { id: string }) => m.id === record.compensationMovementId,
    );
    for (const movementId of [
      record.originalMovementId,
      record.compensationMovementId,
    ]) {
      const snapshot = storage.getItem(DEMO_STORAGE_KEY);
      await expect(
        api.reverseCashMovement({
          movementId,
          reason: "Prueba",
          authorizerPin: "1234",
        }),
      ).rejects.toThrow(/gasto de Finanzas|corrección/i);
      expect(storage.getItem(DEMO_STORAGE_KEY)).toBe(snapshot);
    }
    expect(corrected.cashPaymentCorrection).toBeNull();
    expect(comp).toMatchObject({
      type: "INCOME",
      referenceId: record.originalMovementId,
    });
  });

  it("replaya recibos sin repetir compensación y permite ciclos con una compensación por pago", async () => {
    const { storage, api, expense, paid } = await setup();
    const input = {
      expenseId: expense.id,
      expectedRevision: paid.revision!,
      reason: "Primer error",
      authorizerPin: "1234",
      idempotencyKey: "fix-1",
    };
    const first = await api.correctFinanceExpenseCashPayment(input);
    const replay =
      await createDemoApi(storage).correctFinanceExpenseCashPayment(input);
    expect(replay).toEqual(first);
    await expect(
      createDemoApi(storage).correctFinanceExpenseCashPayment({
        ...input,
        authorizerPin: "0000",
      }),
    ).rejects.toThrow(/PIN/i);
    expect(
      JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!)
        .financeExpensePaymentCorrections,
    ).toHaveLength(1);
    const recreatedApi = createDemoApi(storage);
    const repaid = await recreatedApi.payFinanceExpense({
      expenseId: expense.id,
      paymentMethodCode: "CASH",
      fromCash: true,
      expectedRevision: first.revision!,
      idempotencyKey: "pay-2",
    });
    await createDemoApi(storage).correctFinanceExpenseCashPayment({
      ...input,
      expectedRevision: repaid.revision!,
      reason: "Segundo error",
      idempotencyKey: "fix-2",
    });
    expect(
      JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!)
        .financeExpensePaymentCorrections,
    ).toHaveLength(2);
  });

  it("compensa transferencia vinculada sin alterar efectivo esperado y muestra metadatos sólo en pago elegible", async () => {
    const storage = new MemoryStorage();
    const api = createDemoApi(storage);
    const date = (await api.bootstrap()).cashSession!.businessDate;
    const expense = await api.createFinanceExpense({
      title: "Transferencia",
      category: "Pruebas",
      kind: "GENERAL",
      amountMinor: 7300,
      incurredOn: date,
      dueOn: date,
      idempotencyKey: "expense",
    });
    const paid = await api.payFinanceExpense({
      expenseId: expense.id,
      paymentMethodCode: "TRANSFER",
      fromCash: true,
      expectedRevision: expense.revision ?? 0,
      idempotencyKey: "pay",
    });
    expect(paid.cashPaymentCorrection).toMatchObject({
      affectsCash: false,
      amountMinor: 7300,
    });
    const before = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
    const expectedBefore = before.data.cashSession.expectedAmountMinor;
    before.data.paymentMethods.find(
      (method: { code: string }) => method.code === "TRANSFER",
    ).affectsCash = true;
    storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(before));
    const corrected = await createDemoApi(
      storage,
    ).correctFinanceExpenseCashPayment({
      expenseId: expense.id,
      expectedRevision: paid.revision!,
      reason: "Medio equivocado",
      authorizerPin: "1234",
      idempotencyKey: "correction",
    });
    const after = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
    expect(after.data.cashSession.expectedAmountMinor).toBe(expectedBefore);
    expect(after.movements.at(-1)).toMatchObject({
      type: "INCOME",
      amountMinor: 7300,
      affectsCash: false,
      paymentMethodCode: "TRANSFER",
    });
    expect(corrected.cashPaymentCorrection).toBeNull();
  });

  it("rechaza pago externo y una caja cerrada sin mutar estado", async () => {
    const storage = new MemoryStorage();
    const api = createDemoApi(storage);
    const date = (await api.bootstrap()).cashSession!.businessDate;
    const external = await api.createFinanceExpense({
      title: "Externo",
      category: "Pruebas",
      kind: "GENERAL",
      amountMinor: 2400,
      incurredOn: date,
      dueOn: date,
      idempotencyKey: "external",
    });
    const externalPaid = await api.payFinanceExpense({
      expenseId: external.id,
      paymentMethodCode: "CASH",
      fromCash: false,
      idempotencyKey: "external-pay",
    });
    const linked = await api.createFinanceExpense({
      title: "Caja",
      category: "Pruebas",
      kind: "GENERAL",
      amountMinor: 1700,
      incurredOn: date,
      dueOn: date,
      idempotencyKey: "linked",
    });
    const linkedPaid = await api.payFinanceExpense({
      expenseId: linked.id,
      paymentMethodCode: "CASH",
      fromCash: true,
      idempotencyKey: "linked-pay",
    });
    const state = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
    state.data.currentUser.permissions = ["finance.manage"];
    for (const user of state.data.users) user.permissions = ["finance.manage"];
    storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(state));
    const deniedApi = createDemoApi(storage);
    const deniedSnapshot = storage.getItem(DEMO_STORAGE_KEY);
    await expect(
      deniedApi.correctFinanceExpenseCashPayment({
        expenseId: external.id,
        expectedRevision: externalPaid.revision!,
        reason: "Error",
        authorizerPin: "1234",
        idempotencyKey: "denied",
      }),
    ).rejects.toThrow(/permiso/i);
    expect(storage.getItem(DEMO_STORAGE_KEY)).toBe(deniedSnapshot);

    state.data.currentUser.permissions = ["*"];
    state.data.users[0].permissions = ["*"];
    storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(state));
    const currentExpected = state.data.cashSession.expectedAmountMinor;
    const closedApi = createDemoApi(storage);
    await closedApi.closeCashSession({
      countedAmountMinor: currentExpected,
      force: true,
      reason: "Cierre de prueba con pedidos demo",
      authorizerPin: "1234",
    });
    const closedSessionApi = createDemoApi(storage);
    const closedSnapshot = storage.getItem(DEMO_STORAGE_KEY);
    await expect(
      closedSessionApi.correctFinanceExpenseCashPayment({
        expenseId: linked.id,
        expectedRevision: linkedPaid.revision!,
        reason: "Error",
        authorizerPin: "1234",
        idempotencyKey: "closed",
      }),
    ).rejects.toThrow(/corregir pagos manuales/i);
    expect(storage.getItem(DEMO_STORAGE_KEY)).toBe(closedSnapshot);
  });
});
