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
  userData = await mkdtemp(join(tmpdir(), "gastronomy-table-recovery-"));
  app = await electron.launch({
    args: ["apps/desktop-shell", `--user-data-dir=${userData}`],
    cwd: process.cwd(),
  });
  page = await app.firstWindow();
  await expect(page.getByText("Delta Nube", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Caja" }).click();
  await page.getByRole("button", { name: /Abrir caja/ }).click();
  await page.getByLabel("Cambio / fondo inicial").fill("50000");
  await page
    .getByRole("dialog", { name: "Abrir caja" })
    .getByRole("button", { name: "Abrir caja", exact: true })
    .click();
  await expect(page.getByText(/Caja #\d+/)).toBeVisible();
  await page.getByRole("link", { name: "Salón" }).click();
});

test.afterEach(async () => {
  await app?.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) window.destroy();
  });
  await app?.close();
  if (userData) await rm(userData, { recursive: true, force: true });
});

async function openFromQuickEntry(tableNumber: number) {
  const table = page.getByLabel("Número de mesa");
  await table.fill(String(tableNumber));
  await table.press("Enter");

  const waiterNumber = page.getByLabel(/^Número de mozo/);
  await expect(waiterNumber).toBeFocused();
  await waiterNumber.fill("1");
  await waiterNumber.press("Enter");

  const waiterName = page.getByLabel(/^Nombre de mozo/);
  await expect(waiterName).toBeFocused();
  await waiterName.selectOption({ label: "Administrador" });
  await waiterName.press("Enter");

  const editor = page.getByRole("dialog", { name: /Pedido #\d+ · Salón/ });
  await expect(editor).toBeVisible();
  return editor;
}

async function expectQuickEntryRecovered(nextTableNumber: number) {
  const table = page.getByLabel("Número de mesa");
  await expect(table).toBeEnabled();
  await expect(table).toBeFocused();

  await table.fill(String(nextTableNumber));
  await table.press("Enter");
  await expect(page.getByText(`Mesa ${nextTableNumber} creada`, { exact: true }))
    .toBeVisible();
  await expect(page.getByRole("link", { name: "Salón" })).toBeVisible();
}

test("Escape al cerrar el editor devuelve el foco a carga rápida y permite otra mesa", async () => {
  const editor = await openFromQuickEntry(61);
  await editor.getByPlaceholder(/Código, nombre, categoría/).focus();
  await page.keyboard.press("Escape");
  await expect(editor).toBeHidden();

  await expectQuickEntryRecovered(62);
});

test("cerrar el editor con X devuelve el foco a carga rápida y permite otra mesa", async () => {
  const editor = await openFromQuickEntry(63);
  await editor.getByRole("button", { name: "Cerrar", exact: true }).click();
  await expect(editor).toBeHidden();

  await expectQuickEntryRecovered(64);
});

test("cambiar la mesa mientras se elige mozo sigue disponible sin salir de Salón", async () => {
  const table = page.getByLabel("Número de mesa");
  await table.fill("65");
  await table.press("Enter");
  await expect(page.getByLabel(/^Número de mozo/)).toBeEnabled();

  await expect(table).toBeEnabled();
  await table.fill("66");
  await table.press("Enter");
  await expect(page.getByText("Mesa 66 creada", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Salón" })).toBeVisible();
});

test("cobrar y cerrar mesa devuelve la carga rápida a una nueva mesa", async () => {
  const editor = await openFromQuickEntry(67);
  const search = editor.getByPlaceholder(/Código, nombre, categoría/);
  await search.fill("MUZG");
  await editor.getByRole("button", { name: /Muzzarella grande/ }).click();
  const addProduct = page.getByRole("dialog", {
    name: "Agregar · Muzzarella grande",
  });
  await addProduct.getByRole("button", { name: "Agregar a la mesa" }).click();
  await expect(addProduct).toBeHidden();

  await editor.getByRole("button", { name: "Confirmar pedido" }).click();
  await expect(editor.getByRole("button", { name: "Cobrar" })).toBeEnabled();
  await editor.getByRole("button", { name: "Cobrar" }).click();
  const payment = page.getByRole("dialog", { name: "Cobrar pedido" });
  await payment.getByLabel("Efectivo", { exact: true }).fill("15000");
  await payment.getByRole("button", { name: "Confirmar cobro" }).click();
  await expect(payment).toBeHidden();

  await editor.getByRole("button", { name: "Cerrar mesa" }).click();
  await expect(editor).toBeHidden();
  await expectQuickEntryRecovered(68);
});
