import {
  installInteractionDiagnostics,
  attachInteractionDiagnostics,
} from "./interaction-diagnostics";
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
  await installInteractionDiagnostics(page);
  await app.evaluate(({ app, BrowserWindow }) => {
    (app as any).__capturedPrintHtml = "";
    (app as any).__capturedPrintCount = 0;
    const installPrintCapture = (window: any) => {
      window.webContents.print = (
        _options: unknown,
        callback?: (success: boolean) => void,
      ) => {
        (app as any).__capturedPrintCount += 1;
        void window.webContents
          .executeJavaScript("document.documentElement.outerHTML")
          .then((html: string) => {
            (app as any).__capturedPrintHtml = html;
            callback?.(true);
          });
      };
      window.webContents.getPrintersAsync = async () => [];
    };
    for (const window of BrowserWindow.getAllWindows())
      installPrintCapture(window);
    app.on("browser-window-created", (_event: unknown, window: any) =>
      installPrintCapture(window),
    );
  });
}

async function capturedPrintHtml() {
  await expect
    .poll(() =>
      app.evaluate(({ app }) =>
        Boolean((app as any).__capturedPrintHtml?.length),
      ),
    )
    .toBe(true);
  return app.evaluate(({ app }) =>
    ((app as any).__capturedPrintHtml as string).replaceAll("&nbsp;", " "),
  );
}

test("paga el envío desde Repartidores y lo descuenta en cierre, historial y ticket", async () => {
  await launch();
  const setup = await page.evaluate(async () => {
    const api = window.gastronomy;
    const data = await api.bootstrap();
    await api.saveSettings({
      ...data.settings,
      deliverySettlementEnabled: true,
      deliveryFeeBelongsToDriver: true,
      deliveryDriverPaymentMode: "ACCUMULATED",
      printing: {
        ...data.settings.printing,
        bill: { ...data.settings.printing.bill, mode: "SYSTEM_DIALOG" },
      },
    });
    const session = await api.openCashSession({
      openingAmountMinor: 1_000_000,
    });
    const driver = await api.createDriver({
      fullName: "Repartidor cierre",
      authorizerPin: "1234",
    });
    const order = await api.createOrder({
      type: "DELIVERY",
      customerName: "Cliente cierre",
      customerPhone: "11 5555-1212",
      deliveryAddress: "Calle Cierre 123",
      deliveryFeeMinor: 250_000,
      driverUserId: driver.id,
    });
    await api.addOrderItem({
      orderId: order.id,
      productId: data.products[0]!.id,
    });
    const confirmed = await api.confirmOrder({ orderId: order.id });
    await api.completeOrder({
      orderId: order.id,
      finalStatus: "DELIVERED",
      payments: [{ methodCode: "TRANSFER", amountMinor: confirmed.totalMinor }],
    });
    return { sessionId: session.id, totalMinor: confirmed.totalMinor };
  });
  await page.reload();
  await page.getByRole("link", { name: "Repartidores" }).click();
  await page
    .getByRole("checkbox", { name: /Seleccionar movimiento del pedido/ })
    .check();
  await page.getByRole("button", { name: /Pagar envío/ }).click();
  const settle = page.getByRole("dialog", { name: "Revisar pago o rendición" });
  await settle.getByLabel(/PIN/).fill("1234");
  await settle.getByRole("button", { name: /Revisar/ }).click();
  await page
    .getByRole("dialog", { name: "Confirmar movimiento de caja" })
    .getByRole("button", { name: "Confirmar movimiento" })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Confirmar movimiento de caja" }),
  ).not.toBeVisible();
  const closed = await page.evaluate(async ({ sessionId, totalMinor }) => {
    const api = window.gastronomy;
    const report = await api.getCashSessionReport({ cashSessionId: sessionId });
    if (
      report.session.expectedAmountMinor !== 750_000 ||
      report.session.cashExpenseMinor !== 250_000
    )
      throw new Error("El pago del repartidor no se descontó de caja");
    if (report.totals.salesMinor !== totalMinor)
      throw new Error("Se alteraron las ventas");
    return api.closeCashSession({
      countedAmountMinor: 750_000,
      closingFloatAmountMinor: 0,
    });
  }, setup);
  expect(closed.differenceMinor).toBe(0);
  await page.reload();
  await page.getByRole("link", { name: "Caja" }).click();
  await page.getByRole("button", { name: "Ver informe", exact: true }).click();
  const report = page.getByRole("dialog", { name: "Informe de caja" });
  await expect(
    report.getByText("Gastos y otros egresos en efectivo", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    report.getByText("Esperado sin cambio", { exact: true }),
  ).toBeVisible();
  await report.getByRole("button", { name: "Imprimir informe" }).click();
  const directTicket = await capturedPrintHtml();
  expect(directTicket).toContain("Movimientos de efectivo");
  expect(directTicket).toContain("Esperado sin cambio");
  expect(
    await app.evaluate(({ app }) => (app as any).__capturedPrintCount),
  ).toBe(1);
  expect(
    app
      .windows()
      .filter((candidate) =>
        candidate.url().includes("print-preview-controls"),
      ),
  ).toHaveLength(0);
  await expect(
    page.getByRole("dialog", { name: "Imprimir informe de caja" }),
  ).toHaveCount(0);
});

test.afterEach(async ({}, info) => {
  try {
    await attachInteractionDiagnostics(page, app, info, "interaction-state");
  } catch (error) {
    console.warn("Diagnostic capture failed", error);
  }
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
    report.getByRole("button", { name: "Personalizar ticket" }),
  ).toBeVisible();
  await report.getByRole("button", { name: "Personalizar ticket" }).click();

  const printModal = page.getByRole("dialog", {
    name: "Imprimir informe de caja",
  });
  await expect(printModal).toBeVisible();
  await printModal.getByRole("button", { name: "Imprimir ticket" }).click();

  const printedTicket = await capturedPrintHtml();
  expect(printedTicket).toContain(`INFORME DE CAJA #${setup.sessionNumber}`);
  expect(printedTicket).toContain("Resumen");
  expect(printedTicket).toContain("Pedidos");
  expect(printedTicket).toMatch(/font-family\s*:\s*[^;]*(Verdana|Arial)/i);
  expect(printedTicket).toMatch(/body\{[^}]*font-weight:400/i);
  expect(printedTicket).toMatch(
    /\.total[^}]*font-weight:9?00|\.row strong[^}]*font-weight:700/i,
  );
  expect(printedTicket).toMatch(/font-size\s*:\s*(1[2-9]|[2-9]\d)px/i);
  expect(
    app
      .windows()
      .filter((candidate) =>
        candidate.url().includes("print-preview-controls"),
      ),
  ).toHaveLength(0);

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
    .getByLabel("Total contado en caja")
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
    return {
      sessionNumber: session.number,
      total: withItem.totalMinor,
      tableNumber: 15,
    };
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

  await report.getByRole("button", { name: "Personalizar ticket" }).click();

  const printModal = page.getByRole("dialog", {
    name: "Imprimir informe de caja",
  });
  await expect(printModal).toBeVisible();

  await expect(
    printModal.getByText("Resumen de ventas", { exact: true }),
  ).toBeVisible();
  await expect(printModal.getByText("Arqueo de caja")).toBeVisible();
  await expect(printModal.getByText("Por tipo (canales)")).toBeVisible();
  await expect(
    printModal.getByText("Por medio de pago", { exact: true }),
  ).toBeVisible();

  await expect(printModal.getByRole("checkbox")).toHaveCount(5);
  await expect(
    printModal.locator("input[type='checkbox']:checked"),
  ).toHaveCount(0);
  await expect(printModal.getByText(/Total Administrador:/)).toHaveCount(0);

  await printModal.getByRole("button", { name: "Todas", exact: true }).click();
  await expect(
    printModal.locator("input[type='checkbox']:checked"),
  ).toHaveCount(5);
  await printModal
    .getByRole("button", { name: "Cancelar", exact: true })
    .click();
  await report.getByRole("button", { name: "Personalizar ticket" }).click();
  await expect(
    printModal.locator("input[type='checkbox']:checked"),
  ).toHaveCount(0);

  await printModal
    .locator("label", { hasText: "Por mozo" })
    .locator("input[type='checkbox']")
    .check();

  await printModal.getByRole("button", { name: "Imprimir ticket" }).click();

  const printedTicket = await capturedPrintHtml();
  expect(printedTicket).toContain(`INFORME DE CAJA #${setup.sessionNumber}`);
  expect(printedTicket).toContain("Por mozo");
  expect(printedTicket).toContain("Mesa 15");
  expect(printedTicket).toContain("Total Administrador:");
  expect(
    app
      .windows()
      .filter((candidate) =>
        candidate.url().includes("print-preview-controls"),
      ),
  ).toHaveLength(0);
});

test("separa el cambio final del efectivo neto en revisión, historial e informe imprimible", async () => {
  await launch();
  const session = await page.evaluate(async () => {
    const api = (window as any).gastronomy;
    const opened = await api.openCashSession({ openingAmountMinor: 100_000 });
    await api.registerCashMovement({
      type: "INCOME",
      amountMinor: 500_000,
      reason: "Ingreso para prueba de cambio final",
      paymentMethodCode: "CASH",
    });
    await api.saveSettings({
      ...(await api.bootstrap()).settings,
      printing: {
        ...(await api.bootstrap()).settings.printing,
        bill: {
          ...(await api.bootstrap()).settings.printing.bill,
          mode: "SYSTEM_DIALOG",
        },
      },
    });
    return { id: opened.id, number: opened.number };
  });

  await page.reload();
  await page.getByRole("link", { name: "Caja" }).click();
  await page.getByRole("button", { name: /Conciliar y cerrar caja/ }).click();
  const closeDialog = page.getByRole("dialog", {
    name: "Conciliar y cerrar caja",
  });
  await closeDialog.getByLabel("Total contado en caja").fill("5900");
  await closeDialog
    .getByLabel("Cambio final para la próxima caja")
    .fill("1500");
  await closeDialog.getByLabel("Motivo de la diferencia").fill("Conteo E2E");
  await closeDialog.getByRole("button", { name: "Revisar cierre" }).click();

  const confirmation = page.getByRole("dialog", {
    name: "Confirmar cierre definitivo",
  });
  await expect(
    confirmation
      .getByText("Esperado sin cambio", { exact: true })
      .locator(".."),
  ).toContainText("$ 4.500");
  await expect(
    confirmation.getByText("Contado sin cambio", { exact: true }).locator(".."),
  ).toContainText("$ 4.400");
  await expect(
    confirmation
      .getByText("Diferencia de arqueo", { exact: true })
      .locator(".."),
  ).toContainText(/-\s*\$\s*100/);
  await expect(
    confirmation.getByText("Cambio final", { exact: true }).locator(".."),
  ).toContainText("$ 1.500");
  await expect(confirmation.getByText("$ 6.000", { exact: true })).toHaveCount(
    0,
  );
  await expect(confirmation.getByText("$ 5.900", { exact: true })).toHaveCount(
    0,
  );

  const beforeClose = await page.evaluate(async (cashSessionId) => {
    const api = (window as any).gastronomy;
    const report = await api.getCashSessionReport({ cashSessionId });
    return report.session;
  }, session.id);
  expect(beforeClose.expectedAmountMinor).toBe(600_000);
  await confirmation
    .getByRole("button", { name: "Confirmar cierre definitivo" })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Informe de caja" }),
  ).toBeVisible();

  const state = await page.evaluate(async (cashSessionId) => {
    const api = (window as any).gastronomy;
    const data = await api.bootstrap();
    const report = await api.getCashSessionReport({ cashSessionId });
    return { session: data.cashSession, report: report.session };
  }, session.id);
  expect(state.session).toBeNull();
  expect(state.report.countedAmountMinor).toBe(590_000);
  expect(state.report.expectedAmountMinor).toBe(600_000);

  const report = page.getByRole("dialog", { name: "Informe de caja" });
  for (const value of ["$ 4.500", "$ 4.400", "$ 1.500"]) {
    await expect(report.getByText(value, { exact: true })).toBeVisible();
  }
  await expect(report.getByText(/-\s*\$\s*100/)).toBeVisible();
  await expect(
    report.getByText("Contado sin cambio", { exact: true }).locator(".."),
  ).toContainText("$ 4.400");
  await report.getByRole("button", { name: "Personalizar ticket" }).click();
  const printModal = page.getByRole("dialog", {
    name: "Imprimir informe de caja",
  });
  for (const value of ["$ 4.500", "$ 4.400", "$ 1.500"]) {
    await expect(printModal.getByText(value, { exact: true })).toBeVisible();
  }
  await expect(printModal.getByText(/-\s*\$\s*100/)).toBeVisible();
  await printModal.getByRole("button", { name: "Imprimir ticket" }).click();
  const printedTicket = await capturedPrintHtml();
  for (const value of ["$ 4.500", "$ 4.400", "$ 1.500"]) {
    expect(printedTicket).toContain(value);
  }
  expect(printedTicket).toMatch(/-\s*\$\s*100/);
  expect(
    app
      .windows()
      .filter((candidate) =>
        candidate.url().includes("print-preview-controls"),
      ),
  ).toHaveLength(0);
  await expect(printModal).toBeHidden();
  await report.getByRole("button", { name: "Cerrar", exact: true }).click();
  await expect(report).toBeHidden();
  await expect(
    page.getByText(`#${session.number}`, { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Ver informe", exact: true }).click();
  const historyReport = page.getByRole("dialog", { name: "Informe de caja" });
  for (const value of ["$ 4.500", "$ 4.400", "$ 1.500"]) {
    await expect(historyReport.getByText(value, { exact: true })).toBeVisible();
  }
  await expect(historyReport.getByText(/-\s*\$\s*100/)).toBeVisible();
});
