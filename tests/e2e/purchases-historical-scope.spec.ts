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
  "docs/qa/evidence/system-usability-purchases-history-fix-2026-10-08",
);
let app: ElectronApplication;
let page: Page;
let profile = "";

test.beforeEach(async () => {
  await mkdir(evidence, { recursive: true });
  profile = await mkdtemp(join(tmpdir(), "gastronomy-purchases-history-"));
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
      !basename(profile).startsWith("gastronomy-purchases-history-")
    )
      throw new Error("Unsafe disposable purchases profile cleanup");
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

test("el costo histórico incluye todas las compras y su rótulo cabe en anchos y zoom de escritorio", async () => {
  test.setTimeout(90_000);
  const seeded = await page.evaluate(async () => {
    const product = (await window.gastronomy.bootstrap()).products.find(
      (item) => item.active,
    )!;
    for (const [invoiceNumber, unitCostMinor] of [
      ["US13-HISTORY-1", 11_000],
      ["US13-HISTORY-2", 25_000],
    ] as const) {
      await window.gastronomy.createPurchase({
        idempotencyKey: `us13-${invoiceNumber}`,
        supplierName: "Proveedor historial US13",
        invoiceNumber,
        authorizerPin: "1234",
        items: [{ productId: product.id, quantityMinor: 1_000, unitCostMinor }],
      });
    }
    return {
      purchases: await window.gastronomy.listPurchases(),
      expectedTotalMinor: 36_000,
    };
  });
  await page.getByRole("link", { name: "Compras", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: /Compras e ingresos/i }),
  ).toBeVisible();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]!.setSize(1100, 820),
  );
  const initialText = await page.locator("body").innerText();
  await capture("purchases-history-caption-initial", {
    width: 1100,
    initialText,
    seeded,
  });
  await expect(page.getByText("US13-HISTORY-1", { exact: true })).toBeVisible();
  const caption = page.getByText("Costo histórico de compras", { exact: true });
  await expect(caption).toBeVisible();
  await expect(caption.locator("..")).toContainText(/\$\s*360/);
  const states: unknown[] = [];
  for (const width of [1100, 1366]) {
    await app.evaluate(
      ({ BrowserWindow }, width) =>
        BrowserWindow.getAllWindows()[0]!.setSize(width, 820),
      width,
    );
    const card = caption.locator("..");
    const layout = await caption.evaluate((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return {
        text: element.textContent,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        rectWidth: rect.width,
        overflow: style.overflow,
        textOverflow: style.textOverflow,
        whiteSpace: style.whiteSpace,
      };
    });
    states.push({ width, layout });
    await capture(`purchases-history-caption-${width}`, {
      width,
      layout,
      seeded,
    });
    await expect(card).toContainText("Costo histórico de compras");
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
    expect(layout.textOverflow).not.toBe("ellipsis");
  }
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]!.setSize(1100, 820);
    BrowserWindow.getAllWindows()[0]!.webContents.setZoomFactor(2);
  });
  await caption.scrollIntoViewIfNeeded();
  const zoomLayout = await caption.evaluate((element) => ({
    text: element.textContent,
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    zoom: window.devicePixelRatio,
    visible: element.getBoundingClientRect().width > 0,
  }));
  await capture("purchases-history-caption-zoom-200", {
    zoom: 2,
    zoomLayout,
    seeded,
  });
  expect(zoomLayout.text).toBe("Costo histórico de compras");
  expect(zoomLayout.visible).toBe(true);
  await expect(caption).toBeInViewport();
  expect(zoomLayout.scrollWidth).toBeLessThanOrEqual(zoomLayout.clientWidth);
  expect(states).toHaveLength(2);
});

test("el informe financiero del período no incorpora compras fuera de sus fechas", async () => {
  test.setTimeout(90_000);
  const setup = await page.evaluate(async () => {
    const product = (await window.gastronomy.bootstrap()).products.find(
      (item) => item.active,
    )!;
    await window.gastronomy.createPurchase({
      idempotencyKey: "us13-finance-period-purchase",
      supplierName: "Proveedor período US13",
      invoiceNumber: "US13-PERIOD",
      authorizerPin: "1234",
      items: [
        { productId: product.id, quantityMinor: 1_000, unitCostMinor: 57_000 },
      ],
    });
    const purchases = await window.gastronomy.listPurchases();
    const historyTotalMinor = purchases.reduce(
      (sum, purchase) => sum + purchase.totalMinor,
      0,
    );
    const priorPeriod = await window.gastronomy.getFinanceReport({
      from: "2024-02-01",
      to: "2024-02-29",
    });
    return {
      purchase: purchases[0]!,
      productId: product.id,
      historyTotalMinor,
      priorPeriod,
    };
  });
  await page.getByRole("link", { name: "Finanzas", exact: true }).click();
  const from = page.getByLabel("Desde", { exact: true });
  const to = page.getByLabel("Hasta", { exact: true });
  await from.fill("2024-02-01");
  await to.fill("2024-02-29");
  const selectedPeriodReport = await page.evaluate(() =>
    window.gastronomy.getFinanceReport({
      from: "2024-02-01",
      to: "2024-02-29",
    }),
  );
  await capture("purchases-history-finance-period-excludes-current-purchase", {
    range: { from: "2024-02-01", to: "2024-02-29" },
    setup,
    selectedPeriodReport,
  });
  expect(selectedPeriodReport.from).toBe("2024-02-01");
  expect(selectedPeriodReport.to).toBe("2024-02-29");
  expect(selectedPeriodReport.purchasesMinor).toBe(0);
  expect(selectedPeriodReport.productCosts).toEqual(
    setup.priorPeriod.productCosts,
  );
  expect(setup.historyTotalMinor).toBe(57000);
  await expect(page.getByText(/Compras de inventario: \$\s*0/)).toBeVisible();
  await page.getByRole("link", { name: "Compras", exact: true }).click();
  await expect(page.getByText("US13-PERIOD", { exact: true })).toBeVisible();
  const historicCard = page
    .getByText("Costo histórico de compras", { exact: true })
    .locator("..");
  await expect(historicCard).toContainText(/\$\s*570/);
  const baseline = await page.evaluate(async () => ({
    boot: await window.gastronomy.bootstrap(),
    purchases: await window.gastronomy.listPurchases(),
  }));
  await page
    .getByRole("button", { name: "Registrar ingreso", exact: true })
    .click();
  const modal = page.getByRole("dialog", {
    name: "Registrar ingreso",
    exact: true,
  });
  await modal
    .getByLabel("Proveedor", { exact: true })
    .fill("US13 cancelar recepción");
  await modal.getByRole("button", { name: "Cancelar", exact: true }).click();
  expect(
    await page.evaluate(async () => ({
      boot: await window.gastronomy.bootstrap(),
      purchases: await window.gastronomy.listPurchases(),
    })),
  ).toEqual(baseline);
  await page
    .getByRole("button", { name: "Registrar ingreso", exact: true })
    .click();
  await modal
    .getByLabel("Proveedor", { exact: true })
    .fill("US13 recepción confirmada");
  await modal
    .getByLabel("Comprobante", { exact: true })
    .fill("US13-UI-RECEIPT");
  await modal.getByLabel("Producto").selectOption(setup.productId);
  await modal.getByLabel("Cantidad", { exact: true }).fill("2,5");
  await modal.getByLabel("Costo unit.", { exact: true }).fill("100");
  await modal.getByLabel("PIN autorizador").fill("1234");
  await modal
    .getByRole("button", { name: "Confirmar ingreso", exact: true })
    .click();
  await expect(modal).toBeHidden();
  await expect(
    page.getByText("US13-UI-RECEIPT", { exact: true }),
  ).toBeVisible();
  const after = await page.evaluate(async () => ({
    boot: await window.gastronomy.bootstrap(),
    purchases: await window.gastronomy.listPurchases(),
    costs: await window.gastronomy.getFinanceProductCosts(),
  }));
  expect(after.purchases).toHaveLength(baseline.purchases.length + 1);
  expect(
    after.purchases.find((p) => p.invoiceNumber === "US13-UI-RECEIPT")!
      .totalMinor,
  ).toBe(25000);
  const previousStock =
    baseline.boot.products.find((p) => p.id === setup.productId)!.stockMinor ??
    0;
  expect(
    after.boot.products.find((p) => p.id === setup.productId)!.stockMinor,
  ).toBe(previousStock + 2500);
  expect(
    after.costs.find((c) => c.productId === setup.productId),
  ).toMatchObject({ unitCostMinor: 10000, source: "PURCHASE" });
  await expect(historicCard).toContainText(/\$\s*820/);
  await capture("purchases-history-receiving-preserved", {
    cancelNoMutation: true,
    baseline,
    after,
  });
});
