import { test, expect } from "@playwright/test";
import { createServer } from "node:http";

type Rpc = { method: string; requestId?: string; params?: Record<string, any> };

test("el mozo abre mesas por número y busca la otra mitad sin perder el flujo habitual", async ({ browser }) => {
  const { waiterHtml } = await import("../../apps/orders-service/dist/waiter-page.js");
  const state = {
    serverNow: new Date().toISOString(), cashSessionId: "cash-test", validUntil: "CASH_CLOSE",
    waiter: { id: "waiter-test", name: "Ana" },
    tables: [
      { id: "table-2", number: 2, name: "Mesa 2", openOrderId: null },
      { id: "table-12", number: 12, name: "Mesa 12", openOrderId: null },
      { id: "table-20", number: 20, name: "Mesa 20", openOrderId: "order-20", servedByMe: true },
    ],
    waiterTableWorkflow: true,
    menu: { halfAndHalfEnabled: true, categories: [{ id: "food", name: "Comidas" }], products: [
      { id: "muzza", name: "Pizza Muzzarella", categoryId: "food", halfEligible: true },
      { id: "napo", name: "Pizza Napolitana", categoryId: "food", halfEligible: true },
      { id: "fugazza", name: "Pizza Fugazza", categoryId: "food", halfEligible: true },
      { id: "roquefort", name: "Pizza Roquefort", categoryId: "food", halfEligible: true },
      { id: "jamon", name: "Pizza Jamón y morrones", categoryId: "food", halfEligible: true },
      { id: "empanada", name: "Empanada", categoryId: "food", halfEligible: false },
    ] },
  };
  const calls: Rpc[] = [];
  const submitted: Array<Record<string, any>> = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    res.setHeader("content-type", "text/html; charset=utf-8");
    if (url.pathname === "/waiter") { res.end(waiterHtml); return; }
    if (url.pathname === "/v1/waiter/rpc" && req.method === "POST") {
      let raw = "";
      req.on("data", (chunk) => raw += chunk);
      req.on("end", () => {
        const call = JSON.parse(raw) as Rpc;
        calls.push(call);
        if (call.method === "waiter.submitBatch") submitted.push(...(call.params?.lines ?? []));
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ requestId: call.requestId ?? `request-${calls.length}` }));
      });
      return;
    }
    if (url.pathname.startsWith("/v1/waiter/requests/")) {
      const call = calls.find((item) => item.requestId === url.pathname.split("/").at(-1));
      res.setHeader("content-type", "application/json");
      const result = call?.method === "waiter.getState" ? state
        : call?.method === "waiter.getTable" ? {
          tableId: call.params?.tableId,
          orderId: state.tables.find((table) => table.id === call.params?.tableId)?.openOrderId ?? null,
          items: [], canPrint: false, canReprint: false,
        }
        : call?.method === "waiter.submitBatch" ? { requestId: call.requestId, orderId: "order-created", status: "RECORDED", acceptedLineIds: submitted.map((line) => line.lineId) }
        : { ok: true };
      res.end(JSON.stringify({ status: "completed", result }));
      return;
    }
    res.statusCode = 404; res.end("Not found");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test server");
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await context.newPage();
  await page.addInitScript(() => {
    sessionStorage.setItem("waiter:tenant:v1", "test-tenant");
    sessionStorage.setItem("waiter:terminal:v1", "test-terminal");
    sessionStorage.setItem("waiter:session:v1", "test-token");
  });
  await page.route("**/v1/waiter/**", (route) => route.continue());

  try {
    await page.goto(`http://127.0.0.1:${address.port}/waiter`);
    await expect(page.locator("#table")).toBeVisible();
    const table = page.locator("#table");
    const myTables = page.locator("#myTablesSection");
    await expect(myTables).toBeVisible();
    await myTables.getByRole("button", { name: "Mesa 20", exact: true }).click();
    await expect(table).toHaveValue("table-20");
    const lookup = page.locator("#tableLookup");
    await expect(lookup).toBeVisible();
    await expect(lookup.getByLabel("Número de mesa")).toBeVisible();

    // Exact numeric match: "2" must not select the similarly numbered 20.
    await lookup.getByLabel("Número de mesa").fill("2");
    await lookup.getByRole("button", { name: "Abrir mesa", exact: true }).click();
    await expect(table).toHaveValue("table-2");
    await expect.poll(() => calls.some((call) => call.method === "waiter.getTable" && call.params?.tableId === "table-2")).toBe(true);

    // Invalid lookups preserve the current selection, and Enter submits too.
    await lookup.getByLabel("Número de mesa").fill("999");
    await lookup.getByRole("button", { name: "Abrir mesa", exact: true }).click();
    await expect(page.locator("#tableLookupMessage")).toBeVisible();
    await expect(table).toHaveValue("table-2");
    await lookup.getByLabel("Número de mesa").fill("12");
    await lookup.getByLabel("Número de mesa").press("Enter");
    await expect(table).toHaveValue("table-12");

    // Traditional selector and the existing Mis mesas shortcut remain usable.
    await table.selectOption("table-20");
    await expect(table).toHaveValue("table-20");

    // Adding a draft locks table switching; the fallback select stays visible.
    await page.locator("#openMenu").click();
    await page.getByRole("button", { name: "Agregar Pizza Muzzarella", exact: true }).click();
    const dialog = page.locator("#itemDialog");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Tipo de pizza").selectOption("half");
    const search = dialog.getByLabel("Buscar otra mitad");
    await expect(search).toBeVisible();
    await search.fill("napo");
    const second = dialog.locator("#secondProduct");
    await expect(second.locator("option")).toHaveCount(2); // placeholder + Napolitana
    await expect(second.locator("option", { hasText: "Muzzarella" })).toHaveCount(0);
    await expect(second.locator("option", { hasText: "Napolitana" })).toHaveCount(1);
    await second.selectOption("napo");
    await dialog.getByRole("button", { name: "Agregar al pedido", exact: true }).click();
    await expect(page.locator("#draft")).toContainText("mitad");
    await expect(table).toBeVisible();
    await expect(table).toBeDisabled();
    await expect(lookup.getByLabel("Número de mesa")).toBeDisabled();
    await expect(lookup.getByRole("button", { name: "Abrir mesa", exact: true })).toBeDisabled();
    await expect(table).toHaveValue("table-20");

    // Search normalization and empty feedback are independent of the menu search.
    await page.getByRole("button", { name: "Agregar Pizza Muzzarella", exact: true }).click();
    await expect(dialog.getByLabel("Buscar otra mitad")).toHaveValue("");
    await expect(second).toHaveValue("");
    await dialog.getByLabel("Tipo de pizza").selectOption("half");
    await search.fill("Pizza");
    await expect(second).toHaveValue("");
    await dialog.getByLabel("Buscar otra mitad").fill("roque");
    await expect(second.locator("option", { hasText: "Roquefort" })).toHaveCount(1);
    await dialog.getByLabel("Buscar otra mitad").fill("JAMON");
    await expect(second.locator("option", { hasText: "Jamón y morrones" })).toHaveCount(1);
    await expect(second).toHaveValue("jamon");
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    const screenshot = test.info().outputPath("waiter-half-pizza-search.png");
    await page.screenshot({ path: screenshot, fullPage: true });
    await test.info().attach("waiter-half-pizza-search", { path: screenshot, contentType: "image/png" });
    await dialog.getByLabel("Buscar otra mitad").fill("zz-no-existe");
    await expect(dialog.locator("#secondProductMessage")).toBeVisible();
    await expect(second).toHaveValue("");
    await dialog.getByRole("button", { name: "Agregar al pedido", exact: true }).click();
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Buscar otra mitad").fill("fugazza");
    await expect(second).toHaveValue("fugazza");
    await search.press("Enter");
    await expect(dialog).toBeHidden();
    await page.locator("#confirmOnly").click();
    await expect.poll(() => calls.some((call) => call.method === "waiter.submitBatch")).toBe(true);
    expect(submitted).toEqual(expect.arrayContaining([
      expect.objectContaining({ productId: "muzza", secondProductId: "napo" }),
      expect.objectContaining({ productId: "muzza", secondProductId: "fugazza" }),
    ]));
  } finally {
    await context.close(); server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
