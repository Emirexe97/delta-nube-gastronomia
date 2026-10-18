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
  profile = await mkdtemp(join(tmpdir(), "gastronomy-catalog-combos-"));
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
    !basename(profile).startsWith("gastronomy-catalog-combos-")
  ) {
    throw Error("Unsafe test profile cleanup");
  }
  await rm(profile, { recursive: true, force: true });
});

test("las variantes respetan los controles individuales y globales incluso al buscar y filtrar", async () => {
  await page.evaluate(async () => {
    const api = window.gastronomy;
    const data = await api.bootstrap();
    const categoryId = data.categories.find((category) => category.active)!.id;
    const prices = [
      { priceListCode: "SALON" as const, amountMinor: 10000 },
      { priceListCode: "TAKEAWAY" as const, amountMinor: 10000 },
      { priceListCode: "DELIVERY" as const, amountMinor: 10000 },
    ];
    const parent = await api.createProduct({
      categoryId,
      name: "Base acordeón QA",
      prices,
    });
    const child = await api.createProduct({
      categoryId,
      name: "Variante acordeón QA",
      parentProductId: parent.id,
      prices,
    });
    await api.updateProduct({
      ...child,
      productId: child.id,
      active: false,
      prices: child.prices,
      reason: "Filtro QA",
      authorizerPin: "1234",
    });
  });
  await page.reload();
  await page.getByRole("link", { name: "Productos", exact: true }).click();
  const variant = page.getByRole("checkbox", {
    name: "Seleccionar Variante acordeón QA",
    exact: true,
  });
  const toggle = () =>
    page.getByRole("button", {
      name: /(?:Mostrar 1 variantes|Ocultar variantes) de Base acordeón QA/,
    });
  await expect(variant).toHaveCount(0);
  await toggle().click();
  await expect(variant).toBeVisible();
  await expect(toggle()).toHaveAttribute("aria-expanded", "true");
  await toggle().click();
  await expect(variant).toHaveCount(0);
  const parentRow = page
    .getByRole("row")
    .filter({
      has: page.getByRole("checkbox", {
        name: "Seleccionar Base acordeón QA",
        exact: true,
      }),
    });
  await parentRow
    .getByRole("button", { name: "1 variante", exact: true })
    .click();
  await expect(variant).toBeVisible();
  await page
    .getByRole("button", { name: "Colapsar variantes", exact: true })
    .click();
  await expect(variant).toHaveCount(0);
  await page
    .getByRole("button", { name: "Expandir variantes", exact: true })
    .click();
  await expect(variant).toBeVisible();

  await page.getByLabel("Buscar productos").fill("Variante acordeón QA");
  await expect(variant).toBeVisible();
  await toggle().click();
  await expect(variant).toHaveCount(0);
  await toggle().click();
  await expect(variant).toBeVisible();
  await page
    .getByRole("button", { name: "Colapsar variantes", exact: true })
    .click();
  await expect(variant).toHaveCount(0);
  await page
    .getByRole("button", { name: "Expandir variantes", exact: true })
    .click();
  await expect(variant).toBeVisible();

  await page.getByLabel("Buscar productos").fill("");
  await page.getByLabel("Filtrar por estado").selectOption("inactive");
  await expect(variant).toBeVisible();
  await toggle().click();
  await expect(variant).toHaveCount(0);
  await page
    .getByRole("button", { name: "Expandir variantes", exact: true })
    .click();
  await expect(variant).toBeVisible();
});

test("Combos crea y edita combos completos desde su pestaña sin botones en cada producto", async ({}, testInfo) => {
  const fixture = await page.evaluate(async () => {
    const data = await window.gastronomy.bootstrap();
    const component = data.products.find(
      (product) =>
        product.active &&
        !product.comboDefinition &&
        data.categories.some(
          (category) => category.id === product.categoryId && category.active,
        ),
    )!;
    return { component, count: data.products.length };
  });
  await page.getByRole("link", { name: "Productos", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /Configurar combo/ }),
  ).toHaveCount(0);
  await page.getByRole("tab", { name: "Combos", exact: true }).click();
  await page
    .getByRole("button", { name: "Nuevo combo", exact: true })
    .first()
    .click();
  let dialog = page.getByRole("dialog", { name: "Nuevo combo", exact: true });
  await dialog
    .getByLabel("Nombre del combo", { exact: true })
    .fill("Combo almuerzo QA");
  await dialog
    .getByLabel("Categoría del combo", { exact: true })
    .selectOption(fixture.component.categoryId);
  await dialog.getByLabel("Código del combo", { exact: true }).fill("COMBO-QA");
  await dialog
    .getByLabel("Precio Salón del combo", { exact: true })
    .fill("8500");
  await dialog
    .getByLabel("Precio Delivery / Para retirar del combo", { exact: true })
    .fill("9000");
  await dialog
    .getByLabel("Nombre de opción 1", { exact: true })
    .fill("Principal");
  await dialog
    .getByRole("checkbox", { name: fixture.component.name, exact: true })
    .check();
  await dialog.getByLabel("Motivo", { exact: true }).fill("Alta de combo QA");
  await dialog.getByLabel("PIN de autorización", { exact: true }).fill("0000");
  await dialog
    .getByRole("button", { name: "Crear combo", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  expect(
    (await page.evaluate(() => window.gastronomy.bootstrap())).products,
  ).toHaveLength(fixture.count);
  await dialog.getByLabel("PIN de autorización", { exact: true }).fill("1234");
  await testInfo.attach("nuevo-combo", {
    body: await dialog.screenshot(),
    contentType: "image/png",
  });
  await dialog
    .getByRole("button", { name: "Crear combo", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  const row = page.getByRole("row").filter({ hasText: "Combo almuerzo QA" });
  await expect(row).toContainText("Principal × 1");
  await expect(row).toContainText(/8\.500/);
  await expect(row).toContainText(/9\.000/);
  const created = (
    await page.evaluate(() => window.gastronomy.bootstrap())
  ).products.find((product) => product.code === "COMBO-QA")!;
  expect(created.stockMinor).toBeNull();
  expect(
    created.prices.find((price) => price.priceListCode === "DELIVERY")
      ?.amountMinor,
  ).toBe(900000);
  expect(created.comboDefinition?.slots[0]?.productIds).toEqual([
    fixture.component.id,
  ]);
  await row
    .getByRole("button", {
      name: "Editar opciones de Combo almuerzo QA",
      exact: true,
    })
    .click();
  dialog = page.getByRole("dialog", {
    name: "Editar opciones · Combo almuerzo QA",
    exact: true,
  });
  await dialog.getByLabel("Cantidad de opción 1", { exact: true }).fill("2");
  await dialog.getByLabel("Motivo", { exact: true }).fill("Dos unidades QA");
  await dialog.getByLabel("PIN de autorización", { exact: true }).fill("1234");
  await dialog
    .getByRole("button", { name: "Guardar combo", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(row).toContainText("Principal × 2");
  await page.reload();
  await page.getByRole("tab", { name: "Combos", exact: true }).click();
  await expect(row).toContainText("Principal × 2");
  await page.getByLabel("Buscar combos").fill("COMBO-QA");
  await expect(row).toBeVisible();
  await testInfo.attach("pestana-combos", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
});
