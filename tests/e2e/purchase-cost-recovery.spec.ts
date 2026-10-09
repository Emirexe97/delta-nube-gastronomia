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
  "docs/qa/evidence/system-usability-purchase-cost-fix-2026-10-09",
);
let app: ElectronApplication,
  page: Page,
  profile = "";
test.beforeEach(async () => {
  profile = await mkdtemp(join(tmpdir(), "gastronomy-purchase-cost-"));
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
    !basename(profile).startsWith("gastronomy-purchase-cost-")
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
            "finance_recurring",
            "finance_expense_payment_corrections",
            "finance_expense_returns",
            "finance_expense_closed_payment_corrections",
            "purchase_item_cost_corrections",
            "purchases",
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
  await writeFile(
    join(evidence, name + ".json"),
    JSON.stringify(data, null, 2),
  );
}
async function financeReady() {
  await expect(
    page.getByText("Registrar gasto o sueldo", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Calculando…", { exact: true })).toHaveCount(0);
}
async function openFinance(date: string) {
  await page.reload();
  await page.getByRole("link", { name: "Finanzas", exact: true }).click();
  await financeReady();
  await page.getByLabel("Desde", { exact: true }).fill(date);
  await page.getByLabel("Hasta", { exact: true }).fill(date);
  await financeReady();
}

async function fixture(two = false) {
  const f = await page.evaluate(async (two) => {
    const api = window.gastronomy;
    const session = await api.openCashSession({ openingAmountMinor: 1000000 });
    const data = await api.bootstrap();
    const products = data.products.filter((x) => x.active);
    await api.setFinanceProductCost({
      productId: products[0]!.id,
      unitCostMinor: null,
    });
    const input = {
      supplierName: "Proveedor costo original",
      invoiceNumber: "FAC-COSTO",
      notes: "Conservar original",
      authorizerPin: "1234",
      idempotencyKey: "cost-original",
      items: [
        {
          productId: products[0]!.id,
          quantityMinor: 2500,
          unitCostMinor: 10000,
        },
        ...(two
          ? [
              {
                productId: products[1]!.id,
                quantityMinor: 1000,
                unitCostMinor: 5000,
              },
            ]
          : []),
      ],
    };
    const purchase = await api.createPurchase(input);
    return { purchase, input, products, session };
  }, two);
  await page.reload();
  await page.getByRole("link", { name: "Compras", exact: true }).click();
  await expect(
    page.getByText("Proveedor costo original", { exact: true }),
  ).toBeVisible();
  return f;
}
async function openCost(name = "Proveedor costo original") {
  const row = page.locator("div.divide-y > div", {
    has: page.getByText(name, { exact: true }),
  });
  await row
    .getByRole("button", { name: "Corregir costo", exact: true })
    .click();
  const d = page.getByRole("dialog", {
    name: "Corregir costo de compra",
    exact: true,
  });
  await expect(d).toBeVisible();
  return d;
}
async function fillCost(
  d: Page["getByRole"] extends never ? never : any,
  cost: string,
) {
  await d.getByLabel("Costo unitario correcto", { exact: true }).fill(cost);
  await d
    .getByLabel("Motivo", { exact: true })
    .fill("Costo de comprobante mal transcripto");
  await d.getByLabel("PIN autorizador", { exact: true }).fill("1234");
}
test("one corrected line projects effective total while originals stock cash and receipt stay immutable", async () => {
  const f = await fixture(true);
  const before = await ledger();
  const d = await openCost();
  await expect(
    d.getByText("Los costos ya registrados en ventas se mantienen.", {
      exact: true,
    }),
  ).toBeVisible();
  await fillCost(d, "120");
  await capture("cost-confirm", { f, before });
  await d.getByRole("button", { name: "Guardar costo", exact: true }).click();
  await expect(d).toHaveCount(0);
  const after = await ledger();
  expect(after.purchase_items).toEqual(before.purchase_items);
  for (const t of [
    "products",
    "cash_sessions",
    "cash_movements",
    "finance_expenses",
    "finance_order_item_costs",
    "finance_product_costs",
  ])
    expect(after[t]).toEqual(before[t]);
  expect(after.purchase_item_cost_corrections).toHaveLength(1);
  const p = (await page.evaluate(() => window.gastronomy.listPurchases()))[0]!;
  expect(p.totalMinor).toBe(30000);
  expect(p.effectiveTotalMinor).toBe(35000);
  expect(p.items[0].unitCostMinor).toBe(10000);
  expect(p.items[0].effectiveUnitCostMinor).toBe(12000);
  expect(p.items[1].effectiveUnitCostMinor).toBeUndefined();
  const replay = await page.evaluate(
    (input) => window.gastronomy.createPurchase(input),
    f.input,
  );
  expect(replay).toEqual(f.purchase);
  await expect(
    page.getByText("Costo corregido:", { exact: false }),
  ).toBeVisible();
  await capture("cost-effective-history", { p, after, replay });
});
test("manual cost and newer purchase take precedence even after old invoice cost correction and zero works", async () => {
  const f = await fixture();
  await page.evaluate(async (f) => {
    const api = window.gastronomy;
    await api.createPurchase({
      supplierName: "Compra nueva",
      items: [
        {
          productId: f.products[0].id,
          quantityMinor: 1000,
          unitCostMinor: 15000,
        },
      ],
      authorizerPin: "1234",
    });
    await api.setFinanceProductCost({
      productId: f.products[0].id,
      unitCostMinor: 19000,
    });
  }, f);
  await page.reload();
  const d = await openCost();
  await expect(
    d.getByText("El producto tiene un costo manual; no se cambiará.", {
      exact: true,
    }),
  ).toBeVisible();
  await fillCost(d, "0");
  await d.getByRole("button", { name: "Guardar costo", exact: true }).click();
  await expect(d).toHaveCount(0);
  const costs = await page.evaluate(() =>
    window.gastronomy.getFinanceProductCosts(),
  );
  expect(
    costs.find((x) => x.productId === f.products[0].id)!.unitCostMinor,
  ).toBe(19000);
  await page.evaluate(
    (p) =>
      window.gastronomy.setFinanceProductCost({
        productId: p.id,
        unitCostMinor: null,
      }),
    f.products[0],
  );
  const cleared = await page.evaluate(() =>
    window.gastronomy.getFinanceProductCosts(),
  );
  expect(
    cleared.find((x) => x.productId === f.products[0].id)!.unitCostMinor,
  ).toBe(15000);
  const original = (
    await page.evaluate(() => window.gastronomy.listPurchases())
  ).find((x) => x.id === f.purchase.id)!;
  expect(original.effectiveTotalMinor).toBe(0);
  expect(original.items[0].effectiveUnitCostMinor).toBe(0);
  await capture("cost-manual-and-newer-preserved", {
    original,
    costs,
    cleared,
  });
});
test("old captures and profit stay fixed while later captures use effective purchase cost", async () => {
  const f = await fixture();
  const x = await page.evaluate(async (f) => {
    const api = window.gastronomy;
    const p = f.products[0];
    const one = await api.createOrder({
      type: "TAKEAWAY",
      customerName: "Costo registrado",
      customerPhone: "1155557000",
    });
    await api.addOrderItem({ orderId: one.id, productId: p.id });
    const confirmed = await api.confirmOrder({ orderId: one.id });
    const draft = await api.createOrder({
      type: "TAKEAWAY",
      customerName: "Borrador previo",
      customerPhone: "1155557001",
    });
    await api.addOrderItem({ orderId: draft.id, productId: p.id });
    const date = f.session.businessDate;
    const before = await api.getFinanceReport({ from: date, to: date });
    const cost = await api.correctPurchaseItemCost({
      purchaseId: f.purchase.id,
      purchaseItemId: f.purchase.items[0].id,
      expectedRevision: 0,
      unitCostMinor: 12000,
      reason: "Precio correcto de factura",
      authorizerPin: "1234",
      idempotencyKey: "actual-cost",
    });
    const after = await api.getFinanceReport({ from: date, to: date });
    await api.createPurchase({
      supplierName: "Stock para líneas nuevas",
      items: [{ productId: p.id, quantityMinor: 2000, unitCostMinor: 12000 }],
      authorizerPin: "1234",
    });
    const added = await api.addOrderItem({
      orderId: confirmed.id,
      productId: p.id,
      notes: "Nueva captura",
    });
    const draftConfirmed = await api.confirmOrder({ orderId: draft.id });
    return {
      before,
      after,
      cost,
      first: confirmed.items[0].id,
      later: added.items.find((x) => x.notes === "Nueva captura")!.id,
      draft: draftConfirmed.items[0].id,
    };
  }, f);
  expect(x.before.cogsMinor).toBe(10000);
  expect(x.after.cogsMinor).toBe(10000);
  expect(x.after.estimatedOperatingProfitMinor).toBe(
    x.before.estimatedOperatingProfitMinor,
  );
  expect(x.before.purchasesMinor).toBe(25000);
  expect(x.after.purchasesMinor).toBe(30000);
  const db = await ledger();
  const find = (id: string) =>
    db.finance_order_item_costs.find((r: any) => r.order_item_id === id);
  expect(find(x.first).unit_cost_minor).toBe(10000);
  expect(find(x.later).unit_cost_minor).toBe(12000);
  expect(find(x.draft).unit_cost_minor).toBe(12000);
  await writeFile(
    join(evidence, "cost-capture-boundaries.json"),
    JSON.stringify({ f, x, db }, null, 2),
  );
});
test("PIN error and metadata conflict preserve fields; Escape and reopening use current revision", async () => {
  const f = await fixture();
  const trigger = page.getByRole("button", {
    name: "Corregir costo",
    exact: true,
  });
  let d = await openCost();
  await d.getByLabel("Costo unitario correcto", { exact: true }).fill("120");
  await page.keyboard.press("Escape");
  await expect(d).toHaveCount(0);
  await expect(trigger).toBeFocused();
  d = await openCost();
  await fillCost(d, "130");
  await d.getByLabel("PIN autorizador", { exact: true }).fill("0000");
  await d.getByRole("button", { name: "Guardar costo", exact: true }).click();
  await expect(d.getByRole("alert")).toBeVisible();
  await expect(
    d.getByLabel("Costo unitario correcto", { exact: true }),
  ).toHaveValue("130");
  await d.getByLabel("PIN autorizador", { exact: true }).fill("1234");
  await page.evaluate(
    (f) =>
      window.gastronomy.correctPurchaseMetadata({
        purchaseId: f.purchase.id,
        expectedRevision: 0,
        supplierName: "Proveedor editado",
        reason: "Otra pantalla",
        authorizerPin: "1234",
        idempotencyKey: "metadata-concurrent",
      }),
    f,
  );
  await d.getByRole("button", { name: "Guardar costo", exact: true }).click();
  await expect(d.getByRole("alert")).toContainText(/modific|cambi|revisión/i);
  await expect(
    d.getByLabel("Costo unitario correcto", { exact: true }),
  ).toHaveValue("130");
  await d.getByRole("button", { name: "Cancelar", exact: true }).click();
  d = await openCost("Proveedor editado");
  await fillCost(d, "130");
  await d.getByRole("button", { name: "Guardar costo", exact: true }).click();
  await expect(d).toHaveCount(0);
  expect(
    (await page.evaluate(() => window.gastronomy.listPurchases()))[0].revision,
  ).toBe(2);
});
test("native zoom and pending IPC operation keep controls reachable and prevent duplicate close", async () => {
  await fixture();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]!.webContents.setZoomFactor(2),
  );
  const d = await openCost();
  await fillCost(d, "120");
  await d
    .getByRole("button", { name: "Guardar costo", exact: true })
    .scrollIntoViewIfNeeded();
  expect(
    await d.evaluate((el: any) => el.scrollWidth <= el.clientWidth + 1),
  ).toBe(true);
  await capture("cost-zoom200", {});
  await app.evaluate(({ ipcMain }) => {
    const original = (ipcMain as any)._invokeHandlers.get(
      "gastronomy:correctPurchaseItemCost",
    );
    if (typeof original !== "function") throw Error("No handler");
    (globalThis as any).__calls = 0;
    ipcMain.removeHandler("gastronomy:correctPurchaseItemCost");
    ipcMain.handle("gastronomy:correctPurchaseItemCost", async (e, input) => {
      (globalThis as any).__calls++;
      await new Promise<void>((r) => ((globalThis as any).__release = r));
      return original(e, input);
    });
  });
  await d.getByRole("button", { name: "Guardar costo", exact: true }).click();
  await expect(
    d.getByRole("button", { name: "Guardando…", exact: true }),
  ).toBeDisabled();
  await expect(
    d.getByLabel("Costo unitario correcto", { exact: true }),
  ).toBeDisabled();
  await expect(
    d.getByRole("button", { name: "Cancelar", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(d).toBeVisible();
  await app.evaluate(() => (globalThis as any).__release());
  await expect(d).toHaveCount(0);
  expect(await app.evaluate(() => (globalThis as any).__calls)).toBe(1);
});
