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
  "docs/qa/evidence/system-usability-purchase-metadata-fix-2026-10-09",
);
let app: ElectronApplication,
  page: Page,
  profile = "";
test.beforeEach(async () => {
  profile = await mkdtemp(join(tmpdir(), "gastronomy-purchase-metadata-"));
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
    !basename(profile).startsWith("gastronomy-purchase-metadata-")
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

async function purchaseFixture() {
  await page.evaluate(() =>
    window.gastronomy.openCashSession({ openingAmountMinor: 1000000 }),
  );
  const purchase = await page.evaluate(async () => {
    const api = window.gastronomy;
    const d = await api.bootstrap();
    const p = d.products.find((x) => x.active)!;
    return api.createPurchase({
      supplierName: "Proveedor original",
      invoiceNumber: "FAC-ORIGINAL",
      notes: "Nota original",
      items: [{ productId: p.id, quantityMinor: 2500, unitCostMinor: 10000 }],
      authorizerPin: "1234",
      idempotencyKey: "purchase-original",
    });
  });
  await page.reload();
  await page.getByRole("link", { name: "Compras", exact: true }).click();
  await expect(
    page.getByText("Proveedor original", { exact: true }),
  ).toBeVisible();
  return purchase;
}
async function openCorrection() {
  await page
    .getByRole("button", { name: "Corregir datos", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}
test("correct purchase metadata keeps economic identity, original receipt and native history", async () => {
  const purchase = await purchaseFixture();
  const before = await ledger();
  const dialog = await openCorrection();
  await expect(
    dialog.getByText("No cambia cantidades, costos ni stock.", { exact: true }),
  ).toBeVisible();
  await dialog
    .getByLabel("Proveedor", { exact: true })
    .fill("Proveedor corregido");
  await dialog.getByLabel("Comprobante", { exact: true }).fill("FAC-CORRECTA");
  await dialog.getByLabel("Notas", { exact: true }).fill("Nota corregida");
  await dialog
    .getByLabel("Motivo", { exact: true })
    .fill("Comprobante cargado incorrectamente");
  await dialog.getByLabel("PIN autorizador", { exact: true }).fill("1234");
  await capture("correction-confirm", { purchase, before });
  await dialog
    .getByRole("button", { name: "Guardar cambios", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByText("Proveedor corregido", { exact: true }),
  ).toBeVisible();
  const after = await ledger();
  for (const t of [
    "purchase_items",
    "products",
    "cash_movements",
    "cash_sessions",
    "finance_order_item_costs",
    "finance_product_costs",
    "finance_expenses",
  ])
    expect(after[t]).toEqual(before[t]);
  const corrected = await page.evaluate(() =>
    window.gastronomy.listPurchases(),
  );
  expect(corrected[0]).toMatchObject({
    ...purchase,
    supplierName: "Proveedor corregido",
    invoiceNumber: "FAC-CORRECTA",
    notes: "Nota corregida",
    revision: 1,
  });
  const receipt = await page.evaluate(async (p) => {
    const api = window.gastronomy;
    return api.createPurchase({
      supplierName: "Proveedor original",
      invoiceNumber: "FAC-ORIGINAL",
      notes: "Nota original",
      items: [
        {
          productId: p.items[0].productId,
          quantityMinor: 2500,
          unitCostMinor: 10000,
        },
      ],
      authorizerPin: "1234",
      idempotencyKey: "purchase-original",
    });
  }, purchase);
  expect(receipt).toEqual(purchase);
  expect(
    (await page.evaluate(() => window.gastronomy.listPurchases()))[0]
      .supplierName,
  ).toBe("Proveedor corregido");
  await capture("corrected-history", { corrected, after, receipt });
});
test("cancel Escape and PIN errors preserve fields and return focus", async () => {
  await purchaseFixture();
  const button = page.getByRole("button", {
    name: "Corregir datos",
    exact: true,
  });
  let dialog = await openCorrection();
  await dialog.getByLabel("Proveedor", { exact: true }).fill("No guardar");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(button).toBeFocused();
  await expect(
    page.getByText("Proveedor original", { exact: true }),
  ).toBeVisible();
  dialog = await openCorrection();
  await dialog
    .getByLabel("Proveedor", { exact: true })
    .fill("Proveedor conserva");
  await dialog
    .getByLabel("Motivo", { exact: true })
    .fill("Corrección comprobante");
  await dialog.getByLabel("PIN autorizador", { exact: true }).fill("0000");
  await dialog
    .getByRole("button", { name: "Guardar cambios", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByLabel("Proveedor", { exact: true })).toHaveValue(
    "Proveedor conserva",
  );
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(button).toBeFocused();
});
test("stale revision rejected with fields retained and busy blocks closing and repeat submission", async () => {
  const p = await purchaseFixture();
  const dialog = await openCorrection();
  await dialog
    .getByLabel("Proveedor", { exact: true })
    .fill("Desde pantalla anterior");
  await dialog
    .getByLabel("Motivo", { exact: true })
    .fill("Intento concurrente");
  await dialog.getByLabel("PIN autorizador", { exact: true }).fill("1234");
  await page.evaluate(
    async (p) =>
      window.gastronomy.correctPurchaseMetadata({
        purchaseId: p.id,
        expectedRevision: p.revision ?? 0,
        supplierName: "Cambio concurrente",
        reason: "Otra corrección",
        authorizerPin: "1234",
        idempotencyKey: "other-correction",
      }),
    p,
  );
  await dialog
    .getByRole("button", { name: "Guardar cambios", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByLabel("Proveedor", { exact: true })).toHaveValue(
    "Desde pantalla anterior",
  );
  expect(
    (await page.evaluate(() => window.gastronomy.listPurchases()))[0]
      .supplierName,
  ).toBe("Cambio concurrente");
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Corregir datos", exact: true }),
  ).toBeVisible();
  const newDialog = await openCorrection();
  await expect(newDialog.getByLabel("Proveedor", { exact: true })).toHaveValue(
    "Cambio concurrente",
  );
  await newDialog
    .getByLabel("Proveedor", { exact: true })
    .fill("Último proveedor");
  await newDialog
    .getByLabel("Motivo", { exact: true })
    .fill("Corrección final");
  await newDialog.getByLabel("PIN autorizador", { exact: true }).fill("1234");
  await app.evaluate(({ ipcMain }) => {
    const handlers = (ipcMain as any)._invokeHandlers;
    const original = handlers.get("gastronomy:correctPurchaseMetadata");
    if (typeof original !== "function")
      throw Error("Native IPC handler missing");
    (globalThis as any).__calls = 0;
    ipcMain.removeHandler("gastronomy:correctPurchaseMetadata");
    ipcMain.handle(
      "gastronomy:correctPurchaseMetadata",
      async (event, input) => {
        (globalThis as any).__calls++;
        await new Promise<void>((resolve) => {
          (globalThis as any).__release = resolve;
        });
        return original(event, input);
      },
    );
  });
  await newDialog
    .getByRole("button", { name: "Guardar cambios", exact: true })
    .click();
  await expect(
    newDialog.getByRole("button", { name: "Guardando…", exact: true }),
  ).toBeDisabled();
  await expect(
    newDialog.getByLabel("Proveedor", { exact: true }),
  ).toBeDisabled();
  await expect(
    newDialog.getByRole("button", { name: "Cancelar", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(newDialog).toBeVisible();
  await app.evaluate(() => (globalThis as any).__release());
  await expect(newDialog).toHaveCount(0);
  expect(await app.evaluate(() => (globalThis as any).__calls)).toBe(1);
});
test("native 200 percent zoom keeps correction actions reachable without horizontal overflow", async () => {
  await purchaseFixture();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]!.webContents.setZoomFactor(2),
  );
  const dialog = await openCorrection();
  await dialog.getByLabel("Motivo", { exact: true }).fill("Revisar visual");
  await dialog.getByLabel("PIN autorizador", { exact: true }).fill("1234");
  await dialog
    .getByRole("button", { name: "Guardar cambios", exact: true })
    .scrollIntoViewIfNeeded();
  const overflow = await dialog.evaluate(
    (el) => el.scrollWidth > el.clientWidth + 1,
  );
  expect(overflow).toBe(false);
  await capture("correction-zoom200", { overflow });
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
});
