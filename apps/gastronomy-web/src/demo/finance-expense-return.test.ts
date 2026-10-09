import { describe, expect, it } from "vitest";
import { businessDateFromOpening } from "@gastronomy/domain";
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
  const boot = await api.bootstrap();
  const incurredOn = new Date(
    `${businessDateFromOpening(new Date().toISOString())}T00:00:00.000Z`,
  );
  incurredOn.setUTCDate(1);
  incurredOn.setUTCMonth(incurredOn.getUTCMonth() - 1);
  const expenseDate = incurredOn.toISOString().slice(0, 10);
  const expense = await api.createFinanceExpense({
    title: "Servicio reintegrado",
    category: "Servicios",
    kind: "GENERAL",
    amountMinor: 12_500,
    incurredOn: expenseDate,
    dueOn: expenseDate,
    idempotencyKey: "expense",
  });
  const paid = await api.payFinanceExpense({
    expenseId: expense.id,
    paymentMethodCode: "CASH",
    fromCash: true,
    expectedRevision: expense.revision,
    idempotencyKey: "expense-payment",
  });
  return { storage, api, expense, paid };
}

const receive = (expenseId: string, expectedRevision: number, more = {}) => ({
  expenseId,
  expectedRevision,
  destination: "CASH_SESSION" as const,
  paymentMethodCode: "CASH",
  reason: "Servicio cancelado",
  authorizerPin: "1234",
  idempotencyKey: "return-once",
  ...more,
});

describe("devolución real total de gasto General en demo", () => {
  it("conserva el gasto/pago original y registra retorno vinculado, sin duplicar al recrear API", async () => {
    const { storage, api, expense, paid } = await setup();
    const stateBefore = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
    const receivedOn = businessDateFromOpening(new Date().toISOString());
    const reportBefore = await api.getFinanceReport({
      from: expense.incurredOn,
      to: receivedOn,
    });
    const originalId = stateBefore.financeExpenseMovements[expense.id];
    const original = stateBefore.movements.find(
      (m: { id: string }) => m.id === originalId,
    );
    const expectedBefore = stateBefore.data.cashSession.expectedAmountMinor;
    const productsBefore = structuredClone(stateBefore.data.products);
    const returned = await api.receiveFinanceExpenseReturn(
      receive(expense.id, paid.revision!),
    );
    expect(returned).toMatchObject({
      id: expense.id,
      amountMinor: expense.amountMinor,
      incurredOn: expense.incurredOn,
      paidAt: paid.paidAt,
      paymentMethodCode: paid.paymentMethodCode,
      revision: paid.revision! + 1,
      canReceiveReturn: false,
      canUnmarkPayment: false,
      cashPaymentCorrection: null,
      returnInfo: {
        expenseId: expense.id,
        amountMinor: expense.amountMinor,
        receivedOn,
        destination: "CASH_SESSION",
        affectsCash: true,
      },
    });
    const after = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
    expect(
      after.movements.find((m: { id: string }) => m.id === originalId),
    ).toEqual(original);
    expect(after.data.cashSession.expectedAmountMinor).toBe(
      expectedBefore + expense.amountMinor,
    );
    expect(after.data.products).toEqual(productsBefore);
    expect(after.financeExpenseReturns).toHaveLength(1);
    expect(after.movements.at(-1)).toMatchObject({
      type: "INCOME",
      amountMinor: expense.amountMinor,
      affectsCash: true,
    });
    expect(after.audit[0]).toMatchObject({
      action: "FINANCE_EXPENSE_RETURN_RECEIVED",
      permissionUsed: "finance.manage",
    });
    expect(JSON.parse(after.audit[0].beforeJson)).toMatchObject({
      expense: paid,
      operatorUserId: expect.any(String),
      authorizerUserId: expect.any(String),
      returnRecord: { before: paid, reason: "Servicio cancelado" },
    });
    expect(JSON.parse(after.audit[0].afterJson)).toMatchObject({
      expense: returned,
      operatorUserId: expect.any(String),
      authorizerUserId: expect.any(String),
      returnRecord: { after: returned, reason: "Servicio cancelado" },
    });
    const recreated = createDemoApi(storage);
    const beforeReplay = storage.getItem(DEMO_STORAGE_KEY);
    await expect(
      recreated.receiveFinanceExpenseReturn(
        receive(expense.id, paid.revision!),
      ),
    ).resolves.toEqual(returned);
    expect(storage.getItem(DEMO_STORAGE_KEY)).toBe(beforeReplay);
    expect(
      JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!).financeExpenseReturns,
    ).toHaveLength(1);
    const report = await recreated.getFinanceReport({
      from: expense.incurredOn,
      to: receivedOn,
    });
    expect(expense.incurredOn.slice(0, 7)).not.toBe(receivedOn.slice(0, 7));
    expect(report.expensesMinor).toBe(expense.amountMinor);
    expect(report.expenseReturnsMinor).toBe(expense.amountMinor);
    expect(report.netExpensesMinor).toBe(0);
    expect(report.estimatedOperatingProfitMinor).toBe(
      reportBefore.estimatedOperatingProfitMinor + expense.amountMinor,
    );
    expect(report.expenseReturns).toHaveLength(1);
    expect(
      report.expenses.find((item) => item.id === expense.id),
    ).toMatchObject({
      amountMinor: expense.amountMinor,
      incurredOn: expense.incurredOn,
    });
    const receiptMonth = report.monthly.find(
      (m) => m.month === receivedOn.slice(0, 7),
    )!;
    expect(receiptMonth.expenseReturnsMinor).toBe(expense.amountMinor);
    expect(receiptMonth.netExpensesMinor).toBe(
      receiptMonth.expensesMinor - (receiptMonth.expenseReturnsMinor ?? 0),
    );
  });

  it("valida manage/PIN antes del replay y rechaza colisión de recibo con otra operación", async () => {
    const { storage, api, expense, paid } = await setup();
    const pristine = storage.getItem(DEMO_STORAGE_KEY);
    await expect(
      api.receiveFinanceExpenseReturn(
        receive(expense.id, paid.revision!, { authorizerPin: "0000" }),
      ),
    ).rejects.toThrow(/PIN/i);
    expect(storage.getItem(DEMO_STORAGE_KEY)).toBe(pristine);
    const tampered = JSON.parse(pristine!);
    tampered.data.currentUser.permissions = ["cash.income"];
    storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(tampered));
    const deniedApi = createDemoApi(storage);
    const denied = storage.getItem(DEMO_STORAGE_KEY);
    await expect(
      deniedApi.receiveFinanceExpenseReturn(
        receive(expense.id, paid.revision!),
      ),
    ).rejects.toThrow(/permiso/i);
    expect(storage.getItem(DEMO_STORAGE_KEY)).toBe(denied);

    const state = JSON.parse(denied!);
    state.data.currentUser.permissions = ["*"];
    state.financeExpensePaymentReceipts["return-once"] = {
      fingerprint: "historical-pay",
      result: paid,
    };
    storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(state));
    const collisionApi = createDemoApi(storage);
    const collision = storage.getItem(DEMO_STORAGE_KEY);
    await expect(
      collisionApi.receiveFinanceExpenseReturn(
        receive(expense.id, paid.revision!),
      ),
    ).rejects.toThrow(/clave.*diferentes/i);
    expect(storage.getItem(DEMO_STORAGE_KEY)).toBe(collision);
  });

  it("mantiene el replay histórico de desmarcado y corrección B2A tras devolver un pago posterior", async () => {
    const { storage, api, expense, paid } = await setup();
    const correctionInput = {
      expenseId: expense.id,
      expectedRevision: paid.revision!,
      reason: "Corrección previa",
      authorizerPin: "1234",
      idempotencyKey: "old-b2a",
    };
    const corrected =
      await api.correctFinanceExpenseCashPayment(correctionInput);
    const repaid = await api.payFinanceExpense({
      expenseId: expense.id,
      paymentMethodCode: "CASH",
      fromCash: true,
      expectedRevision: corrected.revision!,
      idempotencyKey: "repay-after-b2a",
    });
    await api.receiveFinanceExpenseReturn(
      receive(expense.id, repaid.revision!, {
        idempotencyKey: "return-after-b2a",
      }),
    );
    const replayApi = createDemoApi(storage);
    const stateAfterConstruction = storage.getItem(DEMO_STORAGE_KEY);
    await expect(
      replayApi.payFinanceExpense({
        expenseId: expense.id,
        paymentMethodCode: "CASH",
        fromCash: true,
        expectedRevision: 0,
        idempotencyKey: "expense-payment",
      }),
    ).resolves.toEqual(paid);
    await expect(
      replayApi.correctFinanceExpenseCashPayment(correctionInput),
    ).resolves.toEqual(corrected);
    expect(storage.getItem(DEMO_STORAGE_KEY)).toBe(stateAfterConstruction);

    const externalStorage = new MemoryStorage();
    const externalApi = createDemoApi(externalStorage);
    const businessDate = (await externalApi.bootstrap()).cashSession!
      .businessDate;
    const external = await externalApi.createFinanceExpense({
      title: "Pago externo",
      category: "Servicios",
      kind: "GENERAL",
      amountMinor: 3300,
      incurredOn: businessDate,
      idempotencyKey: "unmark-expense",
    });
    const externalPaid = await externalApi.payFinanceExpense({
      expenseId: external.id,
      paymentMethodCode: "TRANSFER",
      fromCash: false,
      expectedRevision: external.revision,
      idempotencyKey: "unmark-pay",
    });
    const unmarkInput = {
      expenseId: external.id,
      expectedRevision: externalPaid.revision!,
      reason: "Unmark previo",
      idempotencyKey: "old-unmark",
    };
    const unmarked = await externalApi.unmarkFinanceExpensePayment(unmarkInput);
    const repaidExternal = await externalApi.payFinanceExpense({
      expenseId: external.id,
      paymentMethodCode: "TRANSFER",
      fromCash: false,
      expectedRevision: unmarked.revision!,
      idempotencyKey: "repay-after-unmark",
    });
    await externalApi.receiveFinanceExpenseReturn(
      receive(external.id, repaidExternal.revision!, {
        destination: "EXTERNAL",
        authorizerPin: undefined,
        idempotencyKey: "return-after-unmark",
      }),
    );
    const externalReplayApi = createDemoApi(externalStorage);
    const externalStateAfterConstruction =
      externalStorage.getItem(DEMO_STORAGE_KEY);
    await expect(
      externalReplayApi.unmarkFinanceExpensePayment(unmarkInput),
    ).resolves.toEqual(unmarked);
    expect(externalStorage.getItem(DEMO_STORAGE_KEY)).toBe(
      externalStateAfterConstruction,
    );
  });

  it("no acredita caja para destino externo aunque el medio elegido sea CASH y admite caja cerrada", async () => {
    const { storage, api, expense, paid } = await setup();
    const state = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
    const expected = state.data.cashSession.expectedAmountMinor;
    await api.closeCashSession({
      countedAmountMinor: expected,
      force: true,
      reason: "Cierre demo pendiente",
      authorizerPin: "1234",
    });
    const closedApi = createDemoApi(storage);
    const closed = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
    const afterReturn = await closedApi.receiveFinanceExpenseReturn(
      receive(expense.id, paid.revision!, {
        destination: "EXTERNAL",
        idempotencyKey: "outside",
        paymentMethodCode: "CASH",
        authorizerPin: undefined,
      }),
    );
    const final = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
    expect(afterReturn.returnInfo).toMatchObject({
      destination: "EXTERNAL",
      affectsCash: false,
      cashSessionId: null,
      cashMovementId: null,
    });
    expect(final.movements).toHaveLength(closed.movements.length);
    expect(final.data.cashSession).toEqual(closed.data.cashSession);
    expect(final.historicalSessions).toEqual(closed.historicalSessions);
    expect(final.historicalSessions).toEqual(closed.historicalSessions);
    expect(JSON.parse(final.audit[0].afterJson)).toMatchObject({
      authorizerUserId: null,
      authorizerPermission: null,
    });
  });

  it("usa la sesión OPEN actual y el medio de la devolución, no la sesión ni el medio originales", async () => {
    const { storage, api, expense, paid } = await setup();
    const before = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
    const originalSessionId = before.data.cashSession.id;
    const originalExpected = before.data.cashSession.expectedAmountMinor;
    await api.closeCashSession({
      countedAmountMinor: originalExpected,
      force: true,
      reason: "Cierre de prueba",
      authorizerPin: "1234",
    });
    const opener = createDemoApi(storage);
    const afterClose = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
    const closedSnapshot = structuredClone(
      afterClose.historicalSessions.find(
        (s: { id: string }) => s.id === originalSessionId,
      ),
    );
    await opener.openCashSession({ openingAmountMinor: 80_000 });
    const fresh = createDemoApi(storage);
    const cashToTransfer = await fresh.receiveFinanceExpenseReturn(
      receive(expense.id, paid.revision!, {
        paymentMethodCode: "TRANSFER",
        idempotencyKey: "cash-to-transfer",
      }),
    );
    const transferState = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
    expect(
      transferState.historicalSessions.find(
        (s: { id: string }) => s.id === originalSessionId,
      ),
    ).toMatchObject({ status: "CLOSED" });
    expect(transferState.data.cashSession.expectedAmountMinor).toBe(80_000);
    expect(cashToTransfer.returnInfo).toMatchObject({
      cashSessionId: transferState.data.cashSession.id,
      cashSessionNumber: transferState.data.cashSession.number,
      paymentMethodCode: "TRANSFER",
      affectsCash: false,
    });
    expect(transferState.movements.at(-1)).toMatchObject({
      type: "INCOME",
      sessionId: transferState.data.cashSession.id,
      amountMinor: expense.amountMinor,
      affectsCash: false,
    });
    expect(
      transferState.historicalSessions.find(
        (s: { id: string }) => s.id === originalSessionId,
      ),
    ).toEqual(closedSnapshot);

    const second = new MemoryStorage();
    const secondApi = createDemoApi(second);
    const boot = await secondApi.bootstrap();
    const external = await secondApi.createFinanceExpense({
      title: "Transferencia original",
      category: "Servicios",
      kind: "GENERAL",
      amountMinor: 7000,
      incurredOn: boot.cashSession!.businessDate,
      dueOn: boot.cashSession!.businessDate,
      idempotencyKey: "transfer-expense",
    });
    const paidTransfer = await secondApi.payFinanceExpense({
      expenseId: external.id,
      paymentMethodCode: "TRANSFER",
      fromCash: true,
      expectedRevision: external.revision,
      idempotencyKey: "transfer-payment",
    });
    const transferCashBefore = JSON.parse(second.getItem(DEMO_STORAGE_KEY)!)
      .data.cashSession.expectedAmountMinor;
    const cashReturn = await createDemoApi(second).receiveFinanceExpenseReturn(
      receive(external.id, paidTransfer.revision!, {
        paymentMethodCode: "CASH",
        idempotencyKey: "transfer-to-cash",
      }),
    );
    const cashState = JSON.parse(second.getItem(DEMO_STORAGE_KEY)!);
    expect(cashState.data.cashSession.expectedAmountMinor).toBe(
      transferCashBefore + 7000,
    );
    expect(cashReturn.returnInfo).toMatchObject({
      paymentMethodCode: "CASH",
      affectsCash: true,
    });
  });

  it("rechaza revisión obsoleta y tipos/estados fuera del alcance sin mutar", async () => {
    const { storage, api, expense, paid } = await setup();
    const stale = storage.getItem(DEMO_STORAGE_KEY);
    await expect(
      api.receiveFinanceExpenseReturn(
        receive(expense.id, paid.revision! - 1, { idempotencyKey: "stale" }),
      ),
    ).rejects.toThrow(/cambió/i);
    expect(storage.getItem(DEMO_STORAGE_KEY)).toBe(stale);
    const fixed = await api.createFinanceExpense({
      title: "Fijo",
      category: "Servicios",
      kind: "FIXED",
      amountMinor: 1000,
      incurredOn: expense.incurredOn,
      idempotencyKey: "fixed",
    });
    const fixedPaid = await api.payFinanceExpense({
      expenseId: fixed.id,
      paymentMethodCode: "CASH",
      fromCash: false,
      expectedRevision: fixed.revision,
      idempotencyKey: "fixed-pay",
    });
    const snapshot = storage.getItem(DEMO_STORAGE_KEY);
    await expect(
      api.receiveFinanceExpenseReturn(
        receive(fixed.id, fixedPaid.revision!, {
          idempotencyKey: "fixed-return",
        }),
      ),
    ).rejects.toThrow(/General|manuales/i);
    expect(storage.getItem(DEMO_STORAGE_KEY)).toBe(snapshot);
    const payroll = await api.createFinanceExpense({
      title: "Sueldo",
      category: "Personal",
      kind: "PAYROLL",
      amountMinor: 1000,
      incurredOn: expense.incurredOn,
      employeeId: JSON.parse(snapshot!).data.users[0].id,
      idempotencyKey: "payroll",
    });
    const payrollPaid = await api.payFinanceExpense({
      expenseId: payroll.id,
      paymentMethodCode: "CASH",
      fromCash: false,
      expectedRevision: payroll.revision,
      idempotencyKey: "payroll-pay",
    });
    const beforePayrollReturn = storage.getItem(DEMO_STORAGE_KEY);
    await expect(
      api.receiveFinanceExpenseReturn(
        receive(payroll.id, payrollPaid.revision!, {
          idempotencyKey: "payroll-return",
        }),
      ),
    ).rejects.toThrow(/General|manuales/i);
    expect(storage.getItem(DEMO_STORAGE_KEY)).toBe(beforePayrollReturn);
    for (const field of ["cancelledAt", "recurringId"] as const) {
      const modified = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
      const row = modified.financeExpenses.find(
        (item: { id: string }) => item.id === expense.id,
      );
      row[field] =
        field === "cancelledAt" ? new Date().toISOString() : "recurring-demo";
      storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(modified));
      const invalidApi = createDemoApi(storage);
      const invalidSnapshot = storage.getItem(DEMO_STORAGE_KEY);
      await expect(
        invalidApi.receiveFinanceExpenseReturn(
          receive(expense.id, paid.revision!, {
            idempotencyKey: `invalid-${field}`,
          }),
        ),
      ).rejects.toThrow(/General|manuales/i);
      expect(storage.getItem(DEMO_STORAGE_KEY)).toBe(invalidSnapshot);
    }
  });

  it("limita a pago total General elegible y bloquea desmarcado/reversión genérica después del retorno", async () => {
    const { storage, api, expense, paid } = await setup();
    const returned = await api.receiveFinanceExpenseReturn(
      receive(expense.id, paid.revision!),
    );
    await expect(
      api.unmarkFinanceExpensePayment({
        expenseId: expense.id,
        expectedRevision: returned.revision!,
        reason: "No",
        idempotencyKey: "unmark-after-return",
      }),
    ).rejects.toThrow(/devuelt|devoluci|retorno/i);
    await expect(
      api.correctFinanceExpenseCashPayment({
        expenseId: expense.id,
        expectedRevision: returned.revision!,
        reason: "No",
        authorizerPin: "1234",
        idempotencyKey: "correction-after-return",
      }),
    ).rejects.toThrow(/devolución|retorno/i);
    const state = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
    const info = returned.returnInfo!;
    for (const movementId of [info.originalMovementId!, info.cashMovementId!])
      await expect(
        api.reverseCashMovement({
          movementId,
          reason: "No",
          authorizerPin: "1234",
        }),
      ).rejects.toThrow(/devolución|gasto/i);
    const partial = await api.createFinanceExpense({
      title: "Pendiente",
      category: "Pruebas",
      kind: "GENERAL",
      amountMinor: 1000,
      incurredOn: expense.incurredOn,
      idempotencyKey: "partial",
    });
    await expect(
      api.receiveFinanceExpenseReturn(
        receive(partial.id, partial.revision!, {
          idempotencyKey: "partial-return",
        }),
      ),
    ).rejects.toThrow(/pagado|elegible/i);
    const final = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
    expect(final.financeExpenseReturns).toHaveLength(1);
    expect(final.data.products).toEqual(state.data.products);
  });
});
