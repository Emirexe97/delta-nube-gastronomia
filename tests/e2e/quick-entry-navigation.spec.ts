import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let app: ElectronApplication;
let page: Page;
let userData: string;

async function openCashAndSalon() {
  await page.getByRole("link", { name: "Caja" }).click();
  await page.getByRole("button", { name: /Abrir caja/ }).click();
  await page.getByLabel("Cambio / fondo inicial").fill("50000");
  await page
    .getByRole("dialog", { name: "Abrir caja" })
    .getByRole("button", { name: "Abrir caja", exact: true })
    .click();
  await expect(page.getByText(/Caja #/)).toBeVisible();
  await page.getByRole("link", { name: "Salón" }).click();
}

test.beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), "gastronomy-quick-entry-"));
  app = await electron.launch({
    args: ["apps/desktop-shell", `--user-data-dir=${userData}`],
    cwd: process.cwd(),
  });
  page = await app.firstWindow();
  await expect(page.getByText("Delta Nube", { exact: true })).toBeVisible();
});

test.afterEach(async () => {
  await app?.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) window.destroy();
  });
  await app?.close();
  await rm(userData, { recursive: true, force: true });
});

test("valida caja y mesa antes de habilitar el avance", async () => {
  await page.getByRole("link", { name: "Salón" }).click();
  const table = page.getByLabel("Número de mesa");
  await expect(page.getByRole("button", { name: "Continuar" })).toBeDisabled();
  await table.fill("0");
  await expect(page.getByLabel(/^Número de mozo/)).toBeDisabled();
  await table.press("Enter");
  await expect(page.getByRole("alert")).toContainText("Abrí caja");
  await openCashAndSalon();
  const waiter = page.getByLabel(/^Número de mozo/);
  await table.fill("0");
  await expect(waiter).toBeDisabled();
  await table.fill("10000");
  await expect(waiter).toBeDisabled();
  await table.press("Enter");
  await expect(page.getByRole("alert")).toContainText("número de mesa válido");
});

test("habilita mozo al escribir una mesa de varios dígitos sin crear prefijos", async () => {
  await openCashAndSalon();
  const table = page.getByLabel("Número de mesa");
  const waiter = page.getByLabel(/^Número de mozo/);
  await table.fill("1");
  await expect(waiter).toBeEnabled();
  await table.fill("12");
  await expect(waiter).toBeEnabled();
  await expect(page.getByText(/Mesa 1 creada/)).toHaveCount(0);
  await waiter.click();
  await expect(page.getByText(/Mesa 12 (creada|lista)/)).toBeVisible();
});

test("completa la carga por mouse sin Tab y mantiene la navegación por campos", async () => {
  await openCashAndSalon();
  await page.getByLabel("Número de mesa").fill("23");
  await page.getByLabel(/^Nombre de mozo/).click();
  await page.getByLabel(/^Nombre de mozo/).selectOption({ index: 1 });
  await page.getByRole("button", { name: "Abrir mesa", exact: true }).click();
  await page.getByLabel("Cantidad").fill("1");
  await page.getByLabel("Código / ID").fill("MUZG");
  await page.getByRole("button", { name: /Agregar/ }).click();
  await expect(page.getByText(/1 × .* agregado/)).toBeVisible();
});

test("resuelve y carga un producto por su ID aunque también tenga código", async () => {
  await openCashAndSalon();
  const productId = await page.evaluate(async () => {
    const products = (await window.gastronomy.bootstrap()).products;
    return products.find((product) => product.code === "MUZG")!.id;
  });
  await page.getByLabel("Número de mesa").fill("24");
  await page.getByLabel(/^Nombre de mozo/).click();
  await page.getByLabel(/^Nombre de mozo/).selectOption({ index: 1 });
  await page.getByRole("button", { name: "Abrir mesa", exact: true }).click();
  await page.getByLabel("Cantidad").fill("1");
  await page.getByLabel("Código / ID").fill(productId);
  await expect(
    page.getByRole("combobox", { name: "Producto", exact: true }),
  ).toHaveValue("Muzzarella grande");
  await expect(page.getByLabel("Precio salón")).not.toHaveValue("");
  await page.getByRole("button", { name: /Agregar/ }).click();
  await expect(page.getByText(/1 × Muzzarella grande agregado/)).toBeVisible();
});

test("busca productos por código o ID en el selector de carga rápida", async () => {
  await openCashAndSalon();
  const productId = await page.evaluate(async () => {
    const products = (await window.gastronomy.bootstrap()).products;
    return products.find((product) => product.code === "MUZG")!.id;
  });
  await page.getByLabel("Número de mesa").fill("25");
  await page.getByLabel(/^Nombre de mozo/).click();
  await page.getByLabel(/^Nombre de mozo/).selectOption({ index: 1 });
  await page.getByRole("button", { name: "Abrir mesa", exact: true }).click();
  const product = page.getByRole("combobox", {
    name: "Producto",
    exact: true,
  });
  await product.fill(productId);
  await expect(
    page.getByRole("option", { name: /Muzzarella grande/ }),
  ).toBeVisible();
  await product.fill("MUZG");
  await expect(
    page.getByRole("option", { name: /Muzzarella grande/ }),
  ).toBeVisible();
});

test("Enter avanza y Shift+Enter retrocede sin duplicar pedido", async () => {
  await openCashAndSalon();
  const table = page.getByLabel("Número de mesa");
  await table.fill("31");
  await table.press("Enter");
  const waiter = page.getByLabel(/^Número de mozo/);
  await expect(waiter).toBeFocused();
  await waiter.fill("1");
  await waiter.press("Enter");
  const name = page.getByLabel(/^Nombre de mozo/);
  await expect(name).toBeFocused();
  await name.press("Shift+Enter");
  await expect(waiter).toBeFocused();
  await name.press("Enter");
  await expect(page.getByLabel("Cantidad")).toBeFocused();
  await page.getByLabel("Cantidad").fill("1");
  await page.getByLabel("Cantidad").press("Shift+Enter");
  await expect(name).toBeFocused();
  const orders = await page.evaluate(
    async () => (await window.gastronomy.bootstrap()).orders,
  );
  expect(orders.filter((order) => order.tableNumber === 31)).toHaveLength(1);
});

test("navega línea completa con Enter y Shift+Enter", async () => {
  await openCashAndSalon();
  const table = page.getByLabel("Número de mesa");
  const waiter = page.getByLabel(/^Número de mozo/);
  const name = page.getByLabel(/^Nombre de mozo/);
  const quantity = page.getByLabel("Cantidad");
  const code = page.getByLabel("Código / ID");
  const product = page.getByRole("combobox", { name: "Producto", exact: true });
  const price = page.getByLabel("Precio salón");
  await table.fill("61");
  await table.press("Enter");
  await expect(waiter).toBeFocused();
  await waiter.fill("1");
  await waiter.press("Enter");
  await expect(name).toBeFocused();
  await name.press("Enter");
  await expect(quantity).toBeFocused();
  await quantity.fill("1");
  await quantity.press("Enter");
  await expect(code).toBeFocused();
  await code.fill("MUZG");
  await code.press("Enter");
  await expect(product).toBeFocused();
  await expect(
    page.getByRole("listbox", { name: "Productos disponibles" }),
  ).toBeVisible();
  await product.press("Enter");
  await expect(price).toBeFocused();
  await price.press("Shift+Enter");
  await expect(product).toBeFocused();
  await product.press("Shift+Enter");
  await expect(code).toBeFocused();
  await code.press("Shift+Enter");
  await expect(quantity).toBeFocused();
  await quantity.press("Enter");
  await code.press("Enter");
  await product.press("Enter");
  await price.press("Enter");
  await expect(page.getByText(/1 × .* agregado/)).toBeVisible();
  const orders = await page.evaluate(
    async () => (await window.gastronomy.bootstrap()).orders,
  );
  const order = orders.find((candidate) => candidate.tableNumber === 61);
  expect(order?.items.reduce((total, item) => total + item.quantity, 0)).toBe(
    1,
  );
});

test("cambiar mesa tras retroceder conserva el pedido anterior", async () => {
  await openCashAndSalon();
  const table = page.getByLabel("Número de mesa");
  const waiter = page.getByLabel(/^Número de mozo/);
  const name = page.getByLabel(/^Nombre de mozo/);
  await table.fill("51");
  await table.press("Enter");
  await expect(waiter).toBeFocused();
  await waiter.fill("1");
  await waiter.press("Enter");
  await expect(name).toBeFocused();
  await name.press("Enter");
  const quantity = page.getByLabel("Cantidad");
  await expect(quantity).toBeFocused();
  await quantity.press("Shift+Enter");
  await name.press("Shift+Enter");
  await waiter.press("Shift+Enter");
  await expect(table).toBeFocused();
  await table.fill("52");
  await table.press("Enter");
  await expect(waiter).toBeFocused();
  await waiter.fill("1");
  await waiter.press("Enter");
  await expect(name).toBeFocused();
  await name.press("Enter");
  await expect(quantity).toBeFocused();
  await quantity.fill("1");
  await page.getByLabel("Código / ID").fill("MUZG");
  await page.getByRole("button", { name: /Agregar/ }).click();
  const orders = await page.evaluate(
    async () => (await window.gastronomy.bootstrap()).orders,
  );
  const oldOrder = orders.find((order) => order.tableNumber === 51);
  const newOrder = orders.find((order) => order.tableNumber === 52);
  expect(oldOrder?.items ?? []).toHaveLength(0);
  expect(
    newOrder?.items.reduce((total, item) => total + item.quantity, 0),
  ).toBe(1);
});

test("precio manual conserva autorización PIN y Tab legacy completa la mesa", async () => {
  await openCashAndSalon();
  const table = page.getByLabel("Número de mesa");
  await table.fill("41");
  await table.press("Tab");
  await expect(page.getByText(/Mesa 41 (creada|lista)/)).toBeVisible();
  await page.getByLabel(/^Número de mozo/).fill("1");
  await page.getByLabel(/^Nombre de mozo/).press("Tab");
  const quantity = page.getByLabel("Cantidad");
  await expect(quantity).toBeFocused();
  await quantity.fill("1");
  await page.getByLabel("Código / ID").fill("MUZG");
  await page.getByLabel("Precio salón").fill("9999");
  await page.getByRole("button", { name: /Agregar/ }).click();
  await expect(
    page.getByRole("dialog", { name: "Autorizar precio manual" }),
  ).toBeVisible();
  await page
    .getByRole("dialog", { name: "Autorizar precio manual" })
    .getByRole("button", { name: "Volver sin modificar el precio" })
    .click();
  await page
    .getByRole("button", { name: "Nueva mesa", exact: true })
    .first()
    .click();
});
