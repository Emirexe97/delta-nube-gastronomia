import { test, expect } from "@playwright/test";
import { createServer } from "node:http";

type Rpc = { method: string; params?: Record<string, unknown> };

async function openWaiter(page: import("@playwright/test").Page, workflow = true) {
  const { waiterHtml } = await import("../../apps/orders-service/dist/waiter-page.js");
  const calls: Rpc[] = [];
  const table = {
    tableId: "table-12",
    orderId: "order-12",
    items: [{ name: "Empanada previa", quantity: 2, note: "sin picante" }],
    canPrint: true,
    canReprint: true,
  };
  const state = {
    serverNow: new Date().toISOString(), cashSessionId: "test-cash", validUntil: "CASH_CLOSE",
    waiter: { id: "waiter-1", name: "Ana" },
    tables: [{ id: "table-12", number: 12, name: "Mesa 12", openOrderId: "order-12" }],
    menu: { categories: [{ id: "food", name: "Comidas" }], products: [{ id: "dish", name: "Milanesa" }] },
    ...(workflow ? { waiterTableWorkflow: true } : {}),
  };
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
        : call?.method === "waiter.submitBatch" ? {requestId: call.params?.requestId, orderId: table.orderId,
          status: call.params?.printMode === "NONE" ? "RECORDED" : "PRINTED",
          acceptedLineIds: (call.params?.lines as Array<{lineId:string}>).map(line => line.lineId)}
        : { ok: true };
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
  await page.route("**/v1/waiter/**", (route) => route.continue());
  await page.goto(`http://127.0.0.1:${address.port}/waiter`);
  await page.locator("#table").waitFor();
  return { server, calls };
}

test("el flujo de mesa QR separa consumos previos, borrador e impresión por alcance", async ({ page }) => {
  const { server, calls } = await openWaiter(page);
  try {
    await page.locator("#table").selectOption("table-12");
    await expect.poll(() => calls.some((call) => call.method === "waiter.getTable" && call.params?.tableId === "table-12")).toBe(true);
    await expect(page.locator("#tableSummary")).toContainText("Empanada previa");
    await expect(page.locator("#draft")).not.toContainText("Empanada previa");

    await expect(page.locator("#openMenu")).toBeVisible();
    await page.locator("#openMenu").click();
    const add = page.getByRole("button", { name: "Agregar Milanesa", exact: true });
    await expect(add).toBeVisible();
    await add.click();
    await expect(page.locator("#send")).toHaveText("Confirmar e imprimir");
    await expect(page.locator("#confirmOnly")).toHaveText("Confirmar");
    await page.locator("#send").click();
    await expect(page.locator("#scopeFull")).toBeVisible();
    await expect(page.locator("#scopeAdded")).toBeVisible();
    await page.locator("#scopeAdded").click();
    await expect.poll(() => calls.filter((call) => call.method === "waiter.submitBatch").at(-1)?.params?.printMode).toBe("ADDED");

    await page.locator("#openMenu").click();
    await page.getByRole("button", { name: "Agregar Milanesa", exact: true }).click();
    await page.locator("#send").click();
    await expect(page.locator("#scopeFull")).toBeVisible();
    await page.locator("#scopeFull").click();
    await expect.poll(() => calls.filter((call) => call.method === "waiter.submitBatch").at(-1)?.params?.printMode).toBe("FULL");

    await page.locator("#reprint").click();
    await expect(page.locator("#scopeFull")).toBeVisible();
    await page.locator("#scopeAdded").click();
    await expect.poll(() => calls.filter((call) => call.method === "waiter.reprintTable").at(-1)?.params?.scope).toBe("ADDED");
  } finally {
    await page.close(); server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("confirmación secundaria envía sin diálogo y el legacy conserva el envío directo", async ({ page }) => {
  const current = await openWaiter(page, true);
  try {
    await page.locator("#table").selectOption("table-12");
    await page.locator("#openMenu").click();
    await page.getByRole("button", { name: "Agregar Milanesa", exact: true }).click();
    await page.locator("#confirmOnly").click();
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    await expect.poll(() => current.calls.filter((call) => call.method === "waiter.submitBatch").at(-1)?.params?.printMode).toBe("NONE");
    expect(current.calls.some((call) => call.method === "waiter.reprintTable")).toBe(false);
  } finally {
    current.server.closeAllConnections();
    await new Promise<void>((resolve) => current.server.close(() => resolve()));
  }

  const legacyPage = await page.context().newPage();
  const { server, calls } = await openWaiter(legacyPage, false);
  try {
    await legacyPage.locator("#table").selectOption("table-12");
    await legacyPage.getByRole("button", { name: "Agregar Milanesa", exact: true }).click();
    await legacyPage.locator("#send").click();
    await expect(legacyPage.locator("dialog[open]")).toHaveCount(0);
    await expect.poll(() => calls.some((call) => call.method === "waiter.submitBatch" && call.params?.tableId === "table-12")).toBe(true);
    expect(calls.some((call) => call.method === "waiter.getTable")).toBe(false);
  } finally {
    await legacyPage.close(); server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
