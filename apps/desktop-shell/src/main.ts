import { join } from "node:path";
import { app, BrowserWindow, dialog, ipcMain, session } from "electron";
import { copyFile, rm, writeFile } from "node:fs/promises";
import { GastronomyApplication } from "@gastronomy/application";
import type {
  AppSettingsDto,
  CashSessionReportDto,
  CashSessionReportFilters,
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
  const paperMm = profile.paperWidth === "58mm" ? 58 : 72;
  const marginMm = profile.paperWidth === "58mm" ? 2 : 1.5;
  const contentMm = paperMm - marginMm * 2;
  const fontSizePx = profile.paperWidth === "58mm" ? 11.5 : 12.8;
  const feedHeightMm = Math.max(0, profile.feedLinesBeforeCut) * 2.5;
  const printedAt = new Date();
  const dateLabel = printedAt.toLocaleDateString("es-AR");
  const timeLabel = printedAt.toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const typeLabel =
    order.type === "DINE_IN"
      ? `SALÓN · MESA ${order.tableNumber ?? "-"}`
      : order.type === "TAKEAWAY"
        ? "PARA RETIRAR"
        : "ENVÍO";
  const lineBreaks = (value: string) =>
    escapeHtml(value).replaceAll("\n", "<br>");
  const itemRows = order.items
    .map((item) => {
      const halves = item.halves.length
        ? `<div class="detail">½ ${escapeHtml(item.halves[0]?.nameSnapshot)} · ½ ${escapeHtml(item.halves[1]?.nameSnapshot)}</div>`
        : "";
      const notes =
        isKitchen && item.notes
          ? `<span class="modifier"><strong>OBS:</strong> ${escapeHtml(item.notes)}</span>`
          : "";
      const modifiers = item.modifiers
        .map(
          (modifier) =>
            `<span class="modifier">+ ${escapeHtml(modifier.nameSnapshot)} (${escapeHtml(modifier.scope === "FULL_PIZZA" ? "completo" : modifier.scope === "FIRST_HALF" ? "1ª mitad" : "2ª mitad")})</span>`,
        )
        .join("");
      const price =
        isKitchen || !template.showItemTotal
          ? ""
          : `<strong class="amount">${escapeHtml(formatMoney(item.lineTotalMinor))}</strong>`;
      const quantity =
        template.showItemQuantity || isKitchen
          ? `<strong class="quantity">${item.quantity}×</strong>`
          : "";
      const unitPrice =
        !isKitchen && template.showItemUnitPrice && item.quantity !== 1
          ? `<span class="unit-price">@ ${escapeHtml(formatMoney(item.unitPriceMinorSnapshot))} c/u</span>`
          : "";
      return `<div class="item"><div class="item-main"><span class="product">${quantity}<strong>${escapeHtml(item.productNameSnapshot)}</strong>${unitPrice}</span>${price}</div>${halves}${modifiers || notes ? `<div class="detail">${modifiers}${notes}</div>` : ""}</div>`;
    })
    .join("");
  const showBreakdown = order.discountMinor > 0 || order.deliveryFeeMinor > 0;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page{size:${paperMm}mm auto;margin:${marginMm}mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;width:${contentMm}mm;margin:0;color:#000;font-size:${fontSizePx}px;line-height:1.16;overflow-wrap:anywhere}h1,h2,p{margin:0}.center{text-align:center}.title{font-size:18px;line-height:1.05;font-weight:900}.subtitle{font-size:11px;margin-top:1px}.meta{border-top:1px solid #000;border-bottom:1px solid #000;margin:3px 0;padding:2px 0}.meta-line,.row,.item-main,.columns{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:5px;align-items:baseline}.meta-line+.meta-line{margin-top:1px}.columns{font-size:10px;text-transform:uppercase;border-bottom:1px dashed #000;padding:1px 0}.item{padding:2px 0;border-bottom:1px dotted #999}.product{display:flex;min-width:0;gap:3px;align-items:baseline}.quantity{flex:0 0 27px}.amount{white-space:nowrap;font-variant-numeric:tabular-nums}.unit-price{font-size:9px;font-weight:400;white-space:nowrap}.detail{padding-left:30px;font-size:10px;line-height:1.15}.modifier{display:block}.info{font-size:11px;padding:2px 0;border-bottom:1px dashed #000}.promised{font-size:15px;font-weight:900;text-align:center;padding:2px 0;border-bottom:1px dashed #000}.totals{margin-top:3px}.row{margin:1px 0}.total{border-top:3px double #000;margin-top:2px;padding-top:2px;font-size:19px;font-weight:900}.payments{border-top:1px dashed #000;margin-top:3px;padding-top:2px;font-size:11px}.order-note{font-size:11px;padding-top:2px}.footer{border-top:1px dashed #000;margin-top:4px;padding-top:3px;text-align:center;font-size:11px}.reprint{font-weight:900;border:1px solid #000;padding:1px 4px}
  </style></head><body><header class="center"><h1 class="title">${escapeHtml(isKitchen ? template.kitchenHeader || "COMANDA" : template.title || settings.businessName)}</h1>${!isKitchen && template.subtitle ? `<p class="subtitle">${escapeHtml(template.subtitle)}</p>` : ""}</header><section class="meta"><div class="meta-line"><strong>${dateLabel} · ${timeLabel}</strong>${template.showOrderNumber || isKitchen ? `<strong>PEDIDO #${order.number}</strong>` : ""}</div><div class="meta-line">${template.showTable || isKitchen ? `<strong>${escapeHtml(typeLabel)}</strong>` : "<span></span>"}${template.showWaiter && order.waiterName ? `<span>Mozo: <strong>${escapeHtml(order.waiterName)}</strong></span>` : `<span>${escapeHtml(settings.printing.terminalLabel)}</span>`}</div>${order.printCount > 0 ? `<div class="center"><span class="reprint">REIMPRESIÓN</span></div>` : ""}</section>
  ${order.promisedAt ? `<p class="promised">ENTREGA ${escapeHtml(new Date(order.promisedAt).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }))}</p>` : ""}
  ${template.showCustomer && (order.customerNameSnapshot || order.customerPhoneSnapshot || order.deliveryAddressSnapshot) ? `<section class="info">${order.customerNameSnapshot ? `<strong>${escapeHtml(order.customerNameSnapshot)}</strong>` : ""}${order.customerPhoneSnapshot ? ` · ${escapeHtml(order.customerPhoneSnapshot)}` : ""}${order.deliveryAddressSnapshot ? `<br>${escapeHtml(order.deliveryAddressSnapshot)}` : ""}</section>` : ""}
  ${isKitchen && order.type === "DELIVERY" && order.deliveryAddressNotesSnapshot ? `<p class="order-note"><strong>Referencia:</strong> ${escapeHtml(order.deliveryAddressNotesSnapshot)}</p>` : ""}
  <div class="columns"><strong>Cant. · Producto</strong>${isKitchen || !template.showItemTotal ? "" : "<strong>Total</strong>"}</div>${itemRows}
  ${order.notes ? `<p class="order-note"><strong>OBS:</strong> ${escapeHtml(order.notes)}</p>` : ""}
  ${isKitchen ? "" : `<section class="totals">${showBreakdown ? `<div class="row"><span>Subtotal</span><strong>${escapeHtml(formatMoney(order.subtotalMinor))}</strong></div>` : ""}${order.discountMinor ? `<div class="row"><span>Descuento</span><strong>-${escapeHtml(formatMoney(order.discountMinor))}</strong></div>` : ""}${order.deliveryFeeMinor ? `<div class="row"><span>Delivery</span><strong>${escapeHtml(formatMoney(order.deliveryFeeMinor))}</strong></div>` : ""}<div class="row total"><span>TOTAL</span><span>${escapeHtml(formatMoney(order.totalMinor))}</span></div></section>`}
  ${
    !isKitchen && template.showPaymentSummary && order.payments.length
      ? `<section class="payments">${order.payments
          .filter((payment) => payment.refundableMinor > 0)
          .map(
            (payment) =>
              `<div class="row"><span>${escapeHtml(payment.methodName)}</span><span>${escapeHtml(formatMoney(payment.refundableMinor))}</span></div>`,
          )
          .join("")}</section>`
      : ""
  }
  ${(isKitchen && template.kitchenFooter) || (!isKitchen && (template.footer || template.nonFiscalLegend)) ? `<footer class="footer">${isKitchen && template.kitchenFooter ? lineBreaks(template.kitchenFooter) : ""}${!isKitchen && template.footer ? `<strong>${lineBreaks(template.footer)}</strong>` : ""}${!isKitchen && template.nonFiscalLegend ? `<br>${lineBreaks(template.nonFiscalLegend)}` : ""}</footer>` : ""}<div aria-hidden="true" style="height:${feedHeightMm}mm"></div></body></html>`;
}

function cashSessionReportHtml(
  report: CashSessionReportDto,
  settings: AppSettingsDto,
) {
  const session = report.session;
  const profile = settings.printing.bill;
  const paperMm = profile.paperWidth === "58mm" ? 58 : 80;
  const contentMm = paperMm - 8;
  const fontSizePx = Math.max(
    9,
    Math.min(15, (contentMm / profile.charsPerLine) * 6.2),
  ).toFixed(1);
  const money = (value: unknown) => escapeHtml(formatMoney(Number(value) || 0));
  const date = (value: unknown) =>
    value ? escapeHtml(new Date(String(value)).toLocaleString("es-AR")) : "—";
  const filterLabels: Record<string, string> = {
    tableId: "Mesa",
    waiterUserId: "Mozo",
    productId: "Producto",
    categoryName: "Categoría",
    orderType: "Tipo de pedido",
    paymentMethodCode: "Medio de pago",
    operationalStatus: "Estado",
  };
  const filterValue = (key: string, value: unknown) => {
    if (key === "tableId")
      return report.byTable.find((row) => row.tableId === value)?.name ?? value;
    if (key === "waiterUserId")
      return (
        report.byWaiter.find((row) => row.waiterUserId === value)?.name ?? value
      );
    if (key === "productId")
      return (
        report.byProduct.find((row) => row.productId === value)?.name ?? value
      );
    if (key === "paymentMethodCode")
      return (
        report.byPaymentMethod.find((row) => row.code === value)?.name ?? value
      );
    if (key === "orderType")
      return (
        { DINE_IN: "Salón", TAKEAWAY: "Para retirar", DELIVERY: "Delivery" }[
          String(value)
        ] ?? value
      );
    if (key === "operationalStatus")
      return (
        {
          OPEN: "Abierto",
          IN_PREPARATION: "En preparación",
          READY: "Listo",
          DELIVERED: "Entregado",
          CANCELLED: "Cancelado",
        }[String(value)] ?? value
      );
    return value;
  };
  const filters = Object.entries(report.filters ?? {})
    .filter(([key, value]) => key !== "cashSessionId" && value)
    .map(
      ([key, value]) =>
        `<p>${escapeHtml(filterLabels[key] ?? key)}: ${escapeHtml(filterValue(key, value))}</p>`,
    )
    .join("");
  const aggregate = (
    title: string,
    rows: Array<{ name: string; amountMinor: number; quantity?: number }>,
  ) =>
    rows.length
      ? `<h3>${escapeHtml(title)}</h3>${rows.map((row) => `<div class="row"><span>${escapeHtml(row.name)}${row.quantity == null ? "" : ` ×${row.quantity}`}</span><span>${money(row.amountMinor)}</span></div>`).join("")}`
      : "";
  const details = report.detailAvailable
    ? `${aggregate("Por producto", report.byProduct)}${aggregate("Por categoría", report.byCategory)}${aggregate("Por mesa", report.byTable)}${aggregate("Por mozo", report.byWaiter)}${aggregate(
        "Por tipo",
        report.byType.map((row) => ({ ...row, name: row.type })),
      )}${aggregate("Por medio de pago", report.byPaymentMethod)}<h3>Detalle de pedidos</h3>${report.orders.map((order) => `<div class="row"><span>#${escapeHtml(order.number)} · ${escapeHtml(order.items[0]?.productNameSnapshot ?? order.type)}</span><span>${money(order.totalMinor)}</span></div>`).join("")}`
    : `<p class="notice">El detalle de este turno ya no está disponible; se muestra el resumen conservado.</p>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page{size:${paperMm}mm auto;margin:3mm}body{font-family:"Courier New",monospace;width:${contentMm}mm;margin:0;color:#000;font-size:${fontSizePx}px;overflow-wrap:anywhere}h1,h2,h3,p{margin:0 0 5px}.center{text-align:center}.divider{border-top:1px dashed #000;margin:8px 0}.row{display:flex;justify-content:space-between;gap:8px;margin:4px 0}.total{font-size:16px;font-weight:800}.notice{border:1px solid #000;padding:5px}
  </style></head><body><div class="center"><h1>${escapeHtml(settings.businessName)}</h1><h2>INFORME DE CAJA #${escapeHtml(session.number)}</h2><p>${escapeHtml(settings.printing.terminalLabel)}</p></div><div class="divider"></div>
  <p>Día comercial: ${escapeHtml(session.businessDate)}</p><p>Apertura: ${date(session.openedAt)}</p><p>Cierre: ${date(session.closedAt)}</p><p>Responsable: ${escapeHtml(session.openedByName)}</p>${filters ? `<div class="divider"></div><h3>Filtros</h3>${filters}` : ""}<div class="divider"></div><h3>Resumen</h3><div class="row total"><span>Ventas</span><span>${money(report.totals.salesMinor)}</span></div><div class="row"><span>Pedidos</span><span>${escapeHtml(report.totals.orderCount)}</span></div><div class="row"><span>Ticket promedio</span><span>${money(report.totals.averageTicketMinor)}</span></div><div class="row"><span>Descuentos</span><span>${money(report.totals.discountsMinor)}</span></div><div class="row"><span>Devoluciones</span><span>${money(report.totals.refundsMinor)}</span></div><div class="divider"></div><h3>Arqueo</h3><div class="row"><span>Apertura</span><span>${money(session.openingAmountMinor)}</span></div><div class="row"><span>Esperado</span><span>${money(session.expectedAmountMinor)}</span></div><div class="row"><span>Contado</span><span>${money(session.countedAmountMinor)}</span></div><div class="row"><span>Diferencia</span><span>${money(session.differenceMinor)}</span></div><div class="divider"></div>${details}<div class="divider"></div><p class="center">Impreso: ${escapeHtml(new Date().toLocaleString("es-AR"))}</p><div aria-hidden="true" style="height:${Math.max(0, profile.feedLinesBeforeCut) * 3.5}mm"></div></body></html>`;
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
    deliveryAddressNotesSnapshot: "Tocar timbre rojo",
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
    | "printCashSessionReport"
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
    "listCashSessionHistory",
    "getCashSessionReport",
    "createOrder",
    "updateDraftOrder",
    "confirmOrder",
    "discardDraftOrder",
    "addOrderItem",
    "addHalfAndHalfItem",
    "updateOrderItemNotes",
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
    "createTableSector",
    "updateTableSector",
    "deleteTableSector",
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
  ipcMain.handle(
    "gastronomy:printCashSessionReport",
    async (_event, payload: { filters: CashSessionReportFilters }) => {
      const { appService } = services();
      const report = appService.getCashSessionReport(payload.filters);
      const outcome = await printHtml(
        cashSessionReportHtml(report, appService.bootstrap().settings),
        appService.bootstrap().settings.printing.bill,
        { parent: mainWindow },
      );
      return {
        printed: outcome === "PRINTED",
        message:
          outcome === "PRINTED"
            ? "Informe impreso."
            : "Impresión cancelada. No se imprimió nada.",
      };
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
