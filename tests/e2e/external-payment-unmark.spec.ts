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
  "docs/qa/evidence/system-usability-external-payment-unmark-fix-2026-10-08",
);
let app: ElectronApplication;
let page: Page;
let profile = "";
test.use({ actionTimeout: 5000 });

async function launch(tag: string) {
  await mkdir(evidenceDir, { recursive: true });
  profile = await mkdtemp(join(tmpdir(), `gastronomy-us18b1-${tag}-`));
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
  expect(basename(profile)).toMatch(/^gastronomy-us18b1-/);
}
async function cleanup() {
  await app?.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().forEach((w) => w.destroy()),
  );
  await app?.close();
  if (profile) {
    if (
      dirname(resolve(profile)) !== resolve(tmpdir()) ||
      !basename(profile).startsWith("gastronomy-us18b1-")
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

async function paidFixture(withCash: boolean) {
  return page.evaluate(async (withCash) => {
    const api = window.gastronomy;
    const session = withCash
      ? await api.openCashSession({ openingAmountMinor: 100000 })
      : null;
    const date =
      session?.businessDate ?? new Date().toLocaleDateString("en-CA");
    const expense = await api.createFinanceExpense({
      title: "US18B1 pago externo",
      category: "US18B1",
      kind: "GENERAL",
      amountMinor: 34560,
      incurredOn: date,
    });
    const payInput = {
      expenseId: expense.id,
      paymentMethodCode: "TRANSFER",
      fromCash: false,
      expectedRevision: 0,
      idempotencyKey: "b1-original-payment",
    };
    const paid = await api.payFinanceExpense(payInput);
    return {
      date,
      expense,
      paid,
      payInput,
      session,
      report: await api.getFinanceReport({ from: date, to: date }),
      products: (await api.bootstrap()).products,
      cash: session
        ? await api.getCashSessionReport({ cashSessionId: session.id })
        : null,
    };
  }, withCash);
}
async function openUnmark() {
  await expenseArticle("US18B1 pago externo")
    .getByRole("button", { name: "Deshacer marca de pago", exact: true })
    .click();
  return page.getByRole("dialog", {
    name: "Deshacer marca de pago",
    exact: true,
  });
}
for (const withCash of [false, true])
  test(`deshacer externo ${withCash ? "con caja" : "sin caja"} mantiene gasto, historial y CSV vigente`, async () => {
    const data = await paidFixture(withCash);
    await openFinance(data.date);
    const dialog = await openUnmark();
    await expect(
      dialog.getByText(
        "El gasto volverá a pendiente. Esta acción no registra una devolución de dinero.",
        { exact: true },
      ),
    ).toBeVisible();
    const confirm = dialog.getByRole("button", {
      name: "Deshacer marca de pago",
      exact: true,
    });
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel("Motivo").fill("Marcado por equivocación");
    await capture("unmark-confirm-" + withCash, data);
    await confirm.click();
    await expect(dialog).toHaveCount(0);
    await expect(
      expenseArticle(data.paid.title).getByRole("button", {
        name: "Marcar pagado",
        exact: true,
      }),
    ).toBeVisible();
    const after = await page.evaluate(
      async ({ date, id, sessionId }) => {
        const api = window.gastronomy;
        return {
          report: await api.getFinanceReport({ from: date, to: date }),
          audit: await api.getAuditLog({ search: id, limit: 50 }),
          products: (await api.bootstrap()).products,
          cash: sessionId
            ? await api.getCashSessionReport({ cashSessionId: sessionId })
            : null,
        };
      },
      { date: data.date, id: data.paid.id, sessionId: data.session?.id },
    );
    expect(after.report.expensesMinor).toBe(data.report.expensesMinor);
    expect(after.report.estimatedOperatingProfitMinor).toBe(
      data.report.estimatedOperatingProfitMinor,
    );
    expect(after.report.unpaidMinor).toBe(34560);
    expect(after.products).toEqual(data.products);
    expect(after.cash).toEqual(data.cash);
    const audit = after.audit.find(
      (x) => x.action === "FINANCE_EXPENSE_PAYMENT_UNMARKED",
    )!;
    expect(audit).toMatchObject({
      reason: "Marcado por equivocación",
      permissionUsed: "finance.manage",
      entityId: data.paid.id,
    });
    expect(JSON.parse(audit.beforeJson!)).toMatchObject({
      paidAt: data.paid.paidAt,
      amountMinor: 34560,
      paymentMethodCode: "TRANSFER",
    });
    await capture("unmark-pending-" + withCash, after);
    const savePath = join(profile, "pending-expense.csv");
    await app.evaluate(({ session, app }, savePath) => {
      (app as any).__b1Download = null;
      session.defaultSession.once("will-download", (_e, item) => {
        item.setSavePath(savePath);
        item.once("done", (_e, state) => {
          (app as any).__b1Download = state;
        });
      });
    }, savePath);
    await page
      .getByRole("button", { name: "Exportar gastos (CSV)", exact: true })
      .click();
    await expect
      .poll(() => app.evaluate(({ app }) => (app as any).__b1Download))
      .toBe("completed");
    const bytes = await readFile(savePath);
    expect(bytes.subarray(0, 3).toString("hex")).toBe("efbbbf");
    const row = bytes
      .toString("utf8")
      .split("\r\n")
      .find((x) => x.includes(data.paid.title))!;
    expect(row.split(";")).toHaveLength(8);
    expect(row).toContain(';"345.60";"Pendiente";');
  });

test("viejo intento de pago abierto no vuelve a pagar un gasto modificado", async () => {
  const data = await paidFixture(false);
  const undone = await page.evaluate(
    async (paid) =>
      await window.gastronomy.unmarkFinanceExpensePayment({
        expenseId: paid.id,
        expectedRevision: paid.revision!,
        reason: "Preparar pendiente",
        idempotencyKey: "setup-unmark",
      }),
    data.paid,
  );
  await openFinance(data.date);
  const row = expenseArticle(data.paid.title);
  await row.getByRole("button", { name: "Marcar pagado", exact: true }).click();
  await page.evaluate(
    async ({ undone, date }) =>
      await window.gastronomy.correctFinanceExpense({
        expenseId: undone.id,
        expectedRevision: undone.revision!,
        reason: "Cambio después de abrir pago",
        title: undone.title,
        category: undone.category,
        kind: "GENERAL",
        amountMinor: 25000,
        incurredOn: date,
      }),
    { undone, date: data.date },
  );
  await row.getByRole("button", { name: "Confirmar", exact: true }).click();
  await expect(
    page.getByText(
      /El gasto fue modificado; actualizá la información antes de pagar/,
    ),
  ).toBeVisible();
  const current = await page.evaluate(
    async (date) =>
      await window.gastronomy.getFinanceReport({ from: date, to: date }),
    data.date,
  );
  expect(current.expenses.find((x) => x.id === data.paid.id)).toMatchObject({
    paidAt: null,
    amountMinor: 25000,
  });
  await expect(
    row.getByRole("button", { name: "Confirmar", exact: true }),
  ).toBeVisible();
  await capture("old-payment-intent-rejected", current);
});

test("cancelar, teclado y zoom no cambian la marca externa; pagos desde caja no ofrecen deshacer", async () => {
  const data = await paidFixture(true);
  await page.evaluate(async (date) => {
    const api = window.gastronomy;
    for (const method of ["CASH", "TRANSFER"]) {
      const e = await api.createFinanceExpense({
        title: "US18B1 vinculado " + method,
        category: "US18B1",
        kind: "GENERAL",
        amountMinor: 1000,
        incurredOn: date,
      });
      await api.payFinanceExpense({
        expenseId: e.id,
        paymentMethodCode: method,
        fromCash: true,
      });
    }
  }, data.date);
  await openFinance(data.date);
  for (const method of ["CASH", "TRANSFER"])
    await expect(
      expenseArticle("US18B1 vinculado " + method).getByRole("button", {
        name: "Deshacer marca de pago",
        exact: true,
      }),
    ).toHaveCount(0);
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
    const dialog = await openUnmark();
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
    await dialog.getByLabel("Motivo").fill("Cancelar sin cambio");
    await capture(`unmark-viewport-${width}-${zoom}`, rect);
    await dialog.getByLabel("Motivo").press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(
      expenseArticle(data.paid.title).getByRole("button", {
        name: "Deshacer marca de pago",
        exact: true,
      }),
    ).toBeFocused();
  }
  const report = await page.evaluate(
    async (date) =>
      await window.gastronomy.getFinanceReport({ from: date, to: date }),
    data.date,
  );
  expect(report.expenses.find((x) => x.id === data.paid.id)?.paidAt).toBe(
    data.paid.paidAt,
  );
});

test("reintentos históricos no deshacen un segundo pago ni vuelven a pagar tras deshacer", async () => {
  const data = await paidFixture(false);
  const result = await page.evaluate(async (data) => {
    const api = window.gastronomy;
    const input = {
      expenseId: data.paid.id,
      expectedRevision: data.paid.revision!,
      reason: "Primer pago equivocado",
      idempotencyKey: "b1-undo-once",
    };
    const undone = await api.unmarkFinanceExpensePayment(input);
    const oldPayReceipt = await api.payFinanceExpense(data.payInput);
    const pending = await api.getFinanceReport({
      from: data.date,
      to: data.date,
    });
    const repaid = await api.payFinanceExpense({
      expenseId: data.paid.id,
      paymentMethodCode: "TRANSFER",
      fromCash: false,
      expectedRevision: undone.revision!,
      idempotencyKey: "b1-fresh-pay",
    });
    const oldUndoReceipt = await api.unmarkFinanceExpensePayment(input);
    const current = await api.getFinanceReport({
      from: data.date,
      to: data.date,
    });
    return { undone, oldPayReceipt, pending, repaid, oldUndoReceipt, current };
  }, data);
  expect(result.oldPayReceipt).toEqual(data.paid);
  expect(
    result.pending.expenses.find((x) => x.id === data.paid.id)?.paidAt,
  ).toBeNull();
  expect(result.oldUndoReceipt).toEqual(result.undone);
  expect(
    result.current.expenses.find((x) => x.id === data.paid.id)?.paidAt,
  ).toBe(result.repaid.paidAt);
  await openFinance(data.date);
  await capture("historical-replay-safe", result);
});

test("caja cerrada queda intacta y un deshacer obsoleto conserva motivo sin quitar un pago nuevo", async () => {
  const data = await paidFixture(true);
  const closed = await page.evaluate(async (id) => {
    await window.gastronomy.closeCashSession({countedAmountMinor:100000,closingFloatAmountMinor:5000});
    return window.gastronomy.getCashSessionReport({cashSessionId:id});
  }, data.session!.id);
  await openFinance(data.date);
  const dialog = await openUnmark();
  await dialog.getByLabel("Motivo", {exact:true}).fill("Motivo conservado tras conflicto");
  const repaid = await page.evaluate(async (paid) => {
    const api = window.gastronomy;
    const pending = await api.unmarkFinanceExpensePayment({expenseId:paid.id,expectedRevision:paid.revision!,reason:"Otro usuario corrigió",idempotencyKey:"concurrent-undo"});
    return api.payFinanceExpense({expenseId:paid.id,paymentMethodCode:"TRANSFER",fromCash:false,expectedRevision:pending.revision!,idempotencyKey:"concurrent-new-pay"});
  }, data.paid);
  await dialog.getByRole("button", {name:"Deshacer marca de pago",exact:true}).click();
  await expect(dialog.getByRole("alert")).toContainText("El gasto fue modificado");
  await expect(dialog.getByLabel("Motivo",{exact:true})).toHaveValue("Motivo conservado tras conflicto");
  const after = await page.evaluate(async ({date,id}) => ({cash:await window.gastronomy.getCashSessionReport({cashSessionId:id}),report:await window.gastronomy.getFinanceReport({from:date,to:date}),active:(await window.gastronomy.bootstrap()).cashSession}),{date:data.date,id:data.session!.id});
  expect(after.cash).toEqual(closed);
  expect(after.active).toBeNull();
  expect(after.report.expenses.find(x=>x.id===data.paid.id)).toMatchObject({paidAt:repaid.paidAt,revision:repaid.revision});
  await capture("closed-session-stale-undo-preserved",after);
});
