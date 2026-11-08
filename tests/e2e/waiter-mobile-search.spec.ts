import { test, expect } from "@playwright/test";
import { createServer } from "node:http";

test("buscador móvil de mozos busca sin tildes en todas las categorías y permite agregar y limpiar", async ({ browser }) => {
  const { waiterHtml } = await import("../../apps/orders-service/dist/waiter-page.js");
  const server = createServer((req, res) => {
    res.writeHead(req.url === "/waiter" ? 200 : 404, { "content-type": "text/html; charset=utf-8" });
    res.end(req.url === "/waiter" ? waiterHtml : "Not found");
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test server");
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await context.newPage();
  // Keep the toast timeout deterministic while still exercising its real timer.
  await page.clock.install();
  const state = {
    serverNow: new Date().toISOString(), cashSessionId: "test-cash", validUntil: "CASH_CLOSE",
    waiter: { id: "test-waiter", name: "Ana" },
    tables: [{ id: "table-1", number: 1, name: "Mesa 1", openOrderId: null as string | null }],
    menu: { categories: [{ id: "food", name: "Comidas" }, { id: "drinks", name: "Bebidas" }], products: [
      { id: "p1", name: "Café con leche", categoryId: "food" },
      { id: "p2", name: "Café frío", categoryId: "drinks" },
      { id: "p3", name: "Té", categoryId: "drinks" },
    ] },
  };
  await page.addInitScript(() => {
    sessionStorage.setItem("waiter:tenant:v1", "test-tenant");
    sessionStorage.setItem("waiter:terminal:v1", "test-terminal");
    sessionStorage.setItem("waiter:session:v1", "test-token");
  });
  await page.route("**/v1/waiter/**", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname === "/v1/waiter/rpc" && request.method() === "POST" && request.postDataJSON().method === "waiter.getState") {
      await route.fulfill({ status: 200, json: { requestId: "get-state" } }); return;
    }
    if (url.pathname === "/v1/waiter/requests/get-state" && request.method() === "GET") {
      await route.fulfill({ json: { status: "completed", result: state } }); return;
    }
    await route.fulfill({ status: 500, json: { error: "Unmocked request" } });
  });
  try {
    await page.goto(`http://127.0.0.1:${address.port}/waiter`);
    const search = page.getByRole("searchbox", { name: "Buscar productos" });
    await expect(search).toBeVisible();
    await expect(page.locator("#catalogSearch")).toHaveJSProperty("hidden", false);
    expect(await page.evaluate(() => {
      const search = document.querySelector("#catalogSearch");
      const products = document.querySelector("#products");
      return Boolean(search && products && products.previousElementSibling === search);
    })).toBe(true);
    const searchBounds = await search.boundingBox();
    expect(searchBounds).not.toBeNull();
    expect(searchBounds!.y).toBeGreaterThanOrEqual(0);
    expect(searchBounds!.y + searchBounds!.height).toBeLessThanOrEqual(844);
    await search.fill("cafe");
    await expect(page.getByRole("button", { name: "Agregar Café con leche", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Agregar Café frío", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Agregar Té", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Agregar Café frío", exact: true }).click();
    await expect(page.locator("#draft strong")).toContainText("Café frío");
    await expect(page.locator(".product").filter({ hasText: "Café frío" })).toContainText("1 en pedido");
    const toast = page.locator("#addedToast");
    await expect(toast).toBeVisible();
    await expect(toast).toContainText("Café frío");
    await page.clock.runFor(2500);
    await expect(toast).toBeVisible();
    await page.getByRole("button", { name: "Agregar Café frío", exact: true }).click();
    await expect(page.locator(".product").filter({ hasText: "Café frío" })).toContainText("2 en pedido");
    await expect(toast).toBeVisible();
    await expect(toast).toContainText("Café frío");
    // The second add restarts the 3-second dismissal timer.
    await page.clock.runFor(2500);
    await expect(toast).toBeVisible();
    await page.clock.runFor(500);
    await expect(toast).toBeHidden();
    await search.fill("inexistente");
    await expect(page.getByText("No se encontraron productos.")).toBeVisible();
    await page.getByRole("button", { name: "Limpiar", exact: true }).click();
    await expect(search).toHaveValue("");
    await expect(page.getByRole("button", { name: "Agregar Té", exact: true })).toHaveCount(0);
    await expect(page.locator("#draft strong")).toContainText("Café frío × 2");
    await expect(page.getByRole("button", { name: "Agregar Café con leche", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  } finally {
    await context.close(); server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
