import { describe, expect, it } from "vitest";
import { createDemoApi, DEMO_STORAGE_KEY, type DemoStorage } from "./demo-api";

class MemoryStorage implements DemoStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

async function setup(method = "CASH") {
  const storage = new MemoryStorage();
  const api = createDemoApi(storage);
  const bootstrap = await api.bootstrap();
  const expense = await api.createFinanceExpense({
    title: "Obligación manual aún debida",
    category: "Pruebas",
    kind: "GENERAL",
    amountMinor: 23450,
    incurredOn: bootstrap.cashSession!.businessDate,
    dueOn: bootstrap.cashSession!.businessDate,
    idempotencyKey: "closed-expense",
  });
  const paymentInput = {
    expenseId: expense.id,
    paymentMethodCode: method,
    fromCash: true,
    expectedRevision: expense.revision ?? 0,
    idempotencyKey: "closed-pay",
  };
  const paid = await api.payFinanceExpense(paymentInput);
  const beforeClose = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
  const session = beforeClose.data.cashSession;
  const movements = structuredClone(beforeClose.movements);
  await api.closeCashSession({
    countedAmountMinor: session.expectedAmountMinor,
    force: true,
    reason: "Cierre de prueba",
    authorizerPin: "1234",
  });
  return { storage, api: createDemoApi(storage), expense, paid, paymentInput, session, movements };
}

const correctionInput = (expenseId: string, expectedRevision: number, idempotencyKey = "closed-fix") => ({
  expenseId, expectedRevision, reason: "El dinero nunca salió y la obligación sigue debida",
  authorizerPin: "1234", idempotencyKey, confirmedUnpaid: true,
});

describe("corrección de pago desde caja cerrada en demo", () => {
  it("vuelve a pendiente sin movimiento ni alteración del cierre y conserva auditoría histórica", async () => {
    const { storage, api, expense, paid, session, movements } = await setup();
    const eligible = await api.getFinanceReport({ from: expense.incurredOn, to: expense.incurredOn });
    expect(eligible.expenses.find((item) => item.id === expense.id)?.closedCashPaymentCorrection)
      .toMatchObject({ cashSessionId: session.id, amountMinor: expense.amountMinor });
    const closedSnapshot = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
    const corrected = await api.correctFinanceExpenseClosedCashPayment(
      correctionInput(expense.id, paid.revision!),
    );
    expect(corrected).toMatchObject({
      paidAt: null, paymentMethodCode: null, revision: paid.revision! + 1,
    });
    expect(corrected.closedCashPaymentCorrection).toBeNull();
    expect(corrected.cashPaymentCorrection).toBeNull();
    const state = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
    expect(state.movements).toEqual(closedSnapshot.movements);
    expect(state.historicalSessions).toEqual(closedSnapshot.historicalSessions);
    expect(state.financeExpenseMovements[expense.id]).toBeUndefined();
    expect(state.financeExpensePaymentRevisionRequired[expense.id]).toBe(true);
    expect(state.financeExpenseClosedPaymentCorrections).toHaveLength(1);
    expect(state.financeExpenseClosedPaymentCorrections[0]).toMatchObject({
      originalMovementId: movements.find((m: { type: string }) => m.type === "EXPENSE").id,
      cashSessionId: session.id, cashSessionNumber: session.number,
      amountMinor: expense.amountMinor, before: expect.any(Object), after: expect.any(Object),
    });
    expect(state.audit[0].action).toBe("FINANCE_EXPENSE_CLOSED_PAYMENT_CORRECTED");
    const report = await api.getFinanceReport({ from: expense.incurredOn, to: expense.incurredOn });
    expect(report.expenses.find((item) => item.id === expense.id)).toMatchObject({ paidAt: null, amountMinor: 23450 });
    expect(report.unpaidMinor).toBeGreaterThanOrEqual(23450);
    expect(report.expensesMinor).toBe(23450);
  });

  it("corrige TRANSFER sin caja actual, sin movimiento de ingreso y sin duplicar gasto histórico", async () => {
    const { storage, api, expense, paid, session, movements } = await setup("TRANSFER");
    const before = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
    expect(before.data.cashSession).toBeNull();
    const corrected = await api.correctFinanceExpenseClosedCashPayment(correctionInput(expense.id, paid.revision!, "transfer-closed"));
    const after = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
    expect(after.movements).toEqual(movements);
    expect(after.historicalSessions.find((item: { id: string }) => item.id === session.id))
      .toEqual(before.historicalSessions.find((item: { id: string }) => item.id === session.id));
    expect(after.financeExpenseClosedPaymentCorrections[0].affectsCash).toBe(false);
    expect(corrected.closedCashPaymentCorrection).toBeNull();
    const report = await createDemoApi(storage).getFinanceReport({ from: expense.incurredOn, to: expense.incurredOn });
    expect(report.expensesMinor).toBe(expense.amountMinor);
    expect(report.unpaidMinor).toBeGreaterThanOrEqual(expense.amountMinor);
  });

  it("mantiene intacta una caja nueva abierta y bloquea reversión genérica del movimiento cerrado", async () => {
    const { storage, expense, paid, session } = await setup("CASH");
    const newCash = await createDemoApi(storage).openCashSession({ openingAmountMinor: 5_000 });
    const api = createDemoApi(storage);
    const before = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
    const recordMovementId = before.financeExpenseMovements[expense.id];
    await expect(api.correctFinanceExpenseClosedCashPayment(correctionInput(expense.id, paid.revision!, "cash-new-session")))
      .resolves.toMatchObject({ paidAt: null });
    const after = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
    expect(after.data.cashSession).toEqual(before.data.cashSession);
    expect(after.data.cashSession.id).toBe(newCash.id);
    expect(after.movements).toEqual(before.movements);
    await expect(createDemoApi(storage).reverseCashMovement({ movementId: recordMovementId, reason: "No debe revertir el histórico", authorizerPin: "1234" }))
      .rejects.toThrow(/corrección de pago de Finanzas con caja cerrada/i);
    expect(after.financeExpenseClosedPaymentCorrections[0].cashSessionId).toBe(session.id);
  });

  it("replaya recibo antes de evaluar el pago posterior y luego permite pagar de nuevo", async () => {
    const { storage, api, expense, paid, paymentInput } = await setup();
    const input = correctionInput(expense.id, paid.revision!, "closed-replay");
    const first = await api.correctFinanceExpenseClosedCashPayment(input);
    await createDemoApi(storage).openCashSession({ openingAmountMinor: 5_000 });
    const repaid = await createDemoApi(storage).payFinanceExpense({
      expenseId: expense.id, paymentMethodCode: "TRANSFER", fromCash: true,
      expectedRevision: first.revision!, idempotencyKey: "real-payment-after-fix",
    });
    await expect(createDemoApi(storage).correctFinanceExpenseClosedCashPayment(input)).resolves.toEqual(first);
    expect(repaid.paidAt).toBeTruthy();
    expect(JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!).financeExpenseClosedPaymentCorrections).toHaveLength(1);
    const replayApi = createDemoApi(storage);
    const beforeOldPayReplay = storage.getItem(DEMO_STORAGE_KEY);
    const activeAfterNewPay = JSON.parse(beforeOldPayReplay!).financeExpenses.find((item: { id: string }) => item.id === expense.id);
    await expect(replayApi.payFinanceExpense(paymentInput)).resolves.toEqual(paid);
    expect(storage.getItem(DEMO_STORAGE_KEY)).toBe(beforeOldPayReplay);
    expect(JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!).financeExpenses.find((item: { id: string }) => item.id === expense.id)).toEqual(activeAfterNewPay);
  });

  it("asocia una devolución real al movimiento nuevo, nunca al pago corregido", async () => {
    const { storage, api, expense, paid } = await setup("CASH");
    const corrected = await api.correctFinanceExpenseClosedCashPayment(correctionInput(expense.id, paid.revision!, "closed-before-return"));
    await createDemoApi(storage).openCashSession({ openingAmountMinor: 40_000 });
    const repaid = await createDemoApi(storage).payFinanceExpense({
      expenseId: expense.id, paymentMethodCode: "CASH", fromCash: true,
      expectedRevision: corrected.revision!, idempotencyKey: "new-real-payment",
    });
    const afterPay = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
    const newMovementId = afterPay.financeExpenseMovements[expense.id];
    const oldMovementId = afterPay.financeExpenseClosedPaymentCorrections[0].originalMovementId;
    expect(newMovementId).not.toBe(oldMovementId);
    await createDemoApi(storage).receiveFinanceExpenseReturn({
      expenseId: expense.id, expectedRevision: repaid.revision!, destination: "EXTERNAL",
      paymentMethodCode: "TRANSFER", reason: "Devolución real del pago posterior", idempotencyKey: "actual-return",
    });
    const returned = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
    expect(returned.financeExpenseClosedPaymentCorrections[0].originalMovementId).toBe(oldMovementId);
    expect(returned.financeExpenseReturns[0].originalMovementId).toBe(newMovementId);
  });

  it("exige confirmación explícita y pago completo General; no cambia estado en rechazos", async () => {
    const { storage, api, expense, paid } = await setup();
    const snapshot = storage.getItem(DEMO_STORAGE_KEY);
    await expect(api.correctFinanceExpenseClosedCashPayment({ ...correctionInput(expense.id, paid.revision!), confirmedUnpaid: false }))
      .rejects.toThrow(/confirm/i);
    expect(storage.getItem(DEMO_STORAGE_KEY)).toBe(snapshot);
    await expect(api.correctFinanceExpenseClosedCashPayment({ ...correctionInput(expense.id, paid.revision!), expectedRevision: 0 }))
      .rejects.toThrow(/cambió/i);
    expect(storage.getItem(DEMO_STORAGE_KEY)).toBe(snapshot);
  });

  it("valida PIN, permiso de finanzas, autorizador activo y clase de gasto sin mutar", async () => {
    const { storage, api, expense, paid } = await setup();
    const base = storage.getItem(DEMO_STORAGE_KEY)!;
    await expect(api.correctFinanceExpenseClosedCashPayment({ ...correctionInput(expense.id, paid.revision!), authorizerPin: "0000" }))
      .rejects.toThrow(/PIN/i);
    expect(storage.getItem(DEMO_STORAGE_KEY)).toBe(base);

    const restricted = JSON.parse(base);
    restricted.data.currentUser.permissions = ["finance.manage"];
    restricted.data.users.forEach((user: { permissions: string[] }) => { user.permissions = ["finance.manage"]; });
    storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(restricted));
    const deniedApi = createDemoApi(storage);
    const deniedSnapshot = storage.getItem(DEMO_STORAGE_KEY);
    await expect(deniedApi.correctFinanceExpenseClosedCashPayment(correctionInput(expense.id, paid.revision!, "no-cash-perm")))
      .rejects.toThrow(/no tiene permiso para autorizar egresos/i);
    expect(storage.getItem(DEMO_STORAGE_KEY)).toBe(deniedSnapshot);

    restricted.data.currentUser.permissions = ["*"];
    restricted.data.users[0].permissions = ["*"];
    restricted.financeExpenses.find((item: { id: string }) => item.id === expense.id).kind = "FIXED";
    storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(restricted));
    const wrongKindApi = createDemoApi(storage);
    const wrongKindSnapshot = storage.getItem(DEMO_STORAGE_KEY);
    await expect(wrongKindApi.correctFinanceExpenseClosedCashPayment(correctionInput(expense.id, paid.revision!, "wrong-kind")))
      .rejects.toThrow(/Generales/i);
    expect(storage.getItem(DEMO_STORAGE_KEY)).toBe(wrongKindSnapshot);
  });
});
