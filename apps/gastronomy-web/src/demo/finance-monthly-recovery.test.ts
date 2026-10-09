import { afterEach, describe, expect, it, vi } from "vitest";
import { businessDateFromOpening } from "@gastronomy/domain";
import { createDemoApi, DEMO_STORAGE_KEY, type DemoStorage } from "./demo-api";

class MemoryStorage implements DemoStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

async function setup(kind: "FIXED" | "PAYROLL" = "FIXED") {
  const storage = new MemoryStorage();
  const api = createDemoApi(storage);
  const bootstrap = await api.bootstrap();
  const incurredOn = businessDateFromOpening(new Date().toISOString());
  const rule = await api.createFinanceRecurring({
    title: "Alquiler del mes",
    category: "Vivienda",
    kind,
    amountMinor: 55000,
    dayOfMonth: Number(incurredOn.slice(8, 10)),
    startMonth: incurredOn.slice(0, 7),
    ...(kind === "PAYROLL" ? { employeeId: bootstrap.users[0]!.id } : {}),
    idempotencyKey: "monthly-rule",
  });
  await api.getFinanceReport({ from: incurredOn, to: incurredOn });
  const reportApi = createDemoApi(storage);
  const report = await reportApi.getFinanceReport({ from: incurredOn, to: incurredOn });
  const expense = report.expenses.find((item) => item.recurringId === rule.id)!;
  return { storage, api: reportApi, rule, expense, incurredOn };
}

const changeInput = (expenseId: string, expectedRevision: number, suffix = "1") => ({
  expenseId,
  expectedRevision,
  reason: "Importe del período cargado incorrectamente",
  title: "Alquiler corregido",
  category: "Operación",
  amountMinor: 57000,
  dueOn: "2026-10-20",
  note: "Solo cambia esta ocurrencia",
  idempotencyKey: `monthly-correct-${suffix}`,
});

const businessSnapshot = (expense: any) => ({
  id: expense.id,
  title: expense.title,
  category: expense.category,
  kind: expense.kind,
  amountMinor: expense.amountMinor,
  incurredOn: expense.incurredOn,
  dueOn: expense.dueOn,
  recurringId: expense.recurringId,
  employeeId: expense.employeeId,
  employeeName: expense.employeeName,
  note: expense.note,
  paidAt: expense.paidAt,
  cancelledAt: expense.cancelledAt,
  revision: expense.revision,
});

afterEach(() => vi.useRealTimers());

describe("recuperación de ocurrencias mensuales impagas en demo", () => {
  it.each(["FIXED", "PAYROLL"] as const)(
    "corrige una sola ocurrencia %s ya incurrida sin alterar origen ni regla",
    async (kind) => {
      const { storage, api, rule, expense, incurredOn } = await setup(kind);
      const before = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
      const corrected = await api.correctFinanceMonthlyExpense(changeInput(expense.id, expense.revision ?? 0));
      expect(corrected).toMatchObject({
        id: expense.id, recurringId: rule.id, kind, incurredOn,
        title: "Alquiler corregido", category: "Operación", amountMinor: 57000,
        dueOn: "2026-10-20", note: "Solo cambia esta ocurrencia",
        paidAt: null, cancelledAt: null, revision: (expense.revision ?? 0) + 1,
      });
      expect(corrected.employeeId).toBe(expense.employeeId);
      const after = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
      expect(after.financeRecurring.find((item: { id: string }) => item.id === rule.id)).toEqual(
        before.financeRecurring.find((item: { id: string }) => item.id === rule.id),
      );
      expect(after.financeExpenses.filter((item: { recurringId: string }) => item.recurringId === rule.id)).toHaveLength(1);
      expect(after.audit[0]).toMatchObject({ action: "FINANCE_MONTHLY_EXPENSE_CORRECTED", reason: "Importe del período cargado incorrectamente" });
      expect(JSON.parse(after.audit[0].beforeJson)).toMatchObject(businessSnapshot(expense));
      expect(JSON.parse(after.audit[0].afterJson)).toMatchObject(businessSnapshot(corrected));
      const report = await createDemoApi(storage).getFinanceReport({ from: incurredOn, to: incurredOn });
      expect(report.expenses.filter((item) => item.recurringId === rule.id)).toHaveLength(1);
      expect(report.expensesMinor).toBe(57000);
    },
  );

  it("permite corregir una ocurrencia impaga de una regla detenida sin reactivarla ni cambiarla", async () => {
    const { storage, rule, expense, incurredOn } = await setup("FIXED");
    const stopped = await createDemoApi(storage).stopFinanceRecurring({ recurringId: rule.id });
    expect(stopped.active).toBe(false);
    const before = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
    const api = createDemoApi(storage);
    const corrected = await api.correctFinanceMonthlyExpense(changeInput(expense.id, expense.revision ?? 0, "stopped"));
    expect(corrected).toMatchObject({ recurringId: rule.id, incurredOn, paidAt: null, amountMinor: 57000 });
    const after = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
    expect(after.financeRecurring.find((item: { id: string }) => item.id === rule.id)).toEqual(
      before.financeRecurring.find((item: { id: string }) => item.id === rule.id),
    );
    expect(after.financeRecurring.find((item: { id: string }) => item.id === rule.id).active).toBe(false);
    expect(after.financeExpenses.filter((item: { recurringId: string }) => item.recurringId === rule.id)).toHaveLength(1);
  });

  it("preserva vencimiento y nota omitidos; solo limpia la nota con null explícito", async () => {
    const { api, expense } = await setup("FIXED");
    const first = await api.correctFinanceMonthlyExpense({
      ...changeInput(expense.id, expense.revision ?? 0, "note-initial"),
      dueOn: "2026-10-24",
      note: "Nota que debe persistir",
    });
    const { dueOn: _dueOn, note: _note, ...withoutOptionalFields } = changeInput(expense.id, first.revision ?? 0, "note-omitted");
    const second = await api.correctFinanceMonthlyExpense(withoutOptionalFields);
    expect(second.dueOn).toBe("2026-10-24");
    expect(second.note).toBe("Nota que debe persistir");
    const cleared = await api.correctFinanceMonthlyExpense({
      ...withoutOptionalFields,
      expectedRevision: second.revision ?? 0,
      note: null,
      idempotencyKey: "note-explicit-null",
    });
    expect(cleared.note).toBeNull();
    expect(cleared.dueOn).toBe("2026-10-24");
  });

  it("anula como tombstone sin borrar la ocurrencia ni afectar otras ocurrencias o la regla", async () => {
    const { storage, rule, expense, incurredOn } = await setup();
    const api = createDemoApi(storage);
    const before = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
    const cancelled = await api.cancelFinanceMonthlyExpense({
      expenseId: expense.id,
      expectedRevision: expense.revision ?? 0,
      reason: "Ocurrencia duplicada de este mes",
      idempotencyKey: "monthly-cancel-one",
    });
    expect(cancelled).toMatchObject({ recurringId: rule.id, incurredOn, cancelledAt: expect.any(String), cancellationReason: "Ocurrencia duplicada de este mes" });
    const after = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
    expect(after.financeExpenses.find((item: { id: string }) => item.id === expense.id)).toMatchObject({ cancelledAt: expect.any(String) });
    expect(after.financeExpenses.filter((item: { recurringId: string }) => item.recurringId === rule.id)).toHaveLength(1);
    expect(after.financeRecurring.find((item: { id: string }) => item.id === rule.id)).toEqual(
      before.financeRecurring.find((item: { id: string }) => item.id === rule.id),
    );
    expect(after.audit[0].action).toBe("FINANCE_MONTHLY_EXPENSE_CANCELLED");
    const report = await createDemoApi(storage).getFinanceReport({ from: incurredOn, to: incurredOn });
    expect(report.expenses.filter((item) => item.recurringId === rule.id)).toHaveLength(1);
    expect(report.expensesMinor).toBe(0);
  });

  it("rechaza una ocurrencia futura según el día del negocio local", async () => {
    const { storage, expense } = await setup();
    const futureState = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
    const future = new Date(`${expense.incurredOn}T12:00:00.000Z`);
    future.setUTCDate(future.getUTCDate() + 1);
    futureState.financeExpenses.find((item: { id: string }) => item.id === expense.id).incurredOn = future.toISOString().slice(0, 10);
    storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(futureState));
    const api = createDemoApi(storage);
    const before = storage.getItem(DEMO_STORAGE_KEY);
    await expect(api.correctFinanceMonthlyExpense(changeInput(expense.id, expense.revision ?? 0, "future")))
      .rejects.toThrow(/ya incurrida|fecha de gasto/i);
    expect(storage.getItem(DEMO_STORAGE_KEY)).toBe(before);
  });

  it("usa el corte de día hábil de Buenos Aires al cruzar medianoche UTC", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-09T02:30:00.000Z"));
    const { storage, expense } = await setup("FIXED");
    expect(expense.incurredOn).toBe("2026-10-08");
    expect(expense.canRecoverMonthlyExpense).toBe(true);

    const movedForward = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
    movedForward.financeExpenses.find((item: { id: string }) => item.id === expense.id).incurredOn = "2026-10-09";
    storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(movedForward));
    const api = createDemoApi(storage);
    const before = storage.getItem(DEMO_STORAGE_KEY);
    await expect(api.correctFinanceMonthlyExpense(changeInput(expense.id, expense.revision ?? 0, "ba-cutoff")))
      .rejects.toThrow(/ya incurridas/i);
    expect(storage.getItem(DEMO_STORAGE_KEY)).toBe(before);
  });

  it("no permite cambiar recurrencia, pago, cancelación, caja ni revisión; rechazos no mutan", async () => {
    const { storage, api, expense } = await setup();
    const snapshot = storage.getItem(DEMO_STORAGE_KEY);
    await expect(api.correctFinanceMonthlyExpense(changeInput(expense.id, (expense.revision ?? 0) + 1, "stale")))
      .rejects.toThrow(/cambió/i);
    expect(storage.getItem(DEMO_STORAGE_KEY)).toBe(snapshot);

    const altered = JSON.parse(snapshot!);
    const target = altered.financeExpenses.find((item: { id: string }) => item.id === expense.id);
    target.paidAt = "2026-10-08T12:00:00.000Z";
    storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(altered));
    const paidApi = createDemoApi(storage);
    const paidSnapshot = storage.getItem(DEMO_STORAGE_KEY);
    await expect(paidApi.correctFinanceMonthlyExpense(changeInput(expense.id, expense.revision ?? 0, "paid")))
      .rejects.toThrow(/impagas|pagado/i);
    expect(storage.getItem(DEMO_STORAGE_KEY)).toBe(paidSnapshot);

    altered.financeExpenses.find((item: { id: string }) => item.id === expense.id).paidAt = null;
    (altered.financeExpenseMovements ??= {})[expense.id] = "cash-movement-test";
    storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(altered));
    const linkedApi = createDemoApi(storage);
    const linkedSnapshot = storage.getItem(DEMO_STORAGE_KEY);
    await expect(linkedApi.correctFinanceMonthlyExpense(changeInput(expense.id, expense.revision ?? 0, "linked")))
      .rejects.toThrow(/impagas|vinculados|caja/i);
    expect(storage.getItem(DEMO_STORAGE_KEY)).toBe(linkedSnapshot);
  });

  it("exige solo finance.manage y deja pago nuevo exigir revisión tras replayar corrección", async () => {
    const { storage, expense } = await setup();
    const restricted = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
    restricted.data.currentUser.permissions = ["finance.manage"];
    storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(restricted));
    const api = createDemoApi(storage);
    const input = changeInput(expense.id, expense.revision ?? 0, "replay");
    const corrected = await api.correctFinanceMonthlyExpense(input);
    const state = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
    expect(state.financeExpensePaymentRevisionRequired[expense.id]).toBe(true);
    const snapshot = storage.getItem(DEMO_STORAGE_KEY);
    await expect(createDemoApi(storage).payFinanceExpense({ expenseId: expense.id, paymentMethodCode: "TRANSFER", fromCash: false, idempotencyKey: "missing-revision" }))
      .rejects.toThrow(/cambió/i);
    await expect(createDemoApi(storage).payFinanceExpense({ expenseId: expense.id, paymentMethodCode: "TRANSFER", fromCash: false, expectedRevision: (corrected.revision ?? 0) - 1, idempotencyKey: "stale-revision" }))
      .rejects.toThrow(/cambió/i);
    expect(JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!).financeExpenses.find((item: { id: string }) => item.id === expense.id).paidAt).toBeNull();
    const correctedReplayApi = createDemoApi(storage);
    const beforeReplay = storage.getItem(DEMO_STORAGE_KEY);
    await expect(correctedReplayApi.correctFinanceMonthlyExpense(input)).resolves.toEqual(corrected);
    expect(storage.getItem(DEMO_STORAGE_KEY)).toBe(beforeReplay);
    const paid = await createDemoApi(storage).payFinanceExpense({ expenseId: expense.id, paymentMethodCode: "TRANSFER", fromCash: false, expectedRevision: corrected.revision, idempotencyKey: "valid-new-payment" });
    expect(paid.paidAt).toBeTruthy();
    expect(snapshot).toBeTruthy();
  });
});
