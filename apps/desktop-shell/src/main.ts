import { join } from "node:path";
import { app, BrowserWindow, dialog, ipcMain, session } from "electron";
import { copyFile, rm, writeFile } from "node:fs/promises";
import { GastronomyApplication } from "@gastronomy/application";
import type {
  AppSettingsDto,
  DesktopApi,
  OrderDto,
} from "@gastronomy/contracts";
import { formatMoney } from "@gastronomy/domain";
import { SqliteGastronomyRepository } from "@gastronomy/database";
import { printHtml } from "./printer";

let mainWindow: BrowserWindow | null = null;
let repository: SqliteGastronomyRepository | null = null;
let application: GastronomyApplication | null = null;
let databasePath = "";

function services() {
  if (!application || !repository)
    throw new Error("La aplicación no está inicializada.");
  return { appService: application, localRepository: repository };
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function orderTicketHtml(
  order: OrderDto,
  kind: "KITCHEN_ORDER" | "CUSTOMER_BILL",
  settings: AppSettingsDto,
) {
  const isKitchen = kind === "KITCHEN_ORDER";
  const profile = isKitchen
    ? settings.printing.kitchen
    : settings.printing.bill;
  const template = settings.printing.receiptTemplate;
  const paperMm = profile.paperWidth === "58mm" ? 58 : 80;
  const contentMm = paperMm - 8;
  const fontSizePx = Math.max(
    9,
    Math.min(15, (contentMm / profile.charsPerLine) * 6.2),
  ).toFixed(1);
  const feedHeightMm = Math.max(0, profile.feedLinesBeforeCut) * 3.5;
  const typeLabel =
    order.type === "DINE_IN"
      ? `SALÓN · MESA ${order.tableNumber ?? "-"}`
      : order.type === "TAKEAWAY"
        ? "PARA RETIRAR"
        : "ENVÍO";
  const itemRows = order.items
    .map((item) => {
      const halves = item.halves.length
        ? `<div class="indent">½ ${escapeHtml(item.halves[0]?.nameSnapshot)}<br>½ ${escapeHtml(item.halves[1]?.nameSnapshot)}</div>`
        : "";
      const notes = item.notes
        ? `<div class="indent">SIN / OBS: ${escapeHtml(item.notes)}</div>`
        : "";
      const modifiers = item.modifiers
        .map(
          (modifier) =>
            `<div class="indent">+ ${escapeHtml(modifier.nameSnapshot)} (${escapeHtml(modifier.scope === "FULL_PIZZA" ? "completo" : modifier.scope === "FIRST_HALF" ? "1ª mitad" : "2ª mitad")})</div>`,
        )
        .join("");
      const price =
        isKitchen || !template.showItemTotal
          ? ""
          : `<span>${escapeHtml(formatMoney(item.lineTotalMinor))}</span>`;
      const quantity =
        template.showItemQuantity || isKitchen ? `${item.quantity} × ` : "";
      const unitPrice =
        !isKitchen && template.showItemUnitPrice
          ? `<div class="indent">Unitario: ${escapeHtml(formatMoney(item.unitPriceMinorSnapshot))}</div>`
          : "";
      return `<div class="row"><strong>${quantity}${escapeHtml(item.productNameSnapshot)}</strong>${price}</div>${unitPrice}${halves}${modifiers}${notes}`;
    })
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page{size:${paperMm}mm auto;margin:3mm}body{font-family:"Courier New",monospace;width:${contentMm}mm;margin:0;color:#000;font-size:${fontSizePx}px;overflow-wrap:anywhere}.row>span{white-space:nowrap;flex-shrink:0}
    h1,h2,p{margin:0}.center{text-align:center}.divider{border-top:1px dashed #000;margin:8px 0}.row{display:flex;justify-content:space-between;gap:8px;margin:5px 0}.indent{padding-left:12px;line-height:1.4}.promised{font-size:18px;font-weight:800;margin:8px 0}.total{font-size:18px;font-weight:800}
  </style></head><body><div class="center"><h1>${escapeHtml(isKitchen ? template.kitchenHeader || "COMANDA" : template.title || settings.businessName)}</h1><p>${escapeHtml(settings.printing.terminalLabel)}</p>${!isKitchen && template.subtitle ? `<p>${escapeHtml(template.subtitle)}</p>` : ""}${template.showOrderNumber || isKitchen ? `<h2>PEDIDO #${order.number}</h2>` : ""}${template.showTable || isKitchen ? `<h2>${escapeHtml(typeLabel)}</h2>` : ""}</div>
  <div class="divider"></div>${order.promisedAt ? `<p class="center promised">HORA DE ENTREGA ${escapeHtml(new Date(order.promisedAt).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }))}</p>` : ""}
  ${itemRows}<div class="divider"></div>${order.notes ? `<p><strong>OBS:</strong> ${escapeHtml(order.notes)}</p>` : ""}
  ${template.showCustomer && order.customerNameSnapshot ? `<p>Cliente: ${escapeHtml(order.customerNameSnapshot)}</p>` : ""}${template.showCustomer && order.customerPhoneSnapshot ? `<p>Tel: ${escapeHtml(order.customerPhoneSnapshot)}</p>` : ""}${template.showCustomer && order.deliveryAddressSnapshot ? `<p>Dirección: ${escapeHtml(order.deliveryAddressSnapshot)}</p>` : ""}
  ${isKitchen ? "" : `<div class="divider"></div><div class="row"><span>Subtotal</span><span>${escapeHtml(formatMoney(order.subtotalMinor))}</span></div>${order.discountMinor ? `<div class="row"><span>Descuento</span><span>-${escapeHtml(formatMoney(order.discountMinor))}</span></div>` : ""}${order.deliveryFeeMinor ? `<div class="row"><span>Delivery</span><span>${escapeHtml(formatMoney(order.deliveryFeeMinor))}</span></div>` : ""}<div class="row total"><span>TOTAL</span><span>${escapeHtml(formatMoney(order.totalMinor))}</span></div>`}
  ${template.showWaiter && order.waiterName ? `<p>Tomado por: ${escapeHtml(order.waiterName)}</p>` : ""}
  ${
    !isKitchen && template.showPaymentSummary && order.payments.length
      ? `<div class="divider"></div>${order.payments
          .filter((payment) => payment.refundableMinor > 0)
          .map(
            (payment) =>
              `<div class="row"><span>${escapeHtml(payment.methodName)}</span><span>${escapeHtml(formatMoney(payment.refundableMinor))}</span></div>`,
          )
          .join("")}`
      : ""
  }
  <div class="divider"></div>${template.showDate || isKitchen ? `<p class="center">${escapeHtml(new Date().toLocaleString("es-AR"))}${order.printCount > 0 ? " · REIMPRESIÓN" : ""}</p>` : ""}${isKitchen && template.kitchenFooter ? `<p class="center">${escapeHtml(template.kitchenFooter)}</p>` : ""}${!isKitchen && template.footer ? `<p class="center">${escapeHtml(template.footer)}</p>` : ""}${!isKitchen && template.nonFiscalLegend ? `<p class="center"><small>${escapeHtml(template.nonFiscalLegend)}</small></p>` : ""}<div aria-hidden="true" style="height:${feedHeightMm}mm"></div></body></html>`;
}

async function printOrder(
  order: OrderDto,
  kind: "KITCHEN_ORDER" | "CUSTOMER_BILL",
  settings: AppSettingsDto,
) {
  const profile =
    kind === "KITCHEN_ORDER"
      ? settings.printing.kitchen
      : settings.printing.bill;
  return printHtml(orderTicketHtml(order, kind, settings), profile, {
    parent: mainWindow,
  });
}

function printerTestHtml(
  kind: "KITCHEN_ORDER" | "CUSTOMER_BILL",
  settings: AppSettingsDto,
) {
  const timestamp = new Date().toISOString();
  const testOrder: OrderDto = {
    id: "printer-test",
    number: 9999,
    type: "DELIVERY",
    operationalStatus: "READY",
    paymentStatus: "PAID",
    lifecycleStatus: "CONFIRMED",
    cashSessionCreatedId: "printer-test-cash",
    cashSessionPaidId: "printer-test-cash",
    tableId: null,
    tableNumber: null,
    customerId: "printer-test-customer",
    customerNameSnapshot: "Cliente de prueba",
    customerPhoneSnapshot: "11 5555-0199",
    deliveryAddressSnapshot:
      "Avenida Siempre Viva 742, departamento 8, timbre rojo",
    deliveryFeeMinor: 25_000,
    promisedAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    scheduled: true,
    waiterUserId: "printer-test-waiter",
    waiterName: "Operador de prueba",
    driverUserId: "printer-test-driver",
    driverName: "Repartidor de prueba",
    collectedByDriver: false,
    notes:
      "Texto largo de prueba para verificar saltos de línea y legibilidad.",
    subtotalMinor: 186_000,
    discountMinor: 0,
    totalMinor: 211_000,
    paidMinor: 211_000,
    printedAt: null,
    printCount: 0,
    printAttemptCount: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    items: [
      {
        id: "printer-test-item-1",
        productId: "printer-test-product-1",
        productNameSnapshot: "Pizza especial grande con nombre largo",
        quantity: 1,
        unitPriceMinorSnapshot: 150_000,
        discountMinorSnapshot: 0,
        notes: "Sin cebolla; cortar en ocho porciones",
        halves: [],
        modifiers: [],
        lineTotalMinor: 150_000,
      },
      {
        id: "printer-test-item-2",
        productId: "printer-test-product-2",
        productNameSnapshot: "Empanada de jamón y queso",
        quantity: 2,
        unitPriceMinorSnapshot: 18_000,
        discountMinorSnapshot: 0,
        notes: null,
        halves: [],
        modifiers: [],
        lineTotalMinor: 36_000,
      },
    ],
    payments: [
      {
        id: "printer-test-payment",
        methodCode: "TRANSFER",
        methodName: "Transferencia",
        amountMinor: 211_000,
        receivedMinor: null,
        reference: "PRUEBA-123",
        createdAt: timestamp,
        refundedMinor: 0,
        refundableMinor: 211_000,
        status: "ACTIVE",
      },
    ],
  };
  return orderTicketHtml(testOrder, kind, settings).replace(
    "<body>",
    `<body><p class="center"><strong>*** PRUEBA DE IMPRESIÓN ***</strong><br>${escapeHtml(settings.printing.terminalLabel)}</p><div class="divider"></div>`,
  );
}

async function executePrintJob(
  jobId: string,
  orderId: string,
  kind: "KITCHEN_ORDER" | "CUSTOMER_BILL",
) {
  const { appService, localRepository } = services();
  const order = localRepository.getOrder(orderId);
  try {
    const outcome = await printOrder(
      order,
      kind,
      appService.bootstrap().settings,
    );
    if (outcome === "SKIPPED") {
      localRepository.discardPrintJob(jobId);
      return { jobId, status: "SKIPPED" };
    }
    localRepository.markPrintJob(jobId, "PRINTED");
    return { jobId, status: "PRINTED" };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Falló la impresión.";
    localRepository.markPrintJob(jobId, "FAILED", message);
    throw new Error(
      `El pedido quedó guardado, pero no se pudo imprimir: ${message}`,
    );
  }
}

function registerIpcHandlers() {
  const methods: Exclude<
    keyof DesktopApi,
    | "printOrder"
    | "retryPrint"
    | "exportSalesCsv"
    | "createBackup"
    | "restoreBackup"
    | "listPrinters"
    | "testPrinter"
  >[] = [
    "bootstrap",
    "ensureTable",
    "openCashSession",
    "registerCashMovement",
    "closeCashSession",
    "createOrder",
    "updateDraftOrder",
    "confirmOrder",
    "discardDraftOrder",
    "addOrderItem",
    "addHalfAndHalfItem",
    "removeOrderItem",
    "addOrderItemModifier",
    "removeOrderItemModifier",
    "applyOrderDiscount",
    "updateOrderStatus",
    "assignDeliveryDriver",
    "payOrder",
    "refundPayment",
    "completeOrder",
    "cancelOrder",
    "searchCustomers",
    "searchCustomersPage",
    "getCustomerProfile",
    "createCustomer",
    "updateCustomer",
    "setCustomerActive",
    "mergeCustomers",
    "createCategory",
    "updateCategory",
    "deleteCategory",
    "createProduct",
    "updateProduct",
    "bulkUpdateProducts",
    "createModifier",
    "adjustStock",
    "createUser",
    "createDriver",
    "updateUser",
    "settleDelivery",
    "reverseCashMovement",
    "reverseDeliverySettlement",
    "configureTables",
    "updateTable",
    "deleteTable",
    "saveSettings",
    "getDashboard",
    "getDetailedReport",
    "getAuditLog",
  ];
  for (const method of methods) {
    ipcMain.handle(`gastronomy:${method}`, async (_event, payload) => {
      const { appService } = services();
      const target = appService[method] as (input?: any) => unknown;
      const idempotentMethods = [
        "payOrder",
        "createOrder",
        "registerCashMovement",
        "refundPayment",
        "closeCashSession",
        "settleDelivery",
        "cancelOrder",
        "reverseCashMovement",
        "reverseDeliverySettlement",
      ];
      if (
        idempotentMethods.includes(method) &&
        typeof payload === "object" &&
        payload !== null
      ) {
        payload.terminalId = require("node:os").hostname();
      }
      return target.call(appService, payload);
    });
  }
  ipcMain.handle(
    "gastronomy:printOrder",
    async (
      _event,
      payload: { orderId: string; kind: "KITCHEN_ORDER" | "CUSTOMER_BILL" },
    ) => {
      const { appService } = services();
      const job = appService.queuePrint(payload);
      return executePrintJob(job.jobId, payload.orderId, payload.kind);
    },
  );
  ipcMain.handle("gastronomy:listPrinters", async () => {
    if (!mainWindow)
      throw new Error("La ventana principal no está disponible.");
    const printers = await mainWindow.webContents.getPrintersAsync();
    return printers.map((printer) => ({
      name: printer.name,
      displayName: printer.displayName || printer.name,
      isDefault: Boolean((printer as { isDefault?: boolean }).isDefault),
    }));
  });
  ipcMain.handle(
    "gastronomy:testPrinter",
    async (
      _event,
      payload: {
        kind: "KITCHEN_ORDER" | "CUSTOMER_BILL";
        settings?: AppSettingsDto;
      },
    ) => {
      const { appService } = services();
      const settings = payload.settings ?? appService.bootstrap().settings;
      const profile =
        payload.kind === "KITCHEN_ORDER"
          ? settings.printing.kitchen
          : settings.printing.bill;
      const outcome = await printHtml(
        printerTestHtml(payload.kind, settings),
        profile,
        {
          parent: mainWindow,
        },
      );
      return {
        printed: outcome === "PRINTED",
        message:
          outcome === "PRINTED"
            ? "Impresión completada."
            : "Impresión cancelada. No se imprimió nada.",
      };
    },
  );
  ipcMain.handle(
    "gastronomy:retryPrint",
    async (_event, payload: { jobId: string }) => {
      const { appService } = services();
      const job = appService.preparePrintRetry(payload);
      return executePrintJob(job.jobId, job.orderId, job.kind);
    },
  );
  ipcMain.handle("gastronomy:exportSalesCsv", async () => {
    const { appService } = services();
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: "Exportar ventas",
      defaultPath: `ventas-${new Date().toISOString().slice(0, 10)}.csv`,
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (result.canceled || !result.filePath) return { path: null };
    await writeFile(
      result.filePath,
      `\uFEFF${appService.exportSalesCsv()}`,
      "utf8",
    );
    return { path: result.filePath };
  });
  ipcMain.handle("gastronomy:createBackup", async () => {
    const { localRepository } = services();
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: "Crear copia de seguridad",
      defaultPath: `gastronomia-backup-${new Date().toISOString().replaceAll(":", "-").slice(0, 19)}.sqlite`,
      filters: [{ name: "Copia SQLite", extensions: ["sqlite"] }],
    });
    if (result.canceled || !result.filePath) return { path: null };
    await rm(result.filePath, { force: true });
    await localRepository.backupTo(result.filePath);
    SqliteGastronomyRepository.validateDatabase(result.filePath);
    return { path: result.filePath };
  });
  ipcMain.handle("gastronomy:restoreBackup", async () => {
    const selection = await dialog.showOpenDialog(mainWindow!, {
      title: "Restaurar copia de seguridad",
      properties: ["openFile"],
      filters: [{ name: "Copia SQLite", extensions: ["sqlite", "db"] }],
    });
    const source = selection.filePaths[0];
    if (selection.canceled || !source) return { path: null, restored: false };
    SqliteGastronomyRepository.validateDatabase(source);
    const emergency = `${databasePath}.before-restore`;
    const { localRepository } = services();
    await rm(emergency, { force: true });
    await localRepository.backupTo(emergency);
    localRepository.close();
    repository = null;
    application = null;
    try {
      await rm(`${databasePath}-wal`, { force: true });
      await rm(`${databasePath}-shm`, { force: true });
      await copyFile(source, databasePath);
      repository = new SqliteGastronomyRepository(databasePath, {
        seedStarterCatalog: !app.isPackaged,
      });
      application = new GastronomyApplication(repository);
      await rm(emergency, { force: true });
      return { path: source, restored: true };
    } catch (error) {
      await copyFile(emergency, databasePath);
      repository = new SqliteGastronomyRepository(databasePath, {
        seedStarterCatalog: !app.isPackaged,
      });
      application = new GastronomyApplication(repository);
      throw error;
    }
  });
}

async function createWindow() {
  const preload = join(__dirname, "preload.js");
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 768,
    minWidth: 1100,
    minHeight: 680,
    show: false,
    backgroundColor: "#F5F7FA",
    autoHideMenuBar: true,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  const developmentUrl = process.env.GASTRONOMY_RENDERER_URL;
  if (developmentUrl) await mainWindow.loadURL(developmentUrl);
  else await mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  repository?.close();
  repository = null;
});

app
  .whenReady()
  .then(async () => {
    if (!app.requestSingleInstanceLock()) {
      app.quit();
      return;
    }
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [
            "default-src 'self' data:; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' http://localhost:5173 ws://localhost:5173",
          ],
        },
      });
    });
    databasePath = join(app.getPath("userData"), "gastronomy.sqlite");
    repository = new SqliteGastronomyRepository(databasePath, {
      seedStarterCatalog: !app.isPackaged,
    });
    application = new GastronomyApplication(repository);
    registerIpcHandlers();
    await createWindow();
  })
  .catch((error) => {
    console.error("No se pudo iniciar Delta Nube Gastronomía", error);
    app.quit();
  });
