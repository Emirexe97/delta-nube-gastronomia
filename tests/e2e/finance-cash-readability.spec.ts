import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Locator,
  type Page,
} from "@playwright/test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { formatMoney } from "../../packages/domain/src/money";

const out = join(
  process.cwd(),
  "docs/qa/evidence/system-usability-us07b1-fix-2026-10-07",
);
let app: ElectronApplication;
let page: Page;
let profile = "";

async function stableScreenshot(file: string) {
  await page.evaluate(async () => {
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
  await page.screenshot({ path: file, fullPage: true });
}

test.beforeEach(async () => {
  await mkdir(out, { recursive: true });
  profile = await mkdtemp(join(tmpdir(), "gastronomy-us07b1-readability-"));
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
      !basename(profile).startsWith("gastronomy-us07b1-readability-")
    )
      throw new Error("Unsafe disposable profile cleanup");
    await rm(profile, { recursive: true, force: true });
    profile = "";
  }
});

async function measure(elements: Locator) {
  return elements.evaluateAll((nodes) => {
    const luminance = (color: string) => {
      const channels =
        color
          .match(/[\d.]+/g)
          ?.slice(0, 3)
          .map(Number) ?? [];
      if (channels.length !== 3) return null;
      return channels
        .map((channel) => {
          const value = channel / 255;
          return value <= 0.04045
            ? value / 12.92
            : ((value + 0.055) / 1.055) ** 2.4;
        })
        .reduce(
          (sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index]!,
          0,
        );
    };
    const backgroundOf = (node: Element) => {
      for (
        let current: Element | null = node;
        current;
        current = current.parentElement
      ) {
        const background = getComputedStyle(current).backgroundColor;
        const alpha = background.match(
          /rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)/,
        )?.[1];
        if (
          background !== "rgba(0, 0, 0, 0)" &&
          (alpha === undefined || Number(alpha) >= 0.999)
        )
          return background;
      }
      return "rgb(255, 255, 255)";
    };
    return nodes
      .filter((node) => {
        const text = node.textContent?.trim();
        const box = node.getBoundingClientRect();
        const badge = node.matches("span.inline-flex.rounded-md");
        const disabled = node.closest(":disabled,[aria-disabled='true']");
        let faded = false;
        for (
          let current: Element | null = node;
          current;
          current = current.parentElement
        )
          if (Number(getComputedStyle(current).opacity) < 0.999) faded = true;
        return (
          Boolean(text) &&
          !badge &&
          !disabled &&
          !faded &&
          box.width > 0 &&
          box.height > 0
        );
      })
      .map((node) => {
        const style = getComputedStyle(node);
        const foreground = luminance(style.color);
        const background = backgroundOf(node);
        const backLum = luminance(background);
        return {
          text: node.textContent?.trim().replace(/\s+/g, " "),
          fontSize: Number.parseFloat(style.fontSize),
          fontWeight: Number.parseInt(style.fontWeight, 10),
          color: style.color,
          background,
          contrast:
            foreground === null || backLum === null
              ? null
              : (Math.max(foreground, backLum) + 0.05) /
                (Math.min(foreground, backLum) + 0.05),
        };
      });
  });
}

async function assertReadable(locator: Locator, label: string) {
  await page.evaluate(async () => {
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
  const values = await measure(locator);
  expect(values.length, `${label} has visible measured labels`).toBeGreaterThan(
    0,
  );
  for (const value of values) {
    expect(
      value.fontSize,
      `${label} font size: ${value.text}`,
    ).toBeGreaterThanOrEqual(12);
    expect(value.contrast, `${label} contrast: ${value.text}`).not.toBeNull();
    const largeBold =
      value.fontSize >= 24 ||
      (value.fontSize >= 18.67 && value.fontWeight >= 700);
    expect(
      value.contrast!,
      `${label} contrast: ${value.text}`,
    ).toBeGreaterThanOrEqual(largeBold ? 3 : 4.5);
  }
  return values;
}

async function assertFits(card: Locator) {
  const result = await card.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return [...element.querySelectorAll("p")].map((paragraph) => {
      const range = document.createRange();
      range.selectNodeContents(paragraph);
      const ink = range.getBoundingClientRect();
      return {
        text: paragraph.textContent,
        fits:
          ink.left >= bounds.left - 1 &&
          ink.right <= bounds.right + 1 &&
          ink.top >= bounds.top - 1 &&
          ink.bottom <= bounds.bottom + 1,
      };
    });
  });
  for (const item of result)
    expect(item.fits, `card text remains complete: ${item.text}`).toBe(true);
  return result;
}

for (const width of [1100, 1366]) {
  for (const scenario of [
    "unknown-cost-positive",
    "explicit-expense-negative",
  ] as const) {
    test(`Finanzas conserva etiquetas legibles y resultado ${scenario} a ${width}px`, async () => {
      await app.evaluate(
        ({ BrowserWindow }, width) =>
          BrowserWindow.getAllWindows()[0]!.setSize(width, 820),
        width,
      );
      const fixture = await page.evaluate(async (scenario) => {
        const api = window.gastronomy;
        await api.openCashSession({ openingAmountMinor: 0 });
        const initial = await api.bootstrap();
        const date = initial.cashSession!.businessDate;
        if (scenario === "unknown-cost-positive") {
          const product = initial.products.find(
            (item) => item.code === "MUZG",
          )!;
          const knownProduct = initial.products.find(
            (item) => item.code === "NAPG",
          )!;
          await api.setFinanceProductCost({
            productId: knownProduct.id,
            unitCostMinor: 10_000,
          });
          const order = await api.createOrder({
            type: "TAKEAWAY",
            customerName: "US07B1 costo desconocido",
            customerPhone: "1155000710",
          });
          await api.addOrderItem({ orderId: order.id, productId: product.id });
          await api.addOrderItem({
            orderId: order.id,
            productId: knownProduct.id,
          });
          const confirmed = await api.confirmOrder({ orderId: order.id });
          await api.payOrder({
            orderId: confirmed.id,
            collectedByDriver: false,
            payments: [
              { methodCode: "CASH", amountMinor: confirmed.totalMinor },
            ],
          });
        } else {
          await api.createFinanceExpense({
            title: "US07B1 gasto explícito",
            category: "Prueba aislada",
            kind: "GENERAL",
            amountMinor: 500_000,
            incurredOn: date,
            dueOn: date,
            idempotencyKey: crypto.randomUUID(),
          });
        }
        const report = await api.getFinanceReport({ from: date, to: date });
        const cash = await api.bootstrap();
        const cashReport = await api.getCashSessionReport({
          cashSessionId: cash.cashSession!.id,
        });
        return { date, report, cash, cashReport };
      }, scenario);
      if (scenario === "unknown-cost-positive") {
        expect(fixture.report.unknownCostItems).toBeGreaterThan(0);
        expect(fixture.report.costedItems).toBeGreaterThan(0);
        expect(fixture.report.salesMinor).toBeGreaterThan(0);
        expect(fixture.report.estimatedOperatingProfitMinor).toBeGreaterThan(0);
      } else {
        expect(fixture.report.estimatedOperatingProfitMinor).toBe(-500_000);
      }

      await page.reload();
      await page.getByRole("link", { name: "Finanzas", exact: true }).click();
      await page.getByLabel("Desde", { exact: true }).fill(fixture.date);
      await page.getByLabel("Hasta", { exact: true }).fill(fixture.date);
      await expect(
        page.getByText("Resultado operativo estimado", { exact: true }),
      ).toBeVisible();
      if (scenario === "unknown-cost-positive")
        await expect(
          page.getByText(/Hay ventas de productos sin costo cargado/).first(),
        ).toBeVisible();
      const financeRoot = page.locator("main div.space-y-5.pb-8");
      const labels = financeRoot.locator("p, span, td, th, strong, label, h2");
      const measurements = await assertReadable(labels, `finanzas ${scenario}`);
      const metricLayout = [];
      for (const card of await financeRoot
        .locator("section")
        .first()
        .locator(":scope > div")
        .all())
        metricLayout.push(await assertFits(card));
      const profitCard = page
        .getByText("Resultado operativo estimado", { exact: true })
        .locator("..");
      await expect(profitCard.locator("p").nth(1)).toHaveText(
        formatMoney(fixture.report.estimatedOperatingProfitMinor),
      );
      if (scenario === "unknown-cost-positive")
        await expect(
          page.getByText(/Hay ventas de productos sin costo cargado/).first(),
        ).toBeVisible();
      await stableScreenshot(join(out, `finance-${scenario}-${width}.png`));
      const stateUnchangedAfterNavigation = await page.evaluate(
        async ({ date, original, cash, cashReport }) => {
          const [currentReport, currentCash, currentCashReport] =
            await Promise.all([
              window.gastronomy.getFinanceReport({ from: date, to: date }),
              window.gastronomy.bootstrap(),
              window.gastronomy.getCashSessionReport({
                cashSessionId: cash.cashSession!.id,
              }),
            ]);
          return (
            JSON.stringify(currentReport) === JSON.stringify(original) &&
            JSON.stringify(currentCash) === JSON.stringify(cash) &&
            JSON.stringify(currentCashReport) === JSON.stringify(cashReport)
          );
        },
        {
          date: fixture.date,
          original: fixture.report,
          cash: fixture.cash,
          cashReport: fixture.cashReport,
        },
      );
      expect(
        stateUnchangedAfterNavigation,
        "report/bootstrap/cash are unchanged after navigation",
      ).toBe(true);
      await writeFile(
        join(out, `finance-${scenario}-${width}.json`),
        JSON.stringify(
          {
            width,
            scenario,
            profitMinor: fixture.report.estimatedOperatingProfitMinor,
            unknownCostItems: fixture.report.unknownCostItems,
            measurements,
            metricLayout,
            stateUnchangedAfterNavigation,
            realElectronSqliteAndIpc: true,
          },
          null,
          2,
        ),
      );
    });
  }
}

for (const width of [1100, 1366])
  test(`Caja, revisión cancelada e informe mantienen lectura del arqueo y no mutan datos a ${width}px`, async () => {
    await app.evaluate(
      ({ BrowserWindow }, width) =>
        BrowserWindow.getAllWindows()[0]!.setSize(width, 820),
      width,
    );
    expect(
      await app.evaluate(
        ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getSize()[0],
      ),
    ).toBe(width);
    const fixture = await page.evaluate(async () => {
      const api = window.gastronomy;
      const session = await api.openCashSession({
        openingAmountMinor: 100_000,
      });
      await api.registerCashMovement({
        type: "INCOME",
        amountMinor: 500_000,
        reason: "US07B1 lectura caja",
        paymentMethodCode: "CASH",
        idempotencyKey: crypto.randomUUID(),
      });
      return {
        sessionId: session.id,
        report: await api.getCashSessionReport({ cashSessionId: session.id }),
      };
    });
    const gross = fixture.report.session.expectedAmountMinor;
    const net = gross - fixture.report.session.openingAmountMinor;
    await page.reload();
    await page.getByRole("link", { name: "Caja", exact: true }).click();
    const grossCard = page
      .getByText("Efectivo esperado en caja", { exact: true })
      .locator("..");
    await expect(grossCard).toContainText(formatMoney(gross));
    await expect(grossCard).toContainText(/Incluye el cambio inicial/);
    await expect(
      page
        .getByText("Esperado sin cambio", { exact: true })
        .first()
        .locator(".."),
    ).toContainText(formatMoney(net));
    await expect(
      page.getByText("Ingreso, gasto, retiro o ajuste con motivo", {
        exact: true,
      }),
    ).toBeVisible();
    const openMeasurements = await assertReadable(
      page
        .locator("main .panel-enter")
        .locator("p, span, td, th, strong, label, h2"),
      "caja secondary text including movement labels",
    );
    await assertFits(grossCard);
    await stableScreenshot(join(out, `cash-open-${width}.png`));

    await page.getByRole("button", { name: /Conciliar y cerrar caja/ }).click();
    const form = page.getByRole("dialog", {
      name: "Conciliar y cerrar caja",
      exact: true,
    });
    await form.getByLabel("Total contado en caja").fill("5900");
    const closingFloat = form.getByLabel("Cambio final para la próxima caja");
    await closingFloat.click();
    await closingFloat.press("End");
    const length = (await closingFloat.inputValue()).length;
    for (let i = 0; i < length; i++) await closingFloat.press("Backspace");
    await expect(closingFloat).toHaveValue("");
    await closingFloat.pressSequentially("2000");
    await expect(closingFloat).toHaveValue("2000");
    await form
      .getByLabel("Motivo de la diferencia")
      .fill("US07B1 diferencia esperada");
    const closingNet = 600_000 - 200_000;
    await expect(
      form.getByText("Esperado sin cambio", { exact: true }).locator(".."),
    ).toContainText(formatMoney(closingNet));
    await form
      .getByRole("button", { name: "Revisar cierre", exact: true })
      .click();
    const review = page.getByRole("dialog", {
      name: "Confirmar cierre definitivo",
      exact: true,
    });
    for (const [label, amount] of [
      ["Esperado sin cambio", closingNet],
      ["Contado sin cambio", 390_000],
      ["Diferencia de arqueo", -10_000],
    ] as const)
      await expect(
        review.getByText(label, { exact: true }).locator(".."),
      ).toContainText(formatMoney(amount));
    const lightValue = review
      .getByText("Diferencia de arqueo", { exact: true })
      .locator("..");
    const darkValue = review
      .getByText("Efectivo a retirar", { exact: true })
      .locator("..");
    const lightMeasurements = await assertReadable(
      lightValue.locator("p"),
      "review light value",
    );
    const darkMeasurements = await assertReadable(
      darkValue.locator("p"),
      "review dark value",
    );
    await assertFits(lightValue);
    await assertFits(darkValue);
    const dangerColor = await lightValue
      .locator("p")
      .last()
      .evaluate((element) => getComputedStyle(element).color);
    expect(
      dangerColor,
      "negative difference remains visually marked as danger",
    ).not.toBe("rgb(15, 23, 42)");
    await stableScreenshot(join(out, `cash-review-${width}.png`));
    await review
      .getByRole("button", { name: "Volver a revisar", exact: true })
      .click();
    await form.getByRole("button", { name: "Cancelar", exact: true }).click();
    expect(
      await page.evaluate(
        (id) => window.gastronomy.getCashSessionReport({ cashSessionId: id }),
        fixture.sessionId,
      ),
    ).toEqual(fixture.report);

    // Close through the real IPC fixture only after proving that review cancellation is read-only.
    const closed = await page.evaluate(
      (id) =>
        window.gastronomy.closeCashSession({
          countedAmountMinor: 590_000,
          closingFloatAmountMinor: 200_000,
          reason: "US07B1 informe legible",
          idempotencyKey: crypto.randomUUID(),
        }),
      fixture.sessionId,
    );
    const closedReport = await page.evaluate(
      (id) => window.gastronomy.getCashSessionReport({ cashSessionId: id }),
      fixture.sessionId,
    );
    await page.reload();
    await page.getByRole("link", { name: "Caja", exact: true }).click();
    await page
      .getByRole("button", { name: "Ver informe", exact: true })
      .click();
    const reportDialog = page.getByRole("dialog", { name: /Informe de caja/ });
    await expect(
      reportDialog
        .getByText("Esperado sin cambio", { exact: true })
        .locator(".."),
    ).toContainText(formatMoney(closingNet));
    const reportLabels = reportDialog.locator(
      "p, span, td, th, strong, label, h2",
    );
    const reportMeasurements = await assertReadable(
      reportLabels,
      "cash session report modal",
    );
    expect(
      await page.evaluate(
        (id) => window.gastronomy.getCashSessionReport({ cashSessionId: id }),
        fixture.sessionId,
      ),
    ).toEqual(closedReport);
    await stableScreenshot(join(out, `cash-report-${width}.png`));
    await writeFile(
      join(out, `cash-session-evidence-${width}.json`),
      JSON.stringify(
        {
          width,
          openMeasurements,
          lightMeasurements,
          darkMeasurements,
          gross,
          net,
          closingNet,
          closedSession: closed,
          measurements: reportMeasurements,
          cancellationPreservedReport: true,
          realElectronSqliteAndIpc: true,
        },
        null,
        2,
      ),
    );
  });
