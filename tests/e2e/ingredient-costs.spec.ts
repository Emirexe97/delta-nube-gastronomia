import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

let app: ElectronApplication;
let page: Page;
let profile = "";
test.beforeEach(async () => {
  profile = await mkdtemp(join(tmpdir(), "gastronomy-ingredient-costs-"));
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
  await app?.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) window.destroy();
  });
  await app?.close();
  if (
    dirname(resolve(profile)) !== resolve(tmpdir()) ||
    !basename(profile).startsWith("gastronomy-ingredient-costs-")
  )
    throw Error("Unsafe test profile cleanup");
  await rm(profile, { recursive: true, force: true });
});

test("ingredientes calcula recetas por peso y volumen, recalcula ventas futuras y conserva el costo histórico", async ({}, testInfo) => {
  test.setTimeout(150_000);
  const product = await page.evaluate(async () => {
    const data = await window.gastronomy.bootstrap();
    return window.gastronomy.createProduct({
      categoryId: data.categories.find((category) => category.active)!.id,
      name: "Papas fritas receta QA",
      stockMinor: null,
      prices: [
        { priceListCode: "SALON", amountMinor: 800000 },
        { priceListCode: "TAKEAWAY", amountMinor: 800000 },
        { priceListCode: "DELIVERY", amountMinor: 800000 },
      ],
    });
  });
  await page.reload();
  await page.getByRole("link", { name: "Productos", exact: true }).click();
  await page.getByRole("tab", { name: "Ingredientes", exact: true }).click();
  for (const ingredient of [
    {
      name: "Papa QA",
      presentation: "Bolsa",
      unit: "KG",
      quantity: "16",
      cost: "16000",
    },
    {
      name: "Aceite QA",
      presentation: "Bidón",
      unit: "L",
      quantity: "10",
      cost: "30000",
    },
  ]) {
    await page
      .getByRole("button", { name: "Nuevo ingrediente", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Nuevo ingrediente",
      exact: true,
    });
    await dialog
      .getByLabel("Nombre del ingrediente", { exact: true })
      .fill(ingredient.name);
    await dialog
      .getByLabel("Presentación del ingrediente", { exact: true })
      .fill(ingredient.presentation);
    await dialog
      .getByLabel("Unidad del ingrediente", { exact: true })
      .selectOption(ingredient.unit);
    await dialog
      .getByLabel("Contenido de la presentación", { exact: true })
      .fill(ingredient.quantity);
    await dialog
      .getByLabel("Costo de la presentación", { exact: true })
      .fill(ingredient.cost);
    await dialog
      .getByRole("button", { name: "Guardar ingrediente", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    await expect(
      page.getByRole("row").filter({ hasText: ingredient.name }),
    ).toContainText(ingredient.presentation);
  }
  const ingredients = await page.evaluate(() =>
    window.gastronomy.listIngredients(),
  );
  const potato = ingredients.find((item) => item.name === "Papa QA")!;
  const oil = ingredients.find((item) => item.name === "Aceite QA")!;
  expect(potato.presentationQuantityMicros).toBe(16_000_000);
  await page.getByRole("tab", { name: "Productos", exact: true }).click();
  await page
    .getByRole("button", { name: `Costo de ${product.name}`, exact: true })
    .click();
  let dialog = page.getByRole("dialog", {
    name: `Costo · ${product.name}`,
    exact: true,
  });
  await dialog
    .getByRole("checkbox", {
      name: "Calcular costo por ingredientes",
      exact: true,
    })
    .check();
  await dialog
    .getByLabel("Ingrediente 1", { exact: true })
    .selectOption(potato.id);
  await dialog.getByLabel("Cantidad 1", { exact: true }).fill("300");
  await dialog.getByLabel("Unidad 1", { exact: true }).selectOption("KG");
  await expect(dialog.getByLabel("Cantidad 1", { exact: true })).toHaveValue(
    "0,3",
  );
  await dialog.getByLabel("Unidad 1", { exact: true }).selectOption("G");
  await expect(dialog.getByLabel("Cantidad 1", { exact: true })).toHaveValue(
    "300",
  );
  await dialog
    .getByRole("button", { name: "Agregar ingrediente", exact: true })
    .click();
  await dialog
    .getByLabel("Ingrediente 2", { exact: true })
    .selectOption(oil.id);
  await dialog.getByLabel("Cantidad 2", { exact: true }).fill("20");
  await expect(dialog.getByText(/Costo por unidad:/)).toContainText(/360/);
  await dialog.screenshot({ path: testInfo.outputPath("receta-producto.png") });
  await dialog
    .getByRole("button", { name: "Guardar costo", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  let current = await page.evaluate(
    (id) =>
      window.gastronomy
        .getFinanceProductCosts()
        .then((items) => items.find((item) => item.productId === id)),
    product.id,
  );
  expect(current).toMatchObject({ source: "RECIPE", unitCostMinor: 36000 });
  const historical = await page.evaluate(async (productId) => {
    const api = window.gastronomy;
    await api.openCashSession({ openingAmountMinor: 0 });
    const order = await api.createOrder({
      type: "DINE_IN",
      tableId: (await api.ensureTable({ number: 1 })).id,
    });
    await api.addOrderItem({ orderId: order.id, productId });
    await api.confirmOrder({ orderId: order.id });
    const year = new Date().getFullYear();
    return (
      await api.getFinanceReport({ from: `${year}-01-01`, to: `${year}-12-31` })
    ).cogsMinor;
  }, product.id);
  expect(historical).toBe(36000);
  await page.getByRole("tab", { name: "Ingredientes", exact: true }).click();
  await page
    .getByRole("button", { name: "Editar ingrediente Papa QA", exact: true })
    .click();
  const ingredientDialog = page.getByRole("dialog", {
    name: "Editar ingrediente · Papa QA",
    exact: true,
  });
  await ingredientDialog
    .getByLabel("Costo de la presentación", { exact: true })
    .fill("32000");
  await ingredientDialog
    .getByRole("button", { name: "Guardar ingrediente", exact: true })
    .click();
  await expect(ingredientDialog).not.toBeVisible();
  current = await page.evaluate(
    (id) =>
      window.gastronomy
        .getFinanceProductCosts()
        .then((items) => items.find((item) => item.productId === id)),
    product.id,
  );
  expect(current).toMatchObject({ source: "RECIPE", unitCostMinor: 66000 });
  expect(
    await page.evaluate(() => {
      const year = new Date().getFullYear();
      return window.gastronomy
        .getFinanceReport({ from: `${year}-01-01`, to: `${year}-12-31` })
        .then((report) => report.cogsMinor);
    }),
  ).toBe(historical);
  await page.getByRole("tab", { name: "Productos", exact: true }).click();
  await page
    .getByRole("button", { name: `Costo de ${product.name}`, exact: true })
    .click();
  dialog = page.getByRole("dialog", {
    name: `Costo · ${product.name}`,
    exact: true,
  });
  await expect(
    dialog.getByRole("checkbox", {
      name: "Calcular costo por ingredientes",
      exact: true,
    }),
  ).toBeChecked();
  await expect(dialog.getByLabel("Cantidad 1", { exact: true })).toHaveValue(
    "300",
  );
  await expect(dialog.getByText(/Costo por unidad:/)).toContainText(/660/);
  await dialog
    .getByRole("checkbox", {
      name: "Calcular costo por ingredientes",
      exact: true,
    })
    .uncheck();
  await dialog
    .getByLabel("Costo manual por unidad", { exact: true })
    .fill("125");
  await dialog
    .getByRole("button", { name: "Guardar costo", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  const config = await page.evaluate(
    (productId) => window.gastronomy.getProductCostConfiguration({ productId }),
    product.id,
  );
  expect(config).toMatchObject({
    recipeEnabled: false,
    manualUnitCostMinor: 12500,
  });
  expect(config.recipeItems).toHaveLength(2);
  await page.reload();
  await page.getByRole("link", { name: "Finanzas", exact: true }).click();
  await page
    .getByLabel("Producto para costo", { exact: true })
    .selectOption(product.id);
  await expect(
    page.getByRole("checkbox", {
      name: "Calcular costo por ingredientes",
      exact: true,
    }),
  ).not.toBeChecked();
  await page
    .getByRole("checkbox", {
      name: "Calcular costo por ingredientes",
      exact: true,
    })
    .check();
  await expect(page.getByText(/Costo por unidad:/)).toContainText(/660/);
  await page
    .getByRole("button", { name: "Guardar costo", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(
        (id) =>
          window.gastronomy
            .getFinanceProductCosts()
            .then(
              (items) => items.find((item) => item.productId === id)?.source,
            ),
        product.id,
      ),
    )
    .toBe("RECIPE");
});
