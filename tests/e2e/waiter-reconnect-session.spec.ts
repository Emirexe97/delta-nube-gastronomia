import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { createServer } from "node:http";

type Rpc = { method: string; params?: Record<string, unknown> };

async function fixture(context: BrowserContext, state: Record<string, any>) {
  const { waiterHtml } = await import("../../apps/orders-service/dist/waiter-page.js");
  const calls: Rpc[] = [];
  const authEvidence: string[] = [];
  const authModes: Array<"normal" | "offline-once" | "unauthorized"> = ["normal"];
  let offlineConsumed = false;
  const tableDetail = { tableId: "table-owned", orderId: "order-1", items: [], canPrint: true, canReprint: false };
  const server = createServer((req, res) => {
    if (req.url === "/waiter") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(waiterHtml); return;
    }
    res.writeHead(404); res.end("Not found");
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test server");
  const origin = `http://127.0.0.1:${address.port}`;
  await context.route("**/v1/waiter/**", async route => {
    const request = route.request(), url = new URL(request.url());
    const headers = request.headers();
    const authenticated = Boolean(headers.authorization?.startsWith("Bearer ") || headers.cookie?.includes("waiter_session="));
    if (!authenticated) {
      await route.fulfill({ status: 401, json: { error: "unauthorized" } });
      return;
    }
    authEvidence.push(headers.authorization?.startsWith("Bearer ") ? "bearer" : "cookie");
    if (url.pathname === "/v1/waiter/rpc" && request.method() === "POST") {
      const call = request.postDataJSON() as Rpc;
      calls.push(call);
      const mode = authModes.at(-1);
      if (mode === "offline-once" && call.method === "waiter.getState" && !offlineConsumed) {
        offlineConsumed = true;
        await route.fulfill({ status: 503, json: { error: "offline" } });
        return;
      }
      if (mode === "unauthorized" && call.method === "waiter.getState") {
        await route.fulfill({ status: 401, json: { error: "unauthorized" } });
        return;
      }
      await route.fulfill({ status: 200, json: { requestId: `r${calls.length}` } });
      return;
    }
    if (url.pathname.startsWith("/v1/waiter/requests/") && request.method() === "GET") {
      const id = url.pathname.split("/").at(-1) ?? "";
      const call = calls[Number(id.slice(1)) - 1];
      const result = call?.method === "waiter.getState" ? state
        : call?.method === "waiter.getTable" ? tableDetail : { ok: true };
      await route.fulfill({
        json: { status: "completed", result },
        ...(call?.method === "waiter.getState" ? { headers: { "set-cookie": `waiter_session=${"A".repeat(48)}; Path=/v1/waiter; HttpOnly; SameSite=Strict` } } : {}),
      });
      return;
    }
    await route.fulfill({ status: 500, json: { error: "Unmocked request" } });
  });
  return { origin, server, calls, authModes, authEvidence };
}

const state = () => ({
  serverNow: new Date().toISOString(), cashSessionId: "cash", validUntil: "CASH_CLOSE",
  waiter: { id: "waiter-1", name: "Ana" }, waiterTableWorkflow: true,
  tables: [
    { id: "table-owned", number: 4, name: "Mesa 4", openOrderId: "order-1", servedByMe: true },
    { id: "table-other", number: 5, name: "Mesa 5", openOrderId: "order-2", servedByMe: false },
  ],
  menu: { categories: [{ id: "food", name: "Comidas" }], products: [{ id: "dish", name: "Milanesa", categoryId: "food" }] },
});

async function addSession(page: Page) {
  await page.addInitScript(() => {
    sessionStorage.setItem("waiter:tenant:v1", "test-tenant");
    sessionStorage.setItem("waiter:terminal:v1", "test-terminal");
    sessionStorage.setItem("waiter:session:v1", "test-token");
  });
}

test("Mis mesas muestra solo mesas asignadas y permite abrir una", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const mock = await fixture(context, state());
  const page = await context.newPage();
  await addSession(page);
  try {
    await page.goto(`${mock.origin}/waiter`);
    const myTables = page.locator("#myTables");
    await expect(myTables.getByRole("button", { name: "Mesa 4", exact: true })).toBeVisible();
    await expect(myTables.getByRole("button", { name: "Mesa 5", exact: true })).toHaveCount(0);
    await myTables.getByRole("button", { name: "Mesa 4", exact: true }).click();
    await expect(page.locator("#table")).toHaveValue("table-owned");
    await expect.poll(() => mock.calls.some(call => call.method === "waiter.getTable" && call.params?.tableId === "table-owned")).toBe(true);
    await page.locator("#openMenu").click();
    const search = page.getByRole("searchbox", { name: "Buscar productos" });
    await expect(search).toBeVisible();
    await expect(search).toBeFocused();
    await expect(page.locator("#products")).toBeInViewport();
    expect(await page.locator("#products").evaluate(node => node.previousElementSibling?.id)).toBe("catalogSearch");
    await expect(search).toBeInViewport();
  } finally {
    await context.close(); mock.server.closeAllConnections();
    await new Promise<void>(resolve => mock.server.close(() => resolve()));
  }
});

test("reabrir una pestaña vinculada restablece la sesión sin pedir PIN", async ({ browser }) => {
  const context = await browser.newContext();
  const mock = await fixture(context, state());
  try {
    const first = await context.newPage();
    await first.addInitScript(() => {
      localStorage.setItem("waiter:device:v1", JSON.stringify({ tenantId: "test-tenant", terminalId: "test-terminal" }));
      sessionStorage.setItem("waiter:tenant:v1", "test-tenant");
      sessionStorage.setItem("waiter:terminal:v1", "test-terminal");
      sessionStorage.setItem("waiter:session:v1", "test-token");
    });
    await first.goto(`${mock.origin}/waiter`);
    await expect(first.locator("#app")).toBeVisible();
    // Simulate the relay's HttpOnly cookie on the authenticated first session.
    await context.addCookies([{ name: "waiter_session", value: "A".repeat(48), url: mock.origin, httpOnly: true, sameSite: "Strict" }]);
    await expect.poll(() => context.cookies(mock.origin).then(cookies => cookies.some(cookie => cookie.name === "waiter_session" && cookie.httpOnly))).toBe(true);
    await first.close();

    mock.authModes.push("offline-once");
    const reopened = await context.newPage();
    await reopened.goto(`${mock.origin}/waiter`);
    await expect(reopened.locator("#retrySession")).toBeVisible();
    await expect(reopened.locator("#pin")).toBeHidden();
    await reopened.locator("#retrySession").click();
    await expect(reopened.locator("#app")).toBeVisible();
    await expect(reopened.locator("#pairing")).toBeHidden();
    await expect(reopened.locator("#pin")).toBeHidden();
    await expect.poll(() => mock.calls.filter(call => call.method === "waiter.getState").length).toBe(3);
    expect(mock.authEvidence).toContain("bearer");
    expect(mock.authEvidence).toContain("cookie");
    expect(await reopened.evaluate(() => sessionStorage.getItem("waiter:session:v1"))).toBeNull();

    mock.authModes.push("unauthorized");
    await reopened.locator("#reconnect").click();
    await expect(reopened.locator("#app")).toBeHidden();
    await expect(reopened.locator("#pairing")).toBeVisible();
    await expect(reopened.locator("#pin")).toBeVisible();
    await expect(reopened.locator("#retrySession")).toBeHidden();
  } finally {
    await context.close(); mock.server.closeAllConnections();
    await new Promise<void>(resolve => mock.server.close(() => resolve()));
  }
});
