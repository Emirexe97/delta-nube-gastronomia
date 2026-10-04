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
let userData = "";

async function launch() {
  userData = await mkdtemp(join(tmpdir(), "gastronomy-order-shortcuts-"));
  app = await electron.launch({
    args: ["apps/desktop-shell", `--user-data-dir=${userData}`],
    cwd: process.cwd(),
  });
  page = await app.firstWindow();
  await expect(page.getByText("Delta Nube", { exact: true })).toBeVisible();
  return page.evaluate(async () => {
    const api = window.gastronomy;
    const data = await api.bootstrap();
    if (!data.cashSession) {
      await api.openCashSession({ openingAmountMinor: 5_000_000 });
    }
    const product = data.products[0]!;
    const order = await api.createOrder({
      type: "TAKEAWAY",
      customerName: "Atajos anidados E2E",
      customerPhone: "11 5555-4455",
    });
    await api.addOrderItem({ orderId: order.id, productId: product.id });
    await api.confirmOrder({ orderId: order.id });
    return order.id;
  });
}

async function openEditor() {
  await page.reload();
  await page.getByRole("link", { name: "Pedidos" }).click();
  await page
    .getByRole("row")
    .filter({ hasText: "Atajos anidados E2E" })
    .click();
  const editor = page.getByRole("dialog", {
    name: /Pedido #\d+ · Para retirar/,
  });
  await expect(editor).toBeVisible();
  return editor;
}

test.afterEach(async () => {
  await app?.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) window.destroy();
  });
  await app?.close();
  if (userData) await rm(userData, { recursive: true, force: true });
});

test("los atajos no abren diálogos sobre el modal de seña", async () => {
  await launch();
  const editor = await openEditor();

  await editor.getByRole("button", { name: "Restar seña" }).click();
  const deposit = page.getByRole("dialog", { name: "Restar seña" });
  await expect(deposit).toBeVisible();

  await page.keyboard.press("F6");
  await expect(deposit).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "Pizza mitad y mitad" }),
  ).toHaveCount(0);
  await page.keyboard.press("F8");
  await expect(deposit).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Cobrar pedido" })).toHaveCount(
    0,
  );

  await page.keyboard.press("Escape");
  await expect(deposit).toBeHidden();
  await expect(editor).toBeVisible();
});

test("los atajos no abren diálogos sobre la confirmación de reimpresión", async () => {
  const orderId = await launch();
  await app.evaluate(({ app: electronApp, BrowserWindow }) => {
    const installPrintMock = (window: any) => {
      window.webContents.getPrintersAsync = async () => [
        { name: "Mock Printer", isDefault: true },
      ];
      window.webContents.print = (_options, callback) => callback(true);
    };
    electronApp.on("browser-window-created", (_event: unknown, window: any) => {
      installPrintMock(window);
    });
    for (const window of BrowserWindow.getAllWindows()) {
      installPrintMock(window);
    }
  });
  await page.evaluate(async () => {
    const api = window.gastronomy;
    const data = await api.bootstrap();
    await api.saveSettings({
      ...data.settings,
      printing: {
        ...data.settings.printing,
        kitchen: {
          ...data.settings.printing.kitchen,
          mode: "SYSTEM_DIRECT",
          deviceName: "Mock Printer",
        },
      },
    });
  });
  await page.evaluate(async (id) => {
    await window.gastronomy.printOrder({ orderId: id, kind: "KITCHEN_ORDER" });
  }, orderId);
  const editor = await openEditor();

  await editor.getByRole("button", { name: "Reimprimir comanda" }).click();
  const reprint = page.getByRole("dialog", { name: "Confirmar reimpresión" });
  await expect(reprint).toBeVisible();

  await page.keyboard.press("F6");
  await expect(reprint).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "Pizza mitad y mitad" }),
  ).toHaveCount(0);
  await page.keyboard.press("F8");
  await expect(reprint).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Cobrar pedido" })).toHaveCount(
    0,
  );

  await page.keyboard.press("Escape");
  await expect(reprint).toBeHidden();
  await expect(editor).toBeVisible();
});
