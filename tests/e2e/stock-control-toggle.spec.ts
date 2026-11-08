import { launchConfiguredPos } from "./pos-fixture";
import {
  test,
  expect,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let app: ElectronApplication;
let page: Page;
let userData: string;

test.beforeAll(async () => {
  userData = await mkdtemp(join(tmpdir(), "gastronomy-stock-toggle-"));
  app = await launchConfiguredPos({
    args: ["apps/desktop-shell", `--user-data-dir=${userData}`],
    cwd: process.cwd(),
  });
  page = await app.firstWindow();
  await expect(page.getByText("Delta Nube", { exact: true })).toBeVisible();
});

test.afterAll(async () => {
  await app?.close();
  await rm(userData, { recursive: true, force: true });
});

test("crea producto con control de stock deshabilitado y verifica que queda Sin control", async () => {
  await page.setViewportSize({ width: 1366, height: 768 });

  await page.getByRole("link", { name: "Productos" }).click();
  await expect(
    page.getByRole("heading", { name: "Catálogo, modificadores y stock" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Nuevo producto" }).click();
  const productDialog = page.getByRole("dialog", { name: "Nuevo producto" });
  await expect(productDialog).toBeVisible();

  await productDialog.getByLabel("Nombre").fill("Agua Mineral Sin Gas");
  await productDialog.getByRole("tab", { name: "Precios", exact: true }).click();
  await productDialog.getByLabel("Precio Principal").fill("1500");

  // Desmarcar checkbox de stock
  const stockCheckbox = productDialog.getByRole("checkbox", {
    name: "Controlar stock de este producto",
  });
  await expect(stockCheckbox).toBeChecked();
  await stockCheckbox.uncheck();
  await expect(stockCheckbox).not.toBeChecked();
  await expect(productDialog.getByText("Sin control de stock")).toBeVisible();

  await productDialog.getByRole("button", { name: "Guardar producto" }).click();
  await expect(productDialog).not.toBeVisible();

  // Verificar en la tabla que el producto aparece con "Sin control"
  const row = page.locator("tr", { hasText: "Agua Mineral Sin Gas" });
  await expect(row).toBeVisible();
  await expect(row.getByRole("button", { name: /Stock actual/ })).toHaveText(
    "Sin control",
  );
});

test("edita producto para habilitar el control de stock con existencias", async () => {
  const row = page.locator("tr", { hasText: "Agua Mineral Sin Gas" });
  await row
    .getByRole("button", { name: "Editar Agua Mineral Sin Gas" })
    .click();

  const editDialog = page.getByRole("dialog", {
    name: /Editar · Agua Mineral Sin Gas/,
  });
  await expect(editDialog).toBeVisible();
  await editDialog
    .getByRole("tab", { name: "Inventario", exact: true })
    .click();

  const stockCheckbox = editDialog.getByRole("checkbox", {
    name: "Controlar stock de este producto",
  });
  await expect(stockCheckbox).not.toBeChecked();

  // Marcar checkbox
  await stockCheckbox.check();
  await expect(stockCheckbox).toBeChecked();
  await expect(editDialog.getByText("Con control de stock")).toBeVisible();

  // Llenar stock actual
  await editDialog.getByLabel("Stock actual").fill("25");

  // Autorización
  await editDialog
    .getByLabel("Motivo del cambio")
    .fill("Activar control de stock");
  await editDialog.getByLabel("PIN de autorización").fill("748259");

  await editDialog.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(editDialog).not.toBeVisible();

  // Verificar en la tabla que ahora muestra "25 u."
  await expect(row.getByRole("button", { name: /Stock actual/ })).toHaveText(
    "25 u.",
  );
});

test("acciones externas de ficha canceladas conservan el producto y el stock", async () => {
  const row = page.locator("tr", { hasText: "Agua Mineral Sin Gas" });
  const before = await page.evaluate(async () => {
    const product = (await window.gastronomy.bootstrap()).products.find(
      (item) => item.name === "Agua Mineral Sin Gas",
    )!;
    return { id: product.id, stockMinor: product.stockMinor };
  });

  await row
    .getByRole("button", { name: "Editar Agua Mineral Sin Gas" })
    .click();
  let editDialog = page.getByRole("dialog", {
    name: "Editar · Agua Mineral Sin Gas",
  });
  await editDialog.getByRole("button", { name: "Eliminar producto" }).click();
  const deleteDialog = page.getByRole("dialog", {
    name: "Eliminar producto · Agua Mineral Sin Gas",
  });
  await deleteDialog
    .getByRole("button", { name: "Volver", exact: true })
    .click();
  await expect(deleteDialog).not.toBeVisible();

  await row
    .getByRole("button", { name: "Editar Agua Mineral Sin Gas" })
    .click();
  editDialog = page.getByRole("dialog", {
    name: "Editar · Agua Mineral Sin Gas",
  });
  await editDialog
    .getByRole("tab", { name: "Inventario", exact: true })
    .click();
  await editDialog.getByRole("button", { name: "Ajustar inventario" }).click();
  const stockDialog = page.getByRole("dialog", {
    name: "Ajustar stock · Agua Mineral Sin Gas",
  });
  await stockDialog
    .getByRole("button", { name: "Volver", exact: true })
    .click();
  await expect(stockDialog).not.toBeVisible();

  const after = await page.evaluate(async (id) => {
    const product = (await window.gastronomy.bootstrap()).products.find(
      (item) => item.id === id,
    )!;
    return { id: product.id, stockMinor: product.stockMinor };
  }, before.id);
  expect(after).toEqual(before);
  await expect(row).toBeVisible();
});

test("permite desactivar el control de stock desde la categoría y vacía el stock de sus productos", async () => {
  // Cambiar a la pestaña Categorías
  await page.getByRole("tab", { name: "Categorías" }).click();
  await expect(
    page.getByRole("button", { name: "Nueva categoría" }),
  ).toBeVisible();

  // Crear una nueva categoría con control de stock activo
  await page.getByRole("button", { name: "Nueva categoría" }).click();
  const catDialog = page.getByRole("dialog", { name: "Nueva categoría" });
  await catDialog
    .getByLabel("Nombre de la categoría")
    .fill("Bebidas Especiales");
  await catDialog.getByRole("button", { name: "Crear categoría" }).click();
  await expect(catDialog).not.toBeVisible();

  // En la tabla de categorías, verificar que aparece con Control stock Habilitado
  const catRow = page.locator("tr", { hasText: "Bebidas Especiales" });
  await expect(catRow).toBeVisible();
  await expect(catRow.getByText("Habilitado")).toBeVisible();

  // Crear un producto dentro de esa categoría desde la fila
  await catRow.getByRole("button", { name: "Producto" }).click();
  const prodDialog = page.getByRole("dialog", { name: "Nuevo producto" });
  await expect(prodDialog).toBeVisible();
  await prodDialog.getByLabel("Nombre").fill("Kombucha");
  await prodDialog.getByRole("tab", { name: "Precios", exact: true }).click();
  await prodDialog.getByLabel("Precio Principal").fill("2000");
  await prodDialog.getByLabel("Stock actual").fill("15");
  await prodDialog.getByRole("button", { name: "Guardar producto" }).click();
  await expect(prodDialog).not.toBeVisible();

  // Verificar en Productos que Kombucha tiene 15 u.
  await page.getByRole("tab", { name: /Productos/ }).click();
  const prodRow = page.locator("tr", { hasText: "Kombucha" });
  await expect(prodRow).toBeVisible();
  await expect(
    prodRow.getByRole("button", { name: /Stock actual/ }),
  ).toHaveText("15 u.");

  // Volver a Categorías y editar Bebidas Especiales para deshabilitar stock
  await page.getByRole("tab", { name: "Categorías" }).click();
  await catRow.getByRole("button", { name: "Editar" }).click();
  const editCatDialog = page.getByRole("dialog", {
    name: /Editar · Bebidas Especiales/,
  });
  await expect(editCatDialog).toBeVisible();

  const catStockCheckbox = editCatDialog.getByRole("checkbox", {
    name: "Controlar stock en productos de esta categoría",
  });
  await expect(catStockCheckbox).toBeChecked();
  await catStockCheckbox.uncheck();
  await editCatDialog
    .getByLabel("Motivo del cambio")
    .fill("Desactivar control general");
  await editCatDialog.getByLabel("PIN de autorización").fill("748259");
  await editCatDialog
    .getByRole("button", { name: "Guardar categoría" })
    .click();
  await expect(editCatDialog).not.toBeVisible();

  // Verificar badge Deshabilitado
  await expect(catRow.getByText("Deshabilitado")).toBeVisible();

  // Volver a Productos y verificar que Kombucha ahora dice "Sin control"
  await page.getByRole("tab", { name: /Productos/ }).click();
  await expect(
    prodRow.getByRole("button", { name: /Stock actual/ }),
  ).toHaveText("Sin control");
});
