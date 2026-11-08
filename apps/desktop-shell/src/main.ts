import { join, resolve } from "node:path";
import { app, autoUpdater as nativeUpdater, BrowserWindow, clipboard, dialog, ipcMain, safeStorage, session, shell } from "electron";
import { writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { GastronomyApplication } from "@gastronomy/application";
import type {
  AppSettingsDto,
  CashSessionReportFilters,
  CashSessionReportPrintSections,
  DesktopApi,
  OrderDto,
  WebCommerceApi,
} from "@gastronomy/contracts";
import type { WaiterDeskApi } from "@gastronomy/contracts";
import { createWaiterRelay, waiterRelayConfig, WaiterRequestError } from "./waiter-relay";
import { handleWaiterRequest } from "./waiter-rpc";
import { createWebCommerceSync } from "./web-commerce-sync";
import { formatMoney } from "@gastronomy/domain";
import { SqliteGastronomyRepository } from "@gastronomy/database";
import { printHtml } from "./printer";
import { createPrintDiagnostics, type PrintDiagnostics } from "./print-diagnostics";
import { cashSessionReportHtml } from "./cash-session-ticket";
import { scheduledOrderBadge } from "./scheduled-order-ticket.cjs";
import { createValidatedBackup } from "./safe-backup.cjs";
import { comboComponentsHtml } from "./combo-ticket";
import { restoreValidatedCopy } from "./safe-restore.cjs";
import { isBackgroundTest } from "./e2e-background.cjs";
import { DesktopLicensing } from "./licensing";
import { localPilotLicenseOptions } from "./local-pilot-config";
import { WebSiteProvisioning } from "./web-site-provisioning";
import { WaiterProvisioning } from "./waiter-provisioning";
import QRCode from "qrcode";
import { shareWebSite as performWebSiteShare, type WebSiteShareAction } from "./web-site-sharing";
import { licenseAllowsMethod } from "@gastronomy/licensing";
import { POS_AI_INTENTS } from "@gastronomy/licensing";
import { UpdateInstallGate } from "./update-install-gate";
import { createUpdateRuntime } from "./update-runtime";
import type { DesktopUpdater } from "./app-updater";

let mainWindow: BrowserWindow | null = null;
// The packaged PNG is a native resource, not a renderer URL or an asar entry.
const appIconPath = app.isPackaged
  ? join(process.resourcesPath, "icons", "app-icon.png")
  : resolve(__dirname, "../build/icons/app-icon.png");
let repository: SqliteGastronomyRepository | null = null;
let application: GastronomyApplication | null = null;
let databasePath = "";
let backgroundE2e = false;
let licensing: DesktopLicensing | null = null;
let licensingTimer: ReturnType<typeof setInterval> | null = null;
let licensingPollInFlight = false;
const operationGate = new UpdateInstallGate();
const electronSafeStorage = { isAvailable: () => safeStorage.isEncryptionAvailable(), encryptString: (value: string) => safeStorage.encryptString(value), decryptString: (value: Buffer) => safeStorage.decryptString(value) };
function createDesktopLicensing(options: Omit<ConstructorParameters<typeof DesktopLicensing>[0], "safeStorage">) {
  return new DesktopLicensing({ ...options, safeStorage: electronSafeStorage });
}
let webInstallationId: string | undefined;
let hostedPilotMode = false;
const webCommerceEnv: NodeJS.ProcessEnv = { ...process.env };
// Keep waiter-only credentials out of the catalog/order synchronization client.
const waiterOrigin = process.env.GASTRONOMY_WAITER_PROVISION_URL ?? process.env.GASTRONOMY_WEB_PROVISION_URL ?? "https://pedidos.deltanubeweb.com";
const hasManualConnector = Boolean(process.env.GASTRONOMY_WEB_ORDERS_TOKEN || process.env.GASTRONOMY_WEB_ORDERS_URL || process.env.GASTRONOMY_WEB_ORDERS_STORE_ID);
let waiterProvisioning: WaiterProvisioning | null = null;
function currentWaiterConfig() {
  const automatic = !hasManualConnector && waiterProvisioning?.credential();
  if (automatic) return waiterRelayConfig({
    GASTRONOMY_WEB_ORDERS_URL: waiterOrigin,
    GASTRONOMY_WAITER_PUBLIC_URL: process.env.GASTRONOMY_WAITER_PUBLIC_URL,
    GASTRONOMY_WEB_ORDERS_STORE_ID: automatic.storeId,
    GASTRONOMY_WEB_ORDERS_TOKEN: automatic.waiterToken,
  }, webInstallationId);
  return waiterRelayConfig(webCommerceEnv, webInstallationId);
}
const webCommerce = createWebCommerceSync({
  getRepository: () => services().localRepository,
  getInstallationId: () => webInstallationId,
  env: webCommerceEnv,
  isEnabled: () => !hostedPilotMode,
});
const waiterRelay = createWaiterRelay({
  config: currentWaiterConfig,
  cashSessionId: () => repository?.getWaiterCashSessionId() ?? null,
  process: async (request) => {
    const release = operationGate.enterOperation();
    try {
      if (repository?.isInitialAdminPinSetupRequired()) throw new WaiterRequestError("pos_unavailable", "Configurá el PIN inicial del administrador antes de operar.");
      if (!(await licensing?.getStatus())?.canOperate) throw new WaiterRequestError("pos_unavailable","La caja no está operativa.");
      const result = handleWaiterRequest(services().localRepository, request, dispatchWaiterPrint);
      if (request.method === "waiter.submitBatch" && result && typeof result === "object" && "status" in result) {
        if (result.status === "PENDING_REVIEW")
          mainWindow?.webContents.send("gastronomy:waiterOrderChanged", "Hay un pedido de mozo para revisar en Salón → Mozos. Todavía no se envió a cocina.");
        else if (result.status === "RECORDED" && "created" in result && result.created)
          notifyWaiterChange();
      }
      return result;
    } finally { release(); }
  },
});
let waiterTimer: ReturnType<typeof setInterval> | undefined;
let webSyncTimer: ReturnType<typeof setInterval> | undefined;
let webSiteTimer: ReturnType<typeof setInterval> | undefined;
let webSite: WebSiteProvisioning | null = null;

// Scheduled work uses the same admission gate and license as an IPC write.
// An unconfigured installation does not start network or database work.
async function pollWebCommerce() {
  if (!webCommerce.getStoreId() || !repository || !licensing || repository.isInitialAdminPinSetupRequired()) return;
  let release: (() => void) | undefined;
  try {
    release = operationGate.enterOperation();
    if ((await licensing.getStatus()).canOperate && repository)
      await webCommerce.run();
  } catch { /* restore/install/quit may temporarily close the gate */ }
  finally { release?.(); }
}
function catalogChanged() {
  webCommerce.invalidate();
  void pollWebCommerce();
}
let updater: DesktopUpdater | null = null;
let updateTimer: ReturnType<typeof setInterval> | null = null;
let updateStartupTimer: ReturnType<typeof setTimeout> | null = null;
let updateQuitRequested = false;
let printDiagnostics: PrintDiagnostics | undefined;
const posAiPinFailures = new Map<string, { count: number; blockedUntil: number }>();
function printTiming() {
  printDiagnostics ??= createPrintDiagnostics(join(app.getPath("userData"), "diagnostics"));
  return printDiagnostics.start();
}
nativeUpdater.on("before-quit-for-update", () => { updateQuitRequested = true; });
async function pollLicensing() {
  if (!licensing || licensingPollInFlight) return;
  let release: (() => void) | undefined;
  try { release = operationGate.enterOperation(); } catch { return; }
  licensingPollInFlight = true;
  try { await licensing.refresh(); } catch { /* retain the last locally verified lease */ }
  finally { licensingPollInFlight = false; release(); }
}
async function pollWebSiteProvisioning() {
  if (!licensing || !webSite || repository?.isInitialAdminPinSetupRequired()) return;
  let release: (() => void) | undefined;
  try { release = operationGate.enterOperation(); await licensing.retryWebSiteProvisioning(); }
  catch { /* installer/restore admission or offline provisioning is retried later */ }
  finally { release?.(); }
}

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
      const productName = isKitchen && item.halves.length === 2
        ? "Pizza mitad y mitad"
        : item.productNameSnapshot;
      const halves = item.halves.length
        ? `<div class="detail halves">½ ${escapeHtml(item.halves[0]?.nameSnapshot)} · ½ ${escapeHtml(item.halves[1]?.nameSnapshot)}</div>`
        : "";
      const combo = comboComponentsHtml(item.comboComponents);
      const notes =
        isKitchen && item.notes
          ? `<div class="order-note item-obs"><strong>OBS:</strong> ${lineBreaks(item.notes)}</div>`
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
      return `<div class="item"><div class="item-main"><span class="product">${quantity}<strong>${escapeHtml(productName)}</strong>${unitPrice}</span>${price}</div>${halves}${combo}${modifiers ? `<div class="detail">${modifiers}</div>` : ""}${notes}</div>`;
    })
    .join("");
  const showBreakdown =
    order.discountMinor > 0 ||
    order.deliveryFeeMinor > 0 ||
    order.depositMinor > 0;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page{size:${paperMm}mm auto;margin:${marginMm}mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;width:${contentMm}mm;margin:0;color:#000;font-size:${fontSizePx}px;line-height:1.16;overflow-wrap:anywhere}h1,h2,p{margin:0}.center{text-align:center}.title{font-size:18px;line-height:1.05;font-weight:900}.subtitle{font-size:11px;margin-top:1px}.meta{border-top:1px solid #000;border-bottom:1px solid #000;margin:3px 0;padding:2px 0}.meta-line,.row,.item-main,.columns{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:5px;align-items:baseline}.meta-line+.meta-line{margin-top:1px}.columns{font-size:10px;text-transform:uppercase;border-bottom:1px dashed #000;padding:1px 0}.item{padding:2px 0;border-bottom:1px dotted #999}.product{display:flex;min-width:0;gap:3px;align-items:baseline;font-size:calc(${fontSizePx}px + 2pt);font-weight:700;text-transform:uppercase;line-height:1.18}.quantity{flex:0 0 auto;min-width:26px}.amount{white-space:nowrap;font-variant-numeric:tabular-nums;font-size:calc(${fontSizePx}px + 2pt);font-weight:700}.unit-price{font-size:9px;font-weight:400;white-space:nowrap;text-transform:none}.detail{padding-left:26px;font-size:10px;line-height:1.15}.halves{font-size:calc(${fontSizePx}px + 2pt);font-weight:700;text-transform:uppercase;line-height:1.18}.modifier{display:block;font-weight:700;text-transform:uppercase}.info{font-size:11px;padding:2px 0;border-bottom:1px dashed #000}.promised{font-size:15px;font-weight:900;text-align:center;padding:2px 0;border-bottom:1px dashed #000}.scheduled-badge{display:flex;flex-direction:column;align-items:center;text-align:center;border:3px solid #000;background:#fff;color:#000;margin:4px 0;padding:4px 2px;line-height:1.08}.scheduled-heading{font-size:15px;font-weight:900;letter-spacing:.3px}.scheduled-delivery{font-size:11px;font-weight:900;margin-top:2px}.scheduled-datetime{display:flex;flex-wrap:wrap;justify-content:center;align-items:baseline;gap:4px 8px;margin-top:3px;font-variant-numeric:tabular-nums}.scheduled-date{font-size:19px;font-weight:900}.scheduled-time{font-size:25px;font-weight:900}.totals{margin-top:3px}.row{margin:1px 0}.total{border-top:3px double #000;margin-top:2px;padding-top:2px;font-size:19px;font-weight:900}.payments{border-top:1px dashed #000;margin-top:3px;padding-top:2px;font-size:11px}.order-note{font-size:calc(${fontSizePx}px + 2pt);font-weight:700;text-transform:uppercase;padding-top:2px;line-height:1.18}.item-obs{padding-left:14px;margin-top:1px}.footer{border-top:1px dashed #000;margin-top:4px;padding-top:3px;text-align:center;font-size:11px}.reprint{font-weight:900;border:1px solid #000;padding:1px 4px}
  </style></head><body><header class="center"><h1 class="title">${escapeHtml(isKitchen ? template.kitchenHeader || "COMANDA" : template.title || settings.businessName)}</h1>${!isKitchen && template.subtitle ? `<p class="subtitle">${escapeHtml(template.subtitle)}</p>` : ""}</header><section class="meta"><div class="meta-line">${isKitchen || template.showDate ? `<strong>${dateLabel} · ${timeLabel}</strong>` : "<span></span>"}${template.showOrderNumber || isKitchen ? `<strong>PEDIDO #${order.number}</strong>` : ""}</div><div class="meta-line">${template.showTable || isKitchen ? `<strong>${escapeHtml(typeLabel)}</strong>` : "<span></span>"}${template.showWaiter && order.waiterName ? `<span>Mozo: <strong>${escapeHtml(order.waiterName)}</strong></span>` : `<span>${escapeHtml(settings.printing.terminalLabel)}</span>`}</div>${isKitchen && order.kitchenPrintScope === "ADDED" ? `<div class="center"><span class="reprint">AGREGADO</span></div>` : order.printCount > 0 ? `<div class="center"><span class="reprint">REIMPRESIÓN</span></div>` : ""}</section>
  ${scheduledOrderBadge(order)}
  ${template.showCustomer && (order.customerNameSnapshot || order.customerPhoneSnapshot || order.deliveryAddressSnapshot) ? `<section class="info">${order.customerNameSnapshot ? `<strong>${escapeHtml(order.customerNameSnapshot)}</strong>` : ""}${order.customerPhoneSnapshot ? ` · ${escapeHtml(order.customerPhoneSnapshot)}` : ""}${order.deliveryAddressSnapshot ? `<br>${escapeHtml(order.deliveryAddressSnapshot)}` : ""}</section>` : ""}
  ${isKitchen && order.type === "DELIVERY" && order.deliveryAddressNotesSnapshot ? `<p class="order-note"><strong>Referencia:</strong> ${escapeHtml(order.deliveryAddressNotesSnapshot)}</p>` : ""}
  <div class="columns"><strong>Cant. · Producto</strong>${isKitchen || !template.showItemTotal ? "" : "<strong>Total</strong>"}</div>${itemRows}
  ${order.notes ? `<p class="order-note"><strong>OBS:</strong> ${lineBreaks(order.notes)}</p>` : ""}
  ${isKitchen ? "" : `<section class="totals">${showBreakdown ? `<div class="row"><span>Subtotal</span><strong>${escapeHtml(formatMoney(order.subtotalMinor))}</strong></div>` : ""}${order.discountMinor ? `<div class="row"><span>Descuento</span><strong>-${escapeHtml(formatMoney(order.discountMinor))}</strong></div>` : ""}${order.depositMinor ? `<div class="row"><span>Seña</span><strong>-${escapeHtml(formatMoney(order.depositMinor))}</strong></div>` : ""}${order.deliveryFeeMinor ? `<div class="row"><span>Delivery</span><strong>${escapeHtml(formatMoney(order.deliveryFeeMinor))}</strong></div>` : ""}<div class="row total"><span>TOTAL</span><span>${escapeHtml(formatMoney(order.totalMinor))}</span></div></section>`}
  ${
    !isKitchen && template.showPaymentSummary && order.payments.length
      ? `<section class="payments">${order.payments
          .filter((payment) => payment.refundableMinor > 0)
          .map(
            (payment) =>
              `<div class="row"><span>${escapeHtml(payment.methodName)}</span><span>${escapeHtml(formatMoney(payment.refundableMinor))}</span></div>`,
          )
          .join("")}${
          order.changeAmountMinor && order.changeAmountMinor > 0
            ? `<div class="row"><span>Vuelto (${escapeHtml(order.changeMethodName || "Efectivo")})</span><span>${escapeHtml(formatMoney(order.changeAmountMinor))}</span></div>`
            : ""
        }</section>`
      : ""
  }
  ${(isKitchen && template.kitchenFooter) || (!isKitchen && (template.footer || template.nonFiscalLegend)) ? `<footer class="footer">${isKitchen && template.kitchenFooter ? lineBreaks(template.kitchenFooter) : ""}${!isKitchen && template.footer ? `<strong>${lineBreaks(template.footer)}</strong>` : ""}${!isKitchen && template.nonFiscalLegend ? `<br>${lineBreaks(template.nonFiscalLegend)}` : ""}</footer>` : ""}<div aria-hidden="true" style="height:${feedHeightMm}mm"></div></body></html>`;
}

async function printOrder(
  order: OrderDto,
  kind: "KITCHEN_ORDER" | "CUSTOMER_BILL",
  settings: AppSettingsDto,
  requireExplicitDevice = false,
) {
  const profile =
    kind === "KITCHEN_ORDER"
      ? settings.printing.kitchen
      : settings.printing.bill;
  if (requireExplicitDevice && (profile.mode !== "SYSTEM_DIRECT" || !profile.deviceName.trim())) throw new Error("Seleccioná impresión directa y el comandero de cocina en Configuración.");
  return printHtml(orderTicketHtml(order, kind, settings), profile, {
    requireExplicitDevice,
    parent: mainWindow,
    onTiming: printTiming(),
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
    depositMinor: 0,
    depositNotes: null,
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

const activePrints = new Set<string>();
function notifyWaiterChange(notice?:string) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("gastronomy:waiterOrderChanged", notice);
}
function dispatchWaiterPrint(jobId:string) {
  // The saved SQLite receipt is authoritative. Printing runs separately; a timeout never resubmits a sale.
  const number=services().localRepository.getPrintOrder(jobId).number;
  const release=operationGate.enterOperation();
  void executePrintJob(jobId,"KITCHEN_ORDER").then(()=>notifyWaiterChange(),()=>{
    notifyWaiterChange("Pedido #" + number + " guardado desde Modo Mozo. Revisá el comandero y, si no salió, reintentá desde el pedido.");
  }).finally(release);
  notifyWaiterChange();
}
async function executePrintJob(
  jobId: string,
  kind: "KITCHEN_ORDER" | "CUSTOMER_BILL",
) {
  const { localRepository } = services();
  const order = localRepository.getPrintOrder(jobId);
  if (activePrints.has(jobId)) throw new Error("La comanda se está imprimiendo.");
  activePrints.add(jobId);
  try {
    const outcome = await printOrder(
      order,
      kind,
      localRepository.getSettings(),
      localRepository.isWaiterPrintJob(jobId),
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
  } finally { activePrints.delete(jobId); }
}

function registerIpcHandlers() {
  const pinSetupAllowedChannels = new Set([
    "gastronomy:isInitialAdminPinSetupRequired", "gastronomy:setInitialAdminPin",
    "gastronomy:getLicenseStatus", "gastronomy:signInLicenseAccount",
    "gastronomy:requestLicenseAccess", "gastronomy:activateLicense", "gastronomy:refreshLicense",
  ]);
  // Licensing IPC is admitted too: no state persistence can race the installer.
  const handleOperation: typeof ipcMain.handle = (channel, listener) => {
    ipcMain.handle(channel, async (...args) => {
      const release = operationGate.enterOperation();
      try {
        if (!pinSetupAllowedChannels.has(String(channel)) && services().localRepository.isInitialAdminPinSetupRequired())
          throw new Error("Configurá el PIN inicial del administrador antes de continuar.");
        return await listener(...args);
      } finally { release(); }
    });
  };
  const handleData: typeof ipcMain.handle = (channel, listener) => {
    handleOperation(channel, async (...args) => {
      const method = String(channel).slice("gastronomy:".length);
      const status = await licensing!.getStatus();
      if (!licenseAllowsMethod(method, status.canOperate))
        throw new Error(status.message);
      return listener(...args);
    });
  };
  handleOperation("gastronomy:isInitialAdminPinSetupRequired", () =>
    services().localRepository.isInitialAdminPinSetupRequired());
  handleOperation("gastronomy:setInitialAdminPin", (_event, input: { currentPin: string; newPin: string }) =>
    services().localRepository.setInitialAdminPin(input));
  type ForwardedDesktopMethod = Exclude<
    keyof DesktopApi,
    | keyof WaiterDeskApi
    | keyof WebCommerceApi
    | "printOrder"
    | "printCashSessionReport"
    | "retryPrint"
    | "exportSalesCsv"
    | "createBackup"
    | "restoreBackup"
    | "listPrinters"
    | "testPrinter"
    | "getLicenseStatus"
    | "signInLicenseAccount"
    | "activateLicense"
    | "requestLicenseAccess"
    | "refreshLicense"
    | "getAppUpdateStatus"
    | "checkAppUpdate"
    | "installAppUpdate"
    | "askPosAssistantAi"
    | "isInitialAdminPinSetupRequired"
    | "setInitialAdminPin"
  >;
  const completeMethodList = <T extends readonly ForwardedDesktopMethod[]>(
    methods: T &
      (Exclude<ForwardedDesktopMethod, T[number]> extends never
        ? unknown
        : { missing: Exclude<ForwardedDesktopMethod, T[number]> }),
  ) => methods;
  const methods = completeMethodList([
    "repeatOrder",
    "addComboItem",
    "configureProductCombo",
    "createCombo",
    "cancelPurchase",
    "correctPurchaseItemProduct",
    "bootstrap",
    "getOrder",
    "ensureTable",
    "openCashSession",
    "registerCashMovement",
    "closeCashSession",
    "listCashSessionHistory",
    "getCashSessionReport",
    "markOrderServed",
    "createOrder",
    "updateDraftOrder",
    "confirmOrder",
    "discardDraftOrder",
    "addOrderItem",
    "updateOrderItemQuantity",
    "addHalfAndHalfItem",
    "updateOrderItemNotes",
    "removeOrderItem",
    "addOrderItemModifier",
    "removeOrderItemModifier",
    "applyOrderDiscount",
    "applyOrderDeposit",
    "updateOrderStatus",
    "assignDeliveryDriver",
    "payOrder",
    "refundPayment",
    "completeOrder",
    "cancelOrder",
    "changeOrderTable",
    "searchCustomers",
    "searchCustomersPage",
    "getCustomerProfile",
    "settleCustomerAccount",
    "createCustomer",
    "updateCustomer",
    "setCustomerActive",
    "mergeCustomers",
    "createCategory",
    "updateCategory",
    "deleteCategory",
    "getPriceBooks", "savePriceBook", "assignPriceBooks",
    "createProduct",
    "updateProduct",
    "deleteProduct",
    "bulkUpdateProducts",
    "createModifier",
    "listPurchases",
    "createPurchase",
    "correctPurchaseMetadata",
    "correctPurchaseItemQuantity",
    "correctPurchaseItemCost",
    "getFinanceReport",
    "getFinanceProductCosts",
    "listIngredients",
    "saveIngredient",
    "getProductCostConfiguration",
    "setProductCostConfiguration",
    "createFinanceExpense",
    "payFinanceExpense",
    "correctFinanceExpense",
    "cancelFinanceExpense",
    "unmarkFinanceExpensePayment",
    "correctFinanceExpenseCashPayment",
    "correctFinanceExpenseClosedCashPayment",
    "correctFinanceMonthlyExpense",
    "cancelFinanceMonthlyExpense",
    "receiveFinanceExpenseReturn",
    "createFinanceRecurring",
    "stopFinanceRecurring",
    "setFinanceProductCost",
    "adjustStock",
    "createUser",
    "createDriver",
    "updateUser",
    "deleteUser",
    "settleDelivery",
    "reverseCashMovement",
    "reverseDeliverySettlement",
    "configureTables",
    "createTableSector",
    "updateTableSector",
    "deleteTableSector",
    "createFloorPlanShape",
    "updateFloorPlanShape",
    "deleteFloorPlanShape",
    "updateTable",
    "deleteTable",
    "saveSettings",
    "getDashboard",
    "getDetailedReport",
    "getAuditLog",
  ] as const);
  // Updates remain available with an expired license (e.g. to recover a licensing bug).
  ipcMain.handle("gastronomy:getAppUpdateStatus", () => updater!.getStatus());
  handleOperation("gastronomy:checkAppUpdate", () => {
    if (!services().appService.bootstrap().currentUser.permissions.includes("settings.manage"))
      throw new Error("No tenés permiso para buscar actualizaciones.");
    return updater!.check();
  });
  // Installation acquires the exclusive gate itself, not an ordinary operation slot.
  ipcMain.handle("gastronomy:installAppUpdate", () => {
    if (updater!.getStatus().state !== "READY")
      throw new Error("No hay una actualización lista para instalar.");
    operationGate.beginInstall(() => {
      if (services().localRepository.isInitialAdminPinSetupRequired())
        throw new Error("Configurá el PIN inicial del administrador antes de continuar.");
      const state = services().appService.bootstrap();
      return {
        permitted: state.currentUser.permissions.includes("settings.manage"),
        cashOpen: state.cashSession?.status === "OPEN",
      };
    });
    try {
      const status = updater!.install();
      if (status.state !== "INSTALLING") operationGate.cancelInstall();
      return status;
    } catch (error) {
      operationGate.cancelInstall();
      throw error;
    }
  });
  handleOperation("gastronomy:getLicenseStatus", () => licensing!.getStatus());
  handleOperation(
    "gastronomy:askPosAssistantAi",
    async (
      _event,
      input: {
        requestId?: unknown;
        text?: unknown;
        staffNumber?: unknown;
        pin?: unknown;
      },
    ) => {
    const invalid = { ok: false as const, code: "invalid" as const };
      const allowedKeys = ["pin", "requestId", "staffNumber", "text"];
      if (
        !input ||
        Object.keys(input).sort().join(",") !== allowedKeys.join(",") ||
        typeof input.requestId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId) ||
        typeof input.text !== "string" ||
        !input.text.trim() ||
        input.text.trim().length > 500 ||
        !Number.isSafeInteger(input.staffNumber) ||
        (input.staffNumber as number) <= 0 ||
        typeof input.pin !== "string" ||
        !/^\d{4,8}$/.test(input.pin)
      ) return invalid;

      const status = await licensing!.getStatus();
      if (!status.canOperate || !licensing!.hasEnrollmentIdentity())
        return { ok: false as const, code: "unavailable" as const };
      const installKey = status.installationId;
      const attempt = posAiPinFailures.get(installKey) ?? {
        count: 0,
        blockedUntil: 0,
      };
      if (Date.now() < attempt.blockedUntil) {
        return {
          ok: false as const,
          code: "cooldown" as const,
          retryAfter: Math.ceil((attempt.blockedUntil - Date.now()) / 1000),
        };
      }
      const operator = services().localRepository.verifyPosAiOperator(
        input.staffNumber as number,
        input.pin,
      );
      if (!operator) {
        attempt.count += 1;
        if (attempt.count >= 5) {
          attempt.count = 0;
          attempt.blockedUntil = Date.now() + 60_000;
        }
        posAiPinFailures.set(installKey, attempt);
        return { ok: false as const, code: "unauthorized" as const };
      }
      posAiPinFailures.delete(installKey);
      // PIN and staff number are intentionally discarded before any network request.
      let response;
      try {
        response = await licensing!.askPosAssistantAi({
          actorId: operator.id,
          requestId: input.requestId,
          prompt: input.text.trim(),
        });
      } catch {
        return { ok: false as const, code: "unavailable" as const };
      }
      if (!response.ok || response.questionId === null) return response;
      const intent = POS_AI_INTENTS.find(
        (entry) => entry.id === response.questionId,
      );
      if (
        !intent ||
        ("permission" in intent &&
          !operator.permissions.includes("*") &&
          !operator.permissions.includes(intent.permission))
      ) {
        return {
          ok: false as const,
          code: "unauthorized" as const,
          remaining: response.remaining,
        };
      }
      return response;
    },
  );
  handleOperation("gastronomy:signInLicenseAccount", (_event, input: { email?: unknown; password?: unknown }) => {
    if (typeof input?.email !== "string" || input.email.length > 254 || typeof input.password !== "string" || input.password.length > 128)
      throw new Error("Ingresá el correo y la contraseña de tu cuenta.");
    return licensing!.signInAccount({ email: input.email, password: input.password });
  });
  handleOperation(
    "gastronomy:activateLicense",
    (_event, input: { code?: unknown }) => {
      if (
        typeof input?.code !== "string" ||
        input.code.length < 1 ||
        input.code.length > 256
      )
        throw new Error("Ingresá un código de licencia válido.");
      return licensing!.activate(input.code.trim());
    },
  );
  handleOperation("gastronomy:refreshLicense", () => licensing!.refresh());
  handleOperation("gastronomy:requestLicenseAccess", (_event, input: { businessName?: unknown; webSite?: { slug?: unknown; whatsappNumber?: unknown } }) => {
    if (typeof input?.businessName !== "string" || input.businessName.trim().length < 2 || input.businessName.trim().length > 120) throw new Error("Ingresá el nombre del negocio.");
    const businessName = input.businessName.trim();
    const signup = input.webSite;
    const web = signup && typeof signup.slug === "string" && typeof signup.whatsappNumber === "string" ? { slug: signup.slug, whatsappNumber: signup.whatsappNumber } : undefined;
    return (async () => {
      if (web && (await licensing!.getStatus()).canOperate && !services().appService.bootstrap().currentUser.permissions.includes("settings.manage")) throw new Error("No tenés permiso para configurar la tienda web.");
      return licensing!.requestLicenseAccess({ businessName, ...(web ? { webSite: web } : {}) });
    })();
  });
  handleOperation("gastronomy:getWebSiteStatus", async () => {
    const website = await webSite!.getStatus();
    const license = await licensing!.getStatus();
    if (license.canOperate && !licensing!.hasEnrollmentIdentity() && website.state !== "ACTIVE") return { ...website, state: "NOT_REGISTERED" as const, message: "Para habilitar la tienda, andá a Configuración → Licencia → Solicitar habilitación y esperá la aprobación sobre tu licencia existente." };
    return website;
  });
  handleOperation("gastronomy:shareWebSite", async (_event, action: WebSiteShareAction) => {
    if (!services().appService.bootstrap().currentUser.permissions.includes("settings.manage")) throw new Error("No tenés permiso para compartir la tienda web.");
    return performWebSiteShare(action, {
      // Sharing an already-provisioned public URL needs no online request.
      getStatus: () => webSite!.status(),
      openExternal: async (url) => { await shell.openExternal(url); },
      writeClipboard: (text) => clipboard.writeText(text),
      showSaveDialog: async () => {
        const result = await dialog.showSaveDialog({ title: "Descargar código QR", defaultPath: "carta-web.png", buttonLabel: "Guardar QR", filters: [{ name: "Imagen PNG", extensions: ["png"] }] });
        return { canceled: result.canceled, filePath: result.filePath };
      },
      toBuffer: (url) => QRCode.toBuffer(url, { type: "png", errorCorrectionLevel: "H", margin: 4, scale: 12 }),
    });
  });
  handleOperation("gastronomy:registerWebSite", async (_event, input: { slug?: unknown; whatsappNumber?: unknown }) => {
    const status = await licensing!.getStatus();
    if (!status.canOperate) throw new Error(status.message);
    if (!services().appService.bootstrap().currentUser.permissions.includes("settings.manage")) throw new Error("No tenés permiso para configurar la tienda web.");
    if (typeof input?.slug !== "string" || typeof input?.whatsappNumber !== "string") throw new Error("Completá el enlace y WhatsApp de la tienda.");
    return licensing!.registerWebSite({ slug: input.slug, whatsappNumber: input.whatsappNumber });
  });
  handleOperation("gastronomy:updateWebSiteBranding", async (_event, input: { displayName?: unknown; tagline?: unknown; accent?: unknown }) => {
    const status = await licensing!.getStatus();
    if (!status.canOperate) throw new Error(status.message);
    const state = services().appService.bootstrap();
    if (!state.currentUser.permissions.includes("settings.manage")) throw new Error("No tenés permiso para editar la tienda web.");
    if (typeof input?.displayName !== "string" || typeof input?.tagline !== "string" || typeof input?.accent !== "string") throw new Error("Completá los datos de identidad de la tienda.");
    return webSite!.updateBranding({ displayName: input.displayName, tagline: input.tagline, accent: input.accent });
  });
  const requireWebStore = () => {
    const storeId = webCommerce.getStoreId();
    if (!storeId) throw new Error("Configurá la conexión del comercio web primero.");
    return storeId;
  };
  handleData("gastronomy:getWebSyncStatus", () => webCommerce.status());
  handleData("gastronomy:retryWebSync", () => webCommerce.run(true));
  handleData("gastronomy:setWebPublication", (_event, input) => {
    services().localRepository.setWebPublication(input);
    catalogChanged();
  });
  handleData("gastronomy:listWebOrders", () => {
    const storeId = webCommerce.getStoreId();
    return storeId ? services().localRepository.listWebOrders(storeId) : [];
  });
  for (const method of ["saveWebOrderDraft", "rejectWebOrder", "confirmWebOrder"] as const) {
    handleData(`gastronomy:${method}`, (_event, input) =>
      services().localRepository[method](requireWebStore(), input));
  }
  handleData("gastronomy:listDelayedWaiterBatches", () => services().localRepository.listDelayedWaiterBatches());
  const checkBatchId = (input: { requestId?: unknown }) => {
    if (!input || typeof input.requestId !== "string" || !/^[\w-]{16,128}$/.test(input.requestId))
      throw new Error("Seleccioná una tanda válida.");
    return { requestId: input.requestId };
  };
  handleData("gastronomy:confirmDelayedWaiterBatch", (_event, input) => {
    const result = services().localRepository.confirmDelayedWaiterBatch(checkBatchId(input));
    if (result.created && result.printJobId) dispatchWaiterPrint(result.printJobId);
    mainWindow?.webContents.send("gastronomy:waiterOrderChanged");
    return result;
  });
  handleData("gastronomy:rejectDelayedWaiterBatch", (_event, input) => {
    services().localRepository.rejectDelayedWaiterBatch(checkBatchId(input));
    mainWindow?.webContents.send("gastronomy:waiterOrderChanged");
  });
  handleData("gastronomy:getWaiterDeskStatus",()=>{
    const repo=services().localRepository;
    const kitchen=repo.getSettings().printing.kitchen;
    return {configured:waiterRelay.configured(), automaticEnrollment:!!waiterProvisioning && !!licensing?.waiterIdentity(), printerReady:kitchen.mode==="SYSTEM_DIRECT" && !!kitchen.deviceName.trim(), sessions:repo.listWaiterDevices(),connectionError:waiterRelay.connectionError()};
  });
  handleData("gastronomy:issueWaiterQr",async(_event,input:{waiterId:string})=>{
    const repo=services().localRepository;
    const settings=repo.getSettings();
    if (!settings.modules.diningRoom) throw new Error("Activá el módulo Salón.");
    if (!input || typeof input.waiterId!=="string" || input.waiterId.length>128) throw new Error("Elegí un mozo activo.");
    const challenge=repo.createWaiterChallenge(input.waiterId);
    const invite=await waiterRelay.invite(challenge.challengeId);
    const expiresAt=new Date(Math.min(Date.parse(invite.expiresAt),Date.parse(challenge.expiresAt))).toISOString();
    return {image:await QRCode.toDataURL(invite.url,{errorCorrectionLevel:"M",margin:4,width:320}), expiresAt};
  });
  handleData("gastronomy:revokeWaiterDevice",(_event,input:{sessionId:string})=>{
    if (!input || typeof input.sessionId!=="string" || input.sessionId.length>128) throw new Error("Elegí una sesión.");
    services().localRepository.revokeWaiterDevice(input.sessionId);
  });
  const catalogWrites = new Set<string>([
    "savePriceBook", "assignPriceBooks", "createProduct", "updateProduct", "deleteProduct", "bulkUpdateProducts",
    "updateCategory", "deleteCategory", "configureProductCombo", "adjustStock",
  ]);
  for (const method of methods) {
    handleData(`gastronomy:${method}`, async (_event, payload) => {
      const { appService } = services();
      const target = appService[method] as (input?: any) => unknown;
      const idempotentMethods = [
        "repeatOrder",
        "addComboItem",
        "configureProductCombo",
        "createCombo",
        "cancelPurchase",
        "correctPurchaseItemProduct",
        "payOrder",
        "markOrderServed",
        "createOrder",
        "registerCashMovement",
        "refundPayment",
        "closeCashSession",
        "settleDelivery",
        "cancelOrder",
        "changeOrderTable",
        "reverseCashMovement",
        "reverseDeliverySettlement",
        "createPurchase",
        "correctPurchaseMetadata",
        "correctPurchaseItemQuantity",
        "correctPurchaseItemCost",
        "correctFinanceExpense",
        "cancelFinanceExpense",
        "unmarkFinanceExpensePayment",
        "correctFinanceExpenseCashPayment",
        "correctFinanceExpenseClosedCashPayment",
        "correctFinanceMonthlyExpense",
        "cancelFinanceMonthlyExpense",
        "receiveFinanceExpenseReturn",
      ];
      if (
        idempotentMethods.includes(method) &&
        typeof payload === "object" &&
        payload !== null
      ) {
        payload.terminalId = require("node:os").hostname();
      }
      const result = await target.call(appService, payload);
      if (catalogWrites.has(method)) catalogChanged();
      return result;
    });
  }
  handleData(
    "gastronomy:printOrder",
    async (
      _event,
      payload: Parameters<DesktopApi["printOrder"]>[0],
    ) => {
      const { appService } = services();
      const job = appService.queuePrint(payload);
      return executePrintJob(job.jobId, payload.kind);
    },
  );
  handleData(
    "gastronomy:printCashSessionReport",
    async (
      _event,
      payload: {
        filters: CashSessionReportFilters;
        sections?: CashSessionReportPrintSections;
      },
    ) => {
      const { appService } = services();
      const report = appService.getCashSessionReport(payload.filters);
      const outcome = await printHtml(
        cashSessionReportHtml(
          report,
          appService.bootstrap().settings,
          payload.sections,
        ),
        appService.bootstrap().settings.printing.bill,
        { parent: mainWindow, skipPreview: true },
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
  handleData("gastronomy:listPrinters", async () => {
    if (!mainWindow)
      throw new Error("La ventana principal no está disponible.");
    const printers = await mainWindow.webContents.getPrintersAsync();
    return printers.map((printer) => ({
      name: printer.name,
      displayName: printer.displayName || printer.name,
      isDefault: Boolean((printer as { isDefault?: boolean }).isDefault),
    }));
  });
  handleData(
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
            ? "Prueba enviada al sistema de impresión. Verificá el papel en la impresora elegida."
            : "Impresión cancelada. No se imprimió nada.",
      };
    },
  );
  handleData(
    "gastronomy:retryPrint",
    async (_event, payload: { jobId: string }) => {
      const { appService } = services();
      if (activePrints.has(payload.jobId)) throw new Error("La comanda se está imprimiendo.");
      const job = appService.preparePrintRetry(payload);
      return executePrintJob(job.jobId, job.kind);
    },
  );
  handleData(
    "gastronomy:exportSalesCsv",
    async (_event, filters?: import("@gastronomy/contracts").ReportFilters) => {
      const { appService } = services();
      const result = await dialog.showSaveDialog(mainWindow!, {
        title: "Exportar ventas",
        defaultPath: `ventas-${new Date().toISOString().slice(0, 10)}.csv`,
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });
      if (result.canceled || !result.filePath) return { path: null };
      await writeFile(
        result.filePath,
        `\uFEFF${appService.exportSalesCsv(filters)}`,
        "utf8",
      );
      return { path: result.filePath };
    },
  );
  handleData("gastronomy:createBackup", async () => {
    const { localRepository } = services();
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: "Crear copia de seguridad",
      defaultPath: `gastronomia-backup-${new Date().toISOString().replaceAll(":", "-").slice(0, 19)}.sqlite`,
      filters: [{ name: "Copia de seguridad", extensions: ["sqlite"] }],
    });
    if (result.canceled || !result.filePath) return { path: null };
    const normalizedPath = (path: string) =>
      process.platform === "win32"
        ? resolve(path).toLowerCase()
        : resolve(path);
    if (
      [databasePath, `${databasePath}-wal`, `${databasePath}-shm`].some(
        (path) => normalizedPath(path) === normalizedPath(result.filePath!),
      )
    )
      throw new Error(
        "Elegí otro archivo: no se puede usar la base en uso como destino de la copia.",
      );
    await createValidatedBackup(result.filePath, {
      backupTo: (path) => localRepository.backupTo(path),
      validate: (path) => SqliteGastronomyRepository.validateDatabase(path),
    });
    return { path: result.filePath };
  });
  ipcMain.handle("gastronomy:restoreBackup", async (_event, pin: string) => {
    operationGate.beginRestore();
    try {
      const { localRepository } = services();
      // Validate only after acquiring the restore gate and before showing the
      // picker, so neither a concurrent cash-open nor an unauthorized chooser
      // can race into a database replacement.
      localRepository.authorizeBackupRestore(pin);
      const selection = await dialog.showOpenDialog(mainWindow!, {
        title: "Restaurar copia de seguridad",
        properties: ["openFile"],
        filters: [{ name: "Copia de seguridad", extensions: ["sqlite", "db"] }],
      });
      const source = selection.filePaths[0];
      if (selection.canceled || !source) return { path: null, restored: false };
      const result = await restoreValidatedCopy({
        source,
        databasePath,
        backupTo: (path) => localRepository.backupTo(path),
        validate: (path) => SqliteGastronomyRepository.validateDatabase(path),
        confirm: async ({ fileName, modifiedAt }) => {
          const choice = await dialog.showMessageBox(mainWindow!, {
            type: "warning",
            title: "Restaurar copia de seguridad",
            message: "¿Restaurar esta copia?",
            detail: `Archivo: ${fileName}\nÚltima modificación del archivo: ${modifiedAt.toLocaleString("es-AR")}\n\nSe reemplazará la información actual por los datos de esta copia. No se combinarán. Se guardará una copia de los datos actuales para poder recuperarlos.`,
            buttons: ["Cancelar", "Restaurar copia"],
            defaultId: 0,
            cancelId: 0,
            noLink: true,
          });
          return choice.response === 1;
        },
        close: () => {
          repository?.close();
          repository = null;
          application = null;
        },
        open: () => {
          repository = new SqliteGastronomyRepository(databasePath, {
            seedStarterCatalog: !app.isPackaged,
          });
          // A restored snapshot must never resurrect a previously revoked phone.
          repository.resetWaiterAccess();
          application = new GastronomyApplication(repository);
          waiterRelay.reset();
          waiterRelay.wake();
          webCommerce.invalidate();
        },
      });
      if (!result.restored) return { path: null, restored: false };
      // A failed acknowledgement must not report a completed restoration as failed.
      try {
        await dialog.showMessageBox(mainWindow!, {
          type: "info",
          title: "Copia restaurada",
          message: "Los datos de la copia ya están restaurados.",
          detail: `Los datos anteriores quedaron guardados en:\n${result.recoveryPath}\n\nPodés elegir ese archivo desde Restaurar copia si necesitás recuperarlos.`,
          buttons: ["Aceptar"],
          noLink: true,
        });
      } catch (error) {
        console.warn(
          "No se pudo mostrar la ubicación de la copia previa.",
          result.recoveryPath,
          error,
        );
      }
      return { path: source, restored: true };
    } finally {
      operationGate.endRestore();
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
    ...(existsSync(appIconPath) ? { icon: appIconPath } : {}),
    backgroundColor: "#F5F7FA",
    autoHideMenuBar: true,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: backgroundE2e ? false : undefined,
    },
  });
  mainWindow.once("ready-to-show", () => {
    if (!backgroundE2e) mainWindow?.show();
  });
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

app.on("activate", () => {
  if (process.platform !== "darwin" || mainWindow || !application) return;
  void createWindow().catch((error) => {
    console.error("No se pudo reabrir Delta Nube Gastronomía", error);
  });
});

app.on("before-quit", (event) => {
  // NSIS can schedule quit before an async installer-spawn error is reported.
  // Never honor that delayed update quit after its admission lock was released.
  if (updateQuitRequested && (!operationGate.installationInProgress || updater?.getStatus().state !== "INSTALLING")) {
    updateQuitRequested = false;
    event.preventDefault();
    return;
  }
  if (updateTimer) clearInterval(updateTimer);
  if (waiterTimer) clearInterval(waiterTimer);
  waiterRelay.reset();
  if (webSyncTimer) clearInterval(webSyncTimer);
  if (webSiteTimer) clearInterval(webSiteTimer);
  if (updateStartupTimer) clearTimeout(updateStartupTimer);
  updater?.dispose();
  if (licensingTimer) clearInterval(licensingTimer);
  licensingTimer = null;
  repository?.close();
  repository = null;
});

app
  .whenReady()
  .then(async () => {
    // A packaged Mac app already has its multi-resolution ICNS in the app bundle.
    if (process.platform === "darwin" && !app.isPackaged && app.dock && existsSync(appIconPath))
      app.dock.setIcon(appIconPath);
    backgroundE2e = isBackgroundTest({
      flag: process.env.GASTRONOMY_E2E_BACKGROUND,
      isPackaged: app.isPackaged,
      userDataPath: app.getPath("userData"),
      tempRoot: tmpdir(),
    });
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
    const pilotLicenseOptions = await localPilotLicenseOptions({ enabled: process.env.GASTRONOMY_LOCAL_PILOT, hostedOrigin: process.env.GASTRONOMY_HOSTED_PILOT_ORIGIN, isPackaged: app.isPackaged, userDataPath: app.getPath("userData") });
    // This is set only after localPilotLicenseOptions has validated the explicit
    // unpackaged temporary profile and matching HTTPS hosted origin.
    hostedPilotMode = !app.isPackaged && process.env.GASTRONOMY_LOCAL_PILOT === "1" && !!process.env.GASTRONOMY_HOSTED_PILOT_ORIGIN && "config" in pilotLicenseOptions && !!pilotLicenseOptions.config;
    licensing = createDesktopLicensing({
      userDataPath: app.getPath("userData"),
      isPackaged: app.isPackaged,
      configPath: resolve(__dirname, "../licensing-config.json"),
      ...pilotLicenseOptions,
    });
    await licensing.initialize();
    webSite = new WebSiteProvisioning({ userDataPath: app.getPath("userData"), baseUrl: process.env.GASTRONOMY_WEB_PROVISION_URL ?? "https://pedidos.deltanubeweb.com", env: webCommerceEnv, safeStorage: electronSafeStorage, installationId: () => webInstallationId, onConfigured: () => { webCommerce.invalidate(); void pollWebCommerce(); } });
    await webSite.initialize();
    licensing.setWebSiteProvisioner({ provision: (ticket, signup) => webSite!.provision(ticket, signup), getChoice: () => webSite!.selectedSignup(), selectChoice: (signup) => webSite!.select(signup), getStatus: () => webSite!.status() });
    webInstallationId = (await licensing.getStatus()).installationId;
    if (!hasManualConnector && !hostedPilotMode) {
      const connector = new WaiterProvisioning({
        userDataPath: app.getPath("userData"), baseUrl: waiterOrigin, safeStorage: electronSafeStorage,
        installationId: () => webInstallationId, licenseId: () => licensing?.waiterIdentity()?.licenseId,
      });
      waiterProvisioning = connector;
      await connector.initialize().catch(() => { /* optional service; the local POS remains available */ });
      licensing.setWaiterProvisioner(async (ticket, identity) => {
        if (identity.installationId !== webInstallationId || identity.licenseId !== licensing?.waiterIdentity()?.licenseId) return;
        // A previously configured shop keeps its working relay (and its paired phones).
        if (!connector.credential() && waiterRelayConfig(webCommerceEnv, webInstallationId)) return;
        await connector.provision(ticket);
      });
    }
    updater = await createUpdateRuntime({
      isPackaged: app.isPackaged,
      platform: process.platform,
      arch: process.arch,
      currentVersion: app.getVersion(),
      configPath: resolve(__dirname, "../updates-config.json"),
      resourcesPath: process.resourcesPath,
      appPath: resolve(process.execPath, "../../.."),
      onStatusChange: (status) => {
        if (status.state === "ERROR") operationGate.cancelInstall();
      },
    });
    // Preserve cash-bound access across PC restarts; report a closed cash too.
    waiterRelay.wake();
    waiterTimer = setInterval(() => { void waiterRelay.tick(); }, 1000);
    registerIpcHandlers();
    // Always run the lightweight scheduler: provisioned credentials can arrive after approval.
    webSyncTimer = setInterval(() => { void pollWebCommerce(); }, 15_000);
    void pollWebCommerce();
    webSiteTimer = setInterval(() => { void pollWebSiteProvisioning(); }, 15_000);
    if (app.isPackaged || process.env.GASTRONOMY_LOCAL_PILOT === "1") {
      void pollLicensing();
      licensingTimer = setInterval(() => { void pollLicensing(); }, 60_000);
    }
    await createWindow();
    if (updater.getStatus().state !== "DISABLED") {
      // Background failures never prevent startup, sales, printing or license checks.
      updateStartupTimer = setTimeout(() => { void updater?.check(); }, 30_000);
      updateTimer = setInterval(() => { void updater?.check(); }, 6 * 60 * 60_000);
    }
  })
  .catch((error) => {
    console.error("No se pudo iniciar Delta Nube Gastronomía", error);
    app.quit();
  });
