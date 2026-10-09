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
  "docs/qa/evidence/system-usability-known-bugs-fix-2026-10-09",
);
let app: ElectronApplication,
  page: Page,
  profile = "";

test.beforeEach(async () => {
  profile = await mkdtemp(join(tmpdir(), "gastronomy-order-guidance-"));
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
    !basename(profile).startsWith("gastronomy-order-guidance-")
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

async function openOrder(name:string){await page.reload();await page.getByRole('link',{name:'Pedidos',exact:true}).click();await page.getByRole('row').filter({hasText:name}).click();const editor=page.getByRole('dialog',{name:/Pedido #/});await expect(editor).toBeVisible();return editor;}
test('a blocked draft confirmation has a visible reason without hover and never changes the order',async()=>{
 const order=await page.evaluate(async()=>{const api=window.gastronomy;await api.openCashSession({openingAmountMinor:1000000});return api.createOrder({type:'TAKEAWAY',customerName:'Motivo confirmación',customerPhone:'1155557301'});});const before=await ledger();const editor=await openOrder('Motivo confirmación');const confirm=editor.getByRole('button',{name:'Confirmar pedido',exact:true});await expect(confirm).toBeDisabled();const reason=await confirm.getAttribute('title');expect(reason).toBeTruthy();await expect(editor.getByText(reason!,{exact:true})).toBeVisible();await capture('visible-confirmation-reason',{order,before,reason});await page.keyboard.press('Escape');expect(await ledger()).toEqual(before);
});
async function deliveryFixture(){return page.evaluate(async()=>{const api=window.gastronomy;const d=await api.bootstrap();await api.saveSettings({...d.settings,deliverySettlementEnabled:true,deliveryFeeBelongsToDriver:true,deliveryDriverPaymentMode:'ACCUMULATED'});const session=await api.openCashSession({openingAmountMinor:1000000});const driver=await api.createDriver({fullName:'Repartidor prueba cobro',authorizerPin:'1234'});const order=await api.createOrder({type:'DELIVERY',customerName:'Receptor del cobro',customerPhone:'1155557302',deliveryAddress:'Calle 730',deliveryFeeMinor:250000,driverUserId:driver.id});await api.addOrderItem({orderId:order.id,productId:d.products[0]!.id});const confirmed=await api.confirmOrder({orderId:order.id});await api.updateOrderStatus({orderId:order.id,status:'READY'});await api.updateOrderStatus({orderId:order.id,status:'OUT_FOR_DELIVERY'});return{order:confirmed,driver,session};});}
test('cash at door identifies driver and cash-register effect before confirming actual delivery',async()=>{
 const f=await deliveryFixture();const editor=await openOrder('Receptor del cobro');await editor.getByRole('button',{name:'Entregar',exact:true}).click();const pay=page.getByRole('dialog',{name:'Cobrar y entregar',exact:true});await expect(pay.getByText(/lo recibe el repartidor/i)).toBeVisible();await expect(pay.getByText(/No ingresa efectivo a esta caja/i)).toBeVisible();await expect(pay.getByText(/retiene.*envío/i)).toBeVisible();await capture('delivery-cash-receiver',{f});await pay.getByRole('button',{name:'Cobrar y entregar',exact:true}).click();await expect(pay).toHaveCount(0);const after=await page.evaluate(()=>window.gastronomy.bootstrap());expect(after.cashSession!.expectedAmountMinor).toBe(f.session.expectedAmountMinor);const delivered=after.orders.find(o=>o.id===f.order.id)!;expect(delivered.collectedByDriver).toBe(true);expect(delivered.paymentStatus).toBe('PAID');expect(after.deliveryLedger.find(l=>l.orderId===f.order.id)?.direction).toBe('DRIVER_OWES_BUSINESS');
});
test('non-cash payment identifies the business; changing method and cancelling never creates a payment',async()=>{
 const f=await deliveryFixture();const editor=await openOrder('Receptor del cobro');await editor.getByRole('button',{name:'Entregar',exact:true}).click();const pay=page.getByRole('dialog',{name:'Cobrar y entregar',exact:true});await pay.getByLabel('Efectivo',{exact:true}).fill('');await pay.getByLabel('Transferencia',{exact:true}).fill(String(f.order.totalMinor/100));await expect(pay.getByText(/Cobro recibido por el negocio/i)).toBeVisible();await expect(pay.getByText(/no aumentan el efectivo de caja/i)).toBeVisible();const before=await ledger();await capture('delivery-transfer-receiver',{f});await pay.getByRole('button',{name:'Cancelar',exact:true}).click();expect(await ledger()).toEqual(before);
});
test('driver cash overpay requires cash change before submission and preserves the actual cash ledger',async()=>{
 const f=await deliveryFixture();const editor=await openOrder('Receptor del cobro');await editor.getByRole('button',{name:'Entregar',exact:true}).click();const pay=page.getByRole('dialog',{name:'Cobrar y entregar',exact:true});await pay.getByLabel('Efectivo',{exact:true}).fill(String(f.order.totalMinor/100+100));await pay.getByLabel('Entregar vuelto en:').selectOption('TRANSFER');await expect(pay.getByText(/el vuelto debe ser en efectivo/i)).toBeVisible();const submit=pay.getByRole('button',{name:'Cobrar y entregar',exact:true});await expect(submit).toBeDisabled();const before=await ledger();await pay.getByLabel('Entregar vuelto en:').selectOption('CASH');await expect(submit).toBeEnabled();await submit.click();await expect(pay).toHaveCount(0);const after=await page.evaluate(()=>window.gastronomy.bootstrap());expect(after.cashSession!.expectedAmountMinor).toBe(f.session.expectedAmountMinor);expect(after.orders.find(o=>o.id===f.order.id)!.collectedByDriver).toBe(true);const rawAfter=await ledger();expect(rawAfter.products).toEqual(before.products);expect(rawAfter.cash_movements.filter((m:any)=>m.affects_cash)).toEqual(before.cash_movements.filter((m:any)=>m.affects_cash));const added=rawAfter.cash_movements.filter((m:any)=>!before.cash_movements.some((old:any)=>old.id===m.id));expect(added.map((m:any)=>({type:m.type,amount:m.amount_minor,affects:m.affects_cash}))).toEqual([{type:"SALE",amount:f.order.totalMinor+10000,affects:0},{type:"REFUND",amount:10000,affects:0}]);
});
test('delivery cash plus prepaid cannot submit but cash-only works without changing financial rules',async()=>{
 const f=await deliveryFixture();const editor=await openOrder('Receptor del cobro');await editor.getByRole('button',{name:'Entregar',exact:true}).click();const pay=page.getByRole('dialog',{name:'Cobrar y entregar',exact:true});await pay.getByLabel('Efectivo',{exact:true}).fill(String(f.order.totalMinor/200));await pay.getByLabel('Transferencia',{exact:true}).fill(String(f.order.totalMinor/200));await expect(pay.getByText(/sin combinarlos/i)).toBeVisible();await expect(pay.getByRole('button',{name:'Cobrar y entregar',exact:true})).toBeDisabled();const before=await ledger();await pay.getByLabel('Transferencia',{exact:true}).fill('');await pay.getByLabel('Efectivo',{exact:true}).fill(String(f.order.totalMinor/100));await expect(pay.getByRole('button',{name:'Cobrar y entregar',exact:true})).toBeEnabled();await pay.getByRole('button',{name:'Cancelar',exact:true}).click();expect(await ledger()).toEqual(before);
});
