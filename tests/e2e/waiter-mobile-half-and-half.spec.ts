import { test, expect } from "@playwright/test";
import { createServer } from "node:http";

test("QR móvil agrega pizzas enteras o mitad y mitad con notas independientes", async ({ browser }) => {
  const { waiterHtml } = await import("../../apps/orders-service/dist/waiter-page.js");
  const server = createServer((req, res) => {
    res.writeHead(req.url === "/waiter" ? 200 : 404, { "content-type": "text/html; charset=utf-8" });
    res.end(req.url === "/waiter" ? waiterHtml : "Not found");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test server");
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await context.newPage();
  const state = {
    serverNow: new Date().toISOString(), cashSessionId: "cash-test", validUntil: "CASH_CLOSE",
    waiter: { id: "waiter-test", name: "Ana" },
    tables: [{ id: "table-1", number: 1, name: "Mesa 1", openOrderId: null }],
    menu: { halfAndHalfEnabled: true, categories: [{ id: "food", name: "Comidas" }], products: [
      { id: "muzza", name: "Pizza Muzzarella", categoryId: "food", halfAndHalfGroupId: "pizzas", priceMinor: 1200, halfAndHalfPricingMode: "HALF_PLUS_HALF" },
      { id: "napo", name: "Pizza Napolitana", categoryId: "food", halfAndHalfGroupId: "pizzas", priceMinor: 1400, halfAndHalfPricingMode: "HALF_PLUS_HALF" },
      { id: "fugazza", name: "Pizza Fugazza", categoryId: "food", halfAndHalfGroupId: "pizzas", priceMinor: 1300, halfAndHalfPricingMode: "HALF_PLUS_HALF" },
      { id: "empanada", name: "Empanada", categoryId: "food", halfAndHalfGroupId: null, priceMinor: 900 },
    ] },
  };
  let submitted: any[] = [];
  await page.addInitScript(() => {
    sessionStorage.setItem("waiter:tenant:v1", "test-tenant");
    sessionStorage.setItem("waiter:terminal:v1", "test-terminal");
    sessionStorage.setItem("waiter:session:v1", "test-token");
  });
  await page.route("**/v1/waiter/**", async (route) => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname === "/v1/waiter/rpc" && request.method() === "POST") {
      const body = request.postDataJSON();
      if (body.method === "waiter.getState") {
        await route.fulfill({ status: 200, json: { requestId: "state-request" } }); return;
      }
      if (body.method === "waiter.submitBatch") {
        submitted = body.params.lines;
        await route.fulfill({ status: 200, json: { requestId: body.requestId } }); return;
      }
    }
    if (url.pathname === "/v1/waiter/requests/state-request") {
      await route.fulfill({ json: { status: "completed", result: state } }); return;
    }
    if (url.pathname.startsWith("/v1/waiter/requests/") && request.method() === "GET") {
      const id = url.pathname.split("/").pop()!;
      const result = { requestId: id, status: "accepted", acceptedLineIds: submitted.map((line) => line.lineId), orderId: "order-1", printStatus: "registered" };
      await route.fulfill({ json: { status: "completed", result } }); return;
    }
    await route.fulfill({ status: 500, json: { error: "Unmocked request" } });
  });
  try {
    await page.goto(`http://127.0.0.1:${address.port}/waiter`);
    await page.getByRole("button", { name: "Agregar Pizza Muzzarella", exact: true }).click();
    const dialog = page.locator("#itemDialog");
    await expect(dialog).toBeHidden();
    await expect(page.locator("#draft strong")).toHaveText(["Pizza Muzzarella × 1"]);
    await page.getByRole("button", { name: "Observaciones: Pizza Muzzarella", exact: true }).click();
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Observaciones").fill("Extra crocante");
    await dialog.getByRole("button", { name: "Guardar nota", exact: true }).click();
    await expect(page.locator("#draft strong")).toHaveText(["Pizza Muzzarella × 1"]);
    await page.setViewportSize({ width: 320, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    await page.screenshot({ path: test.info().outputPath("waiter-pizza-actions-320.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });

    const halves = page.getByRole("button", { name: "Mitad y mitad: Pizza Muzzarella", exact: true });
    await halves.click();
    await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
    await expect(page.locator("#draft strong")).toHaveText(["Pizza Muzzarella × 1"]);
    await halves.click();
    await expect(dialog.getByLabel("Otra mitad", { exact: true }).locator("option", { hasText: "Empanada" })).toHaveCount(0);
    await expect(dialog.getByLabel("Observaciones")).toBeHidden();
    await expect(dialog.getByRole("button", { name: "Agregar al pedido" })).toBeHidden();
    await dialog.getByLabel("Otra mitad", { exact: true }).selectOption("napo");
    await expect(dialog).toBeHidden();
    await page.getByRole("button", { name: "Observaciones: Pizza Muzzarella", exact: true }).click();
    await dialog.getByLabel("Observaciones").fill("Sin aceitunas");
    await dialog.getByRole("button", { name: "Guardar nota", exact: true }).click();
    await halves.click();
    await dialog.getByLabel("Otra mitad", { exact: true }).selectOption("fugazza");
    await expect(dialog).toBeHidden();
    await page.getByRole("button", { name: "Observaciones: Pizza Muzzarella", exact: true }).click();
    await dialog.getByLabel("Observaciones").fill("Bien cocida");
    await dialog.getByRole("button", { name: "Guardar nota", exact: true }).click();

    await page.getByRole("button", { name: "Agregar Empanada", exact: true }).click();
    await expect(dialog).toBeHidden();
    const productNote = page.locator("#draft").getByRole("textbox", { name: "Nota para cocina de Empanada" });
    await expect(productNote).toBeVisible();
    await expect(productNote).toBeEditable();
    await productNote.fill("Sin sal");
    // A second empanada is deliberate: + changes quantity, Nota only personalizes it.
    await page.getByRole("button", { name: "Agregar Empanada", exact: true }).click();
    await page.getByRole("button", { name: "Observaciones: Empanada", exact: true }).click();
    await dialog.getByLabel("Observaciones").fill("Sin cebolla");
    await dialog.getByRole("button", { name: "Guardar nota", exact: true }).click();

    await page.locator("#send").click();
    await expect.poll(() => submitted.length).toBe(5);
    expect(submitted).toEqual(expect.arrayContaining([
      expect.objectContaining({ productId: "muzza", note: "Extra crocante" }),
      expect.objectContaining({ productId: "muzza", secondProductId: "napo", note: "Sin aceitunas" }),
      expect.objectContaining({ productId: "muzza", secondProductId: "fugazza", note: "Bien cocida" }),
      expect.objectContaining({ productId: "empanada", note: "Sin sal" }),
      expect.objectContaining({ productId: "empanada", note: "Sin cebolla" }),
    ]));
    expect(submitted.every(line => line.quantity === 1)).toBe(true);
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    }
  } finally {
    await context.close(); server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
