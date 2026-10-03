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

async function expectOrderEditor(tableNumber: number) {
  const editor = page.getByRole("dialog").last();
  await expect(editor).toBeVisible();
  await expect(editor).toContainText(/Pedido #/);
  await expect(editor).toContainText(`Mesa ${tableNumber}`);
  await expect(
    editor.getByPlaceholder(/Código, nombre, categoría/),
  ).toBeVisible();
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

test("abre el modal de productos al confirmar la mesa y el mozo con mouse", async () => {
  await openCashAndSalon();
  await page.getByLabel("Número de mesa").fill("26");
  await page.getByLabel(/^Nombre de mozo/).click();
  await page.getByLabel(/^Nombre de mozo/).selectOption({ index: 1 });
  await page.getByRole("button", { name: "Abrir mesa", exact: true }).click();
  await expectOrderEditor(26);
});

test("abre el modal de productos al avanzar mesa y mozo con teclado", async () => {
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
  await name.press("Enter");
  await expectOrderEditor(31);
  const orders = await page.evaluate(
    async () => (await window.gastronomy.bootstrap()).orders,
  );
  expect(orders.filter((order) => order.tableNumber === 31)).toHaveLength(1);
});
