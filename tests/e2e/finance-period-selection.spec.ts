import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const evidence = join(
  process.cwd(),
  "docs/qa/evidence/system-usability-finance-period-fix-2026-10-08",
);
let app: ElectronApplication;
let page: Page;
let profile = "";

test.beforeEach(async () => {
  await mkdir(evidence, { recursive: true });
  profile = await mkdtemp(join(tmpdir(), "gastronomy-finance-period-"));
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
      !basename(profile).startsWith("gastronomy-finance-period-")
    )
      throw new Error("Unsafe disposable finance profile cleanup");
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
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => {})),
    );
    await new Promise<void>((done) =>
      requestAnimationFrame(() => requestAnimationFrame(() => done())),
    );
  });
  const observed = {
    month: await page.getByLabel("Mes", { exact: true }).inputValue(),
    from: await page.getByLabel("Desde", { exact: true }).inputValue(),
    to: await page.getByLabel("Hasta", { exact: true }).inputValue(),
  };
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
      { state, observed, capture: image.size, realElectronSqliteAndIpc: true },
      null,
      2,
    ),
  );
}

test("Mes representa el período completo y nunca conserva un mes obsoleto en rangos parciales o cruzados", async () => {
  await page.evaluate(async () => {
    for (const [title, date, amount] of [
      ["US12 febrero", "2024-02-29", 12345],
      ["US12 marzo", "2024-03-01", 67890],
    ] as const) {
      await window.gastronomy.createFinanceExpense({
        title,
        category: "US12",
        kind: "GENERAL",
        amountMinor: amount,
        incurredOn: date,
      });
    }
  });
  await page.getByRole("link", { name: "Finanzas", exact: true }).click();
  const month = page.getByLabel("Mes", { exact: true });
  const from = page.getByLabel("Desde", { exact: true });
  const to = page.getByLabel("Hasta", { exact: true });
  await expect(month).toHaveValue(
    await page.evaluate(() => {
      const now = new Date();
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    }),
  );
  await from.fill("2026-10-08");
  await to.fill("2026-10-08");
  await expect(month).toHaveValue("");
  await expect(
    page.getByText("Período personalizado de hasta 3 años", { exact: true }),
  ).toBeVisible();
  await capture("finance-period-partial-current-month", {
    month: "",
    from: "2026-10-08",
    to: "2026-10-08",
  });

  await from.fill("2024-02-01");
  await to.fill("2024-02-29");
  await expect(month).toHaveValue("2024-02");
  await expect(page.getByText("US12 febrero", { exact: true })).toBeVisible();
  await expect(page.getByText("US12 marzo", { exact: true })).toHaveCount(0);
  await capture("finance-period-manual-full-leap-month", {
    month: "2024-02",
    from: "2024-02-01",
    to: "2024-02-29",
  });

  await to.fill("2024-03-01");
  await expect(month).toHaveValue("");
  await expect(page.getByText("US12 febrero", { exact: true })).toBeVisible();
  await expect(page.getByText("US12 marzo", { exact: true })).toBeVisible();
  await capture("finance-period-cross-month", {
    month: "",
    from: "2024-02-01",
    to: "2024-03-01",
  });

  await month.fill("2024-02");
  await expect(from).toHaveValue("2024-02-01");
  await expect(to).toHaveValue("2024-02-29");
  const realReport = await page.evaluate(() =>
    window.gastronomy.getFinanceReport({
      from: "2024-02-01",
      to: "2024-02-29",
    }),
  );
  expect(realReport.from).toBe("2024-02-01");
  expect(realReport.to).toBe("2024-02-29");
  expect(realReport.expensesMinor).toBe(12345);
  await expect(page.getByText("US12 febrero", { exact: true })).toBeVisible();
  await expect(page.getByText("US12 marzo", { exact: true })).toHaveCount(0);
  await capture("finance-period-month-selection-api", {
    month: "2024-02",
    from: "2024-02-01",
    to: "2024-02-29",
    report: realReport,
  });
});

test("rango inválido conserva el error sin mutar datos y controles siguen accesibles a 1100/1366 y 200%", async () => {
  const baseline = await page.evaluate(async () => ({
    bootstrap: await window.gastronomy.bootstrap(),
    report: await window.gastronomy.getFinanceReport({
      from: "2026-10-01",
      to: "2026-10-08",
    }),
  }));
  await page.getByRole("link", { name: "Finanzas", exact: true }).click();
  const from = page.getByLabel("Desde", { exact: true });
  const to = page.getByLabel("Hasta", { exact: true });
  for (const width of [1100, 1366]) {
    await app.evaluate(
      ({ BrowserWindow }, width) =>
        BrowserWindow.getAllWindows()[0]!.setSize(width, 820),
      width,
    );
    await expect(page.getByLabel("Mes", { exact: true })).toBeVisible();
    await expect(from).toBeVisible();
    await expect(to).toBeVisible();
    await expect(from).toBeInViewport();
    await expect(to).toBeInViewport();
    await capture(`finance-period-controls-${width}`, { width });
  }
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]!.setSize(1100, 820);
    BrowserWindow.getAllWindows()[0]!.webContents.setZoomFactor(2);
  });
  for (const control of [page.getByLabel("Mes", { exact: true }), from, to]) {
    await control.scrollIntoViewIfNeeded();
    await expect(control).toBeInViewport();
  }
  await capture("finance-period-controls-zoom-200", { zoom: 2 });
  await from.fill("2026-10-09");
  await to.fill("2026-10-08");
  await expect(page.getByRole("alert")).toContainText(
    "Elegí un período válido de hasta tres años.",
  );
  expect(
    await page.evaluate(async () => ({
      bootstrap: await window.gastronomy.bootstrap(),
      report: await window.gastronomy.getFinanceReport({
        from: "2026-10-01",
        to: "2026-10-08",
      }),
    })),
  ).toEqual(baseline);
  await capture("finance-period-invalid-range-preserves-data", {
    invalidRange: true,
    baseline,
  });
});
