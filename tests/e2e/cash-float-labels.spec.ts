import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { formatMoney } from "../../packages/domain/src/money";

const out = join(
  process.cwd(),
  "docs/qa/evidence/system-usability-us04-fix-2026-10-06",
);
let app: ElectronApplication;
let page: Page;
let profile = "";
test.beforeEach(async () => {
  await mkdir(out, { recursive: true });
  profile = await mkdtemp(join(tmpdir(), "gastronomy-us04-float-labels-"));
  app = await electron.launch({
    args: ["apps/desktop-shell", `--user-data-dir=${profile}`],
    cwd: process.cwd(),
  });
  page = await app.firstWindow();
  await expect(page.getByText("Delta Nube", { exact: true })).toBeVisible();
  expect(
    resolve(await app.evaluate(({ app }) => app.getPath("userData"))),
  ).toBe(resolve(profile));
});
test.afterEach(async () => {
  await app?.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().forEach((window) => window.destroy()),
  );
  await app?.close();
  if (profile) {
    if (
      dirname(resolve(profile)) !== resolve(tmpdir()) ||
      !basename(profile).startsWith("gastronomy-us04-float-labels-")
    )
      throw new Error("Unsafe profile cleanup");
    await rm(profile, { recursive: true, force: true });
  }
});

for (const width of [1280, 1100, 1366]) {
  for (const state of ["with-float", "zero-float", "negative-net"] as const) {
    test(`cash labels ${state} at ${width}px`, async () => {
      await app.evaluate(
        ({ BrowserWindow }, width) =>
          BrowserWindow.getAllWindows()[0]!.setSize(width, 820),
        width,
      );
      const fixture = await page.evaluate(async (state) => {
        const api = window.gastronomy;
        const session = await api.openCashSession({
          openingAmountMinor: state === "zero-float" ? 0 : 5_000_000,
        });
        await api.registerCashMovement({
          type: state === "negative-net" ? "WITHDRAWAL" : "INCOME",
          amountMinor: state === "negative-net" ? 600_000 : 2_350_000,
          reason: "US04 aislado",
          paymentMethodCode: "CASH",
          idempotencyKey: crypto.randomUUID(),
        });
        const data = await api.bootstrap();
        return {
          sessionId: session.id,
          session: data.cashSession!,
          report: await api.getCashSessionReport({ cashSessionId: session.id }),
          dashboard: await api.getDashboard(),
        };
      }, state);
      const gross = fixture.session.expectedAmountMinor;
      const net = gross - fixture.session.openingAmountMinor;
      expect(gross).toBe(
        state === "with-float"
          ? 7_350_000
          : state === "zero-float"
            ? 2_350_000
            : 4_400_000,
      );
      expect(net).toBe(state === "negative-net" ? -600_000 : 2_350_000);
      await page.reload();
      await page.getByRole("link", { name: "Resumen", exact: true }).click();
      const summary = page
        .getByText("Efectivo esperado", { exact: true })
        .locator("..");
      await expect(summary).toContainText(formatMoney(gross));
      await expect(summary).toContainText("Incluye el cambio inicial");
      await summary.screenshot({
        path: join(out, `${state}-${width}-summary.png`),
      });
      expect(
        await summary
          .locator("p")
          .evaluateAll((paragraphs) =>
            paragraphs.every((p) => p.scrollWidth <= p.clientWidth + 1),
          ),
      ).toBe(true);
      await page.getByRole("link", { name: "Caja", exact: true }).click();
      await expect(page.locator(".panel-enter")).toHaveCSS("opacity", "1");
      const cashHeader = page
        .getByText("Efectivo esperado en caja", { exact: true })
        .locator("..");
      await expect(cashHeader).toContainText(formatMoney(gross));
      await expect(cashHeader).toContainText("Incluye el cambio inicial");
      const breakdown = page
        .getByText("Esperado sin cambio", { exact: true })
        .locator("..");
      await expect(breakdown).toContainText(formatMoney(net));
      await expect(
        page.getByText("Descontado el cambio a dejar", { exact: true }),
      ).toBeVisible();
      await page.screenshot({
        path: join(out, `${state}-${width}-cash.png`),
        fullPage: true,
      });
      const after = await page.evaluate(
        async (sessionId) => ({
          report: await window.gastronomy.getCashSessionReport({
            cashSessionId: sessionId,
          }),
          dashboard: await window.gastronomy.getDashboard(),
        }),
        fixture.sessionId,
      );
      expect(after.report).toEqual(fixture.report);
      expect(after.dashboard).toEqual(fixture.dashboard);
      await writeFile(
        join(out, `${state}-${width}.json`),
        JSON.stringify(
          { gross, net, unchanged: true, realSqliteAndIpc: true },
          null,
          2,
        ),
      );
    });
  }
}

test("sin caja abierta no muestra aclaración de fondo ni inventa importes", async () => {
  await page.getByRole("link", { name: "Resumen", exact: true }).click();
  const summary = page
    .getByText("Efectivo esperado", { exact: true })
    .locator("..");
  await expect(summary).toContainText("—");
  await expect(summary).not.toContainText("Incluye el cambio inicial");
});

test("la revisión resta el cambio final elegido, no siempre el inicial", async () => {
  const fixture = await page.evaluate(async () => {
    const api = window.gastronomy;
    const session = await api.openCashSession({ openingAmountMinor: 100_000 });
    await api.registerCashMovement({
      type: "INCOME",
      amountMinor: 500_000,
      reason: "US04 cierre",
      paymentMethodCode: "CASH",
    });
    return {
      sessionId: session.id,
      report: await api.getCashSessionReport({ cashSessionId: session.id }),
    };
  });
  await page.reload();
  await page.getByRole("link", { name: "Caja", exact: true }).click();
  await page.getByRole("button", { name: /Conciliar y cerrar caja/ }).click();
  const dialog = page.getByRole("dialog", {
    name: "Conciliar y cerrar caja",
    exact: true,
  });
  await dialog.getByLabel("Total contado en caja").fill("6000");
  const input = dialog.getByLabel("Cambio final para la próxima caja");
  for (const float of [0, 2000]) {
    await input.click();
    await input.press("End");
    const length = (await input.inputValue()).length;
    for (let n = 0; n < length; n++) await input.press("Backspace");
    await expect(input).toHaveValue("");
    await input.pressSequentially(String(float));
    await expect(input).toHaveValue(String(float));
    await expect(
      dialog.getByText("Esperado sin cambio", { exact: true }).locator(".."),
    ).toContainText(formatMoney(600_000 - float * 100));
    await dialog
      .getByRole("button", { name: "Revisar cierre", exact: true })
      .click();
    const review = page.getByRole("dialog", {
      name: "Confirmar cierre definitivo",
      exact: true,
    });
    for (const label of ["Esperado sin cambio", "Contado sin cambio"])
      await expect(
        review.getByText(label, { exact: true }).locator(".."),
      ).toContainText(formatMoney(600_000 - float * 100));
    await expect(
      review.getByText("Diferencia de arqueo", { exact: true }).locator(".."),
    ).toContainText(formatMoney(0));
    await review
      .getByRole("button", { name: "Volver a revisar", exact: true })
      .click();
  }
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
  expect(
    await page.evaluate(
      (sessionId) =>
        window.gastronomy.getCashSessionReport({ cashSessionId: sessionId }),
      fixture.sessionId,
    ),
  ).toEqual(fixture.report);
});

for (const paperWidth of ["58mm", "80mm"] as const) {
  test(`etiquetas de informe y ticket sin cambio en ${paperWidth}`, async () => {
    await app.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows())
        window.webContents.getPrintersAsync = async () => [];
    });
    const fixture = await page.evaluate(async (paperWidth) => {
      const api = window.gastronomy;
      const data = await api.bootstrap();
      await api.saveSettings({
        ...data.settings,
        printing: {
          ...data.settings.printing,
          bill: {
            ...data.settings.printing.bill,
            paperWidth,
            mode: "SYSTEM_DIALOG",
          },
        },
      });
      const session = await api.openCashSession({
        openingAmountMinor: 100_000,
      });
      await api.registerCashMovement({
        type: "INCOME",
        amountMinor: 500_000,
        reason: "US04 ticket",
        paymentMethodCode: "CASH",
      });
      await api.closeCashSession({
        countedAmountMinor: 590_000,
        closingFloatAmountMinor: 150_000,
        reason: "US04 diferencia aislada",
      });
      return {
        sessionId: session.id,
        report: await api.getCashSessionReport({ cashSessionId: session.id }),
      };
    }, paperWidth);
    expect(fixture.report.session.expectedAmountMinor).toBe(600_000);
    expect(fixture.report.session.countedAmountMinor).toBe(590_000);
    expect(fixture.report.session.differenceMinor).toBe(-10_000);
    await page.reload();
    await page.getByRole("link", { name: "Caja", exact: true }).click();
    await page
      .getByRole("button", { name: "Ver informe", exact: true })
      .click();
    const report = page.getByRole("dialog", {
      name: "Informe de caja",
      exact: true,
    });
    await expect(
      report.getByText("Esperado sin cambio", { exact: true }).locator(".."),
    ).toContainText(formatMoney(450_000));
    await expect(
      report.getByText("Contado sin cambio", { exact: true }).locator(".."),
    ).toContainText(formatMoney(440_000));
    await report
      .getByRole("button", { name: "Imprimir informe", exact: true })
      .click();
    const print = page.getByRole("dialog", {
      name: "Imprimir informe de caja",
      exact: true,
    });
    await expect(
      print.getByText("Esperado sin cambio", { exact: true }).locator(".."),
    ).toContainText(formatMoney(450_000));
    await print
      .getByRole("button", { name: "Imprimir ticket", exact: true })
      .click();
    await expect
      .poll(
        () =>
          app
            .windows()
            .filter((window) => window.url().includes("print-preview-controls"))
            .length,
      )
      .toBe(1);
    const preview = app
      .windows()
      .find((window) => window.url().includes("print-preview-controls"))!;
    for (const [label, amount] of [
      ["Esperado sin cambio", 450_000],
      ["Contado sin cambio", 440_000],
    ] as const) {
      const row = preview.getByText(label, { exact: true }).locator("..");
      await expect(row).toContainText(formatMoney(amount));
      expect(
        await row.locator("strong").evaluate((element) => {
          const range = document.createRange();
          range.selectNodeContents(element);
          return range.getClientRects().length;
        }),
        `${label} amount stays on one line`,
      ).toBe(1);
      expect(
        await row.evaluate((element) => {
          const row = element.getBoundingClientRect();
          return Array.from(element.children).every((child) => {
            const range = document.createRange();
            range.selectNodeContents(child);
            const ink = range.getBoundingClientRect();
            return ink.left >= row.left - 1 && ink.right <= row.right + 1;
          });
        }),
      ).toBe(true);
    }
    await preview.screenshot({
      path: join(out, `ticket-${paperWidth}.png`),
      fullPage: true,
    });
    await preview
      .getByRole("button", { name: "Cancelar", exact: true })
      .click();
    expect(
      await page.evaluate(
        (sessionId) =>
          window.gastronomy.getCashSessionReport({ cashSessionId: sessionId }),
        fixture.sessionId,
      ),
    ).toEqual(fixture.report);
  });
}
