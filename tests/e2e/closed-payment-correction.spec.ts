import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const evidenceDir = join(
  process.cwd(),
  "docs/qa/evidence/system-usability-closed-payment-fix-2026-10-08",
);
let app: ElectronApplication;
let page: Page;
let profile = "";
test.use({ actionTimeout: 5000 });

async function launch(tag: string) {
  await mkdir(evidenceDir, { recursive: true });
  profile = await mkdtemp(join(tmpdir(), `gastronomy-us18b2c-${tag}-`));
  app = await electron.launch({
    args: ["apps/desktop-shell", `--user-data-dir=${profile}`],
    cwd: process.cwd(),
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(5000);
  await expect(page.getByText("Delta Nube", { exact: true })).toBeVisible({
    timeout: 90_000,
  });
  const userData = await app.evaluate(({ app }) => app.getPath("userData"));
  expect(resolve(userData)).toBe(resolve(profile));
  expect(basename(profile)).toMatch(/^gastronomy-us18b2c-/);
}
async function cleanup() {
  await app?.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().forEach((w) => w.destroy()),
  );
  await app?.close();
  if (profile) {
    if (
      dirname(resolve(profile)) !== resolve(tmpdir()) ||
      !basename(profile).startsWith("gastronomy-us18b2c-")
    )
      throw new Error("Unsafe disposable profile cleanup");
    await rm(profile, { recursive: true, force: true });
    profile = "";
  }
}
async function capture(name: string, state: unknown) {
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
  await writeFile(join(evidenceDir, `${name}.png`), Buffer.from(png, "base64"));
  await writeFile(
    join(evidenceDir, `${name}.json`),
    JSON.stringify({ state, realElectronSqliteAndIpc: true }, null, 2),
  );
}
async function seed(title: string, amountMinor = 1_234_500) {
  return page.evaluate(
    async ({ title, amountMinor }) => {
      const api = window.gastronomy;
      const opened = await api.openCashSession({
        openingAmountMinor: 10_000_000,
      });
      const date = (await api.bootstrap()).cashSession!.businessDate;
      const expense = await api.createFinanceExpense({
        title,
        category: "US18A prueba",
        kind: "GENERAL",
        amountMinor,
        incurredOn: date,
        dueOn: date,
        note: "nota inicial",
        idempotencyKey: crypto.randomUUID(),
      });
      return {
        date,
        sessionId: opened.id,
        expense,
        products: (await api.bootstrap()).products,
        report: await api.getFinanceReport({ from: date, to: date }),
        cash: await api.getCashSessionReport({ cashSessionId: opened.id }),
      };
    },
    { title, amountMinor },
  );
}
async function openFinance(date: string) {
  await page.reload();
  await page.getByRole("link", { name: "Finanzas", exact: true }).click();
  await page.getByLabel("Desde", { exact: true }).fill(date);
  await page.getByLabel("Hasta", { exact: true }).fill(date);
}
const expenseArticle = (title: string) =>
  page
    .locator("article")
    .filter({ has: page.getByText(title, { exact: true }) });


test.beforeEach(async()=>launch('case'));test.afterEach(cleanup);
async function fixture(method='CASH',newBox=false,opening=5000){return page.evaluate(async({method,newBox,opening})=>{
const api=window.gastronomy,original=await api.openCashSession({openingAmountMinor:100000}),date=original.businessDate;
const expense=await api.createFinanceExpense({title:'Pago cerrado por error',category:'Prueba cerrada',kind:'GENERAL',amountMinor:23450,incurredOn:date});
const pay={expenseId:expense.id,paymentMethodCode:method,fromCash:true,expectedRevision:expense.revision??0,idempotencyKey:'original-pay'};
const paid=await api.payFinanceExpense(pay);await api.closeCashSession({countedAmountMinor:100000,closingFloatAmountMinor:5000,force:true,reason:'Pago nunca realizado',authorizerPin:'1234'});
const closed=await api.getCashSessionReport({cashSessionId:original.id});if(newBox)await api.openCashSession({openingAmountMinor:opening});
return {expense,paid,pay,date,original,closed,report:await api.getFinanceReport({from:date,to:date}),products:(await api.bootstrap()).products};
},{method,newBox,opening});}
const row=()=>expenseArticle('Pago cerrado por error');
async function modal(){await row().getByRole('button',{name:'Corregir pago de caja cerrada',exact:true}).click();return page.getByRole('dialog',{name:'Corregir pago registrado',exact:true});}
async function csv() {
  const savePath = join(profile, "expense-return.csv");
  await app.evaluate(({ session, app }, savePath) => {
    (app as any).__expenseReturnDownload = null;
    session.defaultSession.once("will-download", (_e, item) => {
      (app as any).__expenseReturnFilename = item.getFilename();
      item.setSavePath(savePath);
      item.once("done", (_e, state) => {
        (app as any).__expenseReturnDownload = state;
      });
    });
  }, savePath);
  await page
    .getByRole("button", { name: "Exportar gastos (CSV)", exact: true })
    .click();
  await expect
    .poll(() => app.evaluate(({ app }) => (app as any).__expenseReturnDownload))
    .toBe("completed");
  return {
    name: await app.evaluate(
      ({ app }) => (app as any).__expenseReturnFilename as string,
    ),
    content: await readFile(savePath, "utf8"),
  };
}
for(const method of ['CASH','TRANSFER'])test('closed '+method+' restores debt without changing closure or currentcash',async()=>{
const d=await fixture(method,method==='TRANSFER');await openFinance(d.date);const dialog=await modal();
await expect(dialog.getByText('El gasto volverá a pendiente. No se registrará un ingreso ni se cambiará el cierre anterior.',{exact:true})).toBeVisible();
await dialog.getByLabel('Motivo',{exact:true}).fill('Confirmo pago nunca realizado y obligación aún adeudada');await dialog.getByLabel('PIN de autorización',{exact:true}).fill('1234');
const submit=dialog.getByRole('button',{name:'Corregir pago registrado',exact:true});await expect(submit).toBeDisabled();
await dialog.getByRole('checkbox',{name:'Confirmo que el dinero nunca salió y el gasto todavía se debe pagar.',exact:true}).check();
await capture('confirm-'+method,d);await submit.click();await expect(dialog).toHaveCount(0);
const after=await page.evaluate(async d=>({report:await window.gastronomy.getFinanceReport({from:d.date,to:d.date}),closed:await window.gastronomy.getCashSessionReport({cashSessionId:d.original.id}),boot:await window.gastronomy.bootstrap()}),d);
expect(after.closed).toEqual(d.closed);expect(after.report.expensesMinor).toBe(23450);expect(after.report.unpaidMinor).toBe(23450);expect(after.report.estimatedOperatingProfitMinor).toBe(d.report.estimatedOperatingProfitMinor);expect(after.report.expenseReturnsMinor??0).toBe(0);expect(after.report.expenses).toHaveLength(1);expect(after.boot.products).toEqual(d.products);
if(method==='TRANSFER')expect(after.boot.cashSession!.expectedAmountMinor).toBe(5000);else expect(after.boot.cashSession).toBeNull();
await expect(row().getByRole('button',{name:'Marcar pagado',exact:true})).toBeVisible();
const exported=await csv();expect(exported.content.charCodeAt(0)).toBe(0xfeff);const lines=exported.content.trim().split('\r\n');expect(lines).toHaveLength(2);expect(lines[1]).toContain('"234.50"');expect(lines[1]).toContain('"Pendiente"');expect(exported.content).not.toContain('DEVOLUCIÓN');expect(lines.every(line=>line.split(';').length===8)).toBe(true);await capture('after-'+method,after);
});
test('new pay and real return use new movement, historical correction replay immutable',async()=>{
const d=await fixture('CASH',true,100000);const after=await page.evaluate(async d=>{
const api=window.gastronomy,input={expenseId:d.expense.id,expectedRevision:d.paid.revision??0,reason:'Nunca pagado y aún adeudado',authorizerPin:'1234',confirmedUnpaid:true,idempotencyKey:'closed-correction'};
const first=await api.correctFinanceExpenseClosedCashPayment(input);await api.payFinanceExpense(d.pay);const pending=await api.getFinanceReport({from:d.date,to:d.date});
const paid=await api.payFinanceExpense({...d.pay,expectedRevision:first.revision,idempotencyKey:'actual-new-payment'});
const replay=await api.correctFinanceExpenseClosedCashPayment(input);const report=await api.getFinanceReport({from:d.date,to:d.date});
const returned=await api.receiveFinanceExpenseReturn({expenseId:d.expense.id,expectedRevision:paid.revision??0,destination:'CASH_SESSION',paymentMethodCode:'CASH',reason:'Devolución real del nuevo pago',authorizerPin:'1234',idempotencyKey:'actual-return'});
return {first,pending,paid,replay,report,returned,closed:await api.getCashSessionReport({cashSessionId:d.original.id}),boot:await api.bootstrap()};
},d);expect(after.pending.unpaidMinor).toBe(23450);expect(after.replay).toEqual(after.first);expect(after.report.unpaidMinor).toBe(0);expect(after.report.expensesMinor).toBe(23450);expect(after.closed).toEqual(d.closed);expect(after.boot.cashSession!.expectedAmountMinor).toBe(100000);expect(after.returned.returnInfo?.originalMovementId).not.toBe(d.closed.movements.find(x=>x.type==='EXPENSE')!.id);await capture('repay-and-return',after);
});
test('rejected PIN preserves confirmation and reason; Escape and zoom safe',async()=>{
const d=await fixture();await openFinance(d.date);let dialog=await modal();await dialog.getByLabel('Motivo',{exact:true}).fill('No salió dinero y sigue pendiente');await dialog.getByLabel('PIN de autorización',{exact:true}).fill('9999');await dialog.getByRole('checkbox').check();await dialog.getByRole('button',{name:'Corregir pago registrado',exact:true}).click();await expect(dialog.getByRole('alert')).toBeVisible();await expect(dialog.getByLabel('Motivo',{exact:true})).toHaveValue('No salió dinero y sigue pendiente');await expect(dialog.getByRole('checkbox')).toBeChecked();await dialog.getByLabel('Motivo',{exact:true}).press('Escape');await expect(dialog).toHaveCount(0);await expect(row().getByRole('button',{name:'Corregir pago de caja cerrada',exact:true})).toBeFocused();
for(const [width,zoom] of [[1100,1],[1366,2]]){await app.evaluate(({BrowserWindow},{width,zoom})=>{const w=BrowserWindow.getAllWindows()[0]!;w.setSize(width!,720);w.webContents.setZoomFactor(zoom!);},{width,zoom});dialog=await modal();await dialog.getByRole('button',{name:'Cancelar',exact:true}).scrollIntoViewIfNeeded();await expect(dialog.getByRole('button',{name:'Cancelar',exact:true})).toBeVisible();const rect=await dialog.evaluate(el=>({sw:el.scrollWidth,cw:el.clientWidth}));expect(rect.sw).toBeLessThanOrEqual(rect.cw+1);await capture('zoom-'+width+'-'+zoom,rect);await dialog.getByRole('button',{name:'Cancelar',exact:true}).click();}
expect(await page.evaluate(async d=>window.gastronomy.getCashSessionReport({cashSessionId:d.original.id}),d)).toEqual(d.closed);
});
