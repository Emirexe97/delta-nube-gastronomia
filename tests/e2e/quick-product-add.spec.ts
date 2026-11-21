import { launchConfiguredPos } from "./pos-fixture";
import { test, expect, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let app: ElectronApplication;
let page: Page;
let userData = "";

test.beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), "gastronomy-quick-add-"));
  app = await launchConfiguredPos({ args: ["apps/desktop-shell", `--user-data-dir=${userData}`], cwd: process.cwd() });
  page = await app.firstWindow();
  await expect(page.getByText("Delta Nube", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Caja" }).click();
  await page.getByRole("button", { name: /Abrir caja/ }).click();
  await page.getByLabel("Cambio / fondo inicial").fill("50000");
  await page.getByRole("dialog", { name: "Abrir caja" }).getByRole("button", { name: "Abrir caja", exact: true }).click();
});

test.afterEach(async () => {
  await app?.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.destroy(); });
  await app?.close();
  if (userData) await rm(userData, { recursive: true, force: true });
});

async function openOrder(table: number) {
  await page.getByRole("link", { name: "Salón" }).click();
  await page.getByLabel("Número de mesa").fill(String(table));
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await page.getByLabel(/^Nombre de mozo/).selectOption({ label: "Administrador" });
  await page.getByRole("button", { name: "Abrir mesa", exact: true }).click();
  return page.getByRole("dialog", { name: /Pedido #\d+ · Salón/ });
}

async function instrumentBootstrap() {
  await app.evaluate(({ ipcMain }) => {
    const channel = "gastronomy:bootstrap";
    const handlers = (ipcMain as any)._invokeHandlers as Map<string, (...args: unknown[]) => unknown>;
    const original = handlers.get(channel);
    if (!original) throw new Error("No se encontró el handler de bootstrap");
    (globalThis as any).__quickAddBootstrapCount = 0;
    handlers.set(channel, async (...args: unknown[]) => {
      (globalThis as any).__quickAddBootstrapCount += 1;
      return original(...args);
    });
  });
}

async function bootstrapCount() {
  return app.evaluate(() => (globalThis as any).__quickAddBootstrapCount as number);
}

test("producto simple se agrega de inmediato por clic/Enter; repetición rápida no duplica la solicitud pendiente", async ({}, info) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const editor = await openOrder(47);
  const search = editor.getByPlaceholder(/Código, nombre, categoría/);
  await search.fill("GAS15");
  const card = editor.locator('[id^="order-editor-product-"]').filter({ hasText: "Gaseosa 1,5 L" });
  await expect(card).toBeVisible();
  await expect(editor.getByRole("button", { name: /^Cantidad y precio/ })).toHaveCount(0);
  await card.dblclick();
  await expect(page.getByRole("dialog", { name: "Agregar · Gaseosa 1,5 L" })).toHaveCount(0);
  const quantity = editor.getByLabel("Cantidad de Gaseosa 1,5 L");
  await expect(quantity).toHaveValue("1");
  await expect(search).toBeFocused();
  await page.screenshot({ path: info.outputPath("quick-add-1366x768.png") });

  await search.fill("GAS15");
  await search.press("Enter");
  await expect(quantity).toHaveValue("2");
  await expect(search).toBeFocused();
});

test("una búsqueda nueva durante una respuesta demorada se conserva al terminar el alta anterior", async () => {
  const editor = await openOrder(50);
  const search = editor.getByPlaceholder(/Código, nombre, categoría/);
  await search.fill("GAS15");
  const card = editor.locator('[id^="order-editor-product-"]').filter({ hasText: "Gaseosa 1,5 L" });
  await expect(card).toHaveCount(1);
  await app.evaluate(({ ipcMain }) => {
    const channel = "gastronomy:addOrderItem";
    const handlers = (ipcMain as any)._invokeHandlers as Map<string, (...args: unknown[]) => unknown>;
    const original = handlers.get(channel);
    if (!original) throw new Error("No se encontró el handler de addOrderItem");
    (globalThis as any).__quickAddPending = false;
    (globalThis as any).__quickAddRelease = null;
    handlers.set(channel, async (...args: unknown[]) => {
      (globalThis as any).__quickAddPending = true;
      await new Promise<void>((resolve) => { (globalThis as any).__quickAddRelease = resolve; });
      return original(...args);
    });
  });
  await card.click();
  await expect.poll(() => app.evaluate(() => (globalThis as any).__quickAddPending as boolean)).toBe(true);
  await search.fill("CAF");
  await expect(search).toHaveValue("CAF");
  await app.evaluate(() => (globalThis as any).__quickAddRelease());
  await expect(editor.getByLabel("Cantidad de Gaseosa 1,5 L")).toHaveValue("1");
  await expect(search).toHaveValue("CAF");
  await expect(search).toBeFocused();
});

test("la cantidad y el precio se editan desde el renglón después de agregar el producto", async () => {
  const editor = await openOrder(48);
  await editor.getByPlaceholder(/Código, nombre, categoría/).fill("GAS15");
  await editor.locator('[id^="order-editor-product-"]').filter({ hasText: "Gaseosa 1,5 L" }).click();
  const quantity = editor.getByLabel("Cantidad de Gaseosa 1,5 L");
  await expect(quantity).toHaveValue("1");
  await editor.getByRole("button", { name: "Sumar una unidad de Gaseosa 1,5 L" }).click();
  await expect(quantity).toHaveValue("2");

  await editor.getByRole("button", { name: "Editar precio de Gaseosa 1,5 L" }).click();
  const modal = page.getByRole("dialog", { name: "Editar precio", exact: true });
  await modal.getByLabel("Precio unitario").fill("9999");
  await modal.getByLabel("PIN de autorización").fill("0000");
  await modal.getByRole("button", { name: "Guardar precio" }).click();
  await expect(modal.getByRole("alert")).toContainText(/PIN/i);
  await modal.getByLabel("PIN de autorización").fill("748259");
  await modal.getByRole("button", { name: "Guardar precio" }).click();
  await expect(modal).toBeHidden();
  await expect(editor.getByRole("article").filter({ hasText: "Gaseosa 1,5 L" })).toContainText("19.998");
});

test("una variante se agrega directo desde el selector y desde su botón en la tarjeta", async () => {
  const variant = await page.evaluate(async () => {
    const api = window.gastronomy;
    const base = (await api.bootstrap()).products.find((product) => product.code === "GAS15")!;
    return api.createProduct({
      categoryId: base.categoryId,
      parentProductId: base.id,
      name: "Gaseosa 1,5 L retornable",
      code: "GAS-RET-E2E",
      prices: [
        { priceListCode: "SALON", amountMinor: 450000 },
        { priceListCode: "TAKEAWAY", amountMinor: 450000 },
        { priceListCode: "DELIVERY", amountMinor: 450000 },
      ],
    });
  });
  await page.reload();
  const editor = await openOrder(51);
  const search = editor.getByPlaceholder(/Código, nombre, categoría/);
  const card = editor.locator('[id^="order-editor-product-"]').filter({ hasText: "Gaseosa 1,5 L" });
  await search.fill("GAS15");
  await card.getByText("Gaseosa 1,5 L", { exact: true }).click();
  const picker = page.getByRole("dialog", { name: "Seleccionar variante / opción · Gaseosa 1,5 L" });
  await picker.getByRole("button", { name: /retornable/ }).press("2");
  await expect(picker).toBeHidden();
  const quantity = editor.getByLabel("Cantidad de " + variant.name);
  await expect(quantity).toHaveValue("1");
  await expect(page.getByRole("dialog", { name: /^Agregar ·/ })).toHaveCount(0);
  await expect(search).toBeFocused();

  await search.fill("GAS15");
  await card.getByTitle(/^Agregar Gaseosa 1,5 L retornable/).press("Enter");
  await expect(quantity).toHaveValue("2");
  await expect(picker).toBeHidden();
});

test("retiro y envío conservan la edición de precio desde el renglón", async () => {
  const orders = await page.evaluate(async () => {
    const api = window.gastronomy;
    return [
      await api.createOrder({ type: "TAKEAWAY", customerName: "Retiro precio QA", customerPhone: "1155550601" }),
      await api.createOrder({
        type: "DELIVERY",
        customerName: "Envío precio QA",
        customerPhone: "1155550600",
        deliveryAddress: "Calle Prueba 123",
      }),
    ];
  });
  await page.reload();
  await page.getByRole("link", { name: "Pedidos", exact: true }).click();
  for (const order of orders) {
    await page.getByText("#" + order.number, { exact: true }).click();
    const editor = page.getByRole("dialog", { name: new RegExp("Pedido #" + order.number + " ·") });
    await editor.getByPlaceholder(/Código, nombre, categoría/).fill("GAS15");
    await editor.locator('[id^="order-editor-product-"]').filter({ hasText: "Gaseosa 1,5 L" }).click();
    await expect(editor.getByLabel("Cantidad de Gaseosa 1,5 L")).toHaveValue("1");
    await editor.getByRole("button", { name: "Editar precio de Gaseosa 1,5 L" }).click();
    const price = page.getByRole("dialog", { name: "Editar precio", exact: true });
    await expect(price.getByLabel("Precio unitario")).not.toHaveValue("");
    await price.getByRole("button", { name: "Cancelar", exact: true }).click();
    await editor.getByRole("button", { name: "Cerrar", exact: true }).click();
    await expect(editor).toBeHidden();
  }
});

test("el alta de borrador evita bootstrap; confirmar refresca y una edición confirmada conserva error de stock", async () => {
  const product = await page.evaluate(async () => {
    const api = window.gastronomy;
    const data = await api.bootstrap();
    await api.saveSettings({ ...data.settings, stockEnabled: true });
    return api.createProduct({
      categoryId: data.categories.find((category) => category.active)!.id,
      name: "Producto stock alta rápida QA",
      code: "QUICK-STOCK-E2E",
      stockMinor: 5000,
      prices: [
        { priceListCode: "SALON", amountMinor: 17500 },
        { priceListCode: "TAKEAWAY", amountMinor: 17500 },
        { priceListCode: "DELIVERY", amountMinor: 17500 },
      ],
    });
  });
  const editor = await openOrder(49);
  const search = editor.getByPlaceholder(/Código, nombre, categoría/);
  const quickAdd = editor.locator('[id^="order-editor-product-"]').filter({ hasText: product.name });
  await search.fill(product.code!);
  await expect(quickAdd).toHaveCount(1);
  await instrumentBootstrap();
  const bootstrapBaseline = await bootstrapCount();
  await quickAdd.click();
  await expect(editor.getByLabel(`Cantidad de ${product.name}`)).toHaveValue("1");
  expect(await bootstrapCount()).toBe(bootstrapBaseline);
  await expect(search).toBeFocused();

  await search.fill(product.code!);
  await search.press("Enter");
  await expect(editor.getByLabel(`Cantidad de ${product.name}`)).toHaveValue("2");
  expect(await bootstrapCount()).toBe(bootstrapBaseline);
  await search.fill(product.code!);
  await search.press("Enter");
  await expect(editor.getByLabel(`Cantidad de ${product.name}`)).toHaveValue("3");
  expect(await bootstrapCount()).toBe(bootstrapBaseline);

  await editor.getByRole("button", { name: "Confirmar pedido" }).click();
  await expect.poll(bootstrapCount).toBeGreaterThan(bootstrapBaseline);
  const state = await page.evaluate(async (productId) => {
    const data = await window.gastronomy.bootstrap();
    const order = data.orders.find((candidate) => candidate.tableNumber === 49)!;
    const stock = data.products.find((candidate) => candidate.id === productId)!.stockMinor;
    return { orderStatus: order.lifecycleStatus, stock };
  }, product.id);
  expect(state.stock).toBe(2000);

  // Confirmed orders intentionally take the full-refresh path, and stock is consumed
  // by confirmed edits as well as by the initial confirmation.
  const confirmedRefreshes = await bootstrapCount();
  await search.fill(product.code!);
  await expect(quickAdd).toHaveCount(1);
  await quickAdd.click();
  await expect(editor.getByLabel(`Cantidad de ${product.name}`)).toHaveValue("4");
  await expect.poll(bootstrapCount).toBeGreaterThan(confirmedRefreshes);
  const updatedState = await page.evaluate(async (productId) => {
    const data = await window.gastronomy.bootstrap();
    return { stock: data.products.find((candidate) => candidate.id === productId)!.stockMinor };
  }, product.id);
  expect(updatedState.stock).toBe(1000);

  // Simulate a concurrent stock change after the product card was rendered. The
  // server rejects the stale click; the existing confirmed line and search survive.
  await page.evaluate(async (productId) => {
    await window.gastronomy.adjustStock({ productId, newStockMinor: 0, reason: "Conteo concurrente E2E", authorizerPin: "748259" });
  }, product.id);
  await search.fill(product.code!);
  await expect(quickAdd).toHaveCount(1);
  await quickAdd.click();
  await expect(editor.getByRole("alert")).toContainText(/stock|disponible|insuficiente/i);
  await expect(search).toHaveValue(product.code!);
  await expect(editor.getByLabel(`Cantidad de ${product.name}`)).toHaveValue("4");
});
