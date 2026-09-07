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
let userData: string;

test.beforeEach(async () => {
  userData = await mkdtemp(
    join(tmpdir(), "gastronomy-driver-late-assignment-"),
  );
  app = await electron.launch({
    args: ["apps/desktop-shell", `--user-data-dir=${userData}`],
    cwd: process.cwd(),
  });
  page = await app.firstWindow();
  await expect(page.getByText("Delta Nube", { exact: true })).toBeVisible();
});

test.afterEach(async () => {
  await app?.close();
  await rm(userData, { recursive: true, force: true });
});

test("cuenta un delivery asignado al cerrar aunque se cree el repartidor después", async () => {
  await page.evaluate(async () => {
    const bootstrap = await window.gastronomy.bootstrap();
    await window.gastronomy.openCashSession({ openingAmountMinor: 0 });
    const draft = await window.gastronomy.createOrder({
      type: "DELIVERY",
      customerName: "Cliente delivery tardío",
      customerPhone: "11 5555-7788",
      deliveryAddress: "Calle E2E 123",
      deliveryFeeMinor: 2500,
    });
    await window.gastronomy.addOrderItem({
      orderId: draft.id,
      productId: bootstrap.products[0]!.id,
    });
    const confirmed = await window.gastronomy.confirmOrder({
      orderId: draft.id,
    });
    const driver = await window.gastronomy.createDriver({
      fullName: "Repartidor tardío E2E",
      authorizerPin: "1234",
    });
    await window.gastronomy.assignDeliveryDriver({
      orderId: confirmed.id,
      driverUserId: driver.id,
    });
    await window.gastronomy.completeOrder({
      orderId: confirmed.id,
      finalStatus: "DELIVERED",
      payments: [
        {
          methodCode: "CASH",
          amountMinor: confirmed.totalMinor,
          receivedMinor: confirmed.totalMinor,
        },
      ],
    });
  });

  await page.reload();
  await expect(page.getByText("Delta Nube", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Repartidores" }).click();
  const row = page
    .getByRole("row")
    .filter({ hasText: "Repartidor tardío E2E" });
  await expect(row).toBeVisible();
  await expect(row.getByRole("cell").nth(1)).toHaveText("1");
});
