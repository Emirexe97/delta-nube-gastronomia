import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const evidenceDir = join(
  process.cwd(),
  "docs/qa/evidence/system-usability-unpaid-expense-recovery-fix-2026-10-08",
);
let app: ElectronApplication;
let page: Page;
let profile = "";
test.use({ actionTimeout: 5000 });

async function launch(tag: string) {
  await mkdir(evidenceDir, { recursive: true });
  profile = await mkdtemp(join(tmpdir(), `gastronomy-us18a-${tag}-`));
  app = await electron.launch({
    args: ["apps/desktop-shell", `--user-data-dir=${profile}`],
    cwd: process.cwd(),
  });
  page = await app.firstWindow();
  await expect(page.getByText("Delta Nube", { exact: true })).toBeVisible({
    timeout: 90_000,
  });
  const userData = await app.evaluate(({ app }) => app.getPath("userData"));
  expect(resolve(userData)).toBe(resolve(profile));
  expect(basename(profile)).toMatch(/^gastronomy-us18a-/);
}
async function cleanup() {
  await app?.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().forEach((w) => w.destroy()),
  );
  await app?.close();
  if (profile) {
    if (
      dirname(resolve(profile)) !== resolve(tmpdir()) ||
      !basename(profile).startsWith("gastronomy-us18a-")
    )
      throw new Error("Unsafe disposable profile cleanup");
    await rm(profile, { recursive: true, force: true });
    profile = "";
  }
}
async function capture(name: string, state: unknown) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => {})),
    );
    await new Promise<void>((r) =>
      requestAnimationFrame(() => requestAnimationFrame(() => r())),
    );
  });
  const png = await app.evaluate(async ({ BrowserWindow }) =>
    (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage())
      .toPNG()
      .toString("base64"),
  );
  await writeFile(join(evidenceDir, `${name}.png`), Buffer.from(png, "base64"));
  await writeFile(
    join(evidenceDir, `${name}.json`),
    JSON.stringify({ state, realElectronSqliteAndIpc: true }, null, 2),
  );
}
async function seed(title: string, amountMinor = 1_234_500) {
  return page.evaluate(
    async ({ title, amountMinor }) => {
      const api = window.gastronomy;
      const opened = await api.openCashSession({
        openingAmountMinor: 10_000_000,
      });
      const date = (await api.bootstrap()).cashSession!.businessDate;
      const expense = await api.createFinanceExpense({
        title,
        category: "US18A prueba",
        kind: "GENERAL",
        amountMinor,
        incurredOn: date,
        dueOn: date,
        note: "nota inicial",
        idempotencyKey: crypto.randomUUID(),
      });
      return {
        date,
        sessionId: opened.id,
        expense,
        products: (await api.bootstrap()).products,
        report: await api.getFinanceReport({ from: date, to: date }),
        cash: await api.getCashSessionReport({ cashSessionId: opened.id }),
      };
    },
    { title, amountMinor },
  );
}
async function openFinance(date: string) {
  await page.getByRole("link", { name: "Finanzas", exact: true }).click();
  await page.getByLabel("Desde", { exact: true }).fill(date);
  await page.getByLabel("Hasta", { exact: true }).fill(date);
}
const expenseArticle = (title: string) =>
  page
    .locator("article")
    .filter({ has: page.getByText(title, { exact: true }) });

test.beforeEach(async () => launch("case"));
test.afterEach(cleanup);

test("permite corregir gasto manual impago con motivo, prefill, auditoría y ledger intacto", async () => {
  test.setTimeout(90_000);
  const fixture = await seed("US18A corregir prueba");
  await openFinance(fixture.date);
  const row = expenseArticle(fixture.expense.title);
  await expect(
    row.getByRole("button", { name: "Corregir", exact: true }),
  ).toBeVisible();
  await row.getByRole("button", { name: "Corregir", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByText("Corregir gasto", { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByLabel("Concepto", { exact: true })).toHaveValue(
    fixture.expense.title,
  );
  await expect(dialog.getByLabel("Importe", { exact: true })).not.toHaveValue(
    "",
  );
  await capture("edit-prefilled", { fixture });
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(expenseArticle(fixture.expense.title)).toBeVisible();
  const unchanged = await page.evaluate(
    async ({ date, sessionId }) => ({
      report: await window.gastronomy.getFinanceReport({
        from: date,
        to: date,
      }),
      cash: await window.gastronomy.getCashSessionReport({
        cashSessionId: sessionId,
      }),
    }),
    { date: fixture.date, sessionId: fixture.sessionId },
  );
  expect(
    unchanged.report.expenses.find((x) => x.id === fixture.expense.id)
      ?.amountMinor,
  ).toBe(1_234_500);
  await expenseArticle(fixture.expense.title)
    .getByRole("button", { name: "Corregir", exact: true })
    .click();
  const form = page.getByRole("dialog");
  await form.getByLabel("Concepto", { exact: true }).fill("US18A corregido");
  await form.getByLabel("Importe", { exact: true }).fill("23456,00");
  const reason = form.getByLabel("Motivo de la corrección", { exact: true });
  await expect(
    form.getByRole("button", { name: "Guardar corrección", exact: true }),
  ).toBeDisabled();
  await reason.fill("Importe transcripto incorrectamente");
  await form
    .getByRole("button", { name: "Guardar corrección", exact: true })
    .click();
  await expect(
    page.getByText("US18A corregido", { exact: true }),
  ).toBeVisible();
  const result = await page.evaluate(
    async ({ date, id, sessionId }) => ({
      report: await window.gastronomy.getFinanceReport({
        from: date,
        to: date,
      }),
      audit: await window.gastronomy.getAuditLog({ limit: 200 }),
      cash: await window.gastronomy.getCashSessionReport({
        cashSessionId: sessionId,
      }),
      bootstrap: await window.gastronomy.bootstrap(),
    }),
    {
      date: fixture.date,
      id: fixture.expense.id,
      sessionId: fixture.sessionId,
    },
  );
  const corrected = result.report.expenses.find(
    (x) => x.id === fixture.expense.id,
  )!;
  expect(corrected.amountMinor).toBe(2_345_600);
  expect(corrected.revision).toBe(1);
  expect(result.report.expensesMinor).toBe(2_345_600);
  expect(
    result.audit.some(
      (x) =>
        x.entityId === fixture.expense.id &&
        /FINANCE_EXPENSE_CORRECTED/.test(x.action),
    ),
  ).toBe(true);
  expect(result.cash).toEqual(fixture.cash);
  expect(result.bootstrap.products).toEqual(fixture.products);
  await capture("corrected-audited", {
    before: fixture.expense,
    after: corrected,
    audit: result.audit.filter((x) => x.entityId === fixture.expense.id),
  });
});

test("anula sin borrar, excluye de total y exportación CSV activa", async () => {
  test.setTimeout(90_000);
  const fixture = await seed("US18A anular prueba");
  const preserved = await page.evaluate(async (date) => {
    const active = await window.gastronomy.createFinanceExpense({
      title: "US18A gasto activo CSV",
      category: "US18A",
      kind: "GENERAL",
      amountMinor: 12_000,
      incurredOn: date,
      dueOn: date,
      idempotencyKey: crypto.randomUUID(),
    });
    const paid = await window.gastronomy.createFinanceExpense({
      title: "US18A gasto pagado CSV",
      category: "US18A",
      kind: "GENERAL",
      amountMinor: 23_000,
      incurredOn: date,
      dueOn: date,
      idempotencyKey: crypto.randomUUID(),
    });
    await window.gastronomy.payFinanceExpense({
      expenseId: paid.id,
      paymentMethodCode: "CASH",
      fromCash: false,
      idempotencyKey: crypto.randomUUID(),
    });
    return { active, paid };
  }, fixture.date);
  await openFinance(fixture.date);
  const row = expenseArticle(fixture.expense.title);
  await row.getByRole("button", { name: "Anular", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Anular gasto", { exact: true })).toBeVisible();
  const reason = dialog.getByLabel("Motivo de anulación", { exact: true });
  await expect(
    dialog.getByRole("button", { name: "Confirmar anulación", exact: true }),
  ).toBeDisabled();
  await reason.fill("Duplicado de carga");
  await capture("cancel-confirmation", { expense: fixture.expense });
  await dialog
    .getByRole("button", { name: "Confirmar anulación", exact: true })
    .click();
  const cancelled = expenseArticle(fixture.expense.title);
  await expect(cancelled.getByText("Anulado", { exact: true })).toBeVisible();
  await expect(
    cancelled.getByRole("button", { name: /Marcar pagado|Corregir|Anular/ }),
  ).toHaveCount(0);
  const result = await page.evaluate(
    async ({ date, id, sessionId }) => ({
      report: await window.gastronomy.getFinanceReport({
        from: date,
        to: date,
      }),
      audit: await window.gastronomy.getAuditLog({ limit: 200 }),
      cash: await window.gastronomy.getCashSessionReport({
        cashSessionId: sessionId,
      }),
    }),
    {
      date: fixture.date,
      id: fixture.expense.id,
      sessionId: fixture.sessionId,
    },
  );
  expect(
    result.report.expenses.find((x) => x.id === fixture.expense.id),
  ).toMatchObject({
    cancelledAt: expect.any(String),
    cancellationReason: "Duplicado de carga",
  });
  expect(result.report.expensesMinor).toBe(35_000);
  expect(result.cash).toEqual(fixture.cash);
  expect(
    result.audit.some(
      (x) =>
        x.entityId === fixture.expense.id &&
        /FINANCE_EXPENSE_CANCELLED/.test(x.action),
    ),
  ).toBe(true);
  const downloadPath = join(profile, "active-expenses.csv");
  await app.evaluate(({ session, app }, savePath) => {
    (app as any).__us18Download = null;
    session.defaultSession.once("will-download", (_event, item) => {
      item.setSavePath(savePath);
      item.once("done", (_e, state) => {
        (app as any).__us18Download = { state, filename: item.getFilename() };
      });
    });
  }, downloadPath);
  await page
    .getByRole("button", { name: "Exportar gastos (CSV)", exact: true })
    .click();
  await expect
    .poll(() => app.evaluate(({ app }) => (app as any).__us18Download?.state))
    .toBe("completed");
  expect(
    await app.evaluate(({ app }) => (app as any).__us18Download.filename),
  ).toBe(`finanzas-${fixture.date}-${fixture.date}.csv`);
  await expect
    .poll(async () => {
      try {
        return (await readFile(downloadPath)).length;
      } catch {
        return 0;
      }
    })
    .toBeGreaterThan(0);
  const csv = await readFile(downloadPath);
  expect(csv.subarray(0, 3).toString("hex")).toBe("efbbbf");
  const body = csv.toString("utf8");
  expect(body).toContain("\r\n");
  expect(
    body
      .split("\r\n")
      .filter(Boolean)
      .every((line) => line.split(";").length === 8),
  ).toBe(true);
  expect(body).not.toContain(fixture.expense.title);
  expect(body).toContain(preserved.active.title);
  expect(body).toContain(preserved.paid.title);
  await rm(downloadPath, { force: true });
  await capture("cancelled-excluded", {
    expense: result.report.expenses.find((x) => x.id === fixture.expense.id),
    reportTotal: result.report.expensesMinor,
    csv: body,
  });
});

test("rechaza pago concurrente al guardar corrección y protege gastos pagados/recurrentes", async () => {
  test.setTimeout(90_000);
  const fixture = await seed("US18A carrera de pago", 100_000);
  const created = await page.evaluate(async (date) => {
    const api = window.gastronomy;
    const paid = await api.createFinanceExpense({
      title: "US18A ya pagado",
      category: "US18A",
      kind: "GENERAL",
      amountMinor: 20_000,
      incurredOn: date,
      dueOn: date,
      idempotencyKey: crypto.randomUUID(),
    });
    const recurring = await api.createFinanceRecurring({
      title: "US18A mensual",
      category: "US18A",
      kind: "FIXED",
      amountMinor: 30_000,
      startMonth: date.slice(0, 7),
      dayOfMonth: Number(date.slice(8)),
      idempotencyKey: crypto.randomUUID(),
    });
    const monthly = await api.getFinanceReport({ from: date, to: date });
    const instance = monthly.expenses.find(
      (x) => x.recurringId === recurring.id,
    );
    return {
      paid: await api.payFinanceExpense({
        expenseId: paid.id,
        paymentMethodCode: "CASH",
        fromCash: false,
        idempotencyKey: crypto.randomUUID(),
      }),
      paidId: paid.id,
      recurringId: recurring.id,
      instanceId: instance?.id,
      recurring,
    };
  }, fixture.date);
  expect(typeof created.instanceId).toBe("string");
  await openFinance(fixture.date);
  await expect(
    expenseArticle(created.paid.title).getByRole("button", {
      name: /Corregir|Anular/,
    }),
  ).toHaveCount(0);
  await expect(
    expenseArticle("US18A mensual").getByRole("button", {
      name: /^(Corregir|Anular)$/,
    }),
  ).toHaveCount(0);
  await expect(expenseArticle("US18A mensual").getByRole("button", { name: "Corregir este mes", exact: true })).toBeVisible();
  await expect(expenseArticle("US18A mensual").getByRole("button", { name: "Anular este mes", exact: true })).toBeVisible();
  const paidRejected = await page.evaluate(
    async ({ id }) => {
      try {
        await window.gastronomy.correctFinanceExpense({
          expenseId: id,
          expectedRevision: 0,
          reason: "prueba",
          title: "x",
          category: "x",
          kind: "GENERAL",
          amountMinor: 1,
          incurredOn: "2026-01-01",
          dueOn: "2026-01-01",
          idempotencyKey: crypto.randomUUID(),
        });
        return false;
      } catch (error) {
        return String(error);
      }
    },
    { id: created.paidId },
  );
  expect(paidRejected).toMatch(/pagado|modificado/i);
  const recurringRejected = await page.evaluate(
    async ({ id }) => {
      try {
        await window.gastronomy.cancelFinanceExpense({
          expenseId: id,
          expectedRevision: 0,
          reason: "prueba",
          idempotencyKey: crypto.randomUUID(),
        });
        return false;
      } catch (error) {
        return String(error);
      }
    },
    { id: created.instanceId },
  );
  expect(recurringRejected).toMatch(/recurrente/i);
  await expenseArticle(fixture.expense.title)
    .getByRole("button", { name: "Corregir", exact: true })
    .click();
  const form = page.getByRole("dialog");
  await form
    .getByLabel("Concepto", { exact: true })
    .fill("No persistir por conflicto");
  await form.getByLabel("Importe", { exact: true }).fill("2000,00");
  await page.evaluate(
    async ({ id }) =>
      window.gastronomy.payFinanceExpense({
        expenseId: id,
        paymentMethodCode: "CASH",
        fromCash: true,
        idempotencyKey: crypto.randomUUID(),
      }),
    { id: fixture.expense.id },
  );
  await form
    .getByLabel("Motivo de la corrección", { exact: true })
    .fill("Evitar conflicto con pago");
  await form
    .getByRole("button", { name: "Guardar corrección", exact: true })
    .click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(form.getByLabel("Concepto", { exact: true })).toHaveValue(
    "No persistir por conflicto",
  );
  const after = await page.evaluate(
    async ({ date, id, sessionId }) => ({
      report: await window.gastronomy.getFinanceReport({
        from: date,
        to: date,
      }),
      bootstrap: await window.gastronomy.bootstrap(),
      cash: await window.gastronomy.getCashSessionReport({
        cashSessionId: sessionId,
      }),
    }),
    {
      date: fixture.date,
      id: fixture.expense.id,
      sessionId: fixture.sessionId,
    },
  );
  expect(
    after.report.expenses.find((x) => x.id === fixture.expense.id),
  ).toMatchObject({
    title: fixture.expense.title,
    amountMinor: 100_000,
    paidAt: expect.any(String),
  });
  expect(after.cash.movements.length - fixture.cash.movements.length).toBe(1); // Only explicit payment may add a ledger movement.
  expect(
    after.report.expenses.find((x) => x.id === created.paidId)?.paidAt,
  ).toBeTruthy();
  await capture("payment-conflict-keeps-form", {
    before: fixture.expense,
    after: after.report.expenses.find((x) => x.id === fixture.expense.id),
    paid: created.paid,
  });
});

test("formulario de recuperación cabe en viewport estrecho y cancelar no modifica el asiento", async () => {
  test.setTimeout(90_000);
  const fixture = await seed("US18A vista estrecha", 543_210);
  await openFinance(fixture.date);
  for (const [width, zoom] of [
    [1100, 1],
    [1366, 1],
    [1366, 2],
  ]) {
    await app.evaluate(
      ({ BrowserWindow }, x) => {
        const w = BrowserWindow.getAllWindows()[0]!;
        w.setSize(x.width, 720);
        w.webContents.setZoomFactor(x.zoom);
      },
      { width: width!, zoom: zoom! },
    );
    const row = expenseArticle(fixture.expense.title);
    await row.getByRole("button", { name: "Corregir", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Corregir gasto" });
    const dimensions = await dialog.evaluate((el) => ({
      left: el.getBoundingClientRect().left,
      right: el.getBoundingClientRect().right,
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    expect(dimensions.left).toBeGreaterThanOrEqual(0);
    expect(dimensions.right).toBeLessThanOrEqual(
      await page.evaluate(() => innerWidth),
    );
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(
      dimensions.clientWidth + 1,
    );
    await dialog
      .getByLabel("Motivo de la corrección", { exact: true })
      .fill("Cancelar prueba teclado");
    await capture("viewport-correction-" + width + "-" + zoom, {
      dimensions,
      expense: fixture.expense,
    });
    await dialog
      .getByLabel("Motivo de la corrección", { exact: true })
      .press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(
      row.getByRole("button", { name: "Corregir", exact: true }),
    ).toBeFocused();
  }
  const after = await page.evaluate(
    async ({ date, id }) => ({
      report: await window.gastronomy.getFinanceReport({
        from: date,
        to: date,
      }),
      audit: await window.gastronomy.getAuditLog({ limit: 200 }),
    }),
    { date: fixture.date, id: fixture.expense.id },
  );
  expect(
    after.report.expenses.find((x) => x.id === fixture.expense.id)?.amountMinor,
  ).toBe(543_210);
  expect(
    after.audit.some(
      (x) =>
        x.entityId === fixture.expense.id &&
        /FINANCE_EXPENSE_(CORRECTED|CANCELLED)/.test(x.action),
    ),
  ).toBe(false);
});
