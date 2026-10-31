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
  profile = await mkdtemp(join(tmpdir(), "gastronomy-delivery-method-"));
  app = await electron.launch({
    args: ["apps/desktop-shell", `--user-data-dir=${profile}`],
    cwd: process.cwd(),
  });
  page = await app.firstWindow();
  await expect(
    page.getByRole("link", { name: "Repartidores", exact: true }),
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
    !basename(profile).startsWith("gastronomy-delivery-method-")
  )
    throw Error("Unsafe profile cleanup");
  await rm(profile, { recursive: true, force: true });
});
test("reproduce los importes de la foto sin pagos y liquida por transferencia sin mover efectivo", async ({}, info) => {
  const fixture = await page.evaluate(async () => {
    const api = window.gastronomy;
    const initial = await api.bootstrap();
    await api.saveSettings({
      ...initial.settings,
      deliverySettlementEnabled: true,
      deliveryFeeBelongsToDriver: true,
      deliveryDriverPaymentMode: "ACCUMULATED",
    });
    const session = await api.openCashSession({ openingAmountMinor: 0 });
    const driver = await api.createDriver({
      fullName: "Repartidor de prueba",
      authorizerPin: "1234",
    });
    const product = await api.createProduct({
      categoryId: initial.categories[0]!.id,
      name: "Menú fixture",
      code: "DELIVERYMETHOD",
      prices: ["SALON", "TAKEAWAY", "DELIVERY"].map((code) => ({
        priceListCode: code as "SALON" | "TAKEAWAY" | "DELIVERY",
        amountMinor: 1_906_000,
      })),
    });
    for (let i = 0; i < 10; i++) {
      const driverCollected = i < 5;
      const fee = driverCollected ? (i === 4 ? 150_000 : 200_000) : 320_000;
      const order = await api.createOrder({
        type: "DELIVERY",
        customerName: `Cliente ${i}`,
        customerPhone: "1155551234",
        deliveryAddress: "Calle prueba 123",
        driverUserId: driver.id,
        deliveryFeeMinor: fee,
      });
      await api.addOrderItem({ orderId: order.id, productId: product.id });
      const confirmed = await api.confirmOrder({ orderId: order.id });
      await api.completeOrder({
        orderId: order.id,
        finalStatus: "DELIVERED",
        collectedByDriver: driverCollected,
        payments: [
          {
            methodCode: driverCollected ? "CASH" : "TRANSFER",
            amountMinor: confirmed.totalMinor,
          },
        ],
      });
    }
    const boot = await api.bootstrap();
    const report = await api.getCashSessionReport({
      cashSessionId: session.id,
    });
    return {
      sessionId: session.id,
      activity: boot.driverDeliveryActivity,
      ledger: boot.deliveryLedger,
      report,
    };
  });
  expect(fixture.activity.reduce((sum, x) => sum + x.deliveryCount, 0)).toBe(
    10,
  );
  expect(fixture.activity.reduce((sum, x) => sum + x.earningsMinor, 0)).toBe(
    2_550_000,
  );
  expect(
    fixture.ledger
      .filter((x) => x.direction === "DRIVER_OWES_BUSINESS")
      .reduce((sum, x) => sum + x.amountDueMinor, 0),
  ).toBe(9_530_000);
  expect(
    fixture.ledger
      .filter((x) => x.direction === "BUSINESS_OWES_DRIVER")
      .reduce((sum, x) => sum + x.amountDueMinor, 0),
  ).toBe(1_600_000);
  expect(
    fixture.ledger.every(
      (x) => x.status === "PENDING" && x.settledAmountMinor === 0,
    ),
  ).toBe(true);
  expect(fixture.report.session.expectedAmountMinor).toBe(0);
  await page.reload();
  await page.getByRole("link", { name: "Repartidores", exact: true }).click();
  await expect(
    page.getByText("Ganancia y saldo pendiente son conceptos distintos.", {
      exact: true,
    }),
  ).toBeVisible();
  for (const [label, amount] of [
    ["Ganancia de repartidores", "$ 25.500"],
    ["Pendiente: repartidor rinde al negocio", "$ 95.300"],
    ["Pendiente: negocio paga al repartidor", "$ 16.000"],
    ["Ya liquidado en el período", "$ 0"],
  ] as const) {
    await expect(
      page.getByText(label, { exact: true }).locator(".."),
    ).toContainText(amount);
  }
  const outgoing = fixture.ledger.filter(
    (x) => x.direction === "BUSINESS_OWES_DRIVER",
  );
  for (const row of outgoing)
    await page
      .getByRole("checkbox", {
        name: `Seleccionar movimiento del pedido ${row.orderNumber}`,
        exact: true,
      })
      .check();
  await page.getByRole("button", { name: /Pagar envío/ }).click();
  const modal = page.getByRole("dialog", {
    name: "Revisar pago o rendición",
    exact: true,
  });
  await modal
    .getByLabel("Medio de pago de la liquidación")
    .selectOption("TRANSFER");
  await modal.getByLabel("PIN de autorización", { exact: true }).fill("1234");
  await modal
    .getByRole("button", { name: "Revisar liquidación", exact: true })
    .click();
  const confirm = page.getByRole("dialog", {
    name: "Confirmar movimiento de caja",
    exact: true,
  });
  await expect(confirm).toContainText("Transferencia");
  await expect(confirm).toContainText("no modifica el efectivo de caja");
  const screenshot = info.outputPath("delivery-transfer-confirmation.png");
  const png = await app.evaluate(async ({ BrowserWindow }) =>
    (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage())
      .toPNG()
      .toString("base64"),
  );
  await writeFile(screenshot, Buffer.from(png, "base64"));
  await confirm
    .getByRole("button", { name: "Confirmar movimiento", exact: true })
    .click();
  await expect(confirm).toBeHidden();
  const after = await page.evaluate(
    async (sessionId) => ({
      boot: await window.gastronomy.bootstrap(),
      report: await window.gastronomy.getCashSessionReport({
        cashSessionId: sessionId,
      }),
    }),
    fixture.sessionId,
  );
  expect(after.report.session.expectedAmountMinor).toBe(0);
  expect(after.report.totals).toEqual(fixture.report.totals);
  expect(after.boot.driverDeliveryActivity).toEqual(fixture.activity);
  expect(
    after.boot.deliveryLedger.filter((x) => x.status === "SETTLED"),
  ).toHaveLength(5);
  const movements = after.report.session.movements!.filter(
    (x) => x.type === "EXPENSE",
  );
  expect(movements).toHaveLength(5);
  expect(
    movements.every(
      (x) => x.paymentMethodCode === "TRANSFER" && x.affectsCash === false,
    ),
  ).toBe(true);
  await page.evaluate(
    async (ledgerId) =>
      window.gastronomy.reverseDeliverySettlement({
        ledgerId,
        reason: "Revisar transferencia",
        authorizerPin: "1234",
      }),
    outgoing[0]!.id,
  );
  await page.reload();
  const reversed = await page.evaluate(
    async (sessionId) => ({
      boot: await window.gastronomy.bootstrap(),
      report: await window.gastronomy.getCashSessionReport({
        cashSessionId: sessionId,
      }),
    }),
    fixture.sessionId,
  );
  expect(reversed.report.session.expectedAmountMinor).toBe(0);
  expect(
    reversed.boot.deliveryLedger.find((x) => x.id === outgoing[0]!.id)?.status,
  ).toBe("PENDING");
  const compensation = reversed.report.session.movements!.find(
    (x) => x.referenceId != null,
  )!;
  expect(compensation).toMatchObject({
    type: "INCOME",
    paymentMethodCode: "TRANSFER",
    affectsCash: false,
  });
});
