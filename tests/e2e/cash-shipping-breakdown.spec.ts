import { test, expect, _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { createRequire } from "node:module";

const evidence = resolve("docs/qa/evidence/system-usability-salon-shipping-2026-10-10");
let app: ElectronApplication;
let page: Page;
let profile = "";

test.beforeEach(async () => {
  profile = await mkdtemp(join(tmpdir(), "gastronomy-shipping-report-"));
  app = await electron.launch({ args: ["apps/desktop-shell", `--user-data-dir=${profile}`], cwd: process.cwd() });
  page = await app.firstWindow();
  await expect(page.getByRole("link", { name: "Caja", exact: true })).toBeVisible();
  expect(resolve(await app.evaluate(({ app }) => app.getPath("userData")))).toBe(resolve(profile));
  await app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.getPrintersAsync = async () => [];
  });
});

test.afterEach(async () => {
  await app?.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) w.destroy(); });
  await app?.close();
  if (dirname(resolve(profile)) !== resolve(tmpdir()) || !basename(profile).startsWith("gastronomy-shipping-report-")) throw Error("unsafe cleanup");
  await rm(profile, { recursive: true, force: true });
});

async function ledger() {
  const modulePath = createRequire(join(process.cwd(), "packages/database/package.json")).resolve("better-sqlite3-multiple-ciphers");
  return app.evaluate(({ app }, x) => {
    const path = process.getBuiltinModule("path");
    if (path.resolve(app.getPath("userData")) !== path.resolve(x.profile)) throw Error("wrong profile");
    const req = process.getBuiltinModule("module").createRequire(x.modulePath);
    const db = new (req(x.modulePath))(path.join(x.profile, "gastronomy.sqlite"), { readonly: true });
    try {
      return Object.fromEntries(["cash_sessions", "cash_movements", "orders", "payments", "delivery_ledger", "products", "finance_expenses"].map((t) => [t, db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]));
    } finally { db.close(); }
  }, { profile, modulePath });
}

async function capture(preview: Page, name: string) {
  await preview.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {})));
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  });
  const png = await app.evaluate(async ({ BrowserWindow }, url) => {
    const w = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL() === url);
    if (!w) throw Error("preview not found");
    return (await w.webContents.capturePage()).toPNG().toString("base64");
  }, preview.url());
  await mkdir(evidence, { recursive: true });
  await writeFile(join(evidence, `shipping-${name}.png`), Buffer.from(png, "base64"));
}

for (const mode of ["direct", "accumulated", "driver-retained", "reversed-remittance"] as const) {
  test(`ticket separa envíos de gastos sin alterar caja: ${mode}`, async () => {
    const fixture = await page.evaluate(async (mode) => {
      const api = window.gastronomy;
      const data = await api.bootstrap();
      await api.saveSettings({ ...data.settings, deliverySettlementEnabled: true, deliveryFeeBelongsToDriver: true, deliveryDriverPaymentMode: "ACCUMULATED" });
      const session = await api.openCashSession({ openingAmountMinor: 1_000_000 });
      await api.registerCashMovement({ type: "EXPENSE", amountMinor: 20_000, paymentMethodCode: "CASH", reason: "Pago de envío a repartidor: Pedido #manual no vinculado" });
      const driver = await api.createDriver({ fullName: "Repartidor informe", authorizerPin: "1234" });
      const order = await api.createOrder({ type: "DELIVERY", customerName: "Cliente informe", customerPhone: "1155557555", deliveryAddress: "Calle informe 75", deliveryFeeMinor: 25_000, driverUserId: driver.id });
      await api.addOrderItem({ orderId: order.id, productId: data.products[0]!.id });
      const confirmed = await api.confirmOrder({ orderId: order.id });
      const driverCollected = mode === "driver-retained" || mode === "reversed-remittance";
      await api.completeOrder({ orderId: order.id, finalStatus: "DELIVERED", payments: [{ methodCode: driverCollected ? "CASH" : "TRANSFER", amountMinor: confirmed.totalMinor }], payDriverNow: mode === "direct", collectedByDriver: driverCollected });
      let shippingExpense = mode === "direct" ? 25_000 : 0;
      if (mode === "accumulated" || mode === "reversed-remittance") {
        const pending = (await api.bootstrap()).deliveryLedger.find((l) => l.orderId === order.id)!;
        await api.settleDelivery({ ledgerIds: [pending.id], authorizerPin: "1234", reason: "Rendición informe" });
        shippingExpense = mode === "accumulated" ? 25_000 : pending.amountDueMinor;
        if (mode === "reversed-remittance") await api.reverseDeliverySettlement({ ledgerId: pending.id, authorizerPin: "1234", reason: "Revertir rendición informe" });
      }
      const beforeClose = (await api.getCashSessionReport({ cashSessionId: session.id })).session;
      await api.closeCashSession({ countedAmountMinor: beforeClose.expectedAmountMinor, closingFloatAmountMinor: 0, force: driverCollected, reason: driverCollected ? "Conservar rendición pendiente para prueba de informe" : undefined, authorizerPin: driverCollected ? "1234" : undefined });
      return { sessionId: session.id, shippingExpense, expected: beforeClose.expectedAmountMinor, sales: confirmed.totalMinor };
    }, mode);
    const before = await ledger();
    // Attach rejection immediately so failure cleanup cannot produce an
    // unrelated unhandled Target closed rejection; still rethrow on success path.
    const outcome = page.evaluate((cashSessionId) => window.gastronomy.printCashSessionReport({ filters: { cashSessionId }, sections: { byProduct: false, byCategory: false, byTable: false, byWaiter: false, orderDetails: false } }), fixture.sessionId).catch((error) => ({ error }));
    await expect.poll(() => app.windows().filter((p) => p.url().includes("print-preview-controls")).length).toBe(1);
    const preview = app.windows().find((p) => p.url().includes("print-preview-controls"))!;
    const shippingRow = preview.locator(".row").filter({ has: preview.getByText("Envíos y rendiciones en efectivo", { exact: true }) });
    const generalRow = preview.locator(".row").filter({ has: preview.getByText("Gastos y otros egresos en efectivo", { exact: true }) });
    await expect(shippingRow).toBeVisible();
    await expect(generalRow).toBeVisible();
    const money = (n: number) => new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n / 100).replace(/\s/g, "");
    expect((await shippingRow.locator("strong").innerText()).replace(/\s/g, "")).toBe(money(fixture.shippingExpense > 0 ? -fixture.shippingExpense : 0));
    expect((await generalRow.locator("strong").innerText()).replace(/\s/g, "")).toBe(money(-20_000));
    await expect(preview.getByText("Egresos en efectivo (incluye repartidores)", { exact: true })).toHaveCount(0);
    await capture(preview, mode);
    expect(await ledger()).toEqual(before);
    await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) if (w.webContents.getURL().includes("print-preview-controls")) w.close(); });
    const result = await outcome;
    if ("error" in result) throw result.error;
    expect(result.printed).toBe(false);
    const after = await page.evaluate((cashSessionId) => window.gastronomy.getCashSessionReport({ cashSessionId }), fixture.sessionId);
    expect(after.session.expectedAmountMinor).toBe(fixture.expected);
    expect(after.session.differenceMinor).toBe(0);
    expect(after.session.cashExpenseMinor).toBe(20_000 + fixture.shippingExpense);
    expect(after.totals.salesMinor).toBe(fixture.sales);
  });
}
