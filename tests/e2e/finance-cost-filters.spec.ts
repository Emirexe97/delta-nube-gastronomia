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
import { createRequire } from "node:module";
import { formatMoney } from "../../packages/domain/src/money";

const out = join(
  process.cwd(),
  "docs/qa/evidence/system-usability-us03-fix-2026-10-06",
);
let app: ElectronApplication;
let page: Page;
let profile = "";
const nativeModule = createRequire(
  join(process.cwd(), "packages/database/package.json"),
).resolve("better-sqlite3-multiple-ciphers");

test("costo explícito cero es conocido; aviso histórico continúa al completar catálogo", async () => {
  const fixture = await makeConfirmedMuzg(false);
  await page.evaluate(
    async ({ productId }) =>
      window.gastronomy.setFinanceProductCost({ productId, unitCostMinor: 0 }),
    fixture,
  );
  const costs = await page.evaluate(() =>
    window.gastronomy.getFinanceProductCosts(),
  );
  expect(
    costs.find((item) => item.productId === fixture.productId),
  ).toMatchObject({ source: "MANUAL", unitCostMinor: 0 });
  const current = await page.evaluate(
    async ({ date }) =>
      window.gastronomy.getFinanceReport({ from: date, to: date }),
    fixture,
  );
  expect(current.unknownCostItems).toBe(1);
  expect(current.estimatedOperatingProfitMinor).toBe(
    fixture.report.estimatedOperatingProfitMinor,
  );
  await page.reload();
  await page.getByRole("link", { name: "Productos", exact: true }).click();
  await page.getByLabel("Filtrar por costo").selectOption("with");
  await page.getByLabel("Buscar productos").fill("MUZG");
  await expect(
    page.getByLabel("Seleccionar Muzzarella grande", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Filtrar por costo")).toHaveValue("with");
  await page.getByLabel("Filtrar por costo").selectOption("sin");
  await page.getByLabel("Buscar productos").fill("MUZG");
  await expect(
    page.getByText("No hay productos que coincidan con los filtros actuales."),
  ).toBeVisible();
  await page.getByRole("link", { name: "Finanzas", exact: true }).click();
  await expect(
    page
      .getByText("Resultado operativo estimado", { exact: true })
      .locator(".."),
  ).toContainText("Hay ventas de productos sin costo cargado");
});

test("costos con carga/error no se clasifican como desconocidos y permiten reintentar", async () => {
  // Only transport timing/failure is injected; successful values come from actual SQLite/IPC.
  const costs = await page.evaluate(() =>
    window.gastronomy.getFinanceProductCosts(),
  );
  await app.evaluate(({ ipcMain }, costs) => {
    ipcMain.removeHandler("gastronomy:getFinanceProductCosts");
    ipcMain.handle(
      "gastronomy:getFinanceProductCosts",
      () =>
        new Promise((_resolve, reject) => {
          (globalThis as any).__us03Reject = () =>
            reject(new Error("Fallo de lectura de prueba"));
        }),
    );
    (globalThis as any).__us03Costs = costs;
  }, costs);
  await page.evaluate(() => {
    window.location.hash = "#/catalogo?costo=sin";
  });
  await expect(page.getByLabel("Filtrar por costo")).toBeDisabled();
  await expect(page.getByText("Esperando datos de costo…")).toBeVisible();
  await expect(page.getByText(/^\d+ coincidencias?$/)).toHaveCount(0);
  await app.evaluate(() => (globalThis as any).__us03Reject());
  await expect(page.getByRole("alert")).toContainText(
    "No se pudieron cargar los costos",
  );
  await expect(page.getByText(/^\d+ coincidencias?$/)).toHaveCount(0);
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler("gastronomy:getFinanceProductCosts");
    ipcMain.handle(
      "gastronomy:getFinanceProductCosts",
      () => (globalThis as any).__us03Costs,
    );
  });
  await page.getByRole("button", { name: "Reintentar", exact: true }).click();
  await expect(page.getByLabel("Filtrar por costo")).toBeEnabled();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(
    page.getByText(
      `${costs.filter((item) => item.unitCostMinor == null).length} coincidencias`,
      { exact: true },
    ),
  ).toBeVisible();
});

test("sin finance.view no se consultan costos y los otros filtros siguen disponibles", async () => {
  const userId = (await page.evaluate(() => window.gastronomy.bootstrap()))
    .currentUser.id;
  await app.evaluate(
    ({ app, ipcMain }, { nativeModule, userId, profile }) => {
      const path = process.getBuiltinModule("path");
      if (path.resolve(app.getPath("userData")) !== path.resolve(profile))
        throw new Error("Unsafe profile");
      const require = process
        .getBuiltinModule("module")
        .createRequire(nativeModule);
      const Database = require(nativeModule);
      const db = new Database(path.join(profile, "gastronomy.sqlite"));
      try {
        db.prepare(
          "DELETE FROM role_permissions WHERE role_id = (SELECT role_id FROM users WHERE id=?) AND permission_code IN ('finance.view','*')",
        ).run(userId);
      } finally {
        db.close();
      }
      (globalThis as any).__us03ReadCalls = 0;
      ipcMain.removeHandler("gastronomy:getFinanceProductCosts");
      ipcMain.handle("gastronomy:getFinanceProductCosts", () => {
        (globalThis as any).__us03ReadCalls++;
        throw new Error("Read must not be attempted");
      });
    },
    { nativeModule, userId, profile },
  );
  await page.reload();
  await page.getByRole("link", { name: "Productos", exact: true }).click();
  await expect(page.getByLabel("Filtrar por costo")).toBeDisabled();
  await expect(
    page.getByText("Requiere permiso para consultar costos."),
  ).toBeVisible();
  await page.getByLabel("Filtrar por estado").selectOption("active");
  await expect(page.getByLabel("Filtrar por estado")).toHaveValue("active");
  expect(await app.evaluate(() => (globalThis as any).__us03ReadCalls)).toBe(0);
});

test("aviso permanece aunque la cobertura redondeada muestre 100 por ciento", async () => {
  test.setTimeout(60_000);
  const fixture = await page.evaluate(async () => {
    const api = window.gastronomy;
    await api.openCashSession({ openingAmountMinor: 0 });
    const boot = await api.bootstrap();
    const known = boot.products[0]!;
    const unknown = boot.products[1]!;
    await api.setFinanceProductCost({ productId: known.id, unitCostMinor: 0 });
    const order = await api.createOrder({
      type: "TAKEAWAY",
      customerName: "Cobertura redondeada",
      customerPhone: "1155000300",
    });
    for (let n = 0; n < 200; n++)
      await api.addOrderItem({
        orderId: order.id,
        productId: known.id,
        notes: `Línea ${n}`,
      });
    await api.addOrderItem({ orderId: order.id, productId: unknown.id });
    await api.confirmOrder({ orderId: order.id });
    const date = boot.cashSession!.businessDate;
    return {
      date,
      report: await api.getFinanceReport({ from: date, to: date }),
    };
  });
  expect(fixture.report.costedItems).toBe(200);
  expect(fixture.report.unknownCostItems).toBe(1);
  await page.reload();
  await page.getByRole("link", { name: "Finanzas", exact: true }).click();
  await expect(
    page.getByText("Margen bruto estimado", { exact: true }).locator(".."),
  ).toContainText("Cobertura de costos: 100%");
  await expect(
    page
      .getByText("Resultado operativo estimado", { exact: true })
      .locator(".."),
  ).toContainText("Hay ventas de productos sin costo cargado");
});

test("aviso y acceso por teclado siguen utilizables con ampliación 200 por ciento", async () => {
  const fixture = await makeConfirmedMuzg(false);
  await page.reload();
  await page.getByRole("link", { name: "Finanzas", exact: true }).click();
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]!;
    window.setSize(1100, 820);
    window.webContents.setZoomFactor(2);
  });
  expect(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.webContents.getZoomFactor(),
    ),
  ).toBe(2);
  const card = page
    .getByText("Resultado operativo estimado", { exact: true })
    .locator("..");
  await card.evaluate((element) =>
    element.scrollIntoView({ block: "center", behavior: "instant" }),
  );
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(card).toBeInViewport({ ratio: 1 });
  await expect(card.locator("p").nth(1)).toHaveText(
    formatMoney(fixture.report.estimatedOperatingProfitMinor),
  );
  expect(
    await card
      .locator("p")
      .evaluateAll((paragraphs) =>
        paragraphs.every((p) => p.scrollWidth <= p.clientWidth + 1),
      ),
  ).toBe(true);
  await app.evaluate(
    async ({ app, BrowserWindow }, { profile, file }) => {
      const path = process.getBuiltinModule("path");
      if (
        path.resolve(app.getPath("userData")) !== path.resolve(profile) ||
        path.dirname(path.resolve(file)) !==
          path.resolve(
            process.cwd(),
            "docs/qa/evidence/system-usability-us03-fix-2026-10-06",
          )
      )
        throw new Error("Unsafe capture path");
      await process
        .getBuiltinModule("fs")
        .promises.writeFile(
          file,
          (
            await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()
          ).toPNG(),
        );
    },
    { profile, file: join(out, "missing-cost-operating-200.png") },
  );
  const link = card.getByRole("link", {
    name: "Ver productos sin costo",
    exact: true,
  });
  await link.focus();
  await expect(link).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Filtrar por costo")).toHaveValue("sin");
  await expect(page.getByLabel("Filtrar por costo")).toBeEnabled();
  for (const name of [
    "Filtrar por categoría",
    "Filtrar por estado",
    "Filtrar por costo",
    "Filtrar por stock",
  ]) {
    const filter = page.getByLabel(name, { exact: true });
    await filter.scrollIntoViewIfNeeded();
    expect(
      await filter.evaluate(
        (element) =>
          element.getBoundingClientRect().right <= window.innerWidth + 1,
      ),
    ).toBe(true);
  }
  expect(
    await page.evaluate(
      async ({ date }) =>
        window.gastronomy.getFinanceReport({ from: date, to: date }),
      fixture,
    ),
  ).toEqual(fixture.report);
});

test("combina filtros con resultados reales e incluye costo de compras e inactivos", async () => {
  const fixture = await page.evaluate(async () => {
    const api = window.gastronomy;
    const boot = await api.bootstrap();
    const prices = ["SALON", "TAKEAWAY", "DELIVERY"].map((priceListCode) => ({
      priceListCode: priceListCode as "SALON" | "TAKEAWAY" | "DELIVERY",
      amountMinor: 1000,
    }));
    const category = boot.categories[0]!;
    const zero = await api.createProduct({
      categoryId: category.id,
      name: "US03 filtro cero",
      stockMinor: 0,
      prices,
    });
    const low = await api.createProduct({
      categoryId: category.id,
      name: "US03 filtro compra",
      stockMinor: 0,
      stockMinMinor: 2000,
      prices,
    });
    const unknown = await api.createProduct({
      categoryId: category.id,
      name: "US03 filtro inactivo",
      stockMinor: null,
      prices,
    });
    await api.setFinanceProductCost({ productId: zero.id, unitCostMinor: 0 });
    await api.createPurchase({
      supplierName: "Proveedor filtro",
      authorizerPin: "1234",
      items: [{ productId: low.id, quantityMinor: 1000, unitCostMinor: 100 }],
    });
    await api.updateProduct({
      productId: unknown.id,
      categoryId: category.id,
      name: unknown.name,
      active: false,
      prices,
      reason: "Fixture inactivo",
      authorizerPin: "1234",
    });
    return { zero, low, unknown, categoryId: category.id };
  });
  await page.reload();
  await page.getByRole("link", { name: "Productos", exact: true }).click();
  await page.getByLabel("Buscar productos").fill("US03 filtro");
  await page
    .getByLabel("Filtrar por categoría")
    .selectOption(fixture.categoryId);
  await page.getByLabel("Filtrar por estado").selectOption("active");
  await page.getByLabel("Filtrar por costo").selectOption("with");
  await page.getByLabel("Filtrar por stock").selectOption("out");
  const zero = page.getByLabel(`Seleccionar ${fixture.zero.name}`, {
    exact: true,
  });
  await expect(zero).toBeVisible();
  await expect(
    page.getByLabel(`Seleccionar ${fixture.low.name}`, { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("1 coincidencia", { exact: true })).toBeVisible();
  await zero.check();
  await page.getByLabel("Filtrar por stock").selectOption("low");
  await expect(
    page.getByLabel(`Seleccionar ${fixture.low.name}`, { exact: true }),
  ).toBeVisible();
  await expect(zero).toHaveCount(0);
  await expect(
    page.getByText(/Hay 1 producto seleccionado oculto/),
  ).toBeVisible();
  await page.getByLabel("Filtrar por estado").selectOption("inactive");
  await page.getByLabel("Filtrar por costo").selectOption("sin");
  await page.getByLabel("Filtrar por stock").selectOption("untracked");
  await expect(
    page.getByLabel(`Seleccionar ${fixture.unknown.name}`, { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("1 coincidencia", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Limpiar filtros", exact: true })
    .click();
  await expect(page.getByLabel("Buscar productos")).toHaveValue("");
  await expect(page.getByLabel("Filtrar por costo")).toHaveValue("all");
  await expect(page.getByLabel("Filtrar por estado")).toHaveValue("all");
  await expect(zero).toBeChecked();
});

test.beforeEach(async () => {
  await mkdir(out, { recursive: true });
  profile = await mkdtemp(join(tmpdir(), "gastronomy-us03-cost-filters-"));
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
      !basename(profile).startsWith("gastronomy-us03-cost-filters-")
    )
      throw new Error("Unsafe disposable profile path");
    await rm(profile, { recursive: true, force: true });
  }
});

async function makeConfirmedMuzg(withCost: boolean) {
  return page.evaluate(async (withCost) => {
    const api = window.gastronomy;
    await api.openCashSession({ openingAmountMinor: 0 });
    const bootstrap = await api.bootstrap();
    const date = bootstrap.cashSession!.businessDate;
    const product = bootstrap.products.find((item) => item.code === "MUZG")!;
    if (withCost)
      await api.setFinanceProductCost({
        productId: product.id,
        unitCostMinor: 300_000,
      });
    const draft = await api.createOrder({
      type: "TAKEAWAY",
      customerName: "US03 costo",
      customerPhone: "1155000300",
    });
    await api.addOrderItem({ orderId: draft.id, productId: product.id });
    const order = await api.confirmOrder({ orderId: draft.id });
    return {
      date,
      productId: product.id,
      orderId: order.id,
      report: await api.getFinanceReport({ from: date, to: date }),
    };
  }, withCost);
}

test("avisa de MUZG sin costo sin alterar reporte; el enlace filtra el catálogo", async () => {
  const fixture = await makeConfirmedMuzg(false);
  for (const width of [1280, 1100]) {
    await app.evaluate(
      ({ BrowserWindow }, width) =>
        BrowserWindow.getAllWindows()[0]!.setSize(width, 740),
      width,
    );
    await page.reload();
    await page.getByRole("link", { name: "Finanzas", exact: true }).click();
    await page.getByLabel("Desde", { exact: true }).fill(fixture.date);
    await page.getByLabel("Hasta", { exact: true }).fill(fixture.date);

    for (const title of [
      "Margen bruto estimado",
      "Resultado operativo estimado",
    ]) {
      const card = page.getByText(title, { exact: true }).locator("..");
      await expect(card.locator("p").nth(1)).toHaveText(
        formatMoney(
          title === "Margen bruto estimado"
            ? fixture.report.grossProfitMinor
            : fixture.report.estimatedOperatingProfitMinor,
        ),
      );
      await expect(card).toContainText(
        "Hay ventas de productos sin costo cargado",
      );
      if (title === "Resultado operativo estimado")
        await expect(
          card.getByRole("link", {
            name: "Ver productos sin costo",
            exact: true,
          }),
        ).toHaveAttribute("href", /\/catalogo\?costo=sin/);
      await card.screenshot({
        path: join(
          out,
          `missing-cost-${title.startsWith("Margen") ? "gross" : "operating"}-${width}.png`,
        ),
      });
      const textFits = await card.locator("p").evaluateAll((paragraphs) =>
        paragraphs.every((p) => {
          const r = document.createRange();
          r.selectNodeContents(p);
          const ink = r.getBoundingClientRect();
          const box = p.getBoundingClientRect();
          return (
            ink.left >= box.left - 1 &&
            ink.right <= box.right + 1 &&
            p.scrollWidth <= p.clientWidth + 1
          );
        }),
      );
      expect(textFits, `${title} text fits at ${width}px`).toBe(true);
    }

    const before = await page.evaluate(
      async ({ date }) =>
        window.gastronomy.getFinanceReport({ from: date, to: date }),
      fixture,
    );
    expect(before).toEqual(fixture.report);
    await page
      .getByText("Resultado operativo estimado", { exact: true })
      .locator("..")
      .getByRole("link", { name: "Ver productos sin costo", exact: true })
      .click();
    await expect(page).toHaveURL(/\/catalogo\?costo=sin/);
    const costFilter = page.getByLabel("Filtrar por costo", { exact: true });
    await expect(costFilter).toHaveValue("sin");
    await costFilter.selectOption("all");
    await expect(costFilter).toHaveValue("all");
    await page
      .getByLabel("Filtrar por categoría", { exact: true })
      .selectOption({ index: 1 });
    await costFilter.selectOption("sin");
    await page
      .getByLabel("Filtrar por estado", { exact: true })
      .selectOption("active");
    await page
      .getByLabel("Filtrar por stock", { exact: true })
      .selectOption("out");
    await expect(page.locator(".panel-enter")).toHaveCSS("opacity", "1");
    await page.screenshot({
      path: join(out, `combined-catalog-filters-${width}.png`),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Limpiar filtros", exact: true })
      .click();
    await expect(page.getByLabel("Filtrar por categoría")).toHaveValue("");
    await expect(page.getByLabel("Filtrar por estado")).toHaveValue("all");
    await expect(costFilter).toHaveValue("all");
    await expect(page.getByLabel("Filtrar por stock")).toHaveValue("all");
    // Filtering is presentation-only: report source figures survive navigation/filtering.
    const after = await page.evaluate(
      async ({ date }) =>
        window.gastronomy.getFinanceReport({ from: date, to: date }),
      fixture,
    );
    expect(after).toEqual(fixture.report);
    await writeFile(
      join(out, `missing-cost-${width}.json`),
      JSON.stringify(
        { width, reportUnchanged: true, realSqliteAndIpc: true },
        null,
        2,
      ),
    );
  }
});

test("ventas con costo cargado no muestran aviso y mantienen cifras al recargar", async () => {
  const known = await makeConfirmedMuzg(true);
  await page.reload();
  await page.getByRole("link", { name: "Finanzas", exact: true }).click();
  await page.getByLabel("Desde", { exact: true }).fill(known.date);
  await page.getByLabel("Hasta", { exact: true }).fill(known.date);
  const knownGross = page
    .getByText("Margen bruto estimado", { exact: true })
    .locator("..");
  await expect(knownGross).not.toContainText(
    "Hay ventas de productos sin costo cargado",
  );
  expect(
    await page.evaluate(
      async ({ date }) =>
        window.gastronomy.getFinanceReport({ from: date, to: date }),
      known,
    ),
  ).toEqual(known.report);

  await writeFile(
    join(out, "known-cost.json"),
    JSON.stringify(
      { knownCostReportStable: true, realSqliteAndIpc: true },
      null,
      2,
    ),
  );
});

test("reporte sin ventas no muestra aviso", async () => {
  const empty = await page.evaluate(async () => {
    await window.gastronomy.openCashSession({ openingAmountMinor: 0 });
    const date = (await window.gastronomy.bootstrap()).cashSession!
      .businessDate;
    return {
      date,
      report: await window.gastronomy.getFinanceReport({
        from: date,
        to: date,
      }),
    };
  });
  await page.reload();
  await page.getByRole("link", { name: "Finanzas", exact: true }).click();
  await page.getByLabel("Desde", { exact: true }).fill(empty.date);
  await page.getByLabel("Hasta", { exact: true }).fill(empty.date);
  await expect(
    page.getByText("Margen bruto estimado", { exact: true }).locator(".."),
  ).not.toContainText("Hay ventas de productos sin costo cargado");
  expect(
    await page.evaluate(
      async ({ date }) =>
        window.gastronomy.getFinanceReport({ from: date, to: date }),
      empty,
    ),
  ).toEqual(empty.report);
  await writeFile(
    join(out, "empty-report.json"),
    JSON.stringify(
      { emptyReportStable: true, realSqliteAndIpc: true },
      null,
      2,
    ),
  );
});

test("ventas con y sin costo conservan reporte y muestran el aviso", async () => {
  const mixed = await page.evaluate(async () => {
    const api = window.gastronomy;
    await api.openCashSession({ openingAmountMinor: 0 });
    const data = await api.bootstrap();
    const date = data.cashSession!.businessDate;
    const product = data.products.find((item) => item.code === "MUZG")!;
    const addConfirmed = async (name: string) => {
      const draft = await api.createOrder({
        type: "TAKEAWAY",
        customerName: name,
        customerPhone: "1155000300",
      });
      await api.addOrderItem({ orderId: draft.id, productId: product.id });
      return api.confirmOrder({ orderId: draft.id });
    };
    const withoutCostOrder = await addConfirmed("US03 sin costo");
    await api.setFinanceProductCost({
      productId: product.id,
      unitCostMinor: 300_000,
    });
    const withCostOrder = await addConfirmed("US03 con costo");
    return {
      date,
      withoutCostOrderId: withoutCostOrder.id,
      withCostOrderId: withCostOrder.id,
      report: await api.getFinanceReport({ from: date, to: date }),
    };
  });
  await page.reload();
  await page.getByRole("link", { name: "Finanzas", exact: true }).click();
  await page.getByLabel("Desde", { exact: true }).fill(mixed.date);
  await page.getByLabel("Hasta", { exact: true }).fill(mixed.date);
  const gross = page
    .getByText("Margen bruto estimado", { exact: true })
    .locator("..");
  await expect(gross).toContainText(
    "Hay ventas de productos sin costo cargado",
  );
  const mixedAfter = await page.evaluate(
    async ({ date }) =>
      window.gastronomy.getFinanceReport({ from: date, to: date }),
    mixed,
  );
  expect({
    sales: mixedAfter.salesMinor,
    cogs: mixedAfter.cogsMinor,
    gross: mixedAfter.grossProfitMinor,
    operating: mixedAfter.estimatedOperatingProfitMinor,
  }).toEqual({
    sales: mixed.report.salesMinor,
    cogs: mixed.report.cogsMinor,
    gross: mixed.report.grossProfitMinor,
    operating: mixed.report.estimatedOperatingProfitMinor,
  });
  await writeFile(
    join(out, "mixed-cost-report.json"),
    JSON.stringify(
      { ...mixed, reportStable: true, realSqliteAndIpc: true },
      null,
      2,
    ),
  );
});

test("coincidencia de costo sólo en variante conserva padre como contexto, no selección", async () => {
  const products = await page.evaluate(async () => {
    const api = window.gastronomy;
    const boot = await api.bootstrap();
    const category = boot.categories[0]!;
    const prices = [
      { priceListCode: "SALON" as const, amountMinor: 1_000 },
      { priceListCode: "TAKEAWAY" as const, amountMinor: 1_000 },
      { priceListCode: "DELIVERY" as const, amountMinor: 1_000 },
    ];
    const parent = await api.createProduct({
      categoryId: category.id,
      name: "US03 base",
      code: "US03BASE",
      prices,
    });
    const variant = await api.createProduct({
      categoryId: category.id,
      parentProductId: parent.id,
      name: "US03 variante sin costo",
      code: "US03VAR",
      prices,
    });
    await api.setFinanceProductCost({
      productId: parent.id,
      unitCostMinor: 100,
    });
    return { parent, variant };
  });
  await page.reload();
  await page.getByRole("link", { name: "Productos", exact: true }).click();
  await page.getByLabel("Filtrar por costo").selectOption("sin");
  const parentCheckbox = page.getByLabel(
    `Seleccionar ${products.parent.name}`,
    { exact: true },
  );
  const variantCheckbox = page.getByLabel(
    `Seleccionar ${products.variant.name}`,
    { exact: true },
  );
  await expect(parentCheckbox).toBeVisible();
  await expect(parentCheckbox).not.toBeChecked();
  await expect(variantCheckbox).toBeVisible();
  await page
    .getByLabel("Seleccionar productos visibles", { exact: true })
    .check();
  await expect(variantCheckbox).toBeChecked();
  await expect(parentCheckbox).not.toBeChecked();
  await page.screenshot({
    path: join(out, "variant-match-parent-context.png"),
    fullPage: true,
  });
});

test("compra conserva el costo capturado aunque cambie luego el costo manual", async () => {
  const fixture = await page.evaluate(async () => {
    const api = window.gastronomy;
    await api.openCashSession({ openingAmountMinor: 0 });
    const data = await api.bootstrap();
    const product = data.products.find((item) => item.code === "MUZG")!;
    return { productId: product.id, date: data.cashSession?.businessDate };
  });
  const purchase = await page.evaluate(
    async ({ productId }) =>
      window.gastronomy.createPurchase({
        idempotencyKey: crypto.randomUUID(),
        supplierName: "US03 proveedor",
        invoiceNumber: "US03-FAC-1",
        authorizerPin: "1234",
        items: [{ productId, quantityMinor: 1_000, unitCostMinor: 40_000 }],
      }),
    fixture,
  );
  const costsAfterPurchase = await page.evaluate(() =>
    window.gastronomy.getFinanceProductCosts(),
  );
  expect(
    costsAfterPurchase.find(
      (item) => item.productId === purchase.items[0]!.productId,
    ),
  ).toMatchObject({ unitCostMinor: 40_000, source: "PURCHASE" });
  const confirmed = await page.evaluate(
    async ({ productId }) => {
      const api = window.gastronomy;
      const draft = await api.createOrder({
        type: "TAKEAWAY",
        customerName: "US03 compra",
        customerPhone: "1155000300",
      });
      await api.addOrderItem({ orderId: draft.id, productId });
      const order = await api.confirmOrder({ orderId: draft.id });
      const report = await api.getFinanceReport({
        from: (await api.bootstrap()).cashSession!.businessDate,
        to: (await api.bootstrap()).cashSession!.businessDate,
      });
      return {
        orderId: order.id,
        date: (await api.bootstrap()).cashSession!.businessDate,
        report,
      };
    },
    { productId: purchase.items[0]!.productId },
  );
  await page.evaluate(
    async ({ productId }) =>
      window.gastronomy.setFinanceProductCost({
        productId,
        unitCostMinor: 50_000,
      }),
    { productId: purchase.items[0]!.productId },
  );
  const unchangedReport = await page.evaluate(
    async ({ date }) =>
      window.gastronomy.getFinanceReport({ from: date, to: date }),
    confirmed,
  );
  expect({
    sales: unchangedReport.salesMinor,
    cogs: unchangedReport.cogsMinor,
    gross: unchangedReport.grossProfitMinor,
    operating: unchangedReport.estimatedOperatingProfitMinor,
  }).toEqual({
    sales: confirmed.report.salesMinor,
    cogs: confirmed.report.cogsMinor,
    gross: confirmed.report.grossProfitMinor,
    operating: confirmed.report.estimatedOperatingProfitMinor,
  });
  const after = await page.evaluate(async () =>
    window.gastronomy.listPurchases(),
  );
  expect(after.find((item) => item.id === purchase.id)?.items[0]).toMatchObject(
    { unitCostMinor: 40_000 },
  );
  expect(formatMoney(purchase.items[0]!.unitCostMinor)).toBe(
    formatMoney(40_000),
  );
  await writeFile(
    join(out, "purchase-cost-snapshot.json"),
    JSON.stringify(
      {
        capturedMinor: 40_000,
        manuallyUpdatedProductCostMinor: 50_000,
        confirmedOrderId: confirmed.orderId,
        historicalPurchaseStable: true,
        orderReportStable: true,
        realSqliteAndIpc: true,
      },
      null,
      2,
    ),
  );
});
