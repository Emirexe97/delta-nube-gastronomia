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

const evidence = join(
  process.cwd(),
  "docs/qa/evidence/system-usability-finance-export-scope-fix-2026-10-08",
);
let app: ElectronApplication;
let page: Page;
let profile = "";

test.beforeEach(async () => {
  await mkdir(evidence, { recursive: true });
  profile = await mkdtemp(join(tmpdir(), "gastronomy-finance-export-scope-"));
  app = await electron.launch({
    args: ["apps/desktop-shell", `--user-data-dir=${profile}`],
    cwd: process.cwd(),
  });
  page = await app.firstWindow();
  await expect(page.getByText("Delta Nube", { exact: true })).toBeVisible();
  expect(
    resolve(await app.evaluate(({ app }) => app.getPath("userData"))),
  ).toBe(resolve(profile));
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]!.isVisible(),
      ),
    )
    .toBe(process.env.GASTRONOMY_E2E_BACKGROUND !== "1");
});

test.afterEach(async () => {
  await app?.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().forEach((window) => window.destroy()),
  );
  await app?.close();
  if (profile) {
    if (
      dirname(resolve(profile)) !== resolve(tmpdir()) ||
      !basename(profile).startsWith("gastronomy-finance-export-scope-")
    )
      throw new Error("Unsafe disposable finance export profile cleanup");
    await rm(profile, { recursive: true, force: true });
    profile = "";
  }
});

async function capture(name: string, state: unknown) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      document
        .getAnimations()
        .filter(
          (animation) => animation.effect?.getTiming().iterations !== Infinity,
        )
        .map((animation) => animation.finished.catch(() => {})),
    );
    await new Promise<void>((done) =>
      requestAnimationFrame(() => requestAnimationFrame(() => done())),
    );
  });
  const image = await app.evaluate(async ({ BrowserWindow }) => {
    const bitmap =
      await BrowserWindow.getAllWindows()[0]!.webContents.capturePage();
    return { size: bitmap.getSize(), data: bitmap.toPNG().toString("base64") };
  });
  await writeFile(
    join(evidence, `${name}.png`),
    Buffer.from(image.data, "base64"),
  );
  await writeFile(
    join(evidence, `${name}.json`),
    JSON.stringify(
      { state, capture: image.size, realElectronSqliteAndIpc: true },
      null,
      2,
    ),
  );
}

async function armDownload(path: string) {
  await app.evaluate(({ session, app: electronApp }, savePath) => {
    (electronApp as any).__financeExportDownload = null;
    session.defaultSession.once("will-download", (_event, item) => {
      item.setSavePath(savePath);
      item.once("done", (_doneEvent, state) => {
        (electronApp as any).__financeExportDownload = {
          state,
          path: item.getSavePath(),
          filename: item.getFilename(),
        };
      });
    });
  }, path);
}

async function waitForDownload() {
  await expect
    .poll(
      () =>
        app.evaluate(
          ({ app: electronApp }) =>
            (electronApp as any).__financeExportDownload,
        ),
      {
        message:
          "El CSV debe descargarse mediante el manejador real de Electron",
      },
    )
    .not.toBeNull();
  return app.evaluate(
    ({ app: electronApp }) => (electronApp as any).__financeExportDownload,
  );
}

test("exporta únicamente los gastos del período y conserva el CSV y su nombre", async () => {
  test.setTimeout(90_000);
  const fixture = await page.evaluate(async () => {
    const api = window.gastronomy;
    const before = {
      bootstrap: await api.bootstrap(),
      feb: await api.getFinanceReport({ from: "2024-02-01", to: "2024-02-29" }),
    };
    const expenses = [];
    for (const [title, date, amountMinor] of [
      ['Servicio; "luz"\nlocal', "2024-02-12", 12_345],
      ["Gasto fuera del mes", "2024-03-04", 67_890],
    ] as const) {
      expenses.push(
        await api.createFinanceExpense({
          title,
          category: "Servicios",
          kind: "GENERAL",
          amountMinor,
          incurredOn: date,
          dueOn: date,
          employeeId: null,
          note: null,
          idempotencyKey: crypto.randomUUID(),
        }),
      );
    }
    const paid = await api.payFinanceExpense({
      expenseId: expenses[0]!.id,
      paymentMethodCode: "CASH",
      fromCash: false,
      idempotencyKey: crypto.randomUUID(),
    });
    return {
      before,
      expenses,
      paid,
      after: {
        bootstrap: await api.bootstrap(),
        feb: await api.getFinanceReport({
          from: "2024-02-01",
          to: "2024-02-29",
        }),
      },
    };
  });
  await page.getByRole("link", { name: "Finanzas", exact: true }).click();
  const button = page.getByRole("button", { name: /CSV/i });
  await expect(button).toBeEnabled();
  const initial = {
    label: await button.innerText(),
    range: {
      from: await page.getByLabel("Desde", { exact: true }).inputValue(),
      to: await page.getByLabel("Hasta", { exact: true }).inputValue(),
    },
    fixture,
  };
  await capture("finance-export-scope-initial", initial);
  await expect(
    page.getByRole("button", { name: "Exportar gastos (CSV)", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "CSV", exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("Desde", { exact: true }).fill("2024-02-01");
  await page.getByLabel("Hasta", { exact: true }).fill("2024-02-29");
  await expect(
    page.getByText("Calculando período…", { exact: true }),
  ).toBeHidden();
  await expect(
    page.getByText('Servicio; "luz" local', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Gasto fuera del mes", { exact: true }),
  ).toHaveCount(0);

  const exportPath = join(profile, "finanzas-2024-02-01-2024-02-29.csv");
  await armDownload(exportPath);
  await button.click();
  const download = await waitForDownload();
  expect(download).toEqual({
    state: "completed",
    path: exportPath,
    filename: basename(exportPath),
  });
  const bytes = await readFile(exportPath);
  const csv = bytes.toString("utf8");
  const expected =
    '\ufeff"Fecha";"Tipo";"Categoría";"Descripción";"Importe (pesos)";"Estado";"Empleado";"Medio"\r\n"2024-02-12";"GENERAL";"Servicios";"Servicio; ""luz""\nlocal";"123.45";"Pagado";"";"CASH"';
  const report = await page.evaluate(() =>
    window.gastronomy.getFinanceReport({
      from: "2024-02-01",
      to: "2024-02-29",
    }),
  );
  await capture("finance-export-scope-february", {
    fixture,
    download,
    exportPath,
    byteLength: bytes.length,
    report,
  });
  expect(bytes[0]).toBe(0xef);
  expect(csv).toBe(expected);
  expect(csv.split("\r\n")[0]!.split(";")).toHaveLength(8);
  expect(csv).not.toContain("Gasto fuera del mes");
  expect(report.expensesMinor).toBe(12_345);
  expect(report.expenses.map((item) => item.title)).toEqual([
    'Servicio; "luz"\nlocal',
  ]);
  expect(report.salesMinor).toBe(0);
  expect(
    await page.evaluate(async () => ({
      bootstrap: await window.gastronomy.bootstrap(),
      feb: await window.gastronomy.getFinanceReport({
        from: "2024-02-01",
        to: "2024-02-29",
      }),
    })),
  ).toEqual(fixture.after);
  expect(report.estimatedOperatingProfitMinor).toBe(
    fixture.before.feb.estimatedOperatingProfitMinor - 12_345,
  );
  expect(fixture.after.bootstrap.orders).toEqual(
    fixture.before.bootstrap.orders,
  );
  expect(fixture.after.bootstrap.products).toEqual(
    fixture.before.bootstrap.products,
  );
  expect(fixture.after.feb.expenses.map((item) => item.id)).toContain(
    fixture.expenses[0]!.id,
  );
  expect(fixture.after.feb.expenses.map((item) => item.id)).not.toContain(
    fixture.expenses[1]!.id,
  );
});

test("el período vacío exporta solo encabezado y la acción es legible y operable por teclado", async () => {
  test.setTimeout(90_000);
  const before = await page.evaluate(async () => ({
    bootstrap: await window.gastronomy.bootstrap(),
    report: await window.gastronomy.getFinanceReport({
      from: "2024-04-01",
      to: "2024-04-30",
    }),
  }));
  await page.getByRole("link", { name: "Finanzas", exact: true }).click();
  await page.getByLabel("Desde", { exact: true }).fill("2024-04-01");
  await page.getByLabel("Hasta", { exact: true }).fill("2024-04-30");
  await expect(
    page.getByText("Calculando período…", { exact: true }),
  ).toBeHidden();
  const button = page.getByRole("button", { name: /CSV/i });
  await capture("finance-export-empty-initial", {
    label: await button.innerText(),
  });
  await expect(button).toHaveText("Exportar gastos (CSV)");
  const layouts = [];
  for (const width of [1100, 1366]) {
    await app.evaluate(
      ({ BrowserWindow }, value) =>
        BrowserWindow.getAllWindows()[0]!.setSize(value, 820),
      width,
    );
    await button.scrollIntoViewIfNeeded();
    await expect(button).toBeInViewport();
    const layout = await button.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        label: element.innerText,
        width: rect.width,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        reachable: rect.width > 0 && rect.height > 0,
      };
    });
    layouts.push({ width, ...layout });
    await capture(`finance-export-scope-layout-${width}`, { layouts, before });
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
    expect(layout.reachable).toBe(true);
  }
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]!.setSize(1100, 820);
    BrowserWindow.getAllWindows()[0]!.webContents.setZoomFactor(2);
  });
  await button.scrollIntoViewIfNeeded();
  await expect(button).toBeInViewport();
  const zoom = await button.evaluate((element) => ({
    label: element.innerText,
    width: element.clientWidth,
    scrollWidth: element.scrollWidth,
    reachable: element.getBoundingClientRect().width > 0,
  }));
  await capture("finance-export-scope-layout-zoom-200", { zoom, before });
  expect(zoom.reachable).toBe(true);
  expect(zoom.scrollWidth).toBeLessThanOrEqual(zoom.width);
  expect(before.report.expenses).toHaveLength(0);

  const exportPath = join(profile, "finanzas-2024-04-01-2024-04-30.csv");
  await armDownload(exportPath);
  await button.focus();
  await page.keyboard.press("Enter");
  const download = await waitForDownload();
  expect(download).toEqual({
    state: "completed",
    path: exportPath,
    filename: basename(exportPath),
  });
  const bytes = await readFile(exportPath);
  expect(bytes.toString("utf8")).toBe(
    '\ufeff"Fecha";"Tipo";"Categoría";"Descripción";"Importe (pesos)";"Estado";"Empleado";"Medio"',
  );
  const after = await page.evaluate(async () => ({
    bootstrap: await window.gastronomy.bootstrap(),
    report: await window.gastronomy.getFinanceReport({
      from: "2024-04-01",
      to: "2024-04-30",
    }),
  }));
  expect(after).toEqual(before);
  await capture("finance-export-scope-empty-export", {
    layouts,
    zoom,
    download,
    bytes: bytes.toString("base64"),
    unchanged: true,
  });
});
