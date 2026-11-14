import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { createServer } from "node:http";

type Rpc = { method: string; params?: Record<string, unknown> };

async function fixture(context: BrowserContext, state: Record<string, any>) {
  const { waiterHtml } = await import("../../apps/orders-service/dist/waiter-page.js");
  const calls: Rpc[] = [];
  const pairSubmits: Array<{ tenantId: string; terminalId: string; challengeId: string; pin: string }> = [];
  let pairMode: "success" | "invalid" = "success";
  const authEvidence: string[] = [];
  const authModes: Array<"normal" | "offline-once" | "unauthorized" | "closed"> = ["normal"];
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
    if (url.pathname === "/v1/waiter/pair" && request.method() === "POST") {
      pairSubmits.push(request.postDataJSON());
      await route.fulfill({ status: 202, json: { requestId: `pair-${pairSubmits.length}` } });
      return;
    }
    if (url.pathname.startsWith("/v1/waiter/pair/") && request.method() === "GET") {
      if (pairMode === "invalid") {
        await route.fulfill({ json: { status: "failed", error: { code: "invalid_pin", message: "El PIN del mozo es incorrecto." } } });
      } else {
        await route.fulfill({ json: { status: "completed", result: { sessionToken: "test-token" } }, headers: { "set-cookie": `waiter_session=${"A".repeat(48)}; Path=/v1/waiter; HttpOnly; SameSite=Strict` } });
      }
      return;
    }
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
      const result = call?.method === "waiter.getState" ? (authModes.at(-1) === "closed" ? { ...state, cashSessionId: "cash-closed" } : state)
        : call?.method === "waiter.getTable" ? tableDetail : { ok: true };
      await route.fulfill({
        json: { status: "completed", result },
        ...(call?.method === "waiter.getState" ? { headers: { "set-cookie": `waiter_session=${"A".repeat(48)}; Path=/v1/waiter; HttpOnly; SameSite=Strict` } } : {}),
      });
      return;
    }
    await route.fulfill({ status: 500, json: { error: "Unmocked request" } });
  });
  return { origin, server, calls, authModes, authEvidence, pairSubmits, setPairMode: (mode: "success" | "invalid") => { pairMode = mode; } };
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
  const liveState = state();
  const mock = await fixture(context, liveState);
  try {
    const first = await context.newPage();
    await first.goto(`${mock.origin}/waiter#tenant=test-tenant&terminal=test-terminal&challenge=challenge-paired`);
    await first.locator("#pin").fill("1234");
    await first.locator("#pairForm button[type=submit]").click();
    await expect(first.locator("#app")).toBeVisible();
    await expect.poll(() => context.cookies(mock.origin + "/v1/waiter/rpc").then(cookies => cookies.some(cookie => cookie.name === "waiter_session" && cookie.httpOnly))).toBe(true);
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

    const stateCallsBeforeLifecycle = mock.calls.filter(call => call.method === "waiter.getState").length;
    liveState.waiter.name = "Ana (visible)";
    await reopened.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(reopened.locator("#welcome")).toContainText("Ana (visible)");
    liveState.waiter.name = "Ana (restaurada)";
    await reopened.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
    await expect(reopened.locator("#welcome")).toContainText("Ana (restaurada)");
    expect(mock.calls.filter(call => call.method === "waiter.getState")).toHaveLength(stateCallsBeforeLifecycle + 2);

    mock.authModes.push("unauthorized");
    await reopened.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
    await expect(reopened.locator("#app")).toBeHidden();
    await expect(reopened.locator("#pairing")).toBeVisible();
    await expect(reopened.locator("#pin")).toBeHidden();
    await expect(reopened.locator("#retrySession")).toBeHidden();
    await expect(reopened.locator("#pairMessage")).toContainText(/QR nuevo/i);
  } finally {
    await context.close(); mock.server.closeAllConnections();
    await new Promise<void>(resolve => mock.server.close(() => resolve()));
  }
});

test("reabrir el QR vigente del mismo terminal conserva el vínculo", async ({ browser }) => {
  const context = await browser.newContext();
  const mock = await fixture(context, state());
  const qrUrl = `${mock.origin}/waiter#tenant=test-tenant&terminal=test-terminal&challenge=challenge-original`;
  try {
    const first = await context.newPage();
    await first.goto(qrUrl);
    await first.locator("#pin").fill("1234");
    await first.locator("#pairForm button[type=submit]").click();
    await expect(first.locator("#app")).toBeVisible();
    expect(mock.pairSubmits).toEqual([{ tenantId: "test-tenant", terminalId: "test-terminal", challengeId: "challenge-original", pin: "1234" }]);
    await first.close();

    const reopened = await context.newPage();
    await reopened.goto(qrUrl);
    await expect(reopened.locator("#app")).toBeVisible();
    await expect(reopened.locator("#pin")).toBeHidden();
    await expect(reopened.locator("#pairForm")).toBeHidden();
    expect(mock.calls.filter(call => call.method === "waiter.getState")).toHaveLength(2);
    expect(mock.authEvidence).toContain("cookie");

    const differentQr = await context.newPage();
    await differentQr.goto(`${mock.origin}/waiter#tenant=test-tenant&terminal=test-terminal&challenge=challenge-other-mozo`);
    await expect(differentQr.locator("#pairForm")).toBeVisible();
    await expect(differentQr.locator("#pin")).toBeVisible();
    await differentQr.locator("#pin").fill("5678");
    await differentQr.locator("#pairForm button[type=submit]").click();
    await expect(differentQr.locator("#app")).toBeVisible();
    expect(mock.pairSubmits.at(-1)).toEqual({ tenantId: "test-tenant", terminalId: "test-terminal", challengeId: "challenge-other-mozo", pin: "5678" });
  } finally {
    await context.close(); mock.server.closeAllConnections();
    await new Promise<void>(resolve => mock.server.close(() => resolve()));
  }
});

test("un PIN inválido consume el QR y pide uno nuevo", async ({ browser }) => {
  const context = await browser.newContext();
  const mock = await fixture(context, state());
  mock.setPairMode("invalid");
  try {
    const page = await context.newPage();
    await page.goto(`${mock.origin}/waiter#tenant=test-tenant&terminal=test-terminal&challenge=challenge-invalid`);
    const submit = page.locator("#pairForm button[type=submit]");
    await page.locator("#pin").fill("9999");
    await submit.click();
    await expect(page.locator("#pairMessage")).toContainText(/PIN incorrecto.*QR nuevo/i);
    await expect(page.locator("#pairForm")).toBeHidden();
    await expect(page.locator("#pin")).toBeHidden();
    await page.goto(`${mock.origin}/waiter#tenant=test-tenant&terminal=test-terminal&challenge=challenge-fresh`);
    await expect(page.locator("#pairForm")).toBeVisible();
    await expect(page.locator("#pin")).toBeVisible();
  } finally {
    await context.close(); mock.server.closeAllConnections();
    await new Promise<void>(resolve => mock.server.close(() => resolve()));
  }
});

test("el cierre de caja bloquea una sesión del mozo y exige QR nuevo", async ({ browser }) => {
  const context = await browser.newContext();
  const mock = await fixture(context, state());
  try {
    const page = await context.newPage();
    await page.goto(`${mock.origin}/waiter#tenant=test-tenant&terminal=test-terminal&challenge=challenge-before-close`);
    await page.locator("#pin").fill("1234");
    await page.locator("#pairForm button[type=submit]").click();
    await expect(page.locator("#app")).toBeVisible();

    mock.authModes.push("closed");
    await page.locator("#reconnect").click();
    await expect(page.locator("#app")).toBeHidden();
    await expect(page.locator("#pairing")).toBeVisible();
    await expect(page.locator("#pin")).toBeHidden();
    await expect(page.locator("#pairMessage")).toContainText(/QR nuevo/i);
  } finally {
    await context.close(); mock.server.closeAllConnections();
    await new Promise<void>(resolve => mock.server.close(() => resolve()));
  }
});
