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
  "docs/qa/evidence/system-usability-monthly-recovery-fix-2026-10-08",
);
let app: ElectronApplication;
let page: Page;
let profile = "";
test.use({ actionTimeout: 5000 });

async function launch(tag: string) {
  await mkdir(evidenceDir, { recursive: true });
  profile = await mkdtemp(join(tmpdir(), `gastronomy-us18c1-${tag}-`));
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
  expect(basename(profile)).toMatch(/^gastronomy-us18c1-/);
}
async function cleanup() {
  await app?.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().forEach((w) => w.destroy()),
  );
  await app?.close();
  if (profile) {
    if (
      dirname(resolve(profile)) !== resolve(tmpdir()) ||
      !basename(profile).startsWith("gastronomy-us18c1-")
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

test.beforeEach(async()=>launch('case'));test.afterEach(cleanup);
async function fixture(kind:'FIXED'|'PAYROLL'='FIXED'){return page.evaluate(async kind=>{const api=window.gastronomy,b=await api.bootstrap(),now=new Date(),y=now.getUTCFullYear(),m=now.getUTCMonth(),month=new Date(Date.UTC(y,m-1,1)).toISOString().slice(0,7),next=new Date(Date.UTC(y,m,1)).toISOString().slice(0,7),to=next+'-'+new Date(Date.UTC(y,m+1,0)).getUTCDate();const rule=await api.createFinanceRecurring({title:'Mensual a recuperar',category:'Servicios mensuales',kind,amountMinor:23450,dayOfMonth:1,startMonth:month,employeeId:kind==='PAYROLL'?b.users[0]!.id:undefined,idempotencyKey:'monthly-rule'});const report=await api.getFinanceReport({from:month+'-01',to});return{rule,month,next,to,expense:report.expenses.find(x=>x.recurringId===rule.id&&x.incurredOn.startsWith(month))!,neighbour:report.expenses.find(x=>x.recurringId===rule.id&&x.incurredOn.startsWith(next))!,products:b.products};},kind);}
const row=(title='Mensual a recuperar')=>expenseArticle(title);
for(const kind of ['FIXED','PAYROLL'] as const)test('correct only incurred unpaid monthly '+kind+' with native CSV and no rule change',async()=>{
const d=await fixture(kind);await openFinance(d.expense.incurredOn);await row().getByRole('button',{name:'Corregir este mes',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Corregir este mes',exact:true});await expect(dialog.getByText('Sólo cambia este gasto. Los próximos meses no se modifican.',{exact:true})).toBeVisible();await expect(dialog.getByLabel('Fecha del gasto',{exact:true})).toHaveCount(0);await expect(dialog.getByLabel('Tipo',{exact:true})).toHaveCount(0);await dialog.getByLabel('Concepto',{exact:true}).fill('Mensual corregido sólo una vez');await dialog.getByLabel('Categoría',{exact:true}).fill('Servicios ajustados');await dialog.getByLabel('Importe',{exact:true}).fill('120,00');await dialog.getByLabel('Vencimiento',{exact:true}).fill(d.next+'-20');await dialog.getByLabel('Nota',{exact:true}).fill('Diferencia de este mes');await dialog.getByLabel('Motivo',{exact:true}).fill('Importe de una mensualidad mal cargado');await capture('confirm-'+kind,d);await dialog.getByRole('button',{name:'Guardar corrección',exact:true}).click();await expect(dialog).toHaveCount(0);
const after=await page.evaluate(async d=>({one:await window.gastronomy.getFinanceReport({from:d.expense.incurredOn,to:d.expense.incurredOn}),both:await window.gastronomy.getFinanceReport({from:d.month+'-01',to:d.to}),boot:await window.gastronomy.bootstrap()}),d);const corrected=after.one.expenses.find(x=>x.id===d.expense.id)!;expect(corrected).toMatchObject({amountMinor:12000,incurredOn:d.expense.incurredOn,kind,employeeId:d.expense.employeeId,recurringId:d.rule.id,title:'Mensual corregido sólo una vez',category:'Servicios ajustados',dueOn:d.next+'-20',note:'Diferencia de este mes',revision:(d.expense.revision??0)+1});expect(after.one.expensesMinor).toBe(12000);expect(after.one.unpaidMinor).toBe(12000);expect(after.both.expenses.find(x=>x.id===d.neighbour.id)).toEqual(d.neighbour);expect(after.both.recurring.find(x=>x.id===d.rule.id)).toEqual(d.rule);expect(after.boot.cashSession).toBeNull();expect(after.boot.products).toEqual(d.products);const exported=await csv();expect(exported.content).toContain('"120.00"');expect(exported.content).toContain('"Pendiente"');expect(exported.content.trim().split('\r\n')).toHaveLength(2);await capture('after-'+kind,after);
});
test('cancel retained occurrence does not regenerate or stop rule and next month remains',async()=>{
const d=await fixture();await openFinance(d.expense.incurredOn);await row().getByRole('button',{name:'Anular este mes',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Anular este mes',exact:true});await dialog.getByLabel('Motivo de anulación',{exact:true}).fill('Este mes no corresponde pagar');await dialog.getByRole('button',{name:'Confirmar anulación',exact:true}).click();await expect(dialog).toHaveCount(0);const after=await page.evaluate(async d=>{const api=window.gastronomy;const one=await api.getFinanceReport({from:d.expense.incurredOn,to:d.expense.incurredOn});const again=await api.getFinanceReport({from:d.expense.incurredOn,to:d.expense.incurredOn});const both=await api.getFinanceReport({from:d.month+'-01',to:d.to});return{one,again,both};},d);expect(after.one).toEqual(after.again);expect(after.one.expenses).toHaveLength(1);expect(after.one.expenses[0]!.id).toBe(d.expense.id);expect(after.one.expenses[0]!.cancelledAt).toBeTruthy();expect(after.one.expensesMinor).toBe(0);expect(after.one.unpaidMinor).toBe(0);expect(after.both.recurring.find(x=>x.id===d.rule.id)).toEqual(d.rule);expect(after.both.expenses.find(x=>x.id===d.neighbour.id)).toEqual(d.neighbour);await expect(row().getByText('Anulado',{exact:true})).toBeVisible();const exported=await csv();expect(exported.content.trim().split('\r\n')).toHaveLength(1);await capture('monthly-cancel-retained',after);
});
test('concurrent payment rejection preserves fields and immutable occurrence; Escape and zoom work',async()=>{
const d=await fixture();await openFinance(d.expense.incurredOn);const trigger=()=>row().getByRole('button',{name:'Corregir este mes',exact:true});await trigger().click();let dialog=page.getByRole('dialog',{name:'Corregir este mes',exact:true});await dialog.getByLabel('Motivo',{exact:true}).fill('Cancelación sin cambios');await dialog.getByLabel('Motivo',{exact:true}).press('Escape');await expect(dialog).toHaveCount(0);await expect(trigger()).toBeFocused();for(const [width,zoom] of [[1100,1],[1366,2]]){await app.evaluate(({BrowserWindow},{width,zoom})=>{const w=BrowserWindow.getAllWindows()[0]!;w.setSize(width!,720);w.webContents.setZoomFactor(zoom!);},{width,zoom});await trigger().click();dialog=page.getByRole('dialog',{name:'Corregir este mes',exact:true});await dialog.getByRole('button',{name:'Cancelar',exact:true}).scrollIntoViewIfNeeded();expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);await capture('zoom-'+width+'-'+zoom,{});await dialog.getByRole('button',{name:'Cancelar',exact:true}).click();}
await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0]!.webContents.setZoomFactor(1));await trigger().click();dialog=page.getByRole('dialog',{name:'Corregir este mes',exact:true});await dialog.getByLabel('Concepto',{exact:true}).fill('Intento concurrente');await dialog.getByLabel('Motivo',{exact:true}).fill('No perder este motivo');await page.evaluate(async d=>window.gastronomy.payFinanceExpense({expenseId:d.expense.id,expectedRevision:d.expense.revision??0,fromCash:false,paymentMethodCode:'TRANSFER',idempotencyKey:'concurrent-pay'}),d);await dialog.getByRole('button',{name:'Guardar corrección',exact:true}).click();await expect(dialog.getByRole('alert')).toBeVisible();await expect(dialog.getByLabel('Motivo',{exact:true})).toHaveValue('No perder este motivo');await expect(dialog.getByLabel('Concepto',{exact:true})).toHaveValue('Intento concurrente');await capture('concurrent-reject',{});await dialog.getByRole('button',{name:'Cancelar',exact:true}).click();
});
