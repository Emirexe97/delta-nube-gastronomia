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

const setup = async () => {
  const storage = new MemoryStorage();
  const api = createDemoApi(storage);
  const date = (await api.bootstrap()).cashSession!.businessDate;
  const expense = await api.createFinanceExpense({
    title: "Pago manual",
    category: "Pruebas",
    kind: "GENERAL",
    amountMinor: 12345,
    incurredOn: date,
    dueOn: date,
    idempotencyKey: "expense-create",
  });
  return { storage, api, date, expense };
};
const revision = (expense: { revision?: number }) => expense.revision ?? 0;

describe("desmarcar pagos de gastos en demo", () => {
  it("no ofrece deshacer pago a un egreso de caja mostrado en el informe", async () => {
    const {api,date}=await setup();
    await api.registerCashMovement({type:"EXPENSE",amountMinor:500,paymentMethodCode:"CASH",reason:"Egreso manual no financiero"});
    const report=await api.getFinanceReport({from:date,to:date});
    const synthetic=report.expenses.find(e=>e.id.startsWith("cash-"))!;
    expect(synthetic).toBeDefined();
    expect(synthetic.canUnmarkPayment).toBe(false);
  });
  it("rechaza la misma clave en otra operación y conserva snapshots completos del pago", async () => {
    const { storage, api, expense } = await setup();
    const paid = await api.payFinanceExpense({
      expenseId: expense.id,
      paymentMethodCode: "TRANSFER",
      fromCash: false,
      expectedRevision: 0,
      idempotencyKey: "shared-key",
    });
    const beforeAttempt = storage.getItem(DEMO_STORAGE_KEY);
    await expect(
      api.unmarkFinanceExpensePayment({
        expenseId: expense.id,
        expectedRevision: paid.revision!,
        reason: "No reutilizar clave",
        idempotencyKey: "shared-key",
      }),
    ).rejects.toThrow(/clave.*diferentes/i);
    expect(storage.getItem(DEMO_STORAGE_KEY)).toBe(beforeAttempt);
    const state = JSON.parse(beforeAttempt!);
    const audit = state.audit.find(
      (a: { action: string }) => a.action === "FINANCE_EXPENSE_PAID",
    );
    expect(JSON.parse(audit.beforeJson)).toMatchObject({
      id: expense.id,
      paidAt: null,
      amountMinor: 12345,
      revision: 0,
    });
    expect(JSON.parse(audit.afterJson)).toMatchObject({
      id: expense.id,
      paidAt: paid.paidAt,
      amountMinor: 12345,
      methodCode: "TRANSFER",
      fromCash: false,
    });
    const undone = await api.unmarkFinanceExpensePayment({expenseId:expense.id,expectedRevision:paid.revision!,reason:"Marca equivocada",idempotencyKey:"new-undo"});
    const undoAudit = (await api.getAuditLog({search:expense.id,limit:20})).find(a=>a.action==="FINANCE_EXPENSE_PAYMENT_UNMARKED")!;
    expect(undoAudit).toMatchObject({reason:"Marca equivocada",permissionUsed:"finance.manage"});
    expect(JSON.parse(undoAudit.beforeJson!)).toEqual(paid);
    expect(JSON.parse(undoAudit.afterJson!)).toEqual(undone);
  });
  it("reproduce recibo de pago historico sin volver a pagar tras desmarcar", async () => {
    const { storage, api, expense } = await setup();
    const paid = await api.payFinanceExpense({
      expenseId: expense.id,
      paymentMethodCode: "TRANSFER",
      fromCash: false,
      expectedRevision: 0,
      idempotencyKey: "pay-once",
    });
    const undone = await api.unmarkFinanceExpensePayment({
      expenseId: expense.id,
      expectedRevision: revision(paid),
      reason: "Carga equivocada",
      idempotencyKey: "undo-once",
    });
    expect(undone).toMatchObject({
      paidAt: null,
      paymentMethodCode: null,
      revision: 2,
    });
    const recreated = createDemoApi(storage);
    const replay = await recreated.payFinanceExpense({
      expenseId: expense.id,
      paymentMethodCode: "TRANSFER",
      fromCash: false,
      expectedRevision: 0,
      idempotencyKey: "pay-once",
    });
    expect(replay).toEqual(paid);
    const afterReplay = storage.getItem(DEMO_STORAGE_KEY);
    expect(
      JSON.parse(afterReplay!).financeExpenses.find(
        (item: { id: string }) => item.id === expense.id,
      ),
    ).toMatchObject({ paidAt: null, revision: 2 });
    expect(
      (
        await recreated.getFinanceReport({
          from: expense.incurredOn,
          to: expense.incurredOn,
        })
      ).expenses[0],
    ).toMatchObject({ paidAt: null, revision: 2, canUnmarkPayment: false });
    expect(JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!)).toBeTruthy();
  });

  it("exige revisión actual después del primer desmarcado y permite luego un nuevo pago", async () => {
    const { api, expense } = await setup();
    const paid = await api.payFinanceExpense({
      expenseId: expense.id,
      paymentMethodCode: "CASH",
      fromCash: false,
    });
    const undone = await api.unmarkFinanceExpensePayment({
      expenseId: expense.id,
      expectedRevision: revision(paid),
      reason: "Error de carga",
      idempotencyKey: "undo",
    });
    await expect(
      api.payFinanceExpense({
        expenseId: expense.id,
        paymentMethodCode: "CASH",
        fromCash: false,
      }),
    ).rejects.toThrow(/cambió/i);
    await expect(
      api.payFinanceExpense({
        expenseId: expense.id,
        paymentMethodCode: "CASH",
        fromCash: false,
        expectedRevision: 0,
      }),
    ).rejects.toThrow(/cambió/i);
    const repaid = await api.payFinanceExpense({
      expenseId: expense.id,
      paymentMethodCode: "CASH",
      fromCash: false,
      expectedRevision: revision(undone),
      idempotencyKey: "repay",
    });
    await expect(
      api.unmarkFinanceExpensePayment({
        expenseId: expense.id,
        expectedRevision: revision(undone),
        reason: "repetir",
        idempotencyKey: "undo-again",
      }),
    ).rejects.toThrow(/cambió/i);
    expect(repaid).toMatchObject({
      paidAt: expect.any(String),
      revision: revision(undone) + 1,
    });
  });

  it("valida motivo, revisión, permisos e inelegibilidad sin mutar estado", async () => {
    const { storage, api, expense } = await setup();
    const paid = await api.payFinanceExpense({
      expenseId: expense.id,
      paymentMethodCode: "CASH",
      fromCash: false,
    });
    const exact = storage.getItem(DEMO_STORAGE_KEY);
    await expect(
      api.unmarkFinanceExpensePayment({
        expenseId: expense.id,
        expectedRevision: 99,
        reason: "motivo valido",
        idempotencyKey: "stale",
      }),
    ).rejects.toThrow(/cambió/i);
    expect(storage.getItem(DEMO_STORAGE_KEY)).toBe(exact);
    await expect(
      api.unmarkFinanceExpensePayment({
        expenseId: expense.id,
        expectedRevision: revision(paid),
        reason: " ",
        idempotencyKey: "empty",
      }),
    ).rejects.toThrow(/motivo válido/i);
    expect(storage.getItem(DEMO_STORAGE_KEY)).toBe(exact);
  });

  it("no permite desmarcar pagos de caja vinculados, aunque el medio no afecte efectivo", async () => {
    for (const paymentMethodCode of ["CASH", "TRANSFER"] as const) {
      const { api, expense } = await setup();
      const paid = await api.payFinanceExpense({
        expenseId: expense.id,
        paymentMethodCode,
        fromCash: true,
      });
      await expect(
        api.unmarkFinanceExpensePayment({
          expenseId: expense.id,
          expectedRevision: revision(paid),
          reason: "Deshacer",
          idempotencyKey: `undo-${paymentMethodCode}`,
        }),
      ).rejects.toThrow(/movimientos vinculados/i);
    }
  });

  it("aplica permiso finance.manage antes de replay y excluye gastos recurrentes", async () => {
    const { storage, api, expense } = await setup();
    const paid = await api.payFinanceExpense({
      expenseId: expense.id,
      paymentMethodCode: "TRANSFER",
      fromCash: false,
    });
    const undone = await api.unmarkFinanceExpensePayment({
      expenseId: expense.id,
      expectedRevision: revision(paid),
      reason: "Prueba",
      idempotencyKey: "undo-permission",
    });
    const saved = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
    saved.data.currentUser.permissions = [];
    storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(saved));
    const withoutPermission = createDemoApi(storage);
    await expect(
      withoutPermission.unmarkFinanceExpensePayment({
        expenseId: expense.id,
        expectedRevision: revision(paid),
        reason: "Prueba",
        idempotencyKey: "undo-permission",
      }),
    ).rejects.toThrow(/permiso/i);
    await expect(
      withoutPermission.payFinanceExpense({
        expenseId: expense.id,
        paymentMethodCode: "TRANSFER",
        fromCash: false,
        idempotencyKey: "pay-denied",
      }),
    ).rejects.toThrow(/permiso/i);
    expect(undone.paidAt).toBeNull();

    const recurring = await api.createFinanceRecurring({
      title: "Fijo",
      category: "Pruebas",
      kind: "FIXED",
      amountMinor: 500,
      dayOfMonth: 1,
      startMonth: "2025-01",
    });
    const recurringExpense = (
      await api.getFinanceReport({ from: "2025-01-01", to: "2025-01-31" })
    ).expenses.find((item) => item.recurringId === recurring.id)!;
    const recurringPaid = await api.payFinanceExpense({
      expenseId: recurringExpense.id,
      paymentMethodCode: "TRANSFER",
      fromCash: false,
    });
    await expect(
      api.unmarkFinanceExpensePayment({
        expenseId: recurringExpense.id,
        expectedRevision: revision(recurringPaid),
        reason: "No aplica",
        idempotencyKey: "undo-recurring",
      }),
    ).rejects.toThrow(/desmarcar pagos manuales externos/i);
  });

  it("rechaza claves de pago reutilizadas con payload distinto y replay undo no cambia el estado", async () => {
    const { storage, api, expense } = await setup();
    const paid = await api.payFinanceExpense({
      expenseId: expense.id,
      paymentMethodCode: "TRANSFER",
      fromCash: false,
      expectedRevision: 0,
      idempotencyKey: "pay-key",
    });
    const undone = await api.unmarkFinanceExpensePayment({
      expenseId: expense.id,
      expectedRevision: revision(paid),
      reason: "Error",
      idempotencyKey: "undo-key",
    });
    const snapshot = storage.getItem(DEMO_STORAGE_KEY);
    await expect(
      api.payFinanceExpense({
        expenseId: expense.id,
        paymentMethodCode: "CASH",
        fromCash: false,
        expectedRevision: 0,
        idempotencyKey: "pay-key",
      }),
    ).rejects.toThrow(/idempotencia/i);
    expect(storage.getItem(DEMO_STORAGE_KEY)).toBe(snapshot);
    expect(
      await api.unmarkFinanceExpensePayment({
        expenseId: expense.id,
        expectedRevision: revision(paid),
        reason: "Error",
        idempotencyKey: "undo-key",
      }),
    ).toEqual(undone);
    expect(storage.getItem(DEMO_STORAGE_KEY)).toBe(snapshot);
  });
});
