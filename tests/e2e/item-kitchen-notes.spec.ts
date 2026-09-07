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
  userData = await mkdtemp(join(tmpdir(), "gastronomy-item-notes-"));
  app = await electron.launch({
    args: ["apps/desktop-shell", `--user-data-dir=${userData}`],
    cwd: process.cwd(),
  });
  page = await app.firstWindow();
  await expect(page.getByText("Delta Nube", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Caja" }).click();
  await page.getByRole("button", { name: /Abrir caja/ }).click();
  await page.getByLabel("Cambio / fondo inicial").fill("0");
  await page
    .getByRole("dialog", { name: "Abrir caja" })
    .getByRole("button", { name: "Abrir caja", exact: true })
    .click();
});

test.afterEach(async () => {
  await app?.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) window.destroy();
  });
  await app?.close();
  await rm(userData, { recursive: true, force: true });
});

test("agrega, persiste y quita observación de comanda por producto", async () => {
  await page.getByRole("link", { name: "Salón" }).click();
  await page.getByRole("button", { name: "Abrir mesa 1", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Abrir mesa 1" })
    .getByRole("button", { name: "Abrir mesa", exact: true })
    .click();

  const editor = page.getByRole("dialog", { name: /Pedido #\d+ · Salón/ });
  await expect(editor).toBeVisible();
  await editor.getByRole("button", { name: /Muzzarella grande/ }).click();
  const addDialog = page.getByRole("dialog", {
    name: "Agregar · Muzzarella grande",
  });
  await addDialog.getByRole("button", { name: "Agregar a la mesa" }).click();
  await expect(
    editor.getByText("Muzzarella grande", { exact: true }),
  ).toBeVisible();

  await editor
    .getByRole("button", { name: "Agregar observación para Muzzarella grande" })
    .click();
  const notesDialog = page.getByRole("dialog", { name: "Agregar observación" });
  await notesDialog
    .getByLabel("Observación para comanda")
    .fill("SIN CEBOLLA · ALERGIA AL MANÍ");
  await notesDialog
    .getByRole("button", { name: "Guardar", exact: true })
    .click();

  await expect(
    editor.getByText("SIN CEBOLLA · ALERGIA AL MANÍ", { exact: true }),
  ).toBeVisible();
  const persisted = await page.evaluate(async () => {
    const data = await window.gastronomy.bootstrap();
    const order = data.orders.find((candidate) => candidate.tableNumber === 1);
    return order?.items.find(
      (item) => item.productNameSnapshot === "Muzzarella grande",
    )?.notes;
  });
  expect(persisted).toBe("SIN CEBOLLA · ALERGIA AL MANÍ");

  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "Salón" }).click();
  await page
    .getByRole("button", { name: "Abrir pedido de mesa 1", exact: true })
    .click();
  const reopenedEditor = page.getByRole("dialog", {
    name: /Pedido #\d+ · Salón/,
  });
  await reopenedEditor
    .getByRole("button", { name: "Editar observación para Muzzarella grande" })
    .click();
  const editNotesDialog = page.getByRole("dialog", {
    name: "Editar observación",
  });
  await editNotesDialog
    .getByRole("button", { name: "Quitar / limpiar", exact: true })
    .click();

  await expect(
    reopenedEditor.getByText("SIN CEBOLLA · ALERGIA AL MANÍ", { exact: true }),
  ).toHaveCount(0);
  const removed = await page.evaluate(async () => {
    const data = await window.gastronomy.bootstrap();
    const order = data.orders.find((candidate) => candidate.tableNumber === 1);
    return order?.items.find(
      (item) => item.productNameSnapshot === "Muzzarella grande",
    )?.notes;
  });
  expect(removed ?? null).toBeNull();
});
