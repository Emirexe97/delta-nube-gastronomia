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

async function launch() {
  userData = await mkdtemp(join(tmpdir(), "gastronomy-cash-report-"));
  app = await electron.launch({
    args: ["apps/desktop-shell", `--user-data-dir=${userData}`],
    cwd: process.cwd(),
  });
  page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.getPrintersAsync = async () => [];
    }
  });
}

async function previewWindow() {
  await expect
    .poll(
      () =>
        app
          .windows()
          .filter((candidate) =>
            candidate.url().includes("print-preview-controls"),
          ).length,
    )
    .toBe(1);
  return app
    .windows()
    .find((candidate) => candidate.url().includes("print-preview-controls"))!;
}

test.afterEach(async () => {
  await app?.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) window.destroy();
  });
  await app?.close();
  if (userData) await rm(userData, { recursive: true, force: true });
});

test("previsualiza el informe sin cerrar y lo conserva en el historial al cerrar", async () => {
  await launch();
  const setup = await page.evaluate(async () => {
    const api = (window as any).gastronomy;
    const data = await api.bootstrap();
    const session = await api.openCashSession({ openingAmountMinor: 0 });
    const product = data.products[0];
    const order = await api.createOrder({
      type: "TAKEAWAY",
      customerName: "Cliente informe E2E",
      customerPhone: "11 4444-1010",
      deliveryAddress: "Calle Informe 123",
    });
    await api.addOrderItem({
      orderId: order.id,
      productId: product.id,
      quantity: 1,
    });
    const withItem = (await api.bootstrap()).orders.find(
      (candidate: any) => candidate.id === order.id,
    );
    await api.confirmOrder({ orderId: order.id });
    await api.payOrder({
      orderId: order.id,
      payments: [{ methodCode: "CASH", amountMinor: withItem.totalMinor }],
    });
    await api.updateOrderStatus({
      orderId: order.id,
      status: "DELIVERED",
    });
    await api.saveSettings({
      ...data.settings,
      printing: {
        ...data.settings.printing,
        bill: { ...data.settings.printing.bill, mode: "SYSTEM_DIALOG" },
      },
    });
    return { sessionNumber: session.number, total: withItem.totalMinor };
  });

  await page.reload();
  await page.getByRole("link", { name: "Caja" }).click();
  await page.getByRole("button", { name: "Cerrar caja" }).click();
  await page
    .getByRole("dialog", { name: "Cerrar caja" })
    .getByRole("button", { name: /Ver informe del turno/ })
    .click();
  const report = page.getByRole("dialog", { name: "Informe de caja" });
  await expect(
    report.getByRole("button", { name: "Imprimir informe" }),
  ).toBeVisible();
  await report.getByRole("button", { name: "Imprimir informe" }).click();

  const printModal = page.getByRole("dialog", {
    name: "Imprimir informe de caja",
  });
  await expect(printModal).toBeVisible();
  await printModal.getByRole("button", { name: "Imprimir ticket" }).click();

  const preview = await previewWindow();
  await expect(
    preview.getByText(`INFORME DE CAJA #${setup.sessionNumber}`),
  ).toBeVisible();
  await expect(preview.getByText("Ventas")).toBeVisible();
  await expect(preview.getByText("Pedidos", { exact: true })).toBeVisible();
  await expect(preview.getByText(/\$\s*[\d.]+/).first()).toBeVisible();

  const typography = await preview.evaluate(() => {
    const body = document.body;
    const style = window.getComputedStyle(body);
    return {
      fontFamily: style.fontFamily,
      fontWeight: style.fontWeight,
      fontSize: parseFloat(style.fontSize),
    };
  });
  expect(typography.fontFamily.toLowerCase()).toContain("arial");
  expect(Number(typography.fontWeight)).toBeGreaterThanOrEqual(700);
  expect(typography.fontSize).toBeGreaterThanOrEqual(12);

  await preview.getByRole("button", { name: "Cancelar" }).click();

  await expect(report).toBeVisible();
  const state = await page.evaluate(async () => {
    const current = await (window as any).gastronomy.bootstrap();
    return current.cashSession?.status ?? current.cashSession?.session?.status;
  });
  expect(state).toBe("OPEN");
  expect(setup.total).toBeGreaterThan(0);

  await page.keyboard.press("Escape");
  const closeDialog = page.getByRole("dialog", {
    name: "Conciliar y cerrar caja",
  });
  await closeDialog
    .getByLabel("Efectivo contado")
    .fill(String(setup.total / 100));
  await closeDialog.getByRole("button", { name: "Revisar cierre" }).click();
  await page
    .getByRole("dialog", { name: "Confirmar cierre definitivo" })
    .getByRole("button", { name: "Confirmar cierre definitivo" })
    .click();

  await expect(
    page.getByRole("dialog", { name: "Informe de caja" }),
  ).toBeVisible();
  await expect
    .poll(async () =>
      page.evaluate(
        async () => (await (window as any).gastronomy.bootstrap()).cashSession,
      ),
    )
    .toBeNull();
  await page.keyboard.press("Escape");
  await expect(
    page.getByText(`#${setup.sessionNumber}`, { exact: true }),
  ).toBeVisible();
});

test("permite seleccionar secciones del informe y desglosa mesas por mozo con vista previa", async () => {
  await launch();
  const setup = await page.evaluate(async () => {
    const api = (window as any).gastronomy;
    const data = await api.bootstrap();
    const session = await api.openCashSession({ openingAmountMinor: 0 });
    const product = data.products[0];
    const table = await api.ensureTable({ number: 15 });
    const order = await api.createOrder({
      type: "DINE_IN",
      tableId: table.id,
      waiterUserId: "user-admin",
    });
    await api.addOrderItem({
      orderId: order.id,
      productId: product.id,
      quantity: 2,
    });
    const withItem = (await api.bootstrap()).orders.find(
      (candidate: any) => candidate.id === order.id,
    );
    await api.confirmOrder({ orderId: order.id });
    await api.payOrder({
      orderId: order.id,
      payments: [{ methodCode: "CASH", amountMinor: withItem.totalMinor }],
    });
    await api.saveSettings({
      ...data.settings,
      printing: {
        ...data.settings.printing,
        bill: { ...data.settings.printing.bill, mode: "SYSTEM_DIALOG" },
      },
    });
    return { sessionNumber: session.number, total: withItem.totalMinor, tableNumber: 15 };
  });

  await page.reload();
  await page.getByRole("link", { name: "Caja" }).click();
  await page.getByRole("button", { name: "Cerrar caja" }).click();
  await page
    .getByRole("dialog", { name: "Cerrar caja" })
    .getByRole("button", { name: /Ver informe del turno/ })
    .click();

  const report = page.getByRole("dialog", { name: "Informe de caja" });
  await expect(report).toBeVisible();
  await expect(report.locator("span", { hasText: "Mesa 15" })).toBeVisible();

  await report.getByRole("button", { name: "Imprimir informe" }).click();

  const printModal = page.getByRole("dialog", {
    name: "Imprimir informe de caja",
  });
  await expect(printModal).toBeVisible();

  await expect(printModal.getByText("Resumen de ventas")).toBeVisible();
  await expect(printModal.getByText("Arqueo de caja")).toBeVisible();
  await expect(printModal.getByText("Por tipo (canales)")).toBeVisible();
  await expect(
    printModal.getByText("Por medio de pago", { exact: true }),
  ).toBeVisible();

  await expect(
    printModal.locator("span", { hasText: "Mesa 15" }).first(),
  ).toBeVisible();
  await expect(printModal.getByText(/Total Administrador:/)).toBeVisible();

  await printModal.getByRole("button", { name: "Solo obligatorias" }).click();
  await printModal.locator("label", { hasText: "Por mozo" }).locator("input[type='checkbox']").check();

  await printModal.getByRole("button", { name: "Imprimir ticket" }).click();

  const preview = await previewWindow();
  await expect(
    preview.getByText(`INFORME DE CAJA #${setup.sessionNumber}`),
  ).toBeVisible();
  await expect(preview.getByRole("heading", { name: "Por mozo" })).toBeVisible();
  await expect(preview.locator("span", { hasText: "Mesa 15" }).first()).toBeVisible();
  await expect(preview.getByText(/Total Administrador:/)).toBeVisible();

  await preview.getByRole("button", { name: "Cancelar" }).click();
});

