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
  userData = await mkdtemp(join(tmpdir(), "gastronomy-table-removal-"));
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
    for (const number of [51, 52, 53, 54, 55])
      await window.gastronomy.ensureTable({ number });
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

test("cancelar modal no elimina mesa y confirmar elimina sólo la mesa elegida", async () => {
  const card = page.getByText("Mesa 51", { exact: true }).locator("..");
  await card.getByRole("button", { name: "Eliminar mesa 51" }).click();
  await page
    .getByRole("button", { name: "Cancelar", exact: true })
    .last()
    .click();
  await expect(page.getByText("Mesa 51", { exact: true })).toBeVisible();
  await card.getByRole("button", { name: "Eliminar mesa 51" }).click();
  await page.getByLabel("Confirmación número de mesa").fill("51");
  await page
    .getByRole("button", { name: "Eliminar mesa", exact: true })
    .click();
  await expect(page.getByText("Mesa 51", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Mesa 52", { exact: true })).toBeVisible();
});

test("impide eliminar mesa ocupada con consumo", async () => {
  await page.evaluate(async () => {
    const b = await window.gastronomy.bootstrap();
    const table = b.tables.find((t) => t.number === 53)!;
    const order = await window.gastronomy.createOrder({
      type: "DINE_IN",
      tableId: table.id,
    });
    await window.gastronomy.addOrderItem({
      orderId: order.id,
      productId: b.products.find((p) => p.code === "MUZG")!.id,
    });
  });
  await page.reload();
  await page.getByRole("link", { name: "Salón" }).click();
  await page.getByRole("button", { name: "Eliminar mesa 53" }).click();
  await page.getByLabel("Confirmación número de mesa").fill("53");
  await page
    .getByRole("button", { name: "Eliminar mesa", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    /consumo|pagos|impresiones/,
  );
  await expect(page.getByText("Mesa 53", { exact: true })).toBeVisible();
});

test("elimina pedido vacío y desactiva mesa", async () => {
  await page.evaluate(async () => {
    const b = await window.gastronomy.bootstrap();
    const table = b.tables.find((t) => t.number === 52)!;
    await window.gastronomy.createOrder({ type: "DINE_IN", tableId: table.id });
  });
  await page.reload();
  await page.getByRole("link", { name: "Salón" }).click();
  await page.getByRole("button", { name: "Eliminar mesa 52" }).click();
  await page.getByLabel("Confirmación número de mesa").fill("52");
  await page
    .getByRole("button", { name: "Eliminar mesa", exact: true })
    .click();
  await expect(page.getByText("Mesa 52", { exact: true })).toHaveCount(0);
});

test("confirmación exige escribir número explícito", async () => {
  await page.getByRole("button", { name: "Eliminar mesa 52" }).click();
  await expect(
    page.getByRole("button", { name: "Eliminar mesa", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Mesa 52", { exact: true })).toBeVisible();
});

test("elimina mesa usada por QuickEntry y permite recrearla sin estado latente", async () => {
  const tableInput = page.getByLabel(/^Número de mesa/);
  for (let i = 0; i < 2; i += 1) {
    await tableInput.fill("55");
    await tableInput.press("Enter");
    const waiter = page.getByLabel(/^Número de mozo/);
    await expect(waiter).toBeFocused();
    await waiter.fill("1");
    await waiter.press("Enter");
    const name = page.getByLabel(/^Nombre de mozo/);
    await expect(name).toBeFocused();
    await name.press("Enter");
    await expect(page.getByLabel("Cantidad")).toBeFocused();
    await page.getByRole("button", { name: "Eliminar mesa 55" }).click();
    await page.getByLabel("Confirmación número de mesa").fill("55");
    await page
      .getByRole("button", { name: "Eliminar mesa", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: /Eliminar mesa 55/ }),
    ).toBeHidden();
    await expect(tableInput).toHaveValue("");
    await expect(page.getByText("Mesa 55", { exact: true })).toHaveCount(0);
  }
});
