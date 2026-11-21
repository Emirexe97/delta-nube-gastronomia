import { test, expect } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { launchConfiguredPos } from "./pos-fixture";

test("el cierre conserva el resultado y las correcciones mantienen caja y vigencias", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gastronomy-finance-controls-"));
  const app = await launchConfiguredPos({
    args: ["apps/desktop-shell", "--user-data-dir=" + dir],
    cwd: process.cwd(),
  });
  try {
    const page = await app.firstWindow();
    const observed = await page.evaluate(async () => {
      const api = window.gastronomy,
        auth = { authorizerPin: "748259" };
      const cs = await api.openCashSession({ openingAmountMinor: 1000000 });
      const date = cs.businessDate;
      const [year, month] = date.slice(0, 7).split("-").map(Number);
      const priorEnd = new Date(Date.UTC(year!, month! - 1, 0))
        .toISOString()
        .slice(0, 10);
      const priorMonth = priorEnd.slice(0, 7);
      const nextMonth = new Date(Date.UTC(year!, month!, 1))
        .toISOString()
        .slice(0, 7);
      const expense = await api.createFinanceExpense({
        ...auth,
        kind: "GENERAL",
        title: "Service del mes anterior",
        category: "Service",
        amountMinor: 8000000,
        incurredOn: priorEnd,
        dueOn: date,
      });
      const before = await api.getFinanceReport({ from: date, to: date });
      const prev = await api.getFinanceReport({
        from: priorMonth + "-01",
        to: priorEnd,
      });
      const closed = await api.postFinanceEntry({
        ...auth,
        idempotencyKey: crypto.randomUUID(),
        kind: "month_close",
        month: priorMonth,
        date,
        reason: "Cierre para administración",
      });
      const adjustment = await api.postFinanceEntry({
        ...auth,
        idempotencyKey: crypto.randomUUID(),
        kind: "adjustment",
        targetRef: { type: "expense", id: expense.id },
        amountMinor: -30000,
        date,
        reason: "Diferencia del comprobante de service",
      });
      const historicBooks = await api.getFinanceBooks({
        from: priorMonth + "-01",
        to: priorEnd,
      });
      const current = await api.createFinanceRecurring({
        ...auth,
        title: "Alquiler pactado",
        category: "Alquiler",
        kind: "FIXED",
        amountMinor: 1000000,
        startMonth: date.slice(0, 7),
        dayOfMonth: 20,
      });
      await api.getFinanceReport({
        from: nextMonth + "-01",
        to: nextMonth + "-28",
      });
      await api.postFinanceEntry({
        ...auth,
        idempotencyKey: crypto.randomUUID(),
        kind: "recurring_rate",
        recurringId: current.id,
        expectedAmountMinor: 1000000,
        amountMinor: 1250000,
        startMonth: nextMonth,
        date,
        reason: "Aumento pactado",
      });
      const future = await api.getFinanceReport({
        from: nextMonth + "-01",
        to: nextMonth + "-28",
      });
      await api.registerCashMovement({
        ...auth,
        type: "EXPENSE",
        amountMinor: 250000,
        reason: "Reparación de heladera",
        paymentMethodCode: "CASH",
      });
      const cashExpense = (
        await api.getFinanceReport({ from: date, to: date })
      ).expenses.find((e) => e.title === "Reparación de heladera")!;
      await api.postFinanceEntry({
        ...auth,
        kind: "cash_category",
        date,
        idempotencyKey: crypto.randomUUID(),
        reason: "Clasificar reparación",
        movementId: cashExpense.id.slice(5),
        expectedCategory: cashExpense.category,
        category: "Mantenimiento",
      });
      const after = await api.getFinanceReport({ from: date, to: date });
      const books = await api.getFinanceBooks({
        from: priorMonth + "-01",
        to: date,
      });
      return {
        priorMonth,
        inAgenda: before.dueAgenda.some((e) => e.id === expense.id),
        historical: prev.estimatedOperatingProfitMinor,
        adjustmentInOriginalMonth:
          historicBooks.monthlyClosures[0]?.adjustmentIds.includes(
            adjustment.id,
          ) &&
          historicBooks.adjustments.some(
            (a) => a.id === adjustment.id && a.amountMinor === -30000,
          ),
        adjustmentInCurrentResult: after.managementAdjustmentMinor,
        frozen: books.monthlyClosures.find((c) => c.id === closed.id)
          ?.pnlSnapshot.netMinor,
        future: future.expenses
          .filter((e) => e.title === "Alquiler pactado")
          .map((e) => e.amountMinor),
        cash: after.expenses
          .filter((e) => e.id === cashExpense.id)
          .map((e) => [e.category, e.amountMinor]),
        drawer: (await api.bootstrap()).cashSession?.expectedAmountMinor,
      };
    });
    const { priorMonth, ...controls } = observed;
    expect(controls).toEqual({
      inAgenda: true,
      historical: -8000000,
      adjustmentInOriginalMonth: true,
      adjustmentInCurrentResult: -30000,
      frozen: -8000000,
      future: [1250000],
      cash: [["Mantenimiento", 250000]],
      drawer: 750000,
    });
    await page.reload();
    await page.getByRole("link", { name: "Finanzas", exact: true }).click();
    await page.getByLabel("Mes", { exact: true }).fill(priorMonth);
    await page
      .getByRole("button", { name: "Resultados y costos", exact: true })
      .click();
    await page.getByRole("button", { name: "Ver cierre", exact: true }).click();
    const csvPath = join(dir, "cierre.csv");
    await app.evaluate(({ session }, downloadPath) => {
      session.defaultSession.once("will-download", (_event, item) =>
        item.setSavePath(downloadPath),
      );
    }, csvPath);
    await page.getByRole("button", { name: "Exportar cierre (CSV)" }).click();
    await expect
      .poll(async () => {
        try {
          return await readFile(csvPath, "utf8");
        } catch {
          return "";
        }
      })
      .toContain("Diferencia del comprobante de service");
    expect(await readFile(csvPath, "utf8")).toContain("Resultado al cierre");
  } finally {
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().forEach((w) => w.destroy()),
    );
    await app.close();
    if (
      dirname(resolve(dir)) === resolve(tmpdir()) &&
      basename(dir).startsWith("gastronomy-finance-controls-")
    )
      await rm(dir, { recursive: true, force: true, maxRetries: 3 });
  }
});
