import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { createRequire } from "node:module";

const evidence = resolve(
  "docs/qa/evidence/system-usability-purchase-quantity-fix-2026-10-09",
);
let app: ElectronApplication,
  page: Page,
  profile = "";

test.beforeEach(async () => {
  profile = await mkdtemp(join(tmpdir(), "gastronomy-purchase-quantity-"));
  app = await electron.launch({
    args: ["apps/desktop-shell", `--user-data-dir=${profile}`],
    cwd: process.cwd(),
  });
  page = await app.firstWindow();
  await expect(page.getByText("Delta Nube", { exact: true })).toBeVisible();
  expect(
    resolve(await app.evaluate(({ app }) => app.getPath("userData"))),
  ).toBe(resolve(profile));
});

test.afterEach(async () => {
  await app?.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) w.destroy();
  });
  await app?.close();
  if (
    dirname(resolve(profile)) !== resolve(tmpdir()) ||
    !basename(profile).startsWith("gastronomy-purchase-quantity-")
  )
    throw Error("unsafe cleanup");
  await rm(profile, { recursive: true, force: true });
});

async function ledger() {
  const modulePath = createRequire(
    join(process.cwd(), "packages/database/package.json"),
  ).resolve("better-sqlite3-multiple-ciphers");
  return app.evaluate(
    ({ app }, x) => {
      const path = process.getBuiltinModule("path");
      if (path.resolve(app.getPath("userData")) !== path.resolve(x.profile))
        throw Error("wrong profile");
      const req = process
        .getBuiltinModule("module")
        .createRequire(x.modulePath);
      const db = new (req(x.modulePath))(
        path.join(x.profile, "gastronomy.sqlite"),
        { readonly: true },
      );
      try {
        return Object.fromEntries(
          [
            "cash_sessions",
            "cash_movements",
            "finance_expenses",
            "purchase_items",
            "products",
            "finance_order_item_costs",
            "finance_product_costs",
            "command_receipts",
            "audit_log",
          ].map((t) => [
            t,
            db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all(),
          ]),
        );
      } finally {
        db.close();
      }
    },
    { profile, modulePath },
  );
}

async function capture(name: string, data: unknown) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => {})),
    );
    await new Promise<void>((r) =>
      requestAnimationFrame(() => requestAnimationFrame(() => r())),
    );
  });
  const png = await app.evaluate(async ({ BrowserWindow }) =>
    (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage())
      .toPNG()
      .toString("base64"),
  );
  await writeFile(join(evidence, name + ".png"), Buffer.from(png, "base64"));
  await writeFile(join(evidence, name + ".json"), JSON.stringify(data, null, 2));
}

async function fixture() {
  const purchase = await page.evaluate(async () => {
    const api = window.gastronomy;
    await api.openCashSession({ openingAmountMinor: 1000000 });
    const data = await api.bootstrap();
    const product = data.products.find((x) => x.active)!;
    return api.createPurchase({
      supplierName: "Proveedor cantidad original",
      invoiceNumber: "FAC-CANTIDAD",
      items: [{ productId: product.id, quantityMinor: 2500, unitCostMinor: 10000 }],
      authorizerPin: "1234",
      idempotencyKey: "purchase-quantity-original",
    });
  });
  await page.reload();
  await page.getByRole("link", { name: "Compras", exact: true }).click();
  await expect(
    page.getByText("Proveedor cantidad original", { exact: true }),
  ).toBeVisible();
  return purchase;
}

async function openQuantity() {
  await page
    .getByRole("button", { name: "Corregir cantidad", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Corregir cantidad de compra",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function fillQuantity(dialog: any, quantity: string, pin = "1234") {
  await dialog.getByLabel("Producto de la compra", { exact: true }).selectOption({ index: 0 });
  await dialog
    .getByLabel("Cantidad correcta", { exact: true })
    .fill(quantity);
  await dialog
    .getByLabel("Motivo", { exact: true })
    .fill("Cantidad del comprobante mal transcripta");
  await dialog.getByLabel("PIN autorizador", { exact: true }).fill(pin);
}

test("quantity correction composes with cost correction and preserves stock, cash, COGS, and original purchase row", async () => {
  const purchase = await fixture();
  const orderSnapshot = await page.evaluate(async (purchase) => {
    const api = window.gastronomy;
    const session = (await api.bootstrap()).cashSession!;
    const order = await api.createOrder({
      type: "TAKEAWAY",
      customerName: "Cantidad registrada",
      customerPhone: "1155557002",
    });
    await api.addOrderItem({
      orderId: order.id,
      productId: purchase.items[0]!.productId,
    });
    const confirmed = await api.confirmOrder({ orderId: order.id });
    const counted = await api.adjustStock({
      productId: purchase.items[0]!.productId,
      newStockMinor: 1500,
      reason: "Conteo físico previo",
      authorizerPin: "1234",
    });
    const report = await api.getFinanceReport({
      from: session.businessDate,
      to: session.businessDate,
    });
    return { confirmed, counted, report };
  }, purchase);
  const before = await ledger();
  expect(before.finance_order_item_costs.length).toBeGreaterThan(0);
  const item = purchase.items[0]!;
  const updated = await page.evaluate(async ({ purchase, itemId }) => {
    const api = window.gastronomy;
    const session = (await api.bootstrap()).cashSession;
    const reportBefore = session
      ? await api.getFinanceReport({ from: session.businessDate, to: session.businessDate })
      : null;
    const cost = await api.correctPurchaseItemCost({
      purchaseId: purchase.id,
      purchaseItemId: itemId,
      expectedRevision: purchase.revision ?? 0,
      unitCostMinor: 12000,
      reason: "Costo real de factura",
      authorizerPin: "1234",
      idempotencyKey: "quantity-compose-cost-first",
    });
    const quantity = await api.correctPurchaseItemQuantity({
      purchaseId: purchase.id,
      purchaseItemId: itemId,
      expectedRevision: cost.revision,
      quantityMinor: 3500,
      reason: "Cantidad correcta de factura",
      authorizerPin: "1234",
      idempotencyKey: "quantity-compose-quantity-second",
    });
    const costAgain = await api.correctPurchaseItemCost({
      purchaseId: purchase.id,
      purchaseItemId: itemId,
      expectedRevision: quantity.revision,
      unitCostMinor: 13000,
      reason: "Revisión final de costo",
      authorizerPin: "1234",
      idempotencyKey: "quantity-compose-cost-third",
    });
    const reportAfter = session
      ? await api.getFinanceReport({ from: session.businessDate, to: session.businessDate })
      : null;
    return { cost, quantity, costAgain, reportBefore, reportAfter };
  }, { purchase, itemId: item.id });
  const after = await ledger();
  expect(after.purchase_items).toEqual(before.purchase_items);
  for (const table of [
    "products",
    "cash_sessions",
    "cash_movements",
    "finance_expenses",
    "finance_order_item_costs",
    "finance_product_costs",
  ])
    expect(after[table]).toEqual(before[table]);
  expect(updated.quantity.revision).toBe(updated.cost.revision + 1);

  const listed = (await page.evaluate(() => window.gastronomy.listPurchases()))[0]!;
  expect(listed.items[0]).toMatchObject({
    quantityMinor: 2500,
    effectiveQuantityMinor: 3500,
    unitCostMinor: 10000,
    effectiveUnitCostMinor: 13000,
  });
  expect(listed.totalMinor).toBe(25000);
  expect(listed.effectiveTotalMinor).toBe(45500);
  expect(updated.costAgain.revision).toBe(updated.quantity.revision + 1);
  expect(updated.reportAfter?.purchasesMinor).toBe(45500);
  expect(updated.reportAfter?.cogsMinor).toBe(orderSnapshot.report.cogsMinor);
  expect(orderSnapshot.confirmed.items[0]!.id).toBeTruthy();
  await page.reload();
  await expect(page.getByText("3,5", { exact: false })).toBeVisible();
  await expect(page.getByText("2,5", { exact: false })).toBeVisible();
  const quantityDialog = await openQuantity();
  await fillQuantity(quantityDialog, "3,5");
  await expect(
    quantityDialog
      .locator("p")
      .filter({ hasText: "Importe efectivo de la línea:" }),
  ).toContainText("455");
  await capture("quantity-cost-composition", {
    purchase,
    updated,
    listed,
    before,
    after,
    orderSnapshot,
  });
  await quantityDialog
    .getByRole("button", { name: "Cancelar", exact: true })
    .click();
});

test("zero quantity and invalid PIN are rejected while correction fields remain recoverable", async () => {
  await fixture();
  const trigger = page.getByRole("button", {
    name: "Corregir cantidad",
    exact: true,
  });
  const dialog = await openQuantity();
  await fillQuantity(dialog, "0", "0000");
  await dialog
    .getByRole("button", { name: "Guardar cantidad", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByLabel("Cantidad correcta", { exact: true })).toHaveValue("0");
  await dialog.getByLabel("Cantidad correcta", { exact: true }).fill("3,5");
  await expect(dialog.getByRole("alert")).toContainText(/mayor|positiv/i);
  await dialog.getByLabel("PIN autorizador", { exact: true }).fill("1234");
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(trigger).toBeFocused();
  const reopened = await openQuantity();
  await fillQuantity(reopened, "3,5", "0000");
  await reopened
    .getByRole("button", { name: "Guardar cantidad", exact: true })
    .click();
  await expect(reopened.getByRole("alert")).toBeVisible();
  await expect(reopened.getByLabel("Cantidad correcta", { exact: true })).toHaveValue("3,5");
  await expect(reopened.getByLabel("PIN autorizador", { exact: true })).toHaveAttribute("type", "password");
  await expect(reopened.getByLabel("PIN autorizador", { exact: true })).toHaveValue("0000");
  await capture("quantity-pin-validation", {});
});

test("stale revision keeps fields, Escape restores focus, and pending IPC cannot duplicate or dismiss", async () => {
  const purchase = await fixture();
  const trigger = page.getByRole("button", {
    name: "Corregir cantidad",
    exact: true,
  });
  let dialog = await openQuantity();
  await fillQuantity(dialog, "3,5");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();

  dialog = await openQuantity();
  await fillQuantity(dialog, "3,5");
  await page.evaluate(async (purchase) => {
    const item = purchase.items[0];
    await window.gastronomy.correctPurchaseItemQuantity({
      purchaseId: purchase.id,
      purchaseItemId: item.id,
      expectedRevision: purchase.revision ?? 0,
      quantityMinor: 3000,
      reason: "Corrección concurrente",
      authorizerPin: "1234",
      idempotencyKey: "quantity-concurrent-change",
    });
  }, purchase);
  await dialog
    .getByRole("button", { name: "Guardar cantidad", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(/modific|cambi|revisión/i);
  await expect(dialog.getByLabel("Cantidad correcta", { exact: true })).toHaveValue("3,5");
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();

  dialog = await openQuantity();
  await fillQuantity(dialog, "4");
  await app.evaluate(({ ipcMain }) => {
    const original = (ipcMain as any)._invokeHandlers.get(
      "gastronomy:correctPurchaseItemQuantity",
    );
    if (typeof original !== "function") throw Error("Native quantity IPC handler missing");
    (globalThis as any).__calls = 0;
    ipcMain.removeHandler("gastronomy:correctPurchaseItemQuantity");
    ipcMain.handle("gastronomy:correctPurchaseItemQuantity", async (event, input) => {
      (globalThis as any).__calls++;
      await new Promise<void>((release) => ((globalThis as any).__release = release));
      return original(event, input);
    });
  });
  await dialog.getByRole("button", { name: "Guardar cantidad", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Guardando…", exact: true })).toBeDisabled();
  await expect(dialog.getByLabel("Cantidad correcta", { exact: true })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Cancelar", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await capture("quantity-pending-ipc", { purchase });
  await app.evaluate(() => (globalThis as any).__release());
  await expect(dialog).toHaveCount(0);
  expect(await app.evaluate(() => (globalThis as any).__calls)).toBe(1);
});

test("native 200 percent zoom keeps quantity correction reachable without horizontal overflow", async () => {
  await fixture();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]!.webContents.setZoomFactor(2),
  );
  const dialog = await openQuantity();
  await fillQuantity(dialog, "3,5");
  await dialog
    .getByRole("button", { name: "Guardar cantidad", exact: true })
    .scrollIntoViewIfNeeded();
  expect(await dialog.evaluate((el: any) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await capture("quantity-zoom200", {});
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
});
