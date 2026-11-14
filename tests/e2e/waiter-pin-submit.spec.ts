import { test, expect } from "@playwright/test";
import { createServer } from "node:http";

test("el PIN informa el progreso, no se duplica y muestra carga tras aceptarlo", async ({ page }) => {
  const { waiterHtml } = await import("../../apps/orders-service/dist/waiter-page.js");
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
  let pairPosts = 0;
  let releasePair!: () => void, releaseState!: () => void;
  const pairGate = new Promise<void>(resolve => { releasePair = resolve; });
  const stateGate = new Promise<void>(resolve => { releaseState = resolve; });
  let stateCallId = 0;
  await page.route("**/v1/waiter/pair", async route => {
    pairPosts++;
    await pairGate;
    await route.fulfill({ status: 202, json: { requestId: "pair-1" } });
  });
  let receiptReads = 0;
  await page.route("**/v1/waiter/pair/**", async route => {
    if (++receiptReads === 1) {
      await route.abort("connectionreset");
      return;
    }
    await route.fulfill({ json: { status: "completed", result: { sessionToken: "token-accepted" } }, headers: { "set-cookie": `waiter_session=${"A".repeat(48)}; Path=/v1/waiter; HttpOnly; SameSite=Strict` } });
  });
  await page.route("**/v1/waiter/rpc", async route => {
    stateCallId++;
    await route.fulfill({ status: 202, json: { requestId: `rpc-${stateCallId}` } });
  });
  await page.route("**/v1/waiter/requests/**", async route => {
    await stateGate;
    await route.fulfill({ json: { status: "completed", result: {
      serverNow: new Date().toISOString(), cashSessionId: "cash", validUntil: "CASH_CLOSE",
      waiter: { id: "waiter-1", name: "Ana" }, waiterTableWorkflow: true, tables: [],
      menu: { categories: [], products: [] },
    } } });
  });
  try {
    await page.goto(`${origin}/waiter#tenant=test-tenant&terminal=test-terminal&challenge=challenge-1`);
    const pin = page.locator("#pin"), submit = page.locator("#pairForm button[type=submit]");
    await pin.fill("1234");
    await submit.click();
    await expect(submit).toBeDisabled();
    await expect(submit).toHaveText("Verificando…");
    await expect(page.locator("#pairMessage")).toContainText("Verificando tu PIN con caja…");
    await page.locator("#pairForm").evaluate((form: HTMLFormElement) => form.requestSubmit());
    await expect.poll(() => pairPosts).toBe(1);

    releasePair();
    await expect(submit).toHaveText("Consultar estado");
    await expect(page.locator("#pairMessage")).toContainText("no reenvíes el PIN");
    await expect(pin).toBeDisabled();
    await submit.click();
    await expect(page.locator("#pairMessage")).toContainText("PIN aceptado. Cargando tus mesas…");
    await expect(submit).toBeDisabled();
    releaseState();
    await expect(page.locator("#app")).toBeVisible();
    expect(pairPosts).toBe(1);
    expect(receiptReads).toBe(2);
  } finally {
    releasePair(); releaseState();
    await page.context().close(); server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
