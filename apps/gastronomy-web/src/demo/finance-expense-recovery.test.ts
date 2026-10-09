import { describe, expect, it } from "vitest";
import type { CashSessionReportDto } from "@gastronomy/contracts";

// Demo normalization refreshes order timestamps on save, without changing money.
const cashInvariant = (report: CashSessionReportDto) => ({
  ...report,
  orders: report.orders.map(({ updatedAt, ...order }) => order),
});
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

const setup = async () => {
  const storage = new MemoryStorage();
  const api = createDemoApi(storage);
  const date = (await api.bootstrap()).cashSession!.businessDate;
  const expense = await api.createFinanceExpense({
    title: "Gasto de prueba",
    category: "Pruebas",
    kind: "GENERAL",
    amountMinor: 123_450,
    incurredOn: date,
    dueOn: date,
    note: "inicial",
    idempotencyKey: "seed-expense",
  });
  return { storage, api, date, expense };
};

describe("recuperación de gastos demo", () => {
  it("corrige gasto manual pendiente, deja auditoría before/after y no mueve caja/stock", async () => {
    const { api, date, expense } = await setup();
    const before = await api.getCashSessionReport({
      cashSessionId: (await api.bootstrap()).cashSession!.id,
    });
    const stock = (await api.bootstrap()).products.map((p) => [
      p.id,
      p.stockMinor,
    ]);
    const corrected = await api.correctFinanceExpense({
      expenseId: expense.id,
      expectedRevision: 0,
      reason: "Importe mal cargado",
      title: "Gasto corregido",
      category: "Servicios",
      kind: "GENERAL",
      amountMinor: 234_560,
      incurredOn: date,
      dueOn: date,
      employeeId: null,
      note: "revisado",
      idempotencyKey: "correct-once",
    });
    expect(corrected).toMatchObject({
      title: "Gasto corregido",
      amountMinor: 234_560,
      revision: 1,
    });
    const report = await api.getFinanceReport({ from: date, to: date });
    expect(report.expensesMinor).toBe(234_560);
    expect(report.expenses).toContainEqual(corrected);
    const audit = await api.getAuditLog({ search: expense.id, limit: 10 });
    expect(audit[0]).toMatchObject({
      entityType: "FINANCE_EXPENSE",
      entityId: expense.id,
      action: "FINANCE_EXPENSE_CORRECTED",
      reason: "Importe mal cargado",
      permissionUsed: "finance.manage",
    });
    expect(JSON.parse(audit[0]!.beforeJson!)).toMatchObject({
      amountMinor: 123_450,
      title: "Gasto de prueba",
    });
    expect(JSON.parse(audit[0]!.afterJson!)).toMatchObject({
      amountMinor: 234_560,
      title: "Gasto corregido",
    });
    expect(
      cashInvariant(
        await api.getCashSessionReport({ cashSessionId: before.session.id }),
      ),
    ).toEqual(cashInvariant(before));
    expect(
      (await api.bootstrap()).products.map((p) => [p.id, p.stockMinor]),
    ).toEqual(stock);
  });

  it("anula conservando DTO y excludes anulados de totales", async () => {
    const { api, date, expense } = await setup();
    const cancelled = await api.cancelFinanceExpense({
      expenseId: expense.id,
      expectedRevision: 0,
      reason: "Duplicado",
      idempotencyKey: "cancel-once",
    });
    expect(cancelled).toMatchObject({
      id: expense.id,
      amountMinor: expense.amountMinor,
      revision: 1,
      cancellationReason: "Duplicado",
    });
    expect(cancelled.cancelledAt).toBeTruthy();
    const report = await api.getFinanceReport({ from: date, to: date });
    expect(report.expenses).toContainEqual(cancelled);
    expect(report.expensesMinor).toBe(0);
    expect(report.payrollMinor).toBe(0);
    expect(report.fixedMinor).toBe(0);
    expect(report.unpaidMinor).toBe(0);
    expect(report.monthly.every((month) => month.expensesMinor === 0)).toBe(
      true,
    );
    expect(
      (await api.getAuditLog({ search: expense.id, limit: 10 }))[0],
    ).toMatchObject({
      action: "FINANCE_EXPENSE_CANCELLED",
      reason: "Duplicado",
    });
  });

  it("replay idempotente devuelve resultado original y clave repetida con datos distintos no escribe", async () => {
    const { api, expense, date } = await setup();
    const input = {
      expenseId: expense.id,
      expectedRevision: 0,
      reason: "Ajuste",
      title: "Original corregido",
      category: "Pruebas",
      kind: "GENERAL" as const,
      amountMinor: 200_000,
      incurredOn: date,
      dueOn: date,
      note: null,
      idempotencyKey: "stable-key",
    };
    const first = await api.correctFinanceExpense(input);
    const replay = await api.correctFinanceExpense(input);
    expect(replay).toEqual(first);
    await expect(
      api.correctFinanceExpense({ ...input, title: "Alterado" }),
    ).rejects.toThrow(/idempotencia/i);
    expect(
      (await api.getFinanceReport({ from: date, to: date })).expensesMinor,
    ).toBe(200_000);
    expect(
      (await api.getAuditLog({ search: expense.id, limit: 10 })).filter(
        (row) => row.action === "FINANCE_EXPENSE_CORRECTED",
      ),
    ).toHaveLength(1);
  });

  it("rechaza revisión obsoleta y no permite pagar un gasto anulado", async () => {
    const { api, expense, date } = await setup();
    await api.correctFinanceExpense({
      expenseId: expense.id,
      expectedRevision: 0,
      reason: "Primera corrección",
      title: "Actual",
      category: "Pruebas",
      kind: "GENERAL",
      amountMinor: 200_000,
      incurredOn: date,
      dueOn: date,
      idempotencyKey: "rev-one",
    });
    await expect(
      api.cancelFinanceExpense({
        expenseId: expense.id,
        expectedRevision: 0,
        reason: "Vieja revisión",
        idempotencyKey: "stale",
      }),
    ).rejects.toThrow(/cambió/i);
    await api.cancelFinanceExpense({
      expenseId: expense.id,
      expectedRevision: 1,
      reason: "Cancelado",
      idempotencyKey: "cancel",
    });
    const before = await api.getCashSessionReport({
      cashSessionId: (await api.bootstrap()).cashSession!.id,
    });
    await expect(
      api.payFinanceExpense({
        expenseId: expense.id,
        paymentMethodCode: "CASH",
        fromCash: true,
      }),
    ).rejects.toThrow(/anulado/i);
    expect(
      await api.getCashSessionReport({ cashSessionId: before.session.id }),
    ).toEqual(before);
  });

  it("exige finance.manage o permiso de administrador", async () => {
    const { storage, expense, date } = await setup();
    const saved = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
    saved.data.currentUser.permissions = ["finance.view"];
    storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(saved));
    const api = createDemoApi(storage);
    await expect(
      api.correctFinanceExpense({
        expenseId: expense.id,
        expectedRevision: 0,
        reason: "No autorizado",
        title: "x",
        category: "x",
        kind: "GENERAL",
        amountMinor: 1,
        incurredOn: date,
        dueOn: date,
        idempotencyKey: "forbidden",
      }),
    ).rejects.toThrow(/permiso/i);
    await expect(
      api.cancelFinanceExpense({
        expenseId: expense.id,
        expectedRevision: 0,
        reason: "No autorizado",
        idempotencyKey: "forbidden-cancel",
      }),
    ).rejects.toThrow(/permiso/i);
  });

  it("rechaza fecha imposible y límites antes de mutar el gasto", async () => {
    const { api, date, expense } = await setup();
    await expect(
      api.correctFinanceExpense({
        expenseId: expense.id,
        expectedRevision: 0,
        reason: "Fecha inválida",
        title: "Cambio",
        category: "Pruebas",
        kind: "GENERAL",
        amountMinor: 123_456,
        incurredOn: "2026-02-30",
        dueOn: date,
        idempotencyKey: "bad-date",
      }),
    ).rejects.toThrow(/datos válidos/i);
    await expect(
      api.correctFinanceExpense({
        expenseId: expense.id,
        expectedRevision: 0,
        reason: "x".repeat(501),
        title: "Cambio",
        category: "Pruebas",
        kind: "GENERAL",
        amountMinor: 123_456,
        incurredOn: date,
        dueOn: date,
        idempotencyKey: "bad-reason",
      }),
    ).rejects.toThrow(/datos válidos/i);
    expect(
      (await api.getFinanceReport({ from: date, to: date })).expenses[0],
    ).toMatchObject({
      title: expense.title,
      amountMinor: expense.amountMinor,
      revision: 0,
    });
  });
});
