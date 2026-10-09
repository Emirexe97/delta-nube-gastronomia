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
  "docs/qa/evidence/system-usability-expense-return-fix-2026-10-08",
);
let app: ElectronApplication;
let page: Page;
let profile = "";
test.use({ actionTimeout: 5000 });

async function launch(tag: string) {
  await mkdir(evidenceDir, { recursive: true });
  profile = await mkdtemp(join(tmpdir(), `gastronomy-us18b2b-${tag}-`));
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
  expect(basename(profile)).toMatch(/^gastronomy-us18b2b-/);
}
async function cleanup() {
  await app?.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().forEach((w) => w.destroy()),
  );
  await app?.close();
  if (profile) {
    if (
      dirname(resolve(profile)) !== resolve(tmpdir()) ||
      !basename(profile).startsWith("gastronomy-us18b2b-")
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

async function paidFixture(
  method: string,
  incurredOn?: string,
  withCash = true,
) {
  return page.evaluate(
    async ({ method, incurredOn, withCash }) => {
      const api = window.gastronomy;
      const session = withCash
        ? await api.openCashSession({ openingAmountMinor: 100000 })
        : null;
      const date =
        session?.businessDate ?? new Date().toLocaleDateString("en-CA");
      const expense = await api.createFinanceExpense({
        title: 'US18B2B "servicio;cancelado"',
        category: "Servicios",
        kind: "GENERAL",
        amountMinor: 23450,
        incurredOn: incurredOn ?? date,
      });
      const payInput = {
        expenseId: expense.id,
        paymentMethodCode: method,
        fromCash: withCash,
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
        finance: await api.getFinanceReport({
          from: expense.incurredOn,
          to: expense.incurredOn,
        }),
      };
    },
    { method, incurredOn, withCash },
  );
}
async function openReturn() {
  await expenseArticle('US18B2B "servicio;cancelado"')
    .getByRole("button", { name: "Registrar devolución recibida", exact: true })
    .click();
  return page.getByRole("dialog", {
    name: "Registrar devolución recibida",
    exact: true,
  });
}
async function csv() {
  const savePath = join(profile, "expense-return.csv");
  await app.evaluate(({ session, app }, savePath) => {
    (app as any).__expenseReturnDownload = null;
    session.defaultSession.once("will-download", (_e, item) => {
      (app as any).__expenseReturnFilename = item.getFilename();
      item.setSavePath(savePath);
      item.once("done", (_e, state) => {
        (app as any).__expenseReturnDownload = state;
      });
    });
  }, savePath);
  await page
    .getByRole("button", { name: "Exportar gastos (CSV)", exact: true })
    .click();
  await expect
    .poll(() => app.evaluate(({ app }) => (app as any).__expenseReturnDownload))
    .toBe("completed");
  return {
    name: await app.evaluate(
      ({ app }) => (app as any).__expenseReturnFilename as string,
    ),
    content: await readFile(savePath, "utf8"),
  };
}
for (const pair of [
  { paid: "CASH", received: "TRANSFER", expected: 76550 },
  { paid: "TRANSFER", received: "CASH", expected: 123450 },
])
  test(`retorno ${pair.paid} recibido ${pair.received}: UI, estado y CSV neto sin inventar ventas`, async () => {
    const data = await paidFixture(pair.paid);
    await openFinance(data.date);
    const dialog = await openReturn();
    await expect(
      dialog.getByText(
        "Usá esta opción sólo si recibiste la devolución total de un gasto General que ya no corresponde pagar. No volverá a pendiente. El pago original y los cierres anteriores se conservarán.",
        { exact: true },
      ),
    ).toBeVisible();
    const confirm = dialog.getByRole("button", {
      name: "Registrar devolución recibida",
      exact: true,
    });
    await expect(confirm).toBeDisabled();
    await dialog
      .getByLabel("Destino", { exact: true })
      .selectOption("CASH_SESSION");
    await dialog
      .getByLabel("Medio recibido", { exact: true })
      .selectOption(pair.received);
    await dialog
      .getByLabel("Motivo", { exact: true })
      .fill("El proveedor devolvió el total");
    await dialog.getByLabel("PIN de autorización").fill("0000");
    await confirm.click();
    await expect(dialog.getByRole("alert")).toContainText(/PIN|permiso/i);
    await expect(dialog.getByLabel("Motivo", { exact: true })).toHaveValue(
      "El proveedor devolvió el total",
    );
    await dialog.getByLabel("PIN de autorización").fill("1234");
    await capture(`confirm-${pair.paid}-to-${pair.received}`, data);
    await confirm.click();
    await expect(dialog).toHaveCount(0);
    const row = expenseArticle(data.expense.title);
    await expect(row.getByText("Devuelto", { exact: true })).toBeVisible();
    for (const action of [
      "Marcar pagado",
      "Deshacer marca de pago",
      "Corregir pago registrado",
      "Registrar devolución recibida",
    ])
      await expect(
        row.getByRole("button", { name: action, exact: true }),
      ).toHaveCount(0);
    const after = await page.evaluate(
      async (d) => ({
        finance: await window.gastronomy.getFinanceReport({
          from: d.date,
          to: d.date,
        }),
        cash: (await window.gastronomy.bootstrap()).cashSession,
        products: (await window.gastronomy.bootstrap()).products,
      }),
      data,
    );
    expect(after.finance.expensesMinor).toBe(23450);
    expect(after.finance.expenseReturnsMinor).toBe(23450);
    expect(after.finance.netExpensesMinor).toBe(0);
    expect(after.finance.unpaidMinor).toBe(0);
    expect(after.finance.estimatedOperatingProfitMinor).toBe(
      data.finance.estimatedOperatingProfitMinor + 23450,
    );
    expect(after.finance.salesMinor).toBe(data.finance.salesMinor);
    expect(after.finance.refundsMinor).toBe(data.finance.refundsMinor);
    expect(after.cash!.expectedAmountMinor).toBe(pair.expected);
    expect(after.products).toEqual(data.products);
    const info = after.finance.expenses.find(
      (x) => x.id === data.expense.id,
    )!.returnInfo!;
    expect(info.paymentMethodCode).toBe(pair.received);
    expect(info.originalMovementId).toBeTruthy();
    const blocked = await page.evaluate(
      async (ids) => {
        const errors = [];
        for (const movementId of ids) {
          try {
            await window.gastronomy.reverseCashMovement({
              movementId,
              reason: "No cambiar devolución",
              authorizerPin: "1234",
            });
            errors.push("accepted");
          } catch (e) {
            errors.push(String(e));
          }
        }
        return errors;
      },
      [info.originalMovementId!, info.cashMovementId!],
    );
    expect(blocked.every((x) => /devolución|devuelt|gasto/i.test(x))).toBe(
      true,
    );
    const exported = await csv();
    expect(exported.content.startsWith('\ufeff"Fecha";')).toBe(true);
    expect(exported.content).toContain('"US18B2B ""servicio;cancelado"""');
    expect(exported.content).toContain('"DEVOLUCIÓN";');
    expect(exported.content).toContain(
      ';"-234.50";"Recibida";"";"' + pair.received + '"',
    );
    expect(exported.content.split("\r\n")).toHaveLength(3);
    await capture(`after-${pair.paid}-to-${pair.received}`, {
      after,
      exported,
      blocked,
    });
  });
test("externa sin caja y período anterior: crédito hoy, sin borrar gasto pasado", async () => {
  const data = await paidFixture("TRANSFER", "2026-09-30", false);
  await openFinance(data.expense.incurredOn);
  const dialog = await openReturn();
  await expect(dialog.getByLabel("PIN de autorización")).toHaveCount(0);
  await dialog
    .getByLabel("Medio recibido", { exact: true })
    .selectOption("CASH");
  await dialog
    .getByLabel("Motivo", { exact: true })
    .fill("Total recibido fuera del cajón");
  await dialog
    .getByRole("button", { name: "Registrar devolución recibida", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  const after = await page.evaluate(
    async (d) => ({
      old: await window.gastronomy.getFinanceReport({
        from: "2026-09-01",
        to: "2026-09-30",
      }),
      current: await window.gastronomy.getFinanceReport({
        from: d.date,
        to: d.date,
      }),
      bootstrap: await window.gastronomy.bootstrap(),
    }),
    data,
  );
  expect(after.old.expensesMinor).toBe(23450);
  expect(after.old.expenseReturnsMinor).toBe(0);
  expect(after.old.estimatedOperatingProfitMinor).toBe(-23450);
  expect(after.current.expensesMinor).toBe(0);
  expect(after.current.expenseReturnsMinor).toBe(23450);
  expect(after.current.netExpensesMinor).toBe(-23450);
  expect(after.current.estimatedOperatingProfitMinor).toBe(23450);
  expect(after.bootstrap.cashSession).toBeNull();
  expect(after.current.expenseReturns![0]).toMatchObject({
    destination: "EXTERNAL",
    paymentMethodCode: "CASH",
    affectsCash: false,
    cashMovementId: null,
    cashSessionId: null,
  });
  await page.getByLabel("Desde", { exact: true }).fill(data.date);
  await page.getByLabel("Hasta", { exact: true }).fill(data.date);
  await expect(
    page.getByText("Devoluciones recibidas del período", { exact: true }),
  ).toBeVisible();
  const exported = await csv();
  expect(exported.content.split("\r\n")).toHaveLength(2);
  expect(exported.content).toContain(';"-234.50";"Recibida";"";"CASH"');
  await capture("external-cross-period", { after, exported });
});
test("recibir en nueva caja conserva cierre original e historial de pago/reintentos", async () => {
  const data = await paidFixture("CASH");
  const before = await page.evaluate(async (d) => {
    await window.gastronomy.closeCashSession({
      countedAmountMinor: 76550,
      closingFloatAmountMinor: 5000,
    });
    const closed = await window.gastronomy.getCashSessionReport({
      cashSessionId: d.session!.id,
    });
    const current = await window.gastronomy.openCashSession({
      openingAmountMinor: 5000,
    });
    return { closed, current };
  }, data);
  const after = await page.evaluate(async (d) => {
    const api = window.gastronomy;
    const input = {
      expenseId: d.expense.id,
      expectedRevision: d.paid.revision ?? 0,
      destination: "CASH_SESSION" as const,
      paymentMethodCode: "CASH",
      reason: "Recibido después del cierre",
      authorizerPin: "1234",
      idempotencyKey: "return-today",
    };
    const returned = await api.receiveFinanceExpenseReturn(input);
    const replay = await api.receiveFinanceExpenseReturn(input);
    await api.payFinanceExpense(d.payInput);
    const closed = await api.getCashSessionReport({
      cashSessionId: d.session!.id,
    });
    const boot = await api.bootstrap();
    const finance = await api.getFinanceReport({ from: d.date, to: d.date });
    return { returned, replay, closed, boot, finance };
  }, data);
  expect(after.returned.paidAt).toBe(data.paid.paidAt);
  expect(after.replay).toEqual(after.returned);
  expect(after.closed).toEqual(before.closed);
  expect(after.boot.cashSession!.id).toBe(before.current.id);
  expect(after.boot.cashSession!.expectedAmountMinor).toBe(28450);
  expect(after.finance.expenseReturns).toHaveLength(1);
  expect(
    after.finance.expenses.find((x) => x.id === data.expense.id)?.returnInfo,
  ).toEqual(after.returned.returnInfo);
  await openFinance(data.date);
  await capture("new-cash-return-old-closure", after);
});
test("caja cerrada mientras modal abierto rechaza sin perder campos ni modificar gasto", async () => {
  const data = await paidFixture("CASH");
  await openFinance(data.date);
  const dialog = await openReturn();
  await dialog
    .getByLabel("Destino", { exact: true })
    .selectOption("CASH_SESSION");
  await dialog
    .getByLabel("Medio recibido", { exact: true })
    .selectOption("CASH");
  await dialog
    .getByLabel("Motivo", { exact: true })
    .fill("El dinero llegó ahora");
  await dialog.getByLabel("PIN de autorización").fill("1234");
  await page.evaluate(async () =>
    window.gastronomy.closeCashSession({
      countedAmountMinor: 76550,
      closingFloatAmountMinor: 0,
    }),
  );
  await dialog
    .getByRole("button", { name: "Registrar devolución recibida", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(/caja/i);
  await expect(dialog.getByLabel("Motivo", { exact: true })).toHaveValue(
    "El dinero llegó ahora",
  );
  const after = await page.evaluate(
    async (d) =>
      window.gastronomy.getFinanceReport({ from: d.date, to: d.date }),
    data,
  );
  expect(after.expenseReturnsMinor).toBe(0);
  expect(after.expenses.find((x) => x.id === data.expense.id)?.paidAt).toBe(
    data.paid.paidAt,
  );
  await capture("closed-modal-rejected", after);
});
test("modal cabe con zoom y Escape devuelve foco sin registrar devolución", async () => {
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
    const dialog = await openReturn();
    await dialog
      .getByLabel("Medio recibido", { exact: true })
      .selectOption("TRANSFER");
    await dialog
      .getByLabel("Motivo", { exact: true })
      .fill("Cancelar sin cambio");
    const confirm = dialog.getByRole("button", {
      name: "Registrar devolución recibida",
      exact: true,
    });
    await confirm.scrollIntoViewIfNeeded();
    await expect(confirm).toBeVisible();
    await expect(confirm).toBeEnabled();
    const rect = await dialog.evaluate((el) => ({
      left: el.getBoundingClientRect().left,
      right: el.getBoundingClientRect().right,
      scroll: el.scrollWidth,
      client: el.clientWidth,
    }));
    expect(rect.left).toBeGreaterThanOrEqual(0);
    expect(rect.right).toBeLessThanOrEqual(
      await page.evaluate(() => innerWidth),
    );
    expect(rect.scroll).toBeLessThanOrEqual(rect.client + 1);
    await capture(`return-zoom-${width}-${zoom}`, rect);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(
      expenseArticle(data.expense.title).getByRole("button", {
        name: "Registrar devolución recibida",
        exact: true,
      }),
    ).toBeFocused();
  }
  const after = await page.evaluate(
    async (d) =>
      window.gastronomy.getFinanceReport({ from: d.date, to: d.date }),
    data,
  );
  expect(after).toEqual(data.finance);
});
