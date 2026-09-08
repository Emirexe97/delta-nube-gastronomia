import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let app: ElectronApplication;
let page: Page;
let userData = "";

test.beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), "gastronomy-shift-boundary-"));
  app = await electron.launch({
    args: ["apps/desktop-shell", `--user-data-dir=${userData}`],
    cwd: process.cwd(),
  });
  page = await app.firstWindow();
  await expect(page.getByText("Delta Nube", { exact: true })).toBeVisible();
});

test.afterEach(async () => {
  await app?.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) window.destroy();
  });
  await app?.close();
  if (userData) await rm(userData, { recursive: true, force: true });
});

test("un turno nuevo inicia Pedidos y Salón en cero y la auditoría omite acciones comunes", async () => {
  const result = await page.evaluate(async () => {
    const api = window.gastronomy;
    await api.openCashSession({ openingAmountMinor: 0 });
    const table = await api.ensureTable({ number: 88 });
    const tableOrder = await api.createOrder({
      type: "DINE_IN",
      tableId: table.id,
      waiterUserId: "user-admin",
    });
    const withItem = await api.addOrderItem({
      orderId: tableOrder.id,
      productId: "starter-muzza-grande",
    });
    await api.removeOrderItem({
      orderId: tableOrder.id,
      itemId: withItem.items[0]!.id,
    });
    await api.deleteTable({ tableId: table.id });
    await api.createCustomer({
      name: "Cliente sin auditoría",
      phone: "11 5555-8888",
    });

    const sale = await api.createOrder({
      type: "TAKEAWAY",
      customerName: "Cliente turno anterior",
      customerPhone: "11 5555-8989",
      deliveryAddress: "Calle Turno 89",
    });
    const populatedSale = await api.addOrderItem({
      orderId: sale.id,
      productId: "starter-muzza-grande",
    });
    await api.confirmOrder({ orderId: sale.id });
    await api.payOrder({
      orderId: sale.id,
      payments: [{ methodCode: "CASH", amountMinor: populatedSale.totalMinor }],
    });
    await api.updateOrderStatus({ orderId: sale.id, status: "DELIVERED" });
    const current = await api.bootstrap();
    await api.closeCashSession({
      countedAmountMinor: current.cashSession!.expectedAmountMinor,
    });
    const afterClose = await api.bootstrap();
    await api.openCashSession({ openingAmountMinor: 0 });
    const nextTurn = await api.bootstrap();
    const audit = await api.getAuditLog({ limit: 200 });
    return {
      afterCloseOrderCount: afterClose.orders.length,
      nextTurnOrderCount: nextTurn.orders.length,
      auditActions: audit.map((entry) => entry.action),
    };
  });

  expect(result.afterCloseOrderCount).toBe(0);
  expect(result.nextTurnOrderCount).toBe(0);
  expect(result.auditActions).toContain("ORDER_ITEM_REMOVED");
  expect(result.auditActions).toContain("TABLE_DELETED");
  expect(result.auditActions).not.toContain("TABLE_CREATED");
  expect(result.auditActions).not.toContain("CUSTOMER_CREATED");
  expect(result.auditActions).not.toContain("ORDER_PAID");

  await page.reload();
  await page.getByRole("link", { name: "Pedidos" }).click();
  await expect(page.getByText("No hay pedidos para este filtro")).toBeVisible();
  await page.getByRole("link", { name: "Salón" }).click();
  await expect(page.getByText(/0 ocupadas/)).toBeVisible();
  await page.getByRole("link", { name: "Auditoría" }).click();
  const auditTable = page.getByRole("table");
  await expect(
    auditTable.getByText("Producto quitado", { exact: true }),
  ).toBeVisible();
  await expect(
    auditTable.getByText("Mesa creada", { exact: true }),
  ).toHaveCount(0);
  await expect(
    auditTable.getByText("Cliente creado", { exact: true }),
  ).toHaveCount(0);
});
