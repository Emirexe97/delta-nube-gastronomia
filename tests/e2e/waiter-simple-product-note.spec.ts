import { test, expect } from "@playwright/test";
import { createServer } from "node:http";

type Rpc = { method: string; params?: Record<string, unknown> };

async function openWaiter(page: import("@playwright/test").Page) {
  const { waiterHtml } = await import("../../apps/orders-service/dist/waiter-page.js");
  const calls: Rpc[] = [];
  const table = { tableId: "table-1", orderId: "order-1", items: [], canPrint: true, canReprint: true };
  const state = {
    serverNow: new Date().toISOString(), cashSessionId: "cash-1", validUntil: "CASH_CLOSE",
    waiter: { id: "waiter-1", name: "Ana" },
    tables: [{ id: "table-1", number: 1, name: "Mesa 1", openOrderId: "order-1" }],
    menu: { categories: [{ id: "food", name: "Comidas" }], products: [{ id: "superpancho", name: "Superpancho", categoryId: "food" }] },
    waiterTableWorkflow: true,
  };
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    res.setHeader("content-type", "text/html; charset=utf-8");
    if (url.pathname === "/waiter") { res.end(waiterHtml); return; }
    if (url.pathname === "/v1/waiter/rpc" && req.method === "POST") {
      let raw = "";
      req.on("data", (chunk) => raw += chunk);
      req.on("end", () => {
        calls.push(JSON.parse(raw) as Rpc);
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ requestId: `request-${calls.length}` }));
      });
      return;
    }
    if (url.pathname.startsWith("/v1/waiter/requests/")) {
      const call = calls[Number(url.pathname.split("-").at(-1)) - 1];
      res.setHeader("content-type", "application/json");
      const result = call?.method === "waiter.getState" ? state
        : call?.method === "waiter.getTable" ? table
        : call?.method === "waiter.submitBatch" ? {
          requestId: call.params?.requestId, orderId: table.orderId, status: "RECORDED",
          acceptedLineIds: (call.params?.lines as Array<{ lineId: string }>).map(line => line.lineId),
        } : { ok: true };
      res.end(JSON.stringify({ status: "completed", result }));
      return;
    }
    res.statusCode = 404; res.end("Not found");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test server");
  await page.addInitScript(() => {
    sessionStorage.setItem("waiter:tenant:v1", "test-tenant");
    sessionStorage.setItem("waiter:terminal:v1", "test-terminal");
    sessionStorage.setItem("waiter:session:v1", "test-token");
  });
  await page.goto(`http://127.0.0.1:${address.port}/waiter`);
  await page.locator("#table").waitFor();
  await page.locator("#table").selectOption("table-1");
  await expect.poll(() => calls.some(call => call.method === "waiter.getTable")).toBe(true);
  await page.locator("#openMenu").click();
  return { server, calls };
}

for (const units of [0, 1, 2]) {
  test(`anotar mayonesa con ${units} superpanchos previos conserva la cantidad correcta al enviar`, async ({ page }) => {
    const { server, calls } = await openWaiter(page);
    try {
      const add = page.getByRole("button", { name: "Agregar Superpancho", exact: true });
      for (let i = 0; i < units; i++) await add.click();
      const openNote = page.getByRole("button", { name: "Observaciones: Superpancho", exact: true });
      const dialog = page.locator("#itemDialog");
      await openNote.click();
      await dialog.getByLabel("Observaciones").fill("mayonesa");
      await dialog.getByRole("button", { name: units ? "Guardar nota" : "Agregar al pedido" }).click();
      // With no plain units left, reopen the existing note; cancel is non-mutating.
      if (units <= 1) {
        await openNote.click();
        await expect(dialog.getByLabel("Observaciones")).toHaveValue("mayonesa");
        await dialog.getByLabel("Observaciones").fill("mostaza");
        await dialog.getByRole("button", { name: "Cancelar" }).click();
      }
      await page.locator("#send").click();
      await page.locator("#scopeAdded").click();
      const expected = [{ productId: "superpancho", quantity: 1, note: "mayonesa" }];
      if (units === 2) expected.unshift({ productId: "superpancho", quantity: 1, note: "" });
      await expect.poll(() => calls.filter(call => call.method === "waiter.submitBatch").map(call => call.params?.lines))
        .toEqual([expected.map(line => expect.objectContaining(line))]);
    } finally {
      await page.close(); server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
}
