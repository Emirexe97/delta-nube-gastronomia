import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
let app: ElectronApplication, page: Page, profile='';
test.beforeEach(async()=>{
 profile=await mkdtemp(join(tmpdir(),'gastronomy-occupied-filter-'));
 app=await electron.launch({args:['apps/desktop-shell',`--user-data-dir=${profile}`],cwd:process.cwd()});page=await app.firstWindow();
 await expect(page.getByText('Delta Nube',{exact:true})).toBeVisible();
 expect(resolve(await app.evaluate(({app})=>app.getPath('userData')))).toBe(resolve(profile));
 await page.evaluate(()=>window.gastronomy.openCashSession({openingAmountMinor:100000}));await page.reload();
});
test.afterEach(async()=>{await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy()));await app.close();if(dirname(resolve(profile))!==resolve(tmpdir())||!basename(profile).startsWith('gastronomy-occupied-filter-'))throw Error('Unsafe cleanup');await rm(profile,{recursive:true,force:true});});
async function records(){return page.evaluate(async()=>{const d=await window.gastronomy.bootstrap();return {tables:d.tables,orders:d.orders,products:d.products,cashSession:d.cashSession};});}

async function capture(name: string) {
 await page.evaluate(async()=>{await document.fonts.ready;await Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));await new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r())));});
 const png=await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'));
 await writeFile(resolve('docs/qa/evidence/system-usability-salon-shipping-2026-10-10',name+'.png'),Buffer.from(png,'base64'));
}
async function occupy(n:number){await page.evaluate(async n=>{const t=await window.gastronomy.ensureTable({number:n});await window.gastronomy.createOrder({type:'DINE_IN',tableId:t.id,waiterUserId:'user-admin'});},n);}
test('filtra ambas vistas, conserva plano en edición y no cambia datos',async()=>{
 await occupy(1);await page.reload();await page.getByRole('link',{name:'Salón',exact:true}).click();const before=await records();
 const filter=page.getByRole('checkbox',{name:'Sólo ocupadas',exact:true});await expect(filter).not.toBeChecked();
 await expect(page.getByRole('button',{name:'Abrir mesa 2',exact:true})).toBeVisible();await filter.check();
 await expect(page.getByRole('button',{name:'Abrir pedido de mesa 1',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Abrir mesa 2',exact:true})).toHaveCount(0);
 await capture('occupied-classic');
 await page.getByRole('tab',{name:'Plano por sectores',exact:true}).click();await expect(filter).toBeChecked();
 await expect(page.getByRole('button',{name:'Abrir pedido de mesa 1',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Abrir mesa 2',exact:true})).toHaveCount(0);
 await capture('occupied-plan');
 await page.getByRole('button',{name:'Editar plano',exact:true}).click();await expect(page.getByRole('button',{name:'Editar mesa 2',exact:true})).toBeVisible();
 expect(await records()).toEqual(before);
});
test('muestra vacío y la carga rápida sigue creando una mesa ocupada con filtro activo',async()=>{
 await page.getByRole('link',{name:'Salón',exact:true}).click();await page.getByRole('checkbox',{name:'Sólo ocupadas',exact:true}).check();
 await expect(page.getByText('No hay mesas ocupadas.',{exact:true})).toBeVisible();
 await page.getByRole('tab',{name:'Plano por sectores',exact:true}).click();await expect(page.getByText('No hay mesas ocupadas en este sector.',{exact:true})).toBeVisible();await page.getByRole('tab',{name:'Vista clásica',exact:true}).click();
 const input=page.getByLabel('Número de mesa');await input.fill('41');await input.press('Enter');
 await expect(page.getByLabel(/^Número de mozo/)).toBeFocused();await page.getByLabel(/^Número de mozo/).fill('1');await page.getByLabel(/^Número de mozo/).press('Enter');await expect(page.getByLabel(/^Nombre de mozo/)).toBeFocused();await page.getByLabel(/^Nombre de mozo/).press('Enter');
 await expect(page.getByRole('dialog',{name:/Pedido #\d+ · Salón/})).toBeVisible();await page.keyboard.press('Escape');
 await expect(page.getByRole('button',{name:'Abrir pedido de mesa 41',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Abrir mesa 2',exact:true})).toHaveCount(0);
});
