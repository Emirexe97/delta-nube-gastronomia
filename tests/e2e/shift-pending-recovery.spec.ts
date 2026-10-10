import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

let app: ElectronApplication;
let page: Page;
let profile = '';

test.beforeEach(async () => {
  profile = await mkdtemp(join(tmpdir(), 'gastronomy-shift-pending-e2e-'));
  app = await electron.launch({ args: ['apps/desktop-shell', `--user-data-dir=${profile}`], cwd: process.cwd() });
  page = await app.firstWindow();
  await expect(page.getByText('Delta Nube', { exact: true })).toBeVisible();
});

test.afterEach(async () => {
  await app?.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((window) => window.destroy()));
  await app?.close();
  if (profile) {
    if (dirname(resolve(profile)) !== resolve(tmpdir()) || !basename(profile).startsWith('gastronomy-shift-pending-e2e-')) throw new Error('Unsafe disposable profile cleanup');
    await rm(profile, { recursive: true, force: true });
  }
});

async function createOldShift() {
  return page.evaluate(async () => {
    const api = window.gastronomy;
    const data = await api.bootstrap();
    const sessionA = await api.openCashSession({ openingAmountMinor: 50000 });
    const table = await api.ensureTable({ number: 31 });
    const tableOrder = await api.createOrder({ type: 'DINE_IN', tableId: table.id, waiterUserId: 'user-admin' });
    const tableWithItem = await api.addOrderItem({ orderId: tableOrder.id, productId: data.products[0]!.id });
    await api.confirmOrder({ orderId: tableOrder.id });
    await api.payOrder({ orderId: tableOrder.id, payments: [{ methodCode: 'CASH', amountMinor: tableWithItem.totalMinor }] });
    const takeaway = await api.createOrder({ type: 'TAKEAWAY', customerName: 'Pendiente A', customerPhone: '1155550031' });
    await api.addOrderItem({ orderId: takeaway.id, productId: data.products[0]!.id });
    await api.confirmOrder({ orderId: takeaway.id });
    const delivery = await api.createOrder({ type: 'DELIVERY', customerName: 'Reparto A', customerPhone: '1155550032', deliveryAddress: 'Calle A 31' });
    await api.addOrderItem({ orderId: delivery.id, productId: data.products[0]!.id });
    await api.confirmOrder({ orderId: delivery.id });
    await api.closeCashSession({ countedAmountMinor: (await api.bootstrap()).cashSession!.expectedAmountMinor, force: true, reason: 'Pendientes históricos del turno A', authorizerPin: '1234' });
    const sessionB = await api.openCashSession({ openingAmountMinor: 10000 });
    return { tableOrderId: tableOrder.id, takeawayId: takeaway.id, deliveryId: delivery.id, tableNumber: table.number, sessionAId: sessionA.id, sessionBId: sessionB.id };
  });
}

test('abre desde Salón una mesa pagada del turno anterior y Cerrar mesa la libera sin tocar pagos ni cajas', async () => {
  const ids = await createOldShift();
  await page.reload();
  const before = await page.evaluate(async ({ tableOrderId, sessionAId, sessionBId }) => {
    const api = window.gastronomy;
    const data = await api.bootstrap();
    return {
      order: await api.getOrder({ orderId: tableOrderId }),
      b: data.cashSession,
      orders: data.orders.map(({ id }) => id),
      reportA: await api.getCashSessionReport({ cashSessionId: sessionAId }),
      reportB: await api.getCashSessionReport({ cashSessionId: sessionBId }),
    };
  }, ids);
  expect(before.orders).toEqual([]);
  expect(before.order.paymentStatus).toBe('PAID');

  await page.getByRole('link', { name: 'Salón', exact: true }).click();
  await page.getByRole('button', { name: 'Abrir pedido de mesa 31', exact: true }).click();
  const editor = page.getByRole('dialog', { name: /Pedido #\d+ · Salón/ });
  await expect(editor).toBeVisible();
  await editor.getByRole('button', { name: 'Cerrar mesa', exact: true }).click();
  await expect(editor).toBeHidden();

  const after = await page.evaluate(async ({ tableOrderId, sessionAId, sessionBId }) => {
    const api = window.gastronomy;
    const data = await api.bootstrap();
    const oldOrder = await api.getOrder({ orderId: tableOrderId });
    const table = data.tables.find((row) => row.number === 31)!;
    return {
      order: oldOrder,
      table,
      currentSession: data.cashSession,
      reportA: await api.getCashSessionReport({ cashSessionId: sessionAId }),
      reportB: await api.getCashSessionReport({ cashSessionId: sessionBId }),
    };
  }, ids);
  expect(after.order.paymentStatus).toBe('PAID');
  expect(after.order.paidMinor).toBe(before.order.paidMinor);
  expect(after.order.payments).toEqual(before.order.payments);
  expect(after.order.operationalStatus).toBe('DELIVERED');
  expect(after.table.currentOrderId).toBeNull();
  expect(after.currentSession?.id).toBe(ids.sessionBId);
  expect(after.reportA.session).toEqual(before.reportA.session);
  expect(after.reportB.session).toEqual(before.reportB.session);
  expect(after.reportA.totals).toEqual(before.reportA.totals);
  expect(after.reportB.totals).toEqual(before.reportB.totals);
  expect(after.reportA.movements).toEqual(before.reportA.movements);
  expect(after.reportB.movements).toEqual(before.reportB.movements);
  await expect(page.getByRole('button', { name: 'Abrir mesa 31', exact: true })).toBeVisible();
});

test('B puede cerrar normalmente con pendientes impagos conservados en A', async () => {
  const ids = await createOldShift();
  const result = await page.evaluate(async ({ takeawayId, deliveryId }) => {
    const api = window.gastronomy;
    const current = await api.bootstrap();
    const pending = current.orders.find((order) => order.id === takeawayId);
    if (pending) throw new Error('El pedido histórico apareció en los pedidos de B');
    const b = (await api.bootstrap()).cashSession!;
    const closed = await api.closeCashSession({ countedAmountMinor: b.expectedAmountMinor });
    return {
      closed,
      bootstrap: await api.bootstrap(),
      takeaway: await api.getOrder({ orderId: takeawayId }),
      delivery: await api.getOrder({ orderId: deliveryId }),
    };
  }, ids);
  expect(result.closed.status).toBe('CLOSED');
  expect(result.bootstrap.cashSession).toBeNull();
  expect(result.bootstrap.orders).toEqual([]);
  expect(result.takeaway.operationalStatus).toBe('IN_PREPARATION');
  expect(result.takeaway.paymentStatus).toBe('UNPAID');
  expect(result.delivery.operationalStatus).toBe('IN_PREPARATION');
  expect(result.delivery.paymentStatus).toBe('UNPAID');
});
