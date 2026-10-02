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
  userData = await mkdtemp(join(tmpdir(), "gastronomy-scheduled-print-"));
  app = await electron.launch({
    args: ["apps/desktop-shell", `--user-data-dir=${userData}`],
    cwd: process.cwd(),
  });
  page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows())
      window.webContents.getPrintersAsync = async () => [];
  });
  await page.evaluate(async () => {
    const api = window.gastronomy;
    const data = await api.bootstrap();
    await api.openCashSession({ openingAmountMinor: 0 });
    await api.saveSettings({
      ...data.settings,
      printing: {
        ...data.settings.printing,
        kitchen: { ...data.settings.printing.kitchen, mode: "SYSTEM_DIALOG" },
      },
    });
  });
  await page.reload();
});

test.afterEach(async () => {
  await app?.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) window.destroy();
  });
  await app?.close();
  if (userData) await rm(userData, { recursive: true, force: true });
});

async function printPreview(orderId: string) {
  await page.evaluate((id) => {
    (window as any).__printResult = null;
    void window.gastronomy
      .printOrder({ orderId: id, kind: "KITCHEN_ORDER" })
      .then((result) => {
        (window as any).__printResult = result;
      });
  }, orderId);
  await expect
    .poll(
      () =>
        app.windows().filter((w) => w.url().includes("print-preview-controls"))
          .length,
    )
    .toBe(1);
  return app.windows().find((w) => w.url().includes("print-preview-controls"))!;
}

test("Fecha y hora sobrevive a refresco del negocio y sale exacta y destacada en comanda", async () => {
  const timing = await page.evaluate(() => {
    const date = new Date(Date.now() + 3 * 86_400_000);
    date.setHours(21, 37, 0, 0);
    return {
      input: new Date(date.valueOf() - date.getTimezoneOffset() * 60_000)
        .toISOString()
        .slice(0, 16),
      iso: date.toISOString(),
      date: date.toLocaleDateString("es-AR", {
        timeZone: "America/Buenos_Aires",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }),
      time: date.toLocaleTimeString("es-AR", {
        timeZone: "America/Buenos_Aires",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }),
    };
  });
  await page.getByRole("link", { name: "Pedidos", exact: true }).click();
  await page.getByRole("button", { name: "F3 Para retirar" }).click();
  const form = page.getByRole("dialog", { name: "Nuevo Para retirar" });
  await form
    .getByLabel("Nombre del cliente *", { exact: true })
    .fill("Cliente programado E2E");
  await form.getByLabel("Teléfono *", { exact: true }).fill("11 5555-3344");
  await form.getByRole("button", { name: "Fecha y hora", exact: true }).click();
  await form.locator('input[type="datetime-local"]').fill(timing.input);

  // A settings refresh previously reran the form initializer and reset it to QUICK.
  await page.evaluate(async () => {
    const api = window.gastronomy;
    const data = await api.bootstrap();
    await api.saveSettings({
      ...data.settings,
      quickDelayMinutes: [10, 20, 55],
    });
  });
  // Saving a customer from the same form invalidates and refreshes bootstrap.
  await form
    .getByRole("button", { name: "Crear cliente", exact: true })
    .click();
  const customerForm = page.getByRole("dialog", {
    name: "Crear cliente sin salir del pedido",
  });
  await customerForm
    .getByRole("button", { name: "Guardar y seleccionar", exact: true })
    .click();
  await expect(customerForm).not.toBeVisible();
  await expect(form.locator('input[type="datetime-local"]')).toHaveValue(
    timing.input,
  );
  await form.getByRole("button", { name: "Crear pedido", exact: true }).click();
  await expect(form).not.toBeVisible();
  const orderId = await page.evaluate(async ({ iso }) => {
    const api = window.gastronomy;
    const data = await api.bootstrap();
    const order = data.orders.find(
      (o) => o.customerNameSnapshot === "Cliente programado E2E",
    )!;
    if (!order.scheduled || order.promisedAt !== iso)
      throw new Error("La fecha y hora elegidas no se guardaron");
    await api.addOrderItem({
      orderId: order.id,
      productId: data.products[0]!.id,
    });
    await api.confirmOrder({ orderId: order.id });
    return order.id;
  }, timing);
  const preview = await printPreview(orderId);
  await expect(
    preview.getByText("PEDIDO PROGRAMADO", { exact: true }),
  ).toBeVisible();
  await expect(preview.getByText(timing.date, { exact: false })).toBeVisible();
  await expect(preview.getByText(timing.time, { exact: false })).toBeVisible();
  await preview.screenshot({
    path: test.info().outputPath("scheduled-comanda.png"),
  });
  await preview.getByRole("button", { name: "Cancelar", exact: true }).click();
});

test("la demora rápida conserva su hora y no se imprime como pedido programado", async () => {
  const setup = await page.evaluate(async () => {
    const api = window.gastronomy;
    const data = await api.bootstrap();
    const promisedAt = new Date(Date.now() + 40 * 60_000).toISOString();
    const order = await api.createOrder({
      type: "TAKEAWAY",
      customerName: "Cliente demora",
      customerPhone: "11 5555-1133",
      promisedAt,
      scheduled: false,
    });
    await api.addOrderItem({
      orderId: order.id,
      productId: data.products[0]!.id,
    });
    await api.confirmOrder({ orderId: order.id });
    return {
      id: order.id,
      time: new Date(promisedAt).toLocaleTimeString("es-AR", {
        timeZone: "America/Buenos_Aires",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }),
    };
  });
  const preview = await printPreview(setup.id);
  await expect(
    preview.getByText("PEDIDO PROGRAMADO", { exact: true }),
  ).toHaveCount(0);
  await expect(
    preview.getByText(`ENTREGA ${setup.time}`, { exact: true }),
  ).toBeVisible();
  await preview.getByRole("button", { name: "Cancelar", exact: true }).click();
});

test("comanda programada se destaca y no desborda el papel de 58 mm", async () => {
  const orderId = await page.evaluate(async () => {
    const api = window.gastronomy;
    const data = await api.bootstrap();
    await api.saveSettings({
      ...data.settings,
      printing: {
        ...data.settings.printing,
        kitchen: {
          ...data.settings.printing.kitchen,
          mode: "SYSTEM_DIALOG",
          paperWidth: "58mm",
        },
      },
    });
    const order = await api.createOrder({
      type: "TAKEAWAY",
      customerName: "Cliente 58 mm",
      customerPhone: "11 5555-2255",
      scheduled: true,
      promisedAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
    });
    await api.addOrderItem({
      orderId: order.id,
      productId: data.products[0]!.id,
    });
    await api.confirmOrder({ orderId: order.id });
    return order.id;
  });
  const preview = await printPreview(orderId);
  await expect(preview.locator(".scheduled-badge")).toBeVisible();
  const visual = await preview.locator(".scheduled-badge").evaluate((badge) => {
    const time = badge.querySelector(".scheduled-time")!;
    return {
      border: parseFloat(getComputedStyle(badge).borderTopWidth),
      timeSize: parseFloat(getComputedStyle(time).fontSize),
      weight: parseInt(getComputedStyle(time).fontWeight),
      fits: badge.scrollWidth <= badge.clientWidth,
    };
  });
  expect(visual.border).toBeGreaterThanOrEqual(3);
  expect(visual.timeSize).toBeGreaterThanOrEqual(25);
  expect(visual.weight).toBeGreaterThanOrEqual(900);
  expect(visual.fits).toBe(true);
  await preview
    .locator(".scheduled-badge")
    .screenshot({ path: test.info().outputPath("scheduled-badge-58mm.png") });
  await preview.getByRole("button", { name: "Cancelar", exact: true }).click();
});
