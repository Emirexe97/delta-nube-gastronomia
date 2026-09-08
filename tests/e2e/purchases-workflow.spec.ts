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
test.beforeAll(async () => {
  userData = await mkdtemp(join(tmpdir(), "gastronomy-purchases-"));
  app = await electron.launch({
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
test.beforeEach(async () => {
  await page.reload();
});
test("muestra Compras y abre formulario de ingreso", async () => {
  await page.getByRole("link", { name: "Compras" }).click();
  await expect(
    page.getByRole("heading", { name: /Compras e ingresos/i }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Registrar ingreso/i }).click();
  await expect(
    page.getByRole("heading", { name: /Registrar ingreso/i }),
  ).toBeVisible();
  await expect(page.getByLabel("Proveedor")).toBeVisible();
});
test("valida formulario vacío", async () => {
  await page.getByRole("link", { name: "Compras" }).click();
  await page.getByRole("button", { name: /Registrar ingreso/i }).click();
  await page.getByRole("button", { name: /Confirmar ingreso/i }).click();
  await expect(page.getByRole("alert")).toContainText(/Completá proveedor/i);
});

test("registra una compra e incrementa el stock", async () => {
  const before = await page.evaluate(async () => {
    const data = await window.gastronomy.bootstrap();
    const product = data.products.find((item) => item.active)!;
    return {
      productId: product.id,
      productName: product.name,
      stockMinor: product.stockMinor ?? 0,
    };
  });
  await page.getByRole("link", { name: "Compras" }).click();
  await page.getByRole("button", { name: /Registrar ingreso/i }).click();
  const dialog = page.getByRole("dialog", { name: /Registrar ingreso/i });
  await dialog.getByLabel("Proveedor").fill("Proveedor E2E");
  await dialog.getByLabel("Comprobante").fill("FAC-E2E-1");
  await dialog.getByLabel("Producto").selectOption(before.productId);
  await dialog.getByLabel("Cantidad").fill("2,5");
  await dialog.getByLabel("Costo unit.").fill("100");
  await dialog.getByLabel("PIN autorizador").fill("1234");
  await dialog.getByRole("button", { name: "Confirmar ingreso" }).click();

  await expect(page.getByText("Proveedor E2E", { exact: true })).toBeVisible();
  await expect(page.getByText("FAC-E2E-1", { exact: false })).toBeVisible();
  const persisted = await page.evaluate(async (productId) => {
    const [data, purchases] = await Promise.all([
      window.gastronomy.bootstrap(),
      window.gastronomy.listPurchases(),
    ]);
    return {
      stockMinor: data.products.find((item) => item.id === productId)
        ?.stockMinor,
      purchase: purchases[0],
    };
  }, before.productId);
  expect(persisted.stockMinor).toBe(before.stockMinor + 2_500);
  expect(persisted.purchase).toMatchObject({
    supplierName: "Proveedor E2E",
    invoiceNumber: "FAC-E2E-1",
    totalMinor: 25_000,
  });
  expect(persisted.purchase?.items[0]).toMatchObject({
    productId: before.productId,
    productName: before.productName,
    quantityMinor: 2_500,
  });
});
