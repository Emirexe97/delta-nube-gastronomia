import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
let app: ElectronApplication, page: Page, profile = '';
const key = 'gastronomy.salon.view';
async function launch() {
  app = await electron.launch({ args: ['apps/desktop-shell', `--user-data-dir=${profile}`], cwd: process.cwd() });
  page = await app.firstWindow();
  await expect(page.getByText('Delta Nube', { exact: true })).toBeVisible();
  expect(resolve(await app.evaluate(({ app }) => app.getPath('userData')))).toBe(resolve(profile));
}
async function close() {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy()));
  await app.close();
}
test.beforeEach(async () => { profile = await mkdtemp(join(tmpdir(), 'gastronomy-salon-view-')); await launch(); });
test.afterEach(async () => {
  await close();
  if (dirname(resolve(profile)) !== resolve(tmpdir()) || !basename(profile).startsWith('gastronomy-salon-view-')) throw Error('Unsafe cleanup');
  await rm(profile, { recursive: true, force: true });
});
async function salon(view: 'Vista clásica' | 'Plano por sectores') {
  await page.getByRole('link', { name: 'Salón', exact: true }).click();
  await expect(page.getByRole('tab', { name: view, exact: true })).toHaveAttribute('aria-selected', 'true');
}
async function records() {
  return page.evaluate(async () => { const d = await window.gastronomy.bootstrap(); return { orders: d.orders, tables: d.tables, products: d.products, users: d.users, cashSession: d.cashSession }; });
}
test('conserva ambas vistas al navegar y reiniciar sin modificar datos operativos', async () => {
  const before = await records();
  await salon('Vista clásica');
  await page.getByRole('tab', { name: 'Plano por sectores', exact: true }).click();
  await page.getByRole('link', { name: 'Productos', exact: true }).click();
  await salon('Plano por sectores');
  await close(); await launch(); await salon('Plano por sectores');
  expect(await records()).toEqual(before);
  await page.getByRole('tab', { name: 'Vista clásica', exact: true }).click();
  await close(); await launch(); await salon('Vista clásica');
  expect(await records()).toEqual(before);
});
test('un valor desconocido usa Clásica y una elección válida lo reemplaza', async () => {
  await page.evaluate(key => localStorage.setItem(key, 'UNKNOWN'), key);
  await salon('Vista clásica');
  await page.getByRole('tab', { name: 'Plano por sectores', exact: true }).click();
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe('PLAN');
  await page.reload(); await salon('Plano por sectores');
});
test('almacenamiento bloqueado no impide abrir Salón ni alternar vistas', async () => {
  const before = await records();
  await page.evaluate(key => {
    const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
    Storage.prototype.getItem = function(k) { if (k === key) throw new DOMException('Blocked', 'SecurityError'); return get.call(this, k); };
    Storage.prototype.setItem = function(k,v) { if (k === key) throw new DOMException('Full', 'QuotaExceededError'); return set.call(this, k, v); };
  }, key);
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await salon('Vista clásica');
  await page.getByRole('tab', { name: 'Plano por sectores', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Plano por sectores', exact: true })).toHaveAttribute('aria-selected','true');
  await page.getByRole('tab', { name: 'Vista clásica', exact: true }).click();
  expect(errors).toEqual([]); expect(await records()).toEqual(before);
});
