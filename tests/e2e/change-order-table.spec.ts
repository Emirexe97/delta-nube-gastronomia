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

test.beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), "gastronomy-change-table-"));
  app = await electron.launch({
    args: ["apps/desktop-shell", `--user-data-dir=${userData}`],
    cwd: process.cwd(),
  });
  page = await app.firstWindow();
  await page.getByRole("link", { name: "Caja" }).click();
  await page.getByRole("button", { name: /Abrir caja/ }).click();
  await page.getByLabel("Cambio / fondo inicial").fill("0");
  await page
    .getByRole("dialog", { name: "Abrir caja" })
    .getByRole("button", { name: "Abrir caja", exact: true })
    .click();
  await page.getByRole("link", { name: "Salón" }).click();
  await page.evaluate(async () => {
    for (const number of [61, 62]) {
      await window.gastronomy.ensureTable({ number });
    }
  });
  await page.reload();
  await page.getByRole("link", { name: "Salón" }).click();
  await expect(page.getByLabel("Mesas del salón")).toBeVisible();
});

test.afterEach(async () => {
  await app?.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) window.destroy();
  });
  await app?.close();
  await rm(userData, { recursive: true, force: true });
});

test("traslada pedido de mesa 61 a mesa 62 con PIN y actualiza la ocupación", async () => {
  // Abrir Mesa 61
  await page.getByRole("button", { name: "Abrir mesa 61", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Abrir mesa 61" })
    .getByRole("button", { name: "Abrir mesa", exact: true })
    .click();

  // El editor de pedidos debe estar visible con descripción Mesa 61
  const orderDialog = page.getByRole("dialog", { name: /Pedido #\d+ · Salón/ });
  await expect(orderDialog).toBeVisible();
  await expect(orderDialog.getByText("Mesa 61", { exact: true })).toBeVisible();

  // Agregar un producto
  await page.getByRole("button", { name: /Muzzarella grande/i }).first().click();
  await page.getByRole("button", { name: "Agregar a la mesa" }).click();

  // Debe aparecer el botón "Cambiar de mesa"
  const changeTableBtn = page.getByRole("button", { name: /Cambiar de mesa/i });
  await expect(changeTableBtn).toBeVisible();
  await changeTableBtn.click();

  // Se abre el modal "Cambiar de mesa"
  const modal = page.getByRole("dialog", { name: "Cambiar de mesa" });
  await expect(modal).toBeVisible();

  // Mesa destino: seleccionar Mesa 62
  await modal.getByLabel("Mesa de destino").selectOption({ label: "Mesa 62" });

  // Ingresar PIN incorrecto primero
  await modal.getByLabel("PIN de autorización").fill("9999");
  await modal.getByRole("button", { name: /Confirmar traslado/i }).click();
  await expect(modal.getByRole("alert")).toBeVisible();

  // Ingresar PIN correcto
  await modal.getByLabel("PIN de autorización").fill("1234");
  await modal.getByRole("button", { name: /Confirmar traslado/i }).click();

  // El modal se cierra y la cabecera del editor ahora indica Mesa 62
  await expect(modal).not.toBeVisible();
  await expect(orderDialog.getByText("Mesa 62", { exact: true })).toBeVisible();

  // Cerrar el editor de pedidos con Escape
  await page.keyboard.press("Escape");

  // Comprobar en el salón que Mesa 61 quedó libre y Mesa 62 quedó ocupada
  const card61 = page.getByText("Mesa 61", { exact: true }).locator("..");
  const card62 = page.getByText("Mesa 62", { exact: true }).locator("..");
  await expect(card61.getByText(/Libre/i)).toBeVisible();
  await expect(card62.getByText(/Ocupada/i)).toBeVisible();
});
