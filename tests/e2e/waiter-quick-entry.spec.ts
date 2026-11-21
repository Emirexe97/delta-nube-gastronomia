import { test, expect, type Page } from "@playwright/test";
import { createServer } from "node:http";

type Product = { id: string; name: string; categoryId: string; halfAndHalfGroupId?: string | null; priceMinor?: number };

async function openMenu(page: Page, products: Product[]) {
  const { waiterHtml } = await import("../../apps/orders-service/dist/waiter-page.js");
  const server = createServer((req, res) => {
    res.writeHead(req.url === "/waiter" ? 200 : 404, { "content-type": "text/html; charset=utf-8" });
    res.end(req.url === "/waiter" ? waiterHtml : "Not found");
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  const state = {
    serverNow: new Date().toISOString(), cashSessionId: "cash-quick", validUntil: "CASH_CLOSE",
    waiter: { id: "waiter-quick", name: "Ana" },
    tables: [{ id: "table-1", number: 1, name: "Mesa 1", openOrderId: null }],
    menu: { halfAndHalfEnabled: true, categories: [{ id: "food", name: "Comidas" }, { id: "drinks", name: "Bebidas" }], products },
  };
  const unexpected: string[] = [], errors: string[] = [];
  let refreshes = 0;
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    sessionStorage.setItem("waiter:tenant:v1", "quick-tenant");
    sessionStorage.setItem("waiter:terminal:v1", "quick-terminal");
    sessionStorage.setItem("waiter:session:v1", "quick-token");
  });
  await page.route("**/v1/waiter/**", async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.pathname === "/v1/waiter/rpc" && req.method() === "POST" && req.postDataJSON().method === "waiter.getState") {
      await route.fulfill({ json: { requestId: "quick-state" } }); return;
    }
    if (url.pathname === "/v1/waiter/requests/quick-state" && req.method() === "GET") {
      refreshes++;
      await route.fulfill({ json: { status: "completed", result: state } }); return;
    }
    unexpected.push(req.method() + " " + url.pathname);
    await route.fulfill({ status: 500, json: { error: "Unmocked request" } });
  });
  await page.goto(`http://127.0.0.1:${address.port}/waiter`);
  await expect(page.getByRole("searchbox", { name: "Buscar productos" })).toBeVisible();
  return {
    state,
    async refresh() {
      const before = refreshes;
      await page.locator("#reconnect").click();
      await expect.poll(() => refreshes).toBe(before + 1);
    },
    async close() {
      await page.close(); server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
      expect(unexpected).toEqual([]); expect(errors).toEqual([]);
    },
  };
}

test("menú de 1001 productos renderiza por lotes y busca fuera del lote sin perder borrador", async ({ browser }, testInfo) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await context.newPage();
  const products = Array.from({ length: 1000 }, (_, i) => ({ id: `p${i}`, name: `Producto ${i}`, categoryId: "food" }));
  products.push({ id: "coffee", name: "Café especial", categoryId: "drinks" });
  const fixture = await openMenu(page, products);
  try {
    const rows = page.locator("#products .product");
    const more = page.getByRole("button", { name: /Mostrar más/ });
    const search = page.getByRole("searchbox", { name: "Buscar productos" });
    await expect(rows).toHaveCount(100);
    const node = await rows.first().elementHandle();
    const add = page.getByRole("button", { name: "Agregar Producto 0", exact: true });
    await add.click();
    await expect(rows.first()).toContainText("1 en pedido");
    expect(await node!.evaluate(element => element.isConnected)).toBe(true);
    await more.click();
    await expect(rows).toHaveCount(200);
    await page.getByRole("button", { name: "Agregar Producto 150", exact: true }).click();
    const expandedNode = await rows.first().elementHandle();
    await fixture.refresh();
    await expect(rows).toHaveCount(200);
    expect(await expandedNode!.evaluate(element => element.isConnected)).toBe(true);

    // Searching always covers the entire catalog, not merely rendered rows/category.
    await search.fill("Producto 999");
    await expect(rows).toHaveCount(1);
    await page.getByRole("button", { name: "Agregar Producto 999", exact: true }).click();
    await expect(search).toHaveValue("Producto 999");
    const note = page.getByRole("textbox", { name: "Nota para cocina de Producto 999", exact: true });
    await note.fill("Sin sal");
    await fixture.refresh();
    await expect(search).toHaveValue("Producto 999");
    await expect(note).toHaveValue("Sin sal");
    await search.fill("CAFE");
    await expect(rows).toHaveCount(1);
    await page.getByRole("button", { name: "Agregar Café especial", exact: true }).click();
    await page.getByRole("button", { name: "Limpiar", exact: true }).click();
    await expect(rows).toHaveCount(100);
    await expect(page.locator("#draft strong")).toHaveCount(4);
    await page.getByRole("button", { name: "Bebidas", exact: true }).click();
    await expect(rows).toHaveCount(1);
    await expect(more).toBeHidden();
    fixture.state.menu.products[1000]!.name = "Café actualizado";
    await fixture.refresh();
    await expect(page.getByRole("button", { name: "Agregar Café actualizado", exact: true })).toBeVisible();
    await expect(page.locator("#draft strong").last()).toHaveText("Café actualizado × 1");
    await search.fill("sin-coincidencia");
    await expect(rows).toHaveCount(0);
    await expect(page.getByText("No se encontraron productos.")).toBeVisible();
    await expect(more).toBeHidden();
    await page.getByRole("button", { name: "Limpiar", exact: true }).click();
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    }
    await page.screenshot({ path: testInfo.outputPath("waiter-large-menu.png"), fullPage: true });
  } finally { await fixture.close(); await context.close(); }
});

test("pizza única o mitades deshabilitadas conserva agregado directo y notas sin duplicar", async ({ page }) => {
  const fixture = await openMenu(page, [{ id: "pizza", name: "Pizza única", categoryId: "food", halfAndHalfGroupId: "pizzas", priceMinor: 1200 }]);
  try {
    const add = page.getByRole("button", { name: "Agregar Pizza única", exact: true });
    const halves = page.getByRole("button", { name: "Mitad y mitad: Pizza única", exact: true });
    await expect(halves).toHaveCount(0);
    await add.click();
    const dialog = page.locator("#itemDialog");
    await expect(dialog).toBeHidden();
    await page.getByRole("button", { name: "Observaciones: Pizza única", exact: true }).click();
    await expect(dialog.getByLabel("Tipo de pizza")).toBeHidden();
    await dialog.getByLabel("Observaciones").fill("Bien cocida");
    await dialog.getByRole("button", { name: "Guardar nota", exact: true }).click();
    await expect(page.locator("#draft strong")).toHaveText(["Pizza única × 1"]);
    fixture.state.menu.products.push({ id: "second", name: "Otra pizza", categoryId: "food", halfAndHalfGroupId: "pizzas", priceMinor: 1300 });
    fixture.state.menu.halfAndHalfEnabled = false;
    await fixture.refresh();
    await expect(halves).toHaveCount(0);
    await add.click();
    await expect(dialog).toBeHidden();
    await expect(page.locator("#draft strong")).toHaveText(["Pizza única × 1", "Pizza única × 1"]);
    await expect(page.getByRole("textbox", { name: "Nota para cocina de Pizza única", exact: true }).first()).toHaveValue("Bien cocida");
  } finally { await fixture.close(); }
});

test("un envío pendiente bloquea agregado, notas y mitades sin cambiar líneas ni reenviar", async ({ page }) => {
  const fixture = await openMenu(page, [
    { id: "pizza", name: "Pizza entera", categoryId: "food", halfAndHalfGroupId: "pizzas", priceMinor: 1200 },
    { id: "other", name: "Otra pizza", categoryId: "food", halfAndHalfGroupId: "pizzas", priceMinor: 1300 },
  ]);
  const submissions: Array<{ requestId: string; lines: Array<{ lineId: string; quantity: number }> }> = [];
  await page.route("**/v1/waiter/**", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname === "/v1/waiter/rpc" && request.method() === "POST") {
      const body = request.postDataJSON();
      if (body.method === "waiter.submitBatch" || body.method === "waiter.getBatch") {
        if (body.method === "waiter.submitBatch") submissions.push(body.params);
        await route.fulfill({ json: { requestId: "pending-batch" } }); return;
      }
    }
    if (url.pathname === "/v1/waiter/requests/pending-batch") {
      await route.fulfill({ json: { status: "completed", result: { requestId: submissions[0]?.requestId, status: "PENDING_REVIEW" } } }); return;
    }
    await route.fallback();
  });
  try {
    const add = page.getByRole("button", { name: "Agregar Pizza entera", exact: true });
    const note = page.getByRole("button", { name: "Observaciones: Pizza entera", exact: true });
    const half = page.getByRole("button", { name: "Mitad y mitad: Pizza entera", exact: true });
    await add.click();
    await page.locator("#send").click();
    await expect(page.locator("#pendingTitle")).toContainText("Pedido pendiente de revisión");
    for (const control of [add, note, half]) {
      await expect(control).toBeDisabled();
      await control.dispatchEvent("click"); // handlers also guard against synthetic/stale events
    }
    await expect(page.locator("#itemDialog")).toBeHidden();
    await expect(page.locator("#draft strong")).toHaveText(["Pizza entera × 1"]);
    expect(submissions).toHaveLength(1);
    expect(submissions[0]!.lines).toHaveLength(1);
    expect(submissions[0]!.lines[0]!.quantity).toBe(1);
    const stored = await page.evaluate(() => Object.keys(localStorage)
      .filter(key => key.startsWith("waiter:pending:v1:"))
      .map(key => JSON.parse(localStorage.getItem(key)!)));
    expect(stored).toHaveLength(1);
    expect(stored[0].lines).toEqual(submissions[0]!.lines);
  } finally { await fixture.close(); }
});
