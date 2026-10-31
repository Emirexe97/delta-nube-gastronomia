import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
let app: ElectronApplication;
let page: Page;
let profile = "";
test("reinicia pedidos de retiro, delivery y salón por turno sin cambiar identidad ni mesas", async () => {
  profile = await mkdtemp(join(tmpdir(), "gastronomy-shift-number-"));
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
  const fixture = await page.evaluate(async () => {
    const api = window.gastronomy;
    const initial = await api.bootstrap();
    const first = await api.openCashSession({ openingAmountMinor: 0 });
    const a = await api.createOrder({
      type: "TAKEAWAY",
      customerName: "Retiro primer turno",
      customerPhone: "1155551234",
    });
    const populated = await api.addOrderItem({
      orderId: a.id,
      productId: initial.products[0]!.id,
    });
    await api.completeOrder({
      orderId: a.id,
      finalStatus: "DELIVERED",
      payments: [{ methodCode: "CASH", amountMinor: populated.totalMinor }],
    });
    const b = await api.createOrder({
      type: "DELIVERY",
      customerName: "Delivery primer turno",
    });
    const table = await api.ensureTable({ number: 7 });
    const c = await api.createOrder({ type: "DINE_IN", tableId: table.id });
    await api.closeCashSession({
      countedAmountMinor: (await api.bootstrap()).cashSession!
        .expectedAmountMinor,
      closingFloatAmountMinor: 0,
      force: true,
      reason: "Prueba aislada de numeración",
      authorizerPin: "1234",
    });
    const second = await api.openCashSession({ openingAmountMinor: 0 });
    const d = await api.createOrder({
      type: "TAKEAWAY",
      customerName: "Retiro segundo turno",
    });
    const e = await api.createOrder({
      type: "DELIVERY",
      customerName: "Delivery segundo turno",
    });
    const secondTable = await api.ensureTable({ number: 8 });
    const f = await api.createOrder({
      type: "DINE_IN",
      tableId: secondTable.id,
    });
    const historical = await api.getOrder({ orderId: a.id });
    return {
      first,
      second,
      a,
      b,
      c,
      d,
      e,
      f,
      tableBefore: initial.tables.map((t) => ({ id: t.id, number: t.number })),
      tables: (await api.bootstrap()).tables.map((t) => ({
        id: t.id,
        number: t.number,
      })),
      historical,
    };
  });
  expect([fixture.a.number, fixture.b.number, fixture.c.number]).toEqual([
    1, 2, 3,
  ]);
  expect([fixture.d.number, fixture.e.number, fixture.f.number]).toEqual([
    1, 2, 3,
  ]);
  expect(fixture.first.businessDate).toBe(fixture.second.businessDate);
  expect(fixture.second.number).toBe(fixture.first.number + 1);
  expect(
    new Set([
      fixture.a.id,
      fixture.b.id,
      fixture.c.id,
      fixture.d.id,
      fixture.e.id,
      fixture.f.id,
    ]).size,
  ).toBe(6);
  for (const table of fixture.tableBefore)
    expect(fixture.tables).toContainEqual(table);
  expect(fixture.historical).toMatchObject({
    id: fixture.a.id,
    number: 1,
    paymentStatus: "PAID",
  });
  await page.reload();
  await page.getByRole("link", { name: "Pedidos", exact: true }).click();
  const row = page.getByRole("row").filter({ hasText: "Retiro segundo turno" });
  await expect(row).toContainText("#1");
  await row.click();
  await expect(page.getByRole("dialog", { name: /Pedido #1/ })).toBeVisible();
  const next = await page.evaluate(() =>
    window.gastronomy.createOrder({
      type: "TAKEAWAY",
      customerName: "Después de recargar",
    }),
  );
  expect(next.number).toBe(4);
});
test.afterEach(async () => {
  await app?.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().forEach((w) => w.destroy()),
  );
  await app?.close();
  if (profile) {
    if (
      dirname(resolve(profile)) !== resolve(tmpdir()) ||
      !basename(profile).startsWith("gastronomy-shift-number-")
    )
      throw Error("Unsafe cleanup");
    await rm(profile, { recursive: true, force: true });
  }
});
