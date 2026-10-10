import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

const evidence = resolve('docs/qa/evidence/system-usability-salon-list-service-2026-10-10');
let app: ElectronApplication;
let page: Page;
let profile = '';

test.beforeEach(async () => {
  await mkdir(evidence, { recursive: true });
  profile = await mkdtemp(join(tmpdir(), 'gastronomy-salon-list-service-'));
  app = await electron.launch({ args: ['apps/desktop-shell', `--user-data-dir=${profile}`], cwd: process.cwd() });
  page = await app.firstWindow();
  await expect(page.getByText('Delta Nube', { exact: true })).toBeVisible();
  expect(resolve(await app.evaluate(({ app }) => app.getPath('userData')))).toBe(resolve(profile));
  await page.evaluate(() => window.gastronomy.openCashSession({ openingAmountMinor: 100000 }));
  await page.reload();
});

test.afterEach(async () => {
  if (page && !page.isClosed() && test.info().status !== test.info().expectedStatus) {
    await writeFile(join(evidence, `failed-${test.info().title.replace(/[^a-z0-9]/gi, '_')}.json`), JSON.stringify(await page.evaluate(() => document.body.innerText), null, 2)).catch(() => {});
  }
  await app?.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((window) => window.destroy()));
  await app?.close();
  if (profile) {
    if (dirname(resolve(profile)) !== resolve(tmpdir()) || !basename(profile).startsWith('gastronomy-salon-list-service-')) throw new Error('Unsafe disposable profile cleanup');
    await rm(profile, { recursive: true, force: true });
  }
});

async function createConfirmedTableOrder(number: number) {
  return page.evaluate(async (number) => {
    const api = window.gastronomy;
    const data = await api.bootstrap();
    const table = await api.ensureTable({ number });
    const draft = await api.createOrder({ type: 'DINE_IN', tableId: table.id, waiterUserId: 'user-admin' });
    await api.addOrderItem({ orderId: draft.id, productId: data.products[0]!.id });
    return api.confirmOrder({ orderId: draft.id });
  }, number);
}

async function orderSnapshot(orderId: string) {
  return page.evaluate(async (orderId) => {
    const data = await window.gastronomy.bootstrap();
    const order = data.orders.find((item) => item.id === orderId)!;
    const table = data.tables.find((item) => item.id === order.tableId)!;
    return { order, table, cashSession: data.cashSession, productStock: data.products.map(({ id, stockMinor }) => ({ id, stockMinor })) };
  }, orderId);
}

async function openList() {
  await page.getByRole('link', { name: 'Salón', exact: true }).click();
  await page.getByRole('tab', { name: 'Lista de servicio', exact: true }).click();
}

async function capture(name: string, zoom = 1) {
  await app.evaluate(({ BrowserWindow }, zoom) => {
    const window = BrowserWindow.getAllWindows()[0]!;
    window.setSize(1366, 768);
    window.webContents.setZoomFactor(zoom);
  }, zoom);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(document.getAnimations().filter((animation) => animation.effect?.getTiming().iterations !== Infinity).map((animation) => animation.finished.catch(() => {})));
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  const pngBase64 = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'));
  await writeFile(join(evidence, `${name}.png`), Buffer.from(pngBase64, 'base64'));
  if (zoom !== 1) {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.setZoomFactor(1));
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  }
}

test('lista confirmados por antigüedad, persiste tras navegar y filtra sólo ocupadas', async () => {
  const oldest = await createConfirmedTableOrder(61);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const newer = await createConfirmedTableOrder(62);
  await page.reload();
  await openList();
  await expect(page.getByText(`Mesa 61`, { exact: true })).toBeVisible();
  const list = page.getByRole('table');
  const rows = list.getByRole('row');
  await expect(rows.nth(1)).toContainText('Mesa 61');
  await expect(rows.nth(2)).toContainText('Mesa 62');
  await capture('salon-list-1366x768');
  await capture('salon-list-200-percent', 2);

  await page.getByRole('tab', { name: 'Vista clásica', exact: true }).click();
  await page.getByRole('tab', { name: 'Lista de servicio', exact: true }).click();
  await expect(rows.nth(1)).toContainText('Mesa 61');
  await page.getByRole('link', { name: 'Resumen', exact: true }).click();
  await page.getByRole('link', { name: 'Salón', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Lista de servicio', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('checkbox', { name: 'Sólo ocupadas', exact: true }).check();
  await expect(page.getByText('Mesa 61', { exact: true })).toBeVisible();
  await expect(page.getByText('Mesa 62', { exact: true })).toBeVisible();
  expect((await orderSnapshot(oldest.id)).order.servicePendingSince).toBeTruthy();
  expect((await orderSnapshot(newer.id)).order.servicePendingSince).toBeTruthy();
});

test('marcar servido persiste servicio sin mutar finanzas, stock, estado ni vínculo de mesa', async () => {
  const order = await createConfirmedTableOrder(63);
  await page.reload();
  await openList();
  const before = await orderSnapshot(order.id);
  await page.getByRole('row').filter({ hasText: 'Mesa 63' }).getByRole('button', { name: `Marcar servido pedido ${order.number}`, exact: true }).click();
  await expect.poll(async () => (await orderSnapshot(order.id)).order.servedAt).toBeTruthy();
  const served = await orderSnapshot(order.id);
  expect(served.order.servicePendingSince).toBeNull();
  expect(served.order.serviceRevision).toBe((before.order.serviceRevision ?? 0) + 1);
  expect(served.order).toMatchObject({
    id: before.order.id,
    tableId: before.order.tableId,
    operationalStatus: before.order.operationalStatus,
    paymentStatus: before.order.paymentStatus,
    lifecycleStatus: before.order.lifecycleStatus,
    totalMinor: before.order.totalMinor,
    paidMinor: before.order.paidMinor,
    payments: before.order.payments,
  });
  expect(served.order.items).toEqual(before.order.items);
  expect(served.table).toMatchObject({ id: before.table.id, number: before.table.number, currentOrderId: before.table.currentOrderId });
  expect(served.cashSession).toEqual(before.cashSession);
  expect(served.productStock).toEqual(before.productStock);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((window) => window.destroy()));
  await app.close();
  app = await electron.launch({ args: ['apps/desktop-shell', `--user-data-dir=${profile}`], cwd: process.cwd() });
  page = await app.firstWindow();
  await expect(page.getByText('Delta Nube', { exact: true })).toBeVisible();
  expect(resolve(await app.evaluate(({ app }) => app.getPath('userData')))).toBe(resolve(profile));
  const reloaded = await orderSnapshot(order.id);
  expect(reloaded.order.servedAt).toBe(served.order.servedAt);
  expect(reloaded.order.serviceRevision).toBe(served.order.serviceRevision);
});

test('agregar un producto después de servido vuelve a dejar servicio pendiente', async () => {
  const order = await createConfirmedTableOrder(64);
  await page.evaluate(async (orderId) => {
    const before = (await window.gastronomy.bootstrap()).orders.find((item) => item.id === orderId)!;
    await window.gastronomy.markOrderServed({ orderId, expectedServiceRevision: before.serviceRevision!, idempotencyKey: `serve-${orderId}` });
  }, order.id);
  const served = await orderSnapshot(order.id);
  const secondProductId = await page.evaluate(async () => (await window.gastronomy.bootstrap()).products[1]!.id);
  await page.evaluate(async ({ orderId, productId }) => window.gastronomy.addOrderItem({ orderId, productId }), { orderId: order.id, productId: secondProductId });
  const reopened = await orderSnapshot(order.id);
  expect(reopened.order.servicePendingSince).toBeTruthy();
  expect(Date.parse(reopened.order.servicePendingSince!)).toBeGreaterThanOrEqual(Date.parse(served.order.servedAt!));
  expect(reopened.order.servedAt).toBeNull();
  expect(reopened.order.serviceRevision).toBeGreaterThan(served.order.serviceRevision!);
});

test('CAS obsoleto y replay idempotente no vuelven a mutar el servicio', async () => {
  const order = await createConfirmedTableOrder(65);
  const original = await orderSnapshot(order.id);
  const request = { orderId: order.id, expectedServiceRevision: original.order.serviceRevision!, idempotencyKey: `salon-list-${order.id}` };
  const result = await page.evaluate(async (request) => window.gastronomy.markOrderServed(request), request);
  const once = await orderSnapshot(order.id);
  const replay = await page.evaluate(async (request) => window.gastronomy.markOrderServed(request), request);
  expect(replay).toMatchObject({ servedAt: result.servedAt, serviceRevision: result.serviceRevision });
  await expect(page.evaluate(async ({ orderId, revision }) =>
    window.gastronomy.markOrderServed({ orderId, expectedServiceRevision: revision, idempotencyKey: `stale-${orderId}` }),
  { orderId: order.id, revision: original.order.serviceRevision! })).rejects.toThrow(/(?:servicio|pedido) cambió/i);
  expect(await orderSnapshot(order.id)).toEqual(once);
});
