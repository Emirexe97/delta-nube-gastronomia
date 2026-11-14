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
      { id: "muzza", name: "Pizza Muzzarella", categoryId: "food", halfEligible: true },
      { id: "napo", name: "Pizza Napolitana", categoryId: "food", halfEligible: true },
      { id: "fugazza", name: "Pizza Fugazza", categoryId: "food", halfEligible: true },
      { id: "empanada", name: "Empanada", categoryId: "food", halfEligible: false },
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
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Tipo de pizza").locator("option")).toHaveText(["Entera", "Mitad y mitad"]);
    await expect(dialog.getByLabel("Tipo de pizza")).toHaveValue("whole");
    await dialog.getByLabel("Observaciones").fill("Extra crocante");
    await dialog.getByRole("button", { name: "Agregar al pedido", exact: true }).click();

    await page.getByRole("button", { name: "Agregar Pizza Muzzarella", exact: true }).click();
    await dialog.getByLabel("Tipo de pizza").selectOption("half");
    await dialog.getByRole("button", { name: "Agregar al pedido", exact: true }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Otra mitad").locator("option", { hasText: "Empanada" })).toHaveCount(0);
    await dialog.getByLabel("Otra mitad").selectOption("napo");
    await dialog.getByLabel("Observaciones").fill("Sin aceitunas");
    await dialog.getByRole("button", { name: "Agregar al pedido", exact: true }).click();
    await page.getByRole("button", { name: "Agregar Pizza Muzzarella", exact: true }).click();
    await dialog.getByLabel("Tipo de pizza").selectOption("half");
    await dialog.getByLabel("Otra mitad").selectOption("fugazza");
    await dialog.getByLabel("Observaciones").fill("Bien cocida");
    await dialog.getByRole("button", { name: "Agregar al pedido", exact: true }).click();

    await page.getByRole("button", { name: "Agregar Empanada", exact: true }).click();
    await expect(dialog).toBeHidden();
    const productNote = page.locator("#draft").getByRole("textbox", { name: "Nota para cocina de Empanada" });
    await expect(productNote).toBeVisible();
    await expect(productNote).toBeEditable();
    await productNote.fill("Sin sal");
    // A second empanada is deliberate: + changes quantity, Nota only personalizes it.
    await page.getByRole("button", { name: "Agregar Empanada", exact: true }).click();
    await page.getByRole("button", { name: "Observaciones: Empanada", exact: true }).click();
    await expect(dialog.getByLabel("Tipo de pizza")).toBeHidden();
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
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  } finally {
    await context.close(); server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
