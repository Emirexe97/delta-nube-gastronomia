import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
let app: ElectronApplication;
let page: Page;
let profile = "";
test.beforeEach(async () => {
  profile = await mkdtemp(join(tmpdir(), "gastronomy-explicit-collector-"));
  app = await electron.launch({
    args: ["apps/desktop-shell", `--user-data-dir=${profile}`],
    cwd: process.cwd(),
  });
  page = await app.firstWindow();
  await expect(
    page.getByRole("link", { name: "Pedidos", exact: true }),
  ).toBeVisible();
  expect(
    resolve(await app.evaluate(({ app }) => app.getPath("userData"))),
  ).toBe(resolve(profile));
});
test.afterEach(async () => {
  await app?.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().forEach((w) => w.destroy()),
  );
  await app?.close();
  if (
    dirname(resolve(profile)) !== resolve(tmpdir()) ||
    !basename(profile).startsWith("gastronomy-explicit-collector-")
  )
    throw Error("Unsafe profile cleanup");
  await rm(profile, { recursive: true, force: true });
});
async function fixture(assigned = true) {
  const f = await page.evaluate(async (assigned) => {
    const api = window.gastronomy;
    const b = await api.bootstrap();
    await api.saveSettings({
      ...b.settings,
      modules: { ...b.settings.modules, advancedStatuses: false },
      deliverySettlementEnabled: true,
      deliveryFeeBelongsToDriver: true,
      deliveryDriverPaymentMode: "ACCUMULATED",
    });
    const cash = await api.openCashSession({ openingAmountMinor: 100_000 });
    const a = await api.createDriver({
      fullName: "Chofer inicial",
      authorizerPin: "1234",
    });
    const driver = await api.createDriver({
      fullName: "Chofer elegido en cobro",
      authorizerPin: "1234",
    });
    const order = await api.createOrder({
      type: "DELIVERY",
      customerName: "Prueba receptor explícito",
      customerPhone: "1155557788",
      deliveryAddress: "Calle 123",
      deliveryFeeMinor: 250_000,
      driverUserId: assigned ? a.id : undefined,
    });
    await api.addOrderItem({ orderId: order.id, productId: b.products[0]!.id });
    const confirmed = await api.confirmOrder({ orderId: order.id });
    return { cash, order: confirmed, driver };
  }, assigned);
  await page.reload();
  await page.getByRole("link", { name: "Pedidos", exact: true }).click();
  await page
    .getByRole("row")
    .filter({ hasText: "Prueba receptor explícito" })
    .click();
  const editor = page.getByRole("dialog", { name: /Pedido #/ });
  await editor.getByRole("button", { name: "Entregar", exact: true }).click();
  const modal = page.getByRole("dialog", {
    name: "Cobrar y entregar",
    exact: true,
  });
  await expect(modal).toBeVisible();
  return { ...f, modal };
}
for (const driverCollects of [false, true]) {
  test(`cobrar y entregar guarda chofer elegido y cobro explícito=${driverCollects}`, async ({}, info) => {
    const f = await fixture(!driverCollects);
    const checkbox = f.modal.getByRole("checkbox", {
      name: "Cobró el repartidor",
      exact: true,
    });
    await expect(checkbox).not.toBeChecked();
    await f.modal
      .getByRole("combobox", { name: /^Repartidor/ })
      .selectOption(f.driver.id);
    if (driverCollects) await checkbox.check();
    await expect(checkbox).toHaveJSProperty("checked", driverCollects);
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise<void>((r) =>
        requestAnimationFrame(() => requestAnimationFrame(() => r())),
      );
    });
    const png = await app.evaluate(async ({ BrowserWindow }) =>
      (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage())
        .toPNG()
        .toString("base64"),
    );
    await writeFile(
      info.outputPath(`collector-${driverCollects}.png`),
      Buffer.from(png, "base64"),
    );
    await f.modal
      .getByRole("button", { name: "Cobrar y entregar", exact: true })
      .click();
    await expect(f.modal).toBeHidden();
    const state = await page.evaluate(() => window.gastronomy.bootstrap());
    const order = state.orders.find((o) => o.id === f.order.id)!;
    expect(order).toMatchObject({
      driverUserId: f.driver.id,
      collectedByDriver: driverCollects,
      operationalStatus: "DELIVERED",
      paymentStatus: "PAID",
    });
    expect(state.cashSession!.expectedAmountMinor).toBe(
      f.cash.expectedAmountMinor + (driverCollects ? 0 : f.order.totalMinor),
    );
    const ledger = state.deliveryLedger.find((l) => l.orderId === f.order.id)!;
    expect(ledger.driverUserId).toBe(f.driver.id);
    expect(ledger.direction).toBe(
      driverCollects ? "DRIVER_OWES_BUSINESS" : "BUSINESS_OWES_DRIVER",
    );
    expect(ledger.amountDueMinor).toBe(
      driverCollects
        ? f.order.totalMinor - f.order.deliveryFeeMinor
        : f.order.deliveryFeeMinor,
    );
    await page.reload();
    expect(
      (await page.evaluate(() => window.gastronomy.bootstrap())).orders.find(
        (o) => o.id === f.order.id,
      )?.collectedByDriver,
    ).toBe(driverCollects);
  });
}
test("cancelar no asigna chofer ni cobra y cambiar de medio no reactiva la casilla", async () => {
  const f = await fixture();
  await f.modal
    .getByRole("combobox", { name: /^Repartidor/ })
    .selectOption(f.driver.id);
  const check = f.modal.getByRole("checkbox", {
    name: "Cobró el repartidor",
    exact: true,
  });
  await check.check();
  await f.modal.getByLabel("Efectivo", { exact: true }).fill("");
  await f.modal
    .getByLabel("Transferencia", { exact: true })
    .fill(String(f.order.totalMinor / 100));
  await expect(check).not.toBeChecked();
  await f.modal.getByLabel("Transferencia", { exact: true }).fill("");
  await f.modal
    .getByLabel("Efectivo", { exact: true })
    .fill(String(f.order.totalMinor / 100));
  await expect(check).not.toBeChecked();
  await f.modal.getByRole("button", { name: "Cancelar", exact: true }).click();
  const state = await page.evaluate(() => window.gastronomy.bootstrap());
  const order = state.orders.find((o) => o.id === f.order.id)!;
  expect(order.driverUserId).toBe(f.order.driverUserId);
  expect(order.paymentStatus).toBe("UNPAID");
  expect(state.cashSession!.expectedAmountMinor).toBe(
    f.cash.expectedAmountMinor,
  );
  expect(
    state.deliveryLedger.find((l) => l.orderId === f.order.id),
  ).toBeUndefined();
});
