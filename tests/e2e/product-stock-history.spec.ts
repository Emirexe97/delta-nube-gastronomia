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
  profile = await mkdtemp(join(tmpdir(), "gastronomy-product-history-"));
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
    !basename(profile).startsWith("gastronomy-product-history-")
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
 const product=await page.evaluate(async()=>{const api=window.gastronomy;await api.openCashSession({openingAmountMinor:100000});const d=await api.bootstrap();return d.products.find(p=>p.active)!;});
 await page.getByRole('link',{name:'Productos',exact:true}).click(); return product;
}
async function openProduct(product:any) {
 await page.reload(); const row=page.getByRole('row').filter({hasText:product.name});
 await row.getByRole('button',{name:/editar/i}).click();
 const dialog=page.getByRole('dialog',{name:`Editar · ${product.name}`,exact:true});await expect(dialog).toBeVisible();return dialog;
}
test('product recent history includes stock adjustments and edits even beyond other-product recent activity',async()=>{
 const product=await fixture();await page.evaluate(async(product)=>{const api=window.gastronomy;await api.adjustStock({productId:product.id,newStockMinor:7000,reason:'Conteo físico del viernes',authorizerPin:'1234'});},product);
 const modulePath=createRequire(join(process.cwd(),'packages/database/package.json')).resolve('better-sqlite3-multiple-ciphers');
 await app.evaluate(({app},x)=>{const path=process.getBuiltinModule('path');if(path.resolve(app.getPath('userData'))!==path.resolve(x.profile))throw Error('wrong profile');const req=process.getBuiltinModule('module').createRequire(x.modulePath);const db=new(req(x.modulePath))(path.join(x.profile,'gastronomy.sqlite'));try{const base=db.prepare("SELECT * FROM audit_log WHERE action='STOCK_ADJUSTED' AND entity_id=? ORDER BY rowid DESC LIMIT 1").get(x.id);const insert=db.prepare('INSERT INTO audit_log(id,timestamp,business_date,operator_user_id,authorizer_user_id,permission_used,entity_type,entity_id,action,reason,before_json,after_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');db.transaction(()=>{for(let i=0;i<205;i++)insert.run('fixture-other-'+i,new Date(Date.now()+1000+i).toISOString(),base.business_date,base.operator_user_id,base.authorizer_user_id,base.permission_used,'PRODUCT','fixture-other-product','STOCK_ADJUSTED','Otro producto '+i,'{}','{}');})();}finally{db.close();}}, {profile,modulePath,id:product.id});
 await page.evaluate(async(product)=>{const api=window.gastronomy;const fresh=(await api.bootstrap()).products.find(p=>p.id===product.id)!;await api.updateProduct({productId:fresh.id,categoryId:fresh.categoryId,name:fresh.name,code:fresh.code,active:fresh.active,prices:fresh.prices,reason:'Edición de ficha revisada',authorizerPin:'1234'});},product);
 const dialog=await openProduct(product);const history=dialog.getByRole('region',{name:'Historial reciente de cambios'});
 await expect(history.getByText('Conteo físico del viernes',{exact:true})).toBeVisible();await expect(history.getByText('Stock ajustado',{exact:true})).toBeVisible();await expect(history.getByText('Edición de ficha revisada',{exact:true})).toBeVisible();await expect(history.getByRole('listitem').filter({hasText:'Conteo físico del viernes'}).getByText('Administrador',{exact:false})).toBeVisible();
 await expect(history.getByText(/Otro producto/)).toHaveCount(0);
 const before=await ledger();await history.scrollIntoViewIfNeeded();await capture('product-stock-history',{before});await dialog.getByRole('button',{name:'Cancelar',exact:true}).click();expect(await ledger()).toEqual(before);
});
test('an unavailable product history shows an error rather than pretending there are no changes',async()=>{
 const product=await fixture();await app.evaluate(({ipcMain})=>{const original=(ipcMain as any)._invokeHandlers.get('gastronomy:getAuditLog');if(typeof original!=='function')throw Error('missing handler');(globalThis as any).__historyOriginal=original;ipcMain.removeHandler('gastronomy:getAuditLog');ipcMain.handle('gastronomy:getAuditLog',()=>{throw Error('Lectura de historial no disponible');});});
 const before=await ledger();const dialog=await openProduct(product);const history=dialog.getByRole('region',{name:'Historial reciente de cambios'});await expect(history.getByText(/No se pudo cargar/)).toBeVisible();await expect(history.getByText(/Todavía no hay|No hay ediciones/)).toHaveCount(0);await dialog.getByRole('button',{name:'Cancelar',exact:true}).click();expect(await ledger()).toEqual(before);
});
