import { launchConfiguredPos } from "./pos-fixture";
import { test, expect, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let app: ElectronApplication;
let page: Page;
let userData = "";

test.beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), "gastronomy-account-orders-"));
  app = await launchConfiguredPos({ args: ["apps/desktop-shell", `--user-data-dir=${userData}`], cwd: process.cwd() });
  page = await app.firstWindow();
});
test.afterEach(async () => {
  await app?.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) window.destroy();
  });
  await app?.close();
  if (userData) await rm(userData, { recursive: true, force: true });
});

async function seed(type: "TAKEAWAY" | "DELIVERY", linked = false, delivering = false) {
  const setup = await page.evaluate(async ({ type, linked, delivering }) => {
    const api = window.gastronomy;
    const data = await api.bootstrap();
    const session = await api.openCashSession({ openingAmountMinor: 1_000_000 });
    const customer = await api.createCustomer({ name: "Cliente cuenta E2E", phone: "1155559876" });
    const driver = type === "DELIVERY" ? await api.createDriver({ fullName: "Repartidor cuenta E2E", authorizerPin: "748259" }) : null;
    const order = await api.createOrder({
      type, customerId: linked ? customer.id : undefined,
      customerName: customer.name, customerPhone: customer.phone,
      deliveryAddress: type === "DELIVERY" ? "Calle Cuenta 123" : undefined,
      driverUserId: driver?.id,
    });
    await api.addOrderItem({ orderId: order.id, productId: data.products[0]!.id });
    const confirmed = await api.confirmOrder({ orderId: order.id });
    if (delivering) {
      await api.updateOrderStatus({ orderId: order.id, status: "READY" });
      await api.updateOrderStatus({ orderId: order.id, status: "OUT_FOR_DELIVERY" });
    }
    return { id: order.id, customerId: customer.id, total: confirmed.totalMinor, sessionId: session.id };
  }, { type, linked, delivering });
  await page.reload();
  await page.getByRole("link", { name: "Pedidos", exact: true }).click();
  await page.getByRole("row").filter({ hasText: "Cliente cuenta E2E" }).click();
  return setup;
}

for (const type of ["TAKEAWAY", "DELIVERY"] as const) {
  test(`Pedidos ${type}: carga a cuenta y vincula ficha sin duplicar efectivo`, async () => {
    const setup = await seed(type);
    await page.getByRole("button", { name: /Cobrar.*F8/ }).click();
    const modal = page.getByRole("dialog", { name: "Cobrar pedido", exact: true });
    await modal.getByRole("button", { name: "Cargar saldo completo a cuenta corriente", exact: true }).click();
    await expect(modal.getByLabel("Efectivo", { exact: true })).toHaveCount(0);
    await expect(modal.getByLabel("Cuenta corriente", { exact: true })).toHaveValue(String(setup.total / 100));
    await expect(modal.getByRole("button", { name: "Confirmar cobro" })).toBeDisabled();
    await expect(modal.getByLabel("Nombre del cliente nuevo")).toHaveValue("Cliente cuenta E2E");
    await modal.getByLabel("Buscar cliente para cuenta corriente").fill("Cliente cuenta E2E");
    await modal.getByRole("button", { name: "Buscar", exact: true }).click();
    await modal.getByRole("button", { name: /Cliente cuenta E2E ·/ }).click();
    await modal.getByRole("button", { name: "Confirmar cobro" }).click();
    await expect(modal).not.toBeVisible();
    const result = await page.evaluate(async ({ id, sessionId }) => ({
      order: (await window.gastronomy.bootstrap()).orders.find(order => order.id === id)!,
      report: await window.gastronomy.getCashSessionReport({ cashSessionId: sessionId }),
    }), setup);
    expect(result.order.customerId).toBe(setup.customerId);
    expect(result.order.paymentStatus).toBe("PAID");
    expect(result.order.operationalStatus).toBe("IN_PREPARATION");
    expect(result.order.payments.map(p => p.methodCode)).toEqual(["ACCOUNT"]);
    expect(result.report.session.expectedAmountMinor).toBe(1_000_000);
  });
}

test("Envío: efectivo intencional + cuenta permite cobrar y entregar; recibo no duplica venta", async () => {
  const setup = await seed("DELIVERY", true, true);
  await page.getByRole("button", { name: "Entregar", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "Cobrar y entregar", exact: true });
  const cash = Math.floor(setup.total / 2);
  await modal.getByRole("button", { name: "Pago mixto", exact: true }).click();
  await modal.getByLabel("Efectivo", { exact: true }).fill(String(cash / 100));
  await modal.getByLabel("Cuenta corriente", { exact: true }).fill(String((setup.total - cash) / 100));
  await expect(modal.getByLabel("Efectivo", { exact: true })).toHaveValue(String(cash / 100));
  await modal.getByRole("button", { name: "Cobrar y entregar", exact: true }).click();
  await expect(modal).not.toBeVisible();
  const result = await page.evaluate(async ({ id, sessionId, customerId, total }) => {
    const api = window.gastronomy;
    const before = await api.getCashSessionReport({ cashSessionId: sessionId });
    await api.settleCustomerAccount({ customerId, amountMinor: total - Math.floor(total / 2), methodCode: "CASH", idempotencyKey: "account-e2e-receipt" });
    return { order: (await api.bootstrap()).orders.find(order => order.id === id)!, before, after: await api.getCashSessionReport({ cashSessionId: sessionId }) };
  }, setup);
  expect(result.order.operationalStatus).toBe("DELIVERED");
  expect(result.order.paymentStatus).toBe("PAID");
  expect(result.before.session.expectedAmountMinor).toBe(1_000_000 + cash);
  expect(result.after.session.expectedAmountMinor).toBe(1_000_000 + setup.total);
  expect(result.before.totals.salesMinor).toBe(setup.total);
  expect(result.after.totals.salesMinor).toBe(setup.total);
});

test("Ingresar cuenta limpia sólo efectivo automático y explica exceso sin ofrecer vuelto", async () => {
  const setup = await seed("TAKEAWAY", true);
  await page.getByRole("button", { name: /Cobrar.*F8/ }).click();
  const modal = page.getByRole("dialog", { name: "Cobrar pedido", exact: true });
  await modal.getByRole("button", { name: "Pago mixto", exact: true }).click();
  await modal.getByLabel("Cuenta corriente", { exact: true }).fill("0");
  await expect(modal.getByLabel("Efectivo", { exact: true })).toHaveValue(String(setup.total / 100));
  await modal.getByLabel("Cuenta corriente", { exact: true }).fill(String(setup.total / 100));
  await expect(modal.getByLabel("Efectivo", { exact: true })).toHaveValue("0");
  await expect(modal.getByRole("button", { name: "Confirmar cobro" })).toBeEnabled();
  await modal.getByLabel("Cuenta corriente", { exact: true }).fill(String((setup.total + 100) / 100));
  await expect(modal.getByRole("button", { name: "Confirmar cobro" })).toBeDisabled();
  await expect(modal.getByRole("alert")).toContainText("de más");
  await expect(modal.getByText("Vuelto a entregar", { exact: true })).not.toBeVisible();
});

test("Clientes pagina al pie y permite ajustar o eliminar deuda con caja cerrada", async () => {
  const setup = await page.evaluate(async () => {
    const api = window.gastronomy;
    const data = await api.bootstrap();
    for (let index = 0; index < 24; index++) {
      await api.createCustomer({
        name: `Cliente directorio ${index}`,
        phone: `115999${String(index).padStart(4, "0")}`,
      });
    }
    const customer = await api.createCustomer({ name: "Cliente ajuste E2E", phone: "1155553376" });
    await api.openCashSession({ openingAmountMinor: 0 });
    const order = await api.createOrder({
      type: "TAKEAWAY", customerId: customer.id, customerName: customer.name, customerPhone: customer.phone,
    });
    const added = await api.addOrderItem({ orderId: order.id, productId: data.products[0]!.id });
    await api.completeOrder({
      orderId: order.id, finalStatus: "DELIVERED", payments: [{ methodCode: "ACCOUNT", amountMinor: added.totalMinor }],
    });
    const receiptAmount = Math.floor(added.totalMinor / 2);
    const before = await api.settleCustomerAccount({ customerId: customer.id, amountMinor: receiptAmount, methodCode: "CASH" });
    await api.closeCashSession({ countedAmountMinor: receiptAmount });
    return { customerId: customer.id, receipts: before.accountReceipts };
  });
  await page.reload();
  await page.getByRole("link", { name: "Clientes", exact: true }).click();
  const top = page.getByRole("navigation", { name: "Paginación de clientes", exact: true });
  const bottom = page.getByRole("navigation", { name: "Paginación de clientes al pie" });
  await bottom.getByRole("button", { name: "Siguiente" }).click();
  await expect(top.getByText(/^Página 2 de/)).toBeVisible();
  await bottom.getByRole("button", { name: "Anterior" }).click();
  await expect(top.getByText(/^Página 1 de/)).toBeVisible();

  await page.getByLabel("Buscar clientes", { exact: true }).fill("Cliente ajuste E2E");
  await page.getByRole("button", { name: "Ver ficha de Cliente ajuste E2E" }).click();
  const profile = page.getByRole("dialog", { name: "Ficha · Cliente ajuste E2E" });
  await expect(profile.getByRole("button", { name: "Registrar pago" })).toBeDisabled();
  await profile.getByRole("button", { name: "Ajustar deuda" }).click();

  const adjust = profile.getByRole("form", { name: "Ajustar deuda" });
  await adjust.getByLabel(/Nuevo saldo del pedido/).fill("450,25");
  await adjust.getByLabel("Motivo").fill("Corregir saldo pendiente");
  await adjust.getByLabel("PIN de autorización").fill("748259");
  await adjust.getByRole("button", { name: "Guardar ajuste" }).click();
  await expect(profile.getByText(/Deuda pendiente:/)).toContainText("450,25");

  await profile.getByRole("button", { name: "Ajustar deuda" }).click();
  await adjust.getByRole("button", { name: "Eliminar toda la deuda" }).click();
  await expect(adjust.getByLabel(/Nuevo saldo del pedido/)).toHaveValue("0");
  await adjust.getByLabel("Motivo").fill("Condonación de saldo pendiente");
  await adjust.getByLabel("PIN de autorización").fill("748259");
  await adjust.getByRole("button", { name: "Guardar ajuste" }).click();
  await expect(profile.getByText("Sin deuda pendiente.")).toBeVisible();
  const after = await page.evaluate(async (customerId) => {
    const api = window.gastronomy;
    const profile = await api.getCustomerProfile({ customerId, page: 1, pageSize: 10 });
    return { receipts: profile.accountReceipts, cash: (await api.bootstrap()).cashSession };
  }, setup.customerId);
  expect(after.receipts).toEqual(setup.receipts);
  expect(after.cash).toBeNull();
});
