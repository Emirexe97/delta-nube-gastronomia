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
  "docs/qa/evidence/system-usability-cash-payment-correction-fix-2026-10-08",
);
let app: ElectronApplication;
let page: Page;
let profile = "";
test.use({ actionTimeout: 5000 });

async function launch(tag: string) {
  await mkdir(evidenceDir, { recursive: true });
  profile = await mkdtemp(join(tmpdir(), `gastronomy-us18b2a-${tag}-`));
  app = await electron.launch({
    args: ["apps/desktop-shell", `--user-data-dir=${profile}`],
    cwd: process.cwd(),
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(5000);
  await expect(page.getByText("Delta Nube", { exact: true })).toBeVisible({
    timeout: 90_000,
  });
  const userData = await app.evaluate(({ app }) => app.getPath("userData"));
  expect(resolve(userData)).toBe(resolve(profile));
  expect(basename(profile)).toMatch(/^gastronomy-us18b2a-/);
}
async function cleanup() {
  await app?.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().forEach((w) => w.destroy()),
  );
  await app?.close();
  if (profile) {
    if (
      dirname(resolve(profile)) !== resolve(tmpdir()) ||
      !basename(profile).startsWith("gastronomy-us18b2a-")
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
  await page.reload();
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

async function paidFixture(method: string) {
  return page.evaluate(async (method) => {
    const api = window.gastronomy;
    const session = await api.openCashSession({ openingAmountMinor: 100000 });
    const date = session.businessDate;
    const expense = await api.createFinanceExpense({
      title: "US18B2A pago de caja",
      category: "Prueba",
      kind: "GENERAL",
      amountMinor: 23450,
      incurredOn: date,
    });
    const payInput = {
      expenseId: expense.id,
      paymentMethodCode: method,
      fromCash: true,
      expectedRevision: expense.revision ?? 0,
      idempotencyKey: "original-pay",
    };
    const paid = await api.payFinanceExpense(payInput);
    return {
      date,
      session,
      expense,
      paid,
      payInput,
      products: (await api.bootstrap()).products,
      report: await api.getFinanceReport({ from: date, to: date }),
    };
  }, method);
}
async function openCorrection() {
  await expenseArticle("US18B2A pago de caja")
    .getByRole("button", { name: "Corregir pago registrado", exact: true })
    .click();
  return page.getByRole("dialog", {
    name: "Corregir pago registrado",
    exact: true,
  });
}
for (const method of ["CASH", "TRANSFER"])
  test(`corregir ${method} vuelve pendiente sin duplicar gasto ni cambiar stock`, async () => {
    const data = await paidFixture(method);
    await openFinance(data.date);
    const dialog = await openCorrection();
    await expect(
      dialog.getByText(
        "Usá esta opción sólo si el pago se registró por error y el dinero no salió. El gasto volverá a pendiente. No registra una devolución real.",
        { exact: true },
      ),
    ).toBeVisible();
    if (method === "TRANSFER")
      await expect(
        dialog.getByText("No cambia el efectivo esperado de esta caja.", {
          exact: true,
        }),
      ).toBeVisible();
    const confirm = dialog.getByRole("button", {
      name: "Corregir pago registrado",
      exact: true,
    });
    await expect(confirm).toBeDisabled();
    await dialog
      .getByLabel("Motivo", { exact: true })
      .fill("Pago cargado sin entregar dinero");
    await dialog.getByLabel("PIN de autorización").fill("0000");
    await confirm.click();
    await expect(
      dialog.getByText(/PIN.*incorrect|autoriz.*incorrect/i),
    ).toBeVisible();
    await expect(dialog.getByLabel("Motivo", { exact: true })).toHaveValue(
      "Pago cargado sin entregar dinero",
    );
    await dialog.getByLabel("PIN de autorización").fill("1234");
    await capture("confirm-" + method, data);
    await confirm.click();
    await expect(dialog).toHaveCount(0);
    await expect(
      expenseArticle(data.expense.title).getByRole("button", {
        name: "Marcar pagado",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      expenseArticle(data.expense.title).getByRole("button", {
        name: "Corregir",
        exact: true,
      }),
    ).toBeVisible();
    const after = await page.evaluate(
      async (d) => ({
        report: await window.gastronomy.getFinanceReport({
          from: d.date,
          to: d.date,
        }),
        products: (await window.gastronomy.bootstrap()).products,
        cash: (await window.gastronomy.bootstrap()).cashSession,
      }),
      data,
    );
    expect(after.report.expensesMinor).toBe(data.report.expensesMinor);
    expect(after.report.estimatedOperatingProfitMinor).toBe(
      data.report.estimatedOperatingProfitMinor,
    );
    expect(after.report.unpaidMinor).toBe(data.report.unpaidMinor + 23450);
    expect(after.products).toEqual(data.products);
    expect(after.cash!.expectedAmountMinor).toBe(100000);
    await capture("after-" + method, after);
  });
test("Escape devuelve foco y caja cerrada durante confirmación rechaza sin perder motivo", async () => {
  const data = await paidFixture("CASH");
  await openFinance(data.date);
  const trigger = expenseArticle(data.expense.title).getByRole("button", {
    name: "Corregir pago registrado",
    exact: true,
  });
  let dialog = await openCorrection();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  dialog = await openCorrection();
  await dialog.getByLabel("Motivo", { exact: true }).fill("Nunca entregado");
  await dialog.getByLabel("PIN de autorización").fill("1234");
  await page.evaluate(async () => {
    await window.gastronomy.closeCashSession({
      countedAmountMinor: 76550,
      closingFloatAmountMinor: 5000,
    });
  });
  await dialog
    .getByRole("button", { name: "Corregir pago registrado", exact: true })
    .click();
  await expect(
    dialog.getByText(/Abrí una caja antes de operar\./i),
  ).toBeVisible();
  await expect(dialog.getByLabel("Motivo", { exact: true })).toHaveValue(
    "Nunca entregado",
  );
  const after = await page.evaluate(
    async (d) =>
      window.gastronomy.getFinanceReport({ from: d.date, to: d.date }),
    data,
  );
  expect(after.expenses.find((x) => x.id === data.expense.id)?.paidAt).toBe(
    data.paid.paidAt,
  );
  await capture("closed-rejection", after);
});
test("replay histórico no corrige un segundo pago y caja distinta queda excluida", async () => {
  const data = await paidFixture("CASH");
  const result = await page.evaluate(async (d) => {
    const api = window.gastronomy;
    const input = {
      expenseId: d.expense.id,
      expectedRevision: d.paid.revision ?? 0,
      reason: "Primer error",
      authorizerPin: "1234",
      idempotencyKey: "first-correction",
    };
    const first = await api.correctFinanceExpenseCashPayment(input);
    const replay = await api.correctFinanceExpenseCashPayment(input);
    await api.payFinanceExpense(d.payInput);
    const pending = await api.getFinanceReport({ from: d.date, to: d.date });
    const second = await api.payFinanceExpense({
      ...d.payInput,
      expectedRevision: first.revision,
      idempotencyKey: "second-pay",
    });
    const old = await api.correctFinanceExpenseCashPayment(input);
    const report = await api.getFinanceReport({ from: d.date, to: d.date });
    await api.closeCashSession({
      countedAmountMinor: 76550,
      closingFloatAmountMinor: 0,
    });
    await api.openCashSession({ openingAmountMinor: 5000 });
    let error = "";
    try {
      await api.correctFinanceExpenseCashPayment({
        ...input,
        expectedRevision: second.revision ?? 0,
        idempotencyKey: "wrong-session",
      });
    } catch (e) {
      error = String(e);
    }
    return { first, replay, pending, second, old, report, error };
  }, data);
  expect(result.replay).toEqual(result.first);
  expect(result.old).toEqual(result.first);
  expect(
    result.pending.expenses.find((x) => x.id === data.expense.id)?.paidAt,
  ).toBeNull();
  expect(
    result.report.expenses.find((x) => x.id === data.expense.id)?.paidAt,
  ).toBe(result.second.paidAt);
  expect(result.error).toMatch(/caja|sesión/i);
  await page.reload();
  await openFinance(data.date);
  await expect(
    expenseArticle(data.expense.title).getByRole("button", {
      name: "Corregir pago registrado",
      exact: true,
    }),
  ).toHaveCount(0);
});
test("modal utilizable en 1100, 1366 y zoom 200%; cancelar no cambia datos", async () => {
  const data = await paidFixture("CASH");
  await openFinance(data.date);
  for (const [width, zoom] of [
    [1100, 1],
    [1366, 1],
    [1366, 2],
  ]) {
    await app.evaluate(
      ({ BrowserWindow }, { width, zoom }) => {
        const w = BrowserWindow.getAllWindows()[0]!;
        w.setSize(width!, 720);
        w.webContents.setZoomFactor(zoom!);
      },
      { width, zoom },
    );
    const dialog = await openCorrection();
    await dialog
      .getByLabel("Motivo", { exact: true })
      .fill("Cancelar sin cambios");
    await dialog.getByLabel("PIN de autorización").fill("1234");
    const rect = await dialog.evaluate((el) => ({
      left: el.getBoundingClientRect().left,
      right: el.getBoundingClientRect().right,
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    expect(rect.left).toBeGreaterThanOrEqual(0);
    expect(rect.right).toBeLessThanOrEqual(
      await page.evaluate(() => innerWidth),
    );
    expect(rect.scrollWidth).toBeLessThanOrEqual(rect.clientWidth + 1);
    await capture(`viewport-${width}-${zoom}`, rect);
    const confirm = dialog.getByRole("button", {
      name: "Corregir pago registrado",
      exact: true,
    });
    await confirm.scrollIntoViewIfNeeded();
    await expect(confirm).toBeVisible();
    await expect(confirm).toBeEnabled();
    await capture(`viewport-actions-${width}-${zoom}`, rect);
    await dialog.getByLabel("Motivo", { exact: true }).press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(
      expenseArticle(data.expense.title).getByRole("button", {
        name: "Corregir pago registrado",
        exact: true,
      }),
    ).toBeFocused();
  }
  const after = await page.evaluate(
    async (date) =>
      window.gastronomy.getFinanceReport({ from: date, to: date }),
    data.date,
  );
  expect(after).toEqual(data.report);
});
