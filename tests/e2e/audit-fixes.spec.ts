import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let app: ElectronApplication;
let page: Page;
let userData = "";

async function seedOrder(customerName: string) {
  return page.evaluate(async (name) => {
    const api = window.gastronomy;
    const data = await api.bootstrap();
    const product = await api.createProduct({
      categoryId: data.categories[0]!.id,
      name: "Producto centavos E2E",
      code: "CENT150",
      prices: ["SALON", "TAKEAWAY", "DELIVERY"].map((priceListCode) => ({
        priceListCode: priceListCode as "SALON" | "TAKEAWAY" | "DELIVERY",
        amountMinor: 15050,
      })),
    });
    const draft = await api.createOrder({
      type: "TAKEAWAY",
      customerName: name,
      customerPhone: "11 5555-0101",
    });
    await api.addOrderItem({ orderId: draft.id, productId: product.id });
    const confirmed = await api.confirmOrder({ orderId: draft.id });
    return {
      id: confirmed.id,
      productId: product.id,
      businessDate: data.cashSession!.businessDate,
    };
  }, customerName);
}

test.beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), "gastronomy-audit-fixes-"));
  app = await electron.launch({
    args: ["apps/desktop-shell", `--user-data-dir=${userData}`],
    cwd: process.cwd(),
  });
  page = await app.firstWindow();
  await expect(page.getByText("Delta Nube", { exact: true })).toBeVisible();
  await page.evaluate(() =>
    window.gastronomy.openCashSession({ openingAmountMinor: 0 }),
  );
  await page.reload();
});

test.afterEach(async () => {
  await app?.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) window.destroy();
  });
  await app?.close();
  if (userData) await rm(userData, { recursive: true, force: true });
});

test("cobra 150,50 pesos exactos y conserva el costo manual en centavos", async () => {
  const order = await seedOrder("Pago centavos E2E");
  await page.evaluate(
    (productId) =>
      window.gastronomy.setFinanceProductCost({
        productId,
        unitCostMinor: 15050,
      }),
    order.productId,
  );
  await page.reload();
  await page.getByRole("link", { name: "Pedidos", exact: true }).click();
  await page.getByRole("row").filter({ hasText: "Pago centavos E2E" }).click();
  const editor = page.getByRole("dialog", { name: /Pedido #/ });
  await editor.getByRole("button", { name: /Cobrar/ }).click();
  const payment = page.getByRole("dialog", { name: "Cobrar pedido" });
  await expect(payment.getByLabel("Efectivo", { exact: true })).toHaveValue(
    "150,50",
  );
  await expect(
    payment.getByText("Vuelto a entregar", { exact: true }),
  ).toHaveCount(0);
  await expect(
    payment.getByText(/^\$\s150,5(?:0)? \/ \$\s150,5(?:0)?$/),
  ).toBeVisible();
  await payment.getByRole("button", { name: "Confirmar cobro" }).click();
  await expect(payment).toBeHidden();
  const paid = await page.evaluate(
    async (id) =>
      (await window.gastronomy.bootstrap()).orders.find(
        (item) => item.id === id,
      )!,
    order.id,
  );
  expect(paid.paidMinor).toBe(15050);
  expect(paid.paymentStatus).toBe("PAID");
  expect(paid.payments).toHaveLength(1);
  expect(paid.payments[0]).toMatchObject({ amountMinor: 15050 });
  expect(paid.changeAmountMinor ?? 0).toBe(0);
  await editor.getByRole("button", { name: "Cerrar", exact: true }).click();

  await page.getByRole("link", { name: "Finanzas", exact: true }).click();
  await expect(
    page
      .getByRole("heading", { name: "Finanzas", exact: true, level: 1 })
      .last(),
  ).toBeVisible();
  // Field wraps its select and all option texts, so its accessible name is not exactly "Producto".
  const costs = page
    .locator("select")
    .filter({ has: page.locator(`option[value="${order.productId}"]`) });
  await costs.selectOption(order.productId);
  const cost = page.getByLabel("Costo unitario", { exact: true });
  await expect(cost).toHaveValue("150,50");
  await page
    .getByRole("button", { name: "Guardar costo", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Costo actualizado");
  const report = await page.evaluate(
    (date) => window.gastronomy.getFinanceReport({ from: date, to: date }),
    order.businessDate,
  );
  expect(
    report.productCosts.find((item) => item.productId === order.productId)
      ?.unitCostMinor,
  ).toBe(15050);
  await cost.fill("abc");
  await expect(
    page.getByRole("button", { name: "Guardar costo", exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole("alert")).toContainText("costo válido");
});

test("Finanzas rechaza abc y exporta gastos filtrados con fórmula neutralizada", async () => {
  await page.evaluate(async () => {
    for (const [title, date, amountMinor] of [
      ["=1+1", "2026-10-03", 15050],
      ["Fuera de período E2E", "2025-01-01", 99900],
    ] as const) {
      await window.gastronomy.createFinanceExpense({
        title,
        category: "Servicios",
        kind: "GENERAL",
        amountMinor,
        incurredOn: date,
        dueOn: date,
        employeeId: null,
        note: null,
        idempotencyKey: crypto.randomUUID(),
      });
    }
  });
  await page.reload();
  await page.getByRole("link", { name: "Finanzas", exact: true }).click();
  await page.getByLabel("Mes", { exact: true }).fill("2026-10");
  await expect(
    page.getByText("Calculando período…", { exact: true }),
  ).toBeHidden();
  const expense = page.getByRole("article").filter({ hasText: "=1+1" });
  await expect(expense).toContainText(/\$\s150,5(?:0)?/);
  await expect(
    page.getByText("Fuera de período E2E", { exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("Categoría", { exact: true }).fill("Prueba inválida");
  await page.getByLabel("Concepto", { exact: true }).fill("No debe guardar");
  await page.getByLabel("Importe", { exact: true }).fill("abc");
  await page
    .getByRole("button", { name: "Registrar gasto", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("importe válido");
  await expect(page.getByText("No debe guardar", { exact: true })).toHaveCount(
    0,
  );
  const exportPath = join(userData, "finance.csv");
  await app.evaluate(({ session, app: electronApp }, path) => {
    (electronApp as any).__financeDownload = null;
    session.defaultSession.once("will-download", (_event, item) => {
      item.setSavePath(path);
      item.once("done", (_doneEvent, state) => {
        (electronApp as any).__financeDownload = {
          state,
          path: item.getSavePath(),
        };
      });
    });
  }, exportPath);
  await page.getByRole("button", { name: "CSV", exact: true }).click();
  await expect
    .poll(
      () =>
        app.evaluate(
          ({ app: electronApp }) => (electronApp as any).__financeDownload,
        ),
      {
        message:
          "Electron debe finalizar el CSV de Finanzas dentro del perfil temporal",
      },
    )
    .not.toBeNull();
  expect(
    await app.evaluate(
      ({ app: electronApp }) => (electronApp as any).__financeDownload,
    ),
  ).toEqual({ state: "completed", path: exportPath });
  const csv = (await readFile(exportPath, "utf8")).replace(/^\uFEFF/, "");
  expect(csv).toContain('"\'=1+1"');
  expect(csv).toContain('"150.50"');
  expect(csv).not.toContain("Fuera de período E2E");
});

test("ventas CSV recibe el período visible y respeta ambos límites", async () => {
  const order = await seedOrder("Venta filtrada E2E");
  let exportPath = join(userData, "ventas-filtradas.csv");
  await app.evaluate(({ dialog }, path) => {
    // All native Save dialogs stay inside this test's disposable profile.
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
  }, exportPath);
  await page.reload();
  await page.getByRole("link", { name: "Informes", exact: true }).click();
  const from = page.getByLabel("Día comercial desde", { exact: true });
  const to = page.getByLabel("Hasta", { exact: true });
  const exportButton = page.getByRole("button", {
    name: "Exportar ventas CSV",
    exact: true,
  });
  const shiftDate = (delta: number) => {
    const date = new Date(`${order.businessDate}T12:00:00`);
    date.setDate(date.getDate() + delta);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  };
  let exportIndex = 0;
  // Export a one-day inclusive range, then exclude this sale via each bound separately.
  for (const [dateFrom, dateTo, included] of [
    [order.businessDate, order.businessDate, true],
    [shiftDate(1), shiftDate(1), false],
    [shiftDate(-1), shiftDate(-1), false],
  ] as const) {
    exportPath = join(userData, `ventas-${++exportIndex}.csv`);
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
    }, exportPath);
    await from.fill(dateFrom);
    await to.fill(dateTo);
    await exportButton.click();
    await expect(
      page.getByText(`Archivo guardado en ${exportPath}`, { exact: true }),
    ).toBeVisible();
    await expect(exportButton).toBeEnabled();
    const csv = await readFile(exportPath, "utf8");
    expect(csv.includes("Venta filtrada E2E")).toBe(included);
    if (included) expect(csv).toContain("150.50");
  }
  await from.fill(shiftDate(1));
  await to.fill(order.businessDate);
  await expect(exportButton).toBeDisabled();
  await expect(page.getByRole("alert")).toContainText("período válido");
});

test("showDate oculta fecha de cuenta pero conserva fecha operativa de cocina sin imprimir", async () => {
  const order = await seedOrder("Fecha impresión E2E");
  await app.evaluate(({ app: electronApp, BrowserWindow }) => {
    (electronApp as any).__auditPrintCount = 0;
    const install = (window: any) => {
      window.webContents.print = (
        _options: unknown,
        callback: (ok: boolean) => void,
      ) => {
        (electronApp as any).__auditPrintCount += 1;
        callback(true);
      };
    };
    electronApp.on("browser-window-created", (_event: unknown, window: any) =>
      install(window),
    );
    BrowserWindow.getAllWindows().forEach(install);
  });
  await page.evaluate(async () => {
    const api = window.gastronomy;
    const data = await api.bootstrap();
    await api.saveSettings({
      ...data.settings,
      printing: {
        ...data.settings.printing,
        receiptTemplate: {
          ...data.settings.printing.receiptTemplate,
          showDate: false,
        },
        kitchen: { ...data.settings.printing.kitchen, mode: "SYSTEM_DIALOG" },
        bill: { ...data.settings.printing.bill, mode: "SYSTEM_DIALOG" },
      },
    });
  });
  for (const kind of ["CUSTOMER_BILL", "KITCHEN_ORDER"] as const) {
    await page.evaluate(
      ({ orderId, kind }) => {
        (window as any).__auditPrintResult = null;
        void window.gastronomy
          .printOrder({ orderId, kind })
          .then((value) => {
            (window as any).__auditPrintResult = value;
          })
          .catch((error: Error) => {
            (window as any).__auditPrintResult = { error: error.message };
          });
      },
      { orderId: order.id, kind },
    );
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
    const preview = app
      .windows()
      .find((candidate) => candidate.url().includes("print-preview-controls"))!;
    const dateMeta = preview
      .locator("#print-preview-ticket .meta-line")
      .first();
    if (kind === "CUSTOMER_BILL")
      await expect(dateMeta).not.toContainText(/\d{1,2}\/\d{1,2}\/\d{4}/);
    else await expect(dateMeta).toContainText(/\d{1,2}\/\d{1,2}\/\d{4}/);
    await preview
      .getByRole("button", { name: "Cancelar", exact: true })
      .click();
    await expect
      .poll(() => page.evaluate(() => (window as any).__auditPrintResult))
      .not.toBeNull();
    expect(
      await page.evaluate(() => (window as any).__auditPrintResult),
    ).toMatchObject({ status: "SKIPPED" });
  }
  expect(
    await app.evaluate(
      ({ app: electronApp }) => (electronApp as any).__auditPrintCount,
    ),
  ).toBe(0);
});

test("Escape y Cancelar protegen metadatos; abc e Infinity no crean pedidos", async () => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("link", { name: "Pedidos", exact: true }).click();
  await page.getByRole("button", { name: /F4 Envío/ }).click();
  const dialog = page.getByRole("dialog", { name: "Nuevo Envío", exact: true });
  await dialog
    .getByLabel("Nombre del cliente *", { exact: true })
    .fill("Metadatos protegidos E2E");
  await dialog.getByLabel("Teléfono *", { exact: true }).fill("11 5555-7777");
  await dialog.getByLabel("Dirección *", { exact: true }).fill("Calle 100");
  await dialog.getByLabel(/^Costo de envío/).fill("abc");
  const create = dialog.getByRole("button", {
    name: "Crear pedido",
    exact: true,
  });
  const productsFirst = dialog.getByRole("button", {
    name: "Cargar productos primero",
    exact: true,
  });
  await expect(create).toBeDisabled();
  await expect(productsFirst).toBeDisabled();
  await expect(dialog.getByRole("alert")).toContainText("costo válido");
  await dialog.getByLabel(/^Costo de envío/).fill("150,50");
  // The quick-delay input has no dedicated label yet; anchor to its numeric inputMode.
  const delay = dialog.locator('input[inputmode="numeric"]');
  await delay.fill("Infinity");
  await expect(create).toBeDisabled();
  await expect(productsFirst).toBeDisabled();
  await expect(dialog.getByRole("alert")).toContainText("demora");
  await delay.fill("40");
  await expect(create).toBeEnabled();
  for (const close of ["Escape", "Cancelar"] as const) {
    const confirmation = page.waitForEvent("dialog");
    const closing =
      close === "Escape"
        ? page.keyboard.press("Escape")
        : dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
    const prompt = await confirmation;
    expect(prompt.type()).toBe("confirm");
    await prompt.dismiss();
    await closing;
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByLabel("Nombre del cliente *", { exact: true }),
    ).toHaveValue("Metadatos protegidos E2E");
    await expect(dialog.getByLabel(/^Costo de envío/)).toHaveValue("150,50");
  }
  const confirmation = page.waitForEvent("dialog");
  const closing = dialog
    .getByRole("button", { name: "Cancelar", exact: true })
    .click();
  await (await confirmation).accept();
  await closing;
  await expect(dialog).toBeHidden();
  expect(
    await page.evaluate(
      async () => (await window.gastronomy.bootstrap()).orders.length,
    ),
  ).toBe(0);
  expect(errors).toEqual([]);
});

test("auditoría muestra errores recuperables y envía búsqueda y paginación al servidor", async () => {
  await app.evaluate(({ ipcMain, app: electronApp }) => {
    const state = electronApp as any;
    state.__auditUnavailable = true;
    state.__auditRequests = [];
    ipcMain.removeHandler("gastronomy:getAuditLog");
    ipcMain.handle("gastronomy:getAuditLog", (_event, input) => {
      state.__auditRequests.push(input);
      if (state.__auditUnavailable)
        throw new Error("Servidor auditoría no disponible E2E");
      const rows = Array.from({ length: 101 }, (_, index) => ({
        id: `audit-${index}`,
        timestamp: new Date().toISOString(),
        action: "ORDER_CANCELLED",
        entityType: "ORDER",
        entityId: `pedido-${index}`,
        operatorName: "Operador E2E",
        authorizerName: null,
        permissionUsed: null,
        reason:
          index === 100
            ? "Motivo fuera de primera página E2E"
            : `Motivo paginado ${index}`,
      }));
      const filtered = input.search
        ? rows.filter((row) => row.reason.includes(input.search))
        : rows;
      return filtered.slice(
        input.offset ?? 0,
        (input.offset ?? 0) + (input.limit ?? 101),
      );
    });
  });
  await page.getByRole("link", { name: "Auditoría", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "No se pudo cargar la auditoría",
    { timeout: 15000 },
  );
  await expect(
    page.getByText("No hay eventos para este filtro", { exact: true }),
  ).toHaveCount(0);
  await app.evaluate(({ app: electronApp }) => {
    (electronApp as any).__auditUnavailable = false;
  });
  await page.getByRole("button", { name: "Reintentar", exact: true }).click();
  const rows = page.locator("tbody tr");
  await expect(rows).toHaveCount(100);
  await expect(page.getByText("Página 1", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Siguiente", exact: true }).click();
  await expect(rows).toHaveCount(1);
  await expect(page.getByText("Página 2", { exact: true })).toBeVisible();
  await expect(rows).toContainText("Motivo fuera de primera página E2E");
  await expect(
    page.getByRole("button", { name: "Siguiente", exact: true }),
  ).toBeDisabled();
  await page
    .getByPlaceholder("Entidad, usuario o motivo", { exact: true })
    .fill("fuera de primera página");
  await expect(page.getByText("Página 1", { exact: true })).toBeVisible();
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText("Motivo fuera de primera página E2E");
  await expect
    .poll(() =>
      app.evaluate(
        ({ app: electronApp }) =>
          (electronApp as any).__auditRequests.at(-1)?.search,
      ),
    )
    .toBe("fuera de primera página");
  const requests = await app.evaluate(
    ({ app: electronApp }) =>
      (electronApp as any).__auditRequests as Array<Record<string, unknown>>,
  );
  expect(requests).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ offset: 100, limit: 101 }),
      expect.objectContaining({
        search: "fuera de primera página",
        offset: 0,
        limit: 101,
      }),
    ]),
  );
});
