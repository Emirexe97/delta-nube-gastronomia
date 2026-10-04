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

async function deferIpcMutation(method: "openCashSession" | "registerCashMovement") {
  const channel = `gastronomy:${method}`;
  return app.evaluate(({ ipcMain }, handlerChannel) => {
    const main = globalThis as typeof globalThis & {
      __pageStateQaResolveMutation?: () => void;
    };
    const handlers = (ipcMain as any)._invokeHandlers as Map<
      string,
      (event: unknown, ...args: unknown[]) => unknown
    >;
    const original = handlers.get(handlerChannel);
    if (!original) throw new Error(`No existe el handler ${handlerChannel}`);
    ipcMain.removeHandler(handlerChannel);
    ipcMain.handle(handlerChannel, (event, ...args) =>
      new Promise((resolve, reject) => {
        main.__pageStateQaResolveMutation = () => {
          main.__pageStateQaResolveMutation = undefined;
          void Promise.resolve(original(event, ...args)).then(resolve, reject);
        };
      }),
    );
  }, channel);
}

async function resolveDeferredIpcMutation() {
  await app.evaluate(() => {
    const main = globalThis as typeof globalThis & {
      __pageStateQaResolveMutation?: () => void;
    };
    if (!main.__pageStateQaResolveMutation)
      throw new Error("No hay mutación IPC diferida para resolver");
    main.__pageStateQaResolveMutation();
  });
}

test.beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), "gastronomy-page-state-qa-"));
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

test("Repartidores tolera refrescos con y sin caja y conserva solo selecciones pendientes", async () => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.getByRole("link", { name: "Repartidores", exact: true }).click();
  const period = page.getByRole("combobox", { name: "Período" });
  const driverFilter = page.getByRole("combobox", { name: "Repartidor" });
  await expect(period).toBeEnabled();
  await expect(driverFilter).toBeEnabled();
  await period.selectOption("ALL");
  await driverFilter.selectOption("ALL");

  await page.evaluate(() =>
    window.gastronomy.openCashSession({ openingAmountMinor: 5_000_000 }),
  );
  await page.reload();
  await page.getByRole("link", { name: "Repartidores", exact: true }).click();

  const seeded = await page.evaluate(async () => {
    const api = window.gastronomy;
    const bootstrap = await api.bootstrap();
    if (!bootstrap.settings.deliverySettlementEnabled)
      await api.saveSettings({
        ...bootstrap.settings,
        deliverySettlementEnabled: true,
      });
    const driver = await api.createDriver({
      fullName: "Repartidor estado E2E",
      authorizerPin: "1234",
    });
    const product = bootstrap.products.find((candidate) => candidate.active)!;
    const ledgers: Array<{ id: string; number: number }> = [];
    for (const customerName of ["Pendiente válido E2E", "Pendiente liquidado E2E"]) {
      const order = await api.createOrder({
        type: "DELIVERY",
        customerName,
        customerPhone: "11 5555-0909",
        deliveryAddress: "Calle estado 10",
        deliveryFeeMinor: 250_000,
        driverUserId: driver.id,
        promisedAt: new Date(Date.now() + 3_600_000).toISOString(),
      });
      const populated = await api.addOrderItem({
        orderId: order.id,
        productId: product.id,
      });
      const confirmed = await api.confirmOrder({ orderId: order.id });
      await api.payOrder({
        orderId: order.id,
        collectedByDriver: true,
        payments: [{ methodCode: "CASH", amountMinor: populated.totalMinor }],
      });
      await api.updateOrderStatus({ orderId: order.id, status: "READY" });
      await api.updateOrderStatus({ orderId: order.id, status: "OUT_FOR_DELIVERY" });
      await api.updateOrderStatus({ orderId: order.id, status: "DELIVERED" });
      ledgers.push({ id: order.id, number: confirmed.number });
    }
    const data = await api.bootstrap();
    return ledgers.map(({ id, number }) => ({
      number,
      ledgerId: data.deliveryLedger.find((row) => row.orderId === id)!.id,
    }));
  });

  await page.reload();
  await page.getByRole("link", { name: "Repartidores", exact: true }).click();
  await period.selectOption("ALL");
  await period.selectOption("CURRENT_SHIFT");
  await expect(page.getByLabel(`Seleccionar movimiento del pedido ${seeded[0]!.number}`)).toBeVisible();
  const selectedLabels = seeded.map(({ number }) =>
    page.getByLabel(`Seleccionar movimiento del pedido ${number}`),
  );
  for (const checkbox of selectedLabels) await checkbox.check();
  await expect(
    page.getByRole("button", { name: /Registrar rendición del repartidor \(2\)/ }),
  ).toBeEnabled();

  await page.evaluate(async (ledgerId) => {
    await window.gastronomy.settleDelivery({
      ledgerIds: [ledgerId],
      reason: "Refresco selectivo E2E",
      authorizerPin: "1234",
      idempotencyKey: crypto.randomUUID(),
    });
  }, seeded[1]!.ledgerId);

  await page.getByRole("button", { name: "Nuevo repartidor", exact: true }).click();
  const newDriver = page.getByRole("dialog", { name: "Nuevo repartidor" });
  await newDriver.getByLabel("Nombre completo").fill("Dispara refresco E2E");
  await newDriver.getByLabel(/PIN de autorización/).fill("1234");
  await newDriver.getByRole("button", { name: "Crear repartidor" }).click();
  await expect(newDriver).toBeHidden();

  await expect(selectedLabels[0]).toBeChecked();
  await expect(selectedLabels[1]).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /Registrar rendición del repartidor \(1\)/ }),
  ).toBeEnabled();
  expect(errors.filter((message) => /Maximum update depth/i.test(message))).toEqual([]);
});

test("Abrir caja y Movimiento de caja no se cierran mientras su mutación espera", async () => {
  await page.evaluate(async () => {
    const session = (await window.gastronomy.bootstrap()).cashSession;
    if (session)
      await window.gastronomy.closeCashSession({
        countedAmountMinor: session.expectedAmountMinor,
        idempotencyKey: crypto.randomUUID(),
      });
  });
  await page.reload();
  await deferIpcMutation("openCashSession");
  await page.getByRole("link", { name: "Caja", exact: true }).click();
  await page.getByRole("button", { name: "Abrir caja", exact: true }).click();
  const openDialog = page.getByRole("dialog", { name: "Abrir caja" });
  await openDialog.getByLabel("Cambio / fondo inicial").fill("50000");
  await openDialog.getByRole("button", { name: "Abrir caja", exact: true }).click();
  await expect(openDialog).toHaveAttribute("aria-busy", "true");
  await page.keyboard.press("Escape");
  await expect(openDialog).toBeVisible();
  await expect(openDialog.getByRole("button", { name: "Cancelar" })).toBeDisabled();
  await expect(openDialog.getByRole("button", { name: "Operación en curso" })).toBeDisabled();
  await resolveDeferredIpcMutation();
  await expect(openDialog).toBeHidden();

  await page.reload();
  await deferIpcMutation("registerCashMovement");
  await page.getByRole("link", { name: "Caja", exact: true }).click();
  await page.getByRole("button", { name: /Registrar movimiento/ }).click();
  const movementDialog = page.getByRole("dialog", { name: "Movimiento de caja" });
  await movementDialog.getByLabel("Importe").fill("1500");
  await movementDialog.getByLabel("Motivo").fill("Movimiento diferido E2E");
  await movementDialog.getByRole("button", { name: "Registrar" }).click();
  await expect(movementDialog).toHaveAttribute("aria-busy", "true");
  await page.keyboard.press("Escape");
  await expect(movementDialog).toBeVisible();
  await expect(movementDialog.getByRole("button", { name: "Cancelar" })).toBeDisabled();
  await expect(movementDialog.getByRole("button", { name: "Operación en curso" })).toBeDisabled();
  await resolveDeferredIpcMutation();
  await expect(movementDialog).toBeHidden();
});
