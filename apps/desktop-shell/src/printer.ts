import { join } from "node:path";
import { BrowserWindow, ipcMain } from "electron";
import type { PrinterProfileDto } from "@gastronomy/contracts";

type PrinterInfo = { name: string; isDefault?: boolean };
type PrintOptions = {
  getPrinters?: () => Promise<PrinterInfo[]>;
  parent?: BrowserWindow | null;
};

export type PrintOutcome = "PRINTED" | "SKIPPED";

const previewWindows = new Set<BrowserWindow>();
const previewPreload = join(__dirname, "print-preview-preload.js");
function printSettings(profile: PrinterProfileDto, height = 297_000) {
  return {
    copies: Math.max(1, profile.copies || 1),
    printBackground: false,
    pageSize: {
      // An 80 mm roll has a 72 mm printable area on common thermal drivers
      // (including LR2000). Asking Chromium for an unsupported 80 mm imageable
      // area can make silent printing fail before the job reaches Windows.
      width: profile.paperWidth === "58mm" ? 58_000 : 72_000,
      height,
    },
  };
}

async function contentHeightMicrons(contents: Electron.WebContents) {
  const heightPx = Number(
    await contents.executeJavaScript(`(() => {
      const ticket = document.querySelector("#print-preview-ticket") ?? document.body;
      return Math.ceil(ticket.getBoundingClientRect().height);
    })()`),
  );
  const measured = Math.ceil((heightPx * 25_400) / 96) + 4_000;
  return Math.max(40_000, Math.min(500_000, measured));
}

export function resolvePrinterTarget(
  profile: PrinterProfileDto,
  printers: PrinterInfo[],
) {
  if (profile.deviceName) {
    const printer = printers.find((item) => item.name === profile.deviceName);
    return printer ? printer.name : null;
  }
  return printers.find((item) => item.isDefault === true)?.name ?? null;
}

function escapeText(value: string) {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ] ?? char,
  );
}

function previewDocument(
  ticket: string,
  profile: PrinterProfileDto,
  initialMessage = "",
) {
  const contentMm = (profile.paperWidth === "58mm" ? 58 : 80) - 8;
  const controls = `<style>@media screen{body{width:auto!important;margin:0!important}#print-preview-ticket{width:min(calc(100% - 32px),${contentMm}mm);margin:16px auto}}@media print{#print-preview-controls{display:none!important}#print-preview-ticket{display:contents}}</style><section id="print-preview-controls" style="position:sticky;top:0;z-index:9999;display:flex;gap:8px;align-items:center;padding:10px;background:#f3f4f6;border-bottom:1px solid #cbd5e1;font:14px system-ui,sans-serif"><button id="print-preview-print" type="button">Imprimir</button><button id="print-preview-cancel" type="button">Cancelar</button><span id="print-preview-error" role="alert" style="color:#b91c1c">${escapeText(initialMessage)}</span></section>`;
  return ticket.includes("<body>")
    ? ticket
        .replace("<body>", `<body>${controls}<main id="print-preview-ticket">`)
        .replace("</body>", "</main></body>")
    : `${ticket}${controls}`;
}

function isPreviewWindow(value: BrowserWindow) {
  return previewWindows.has(value) && !value.isDestroyed();
}

async function showPreview(
  html: string,
  profile: PrinterProfileDto,
  parent?: BrowserWindow | null,
  initialMessage = "",
): Promise<PrintOutcome> {
  const window = new BrowserWindow({
    parent: parent && !parent.isDestroyed() ? parent : undefined,
    width: 560,
    height: 760,
    show: false,
    title: "Vista previa de impresión",
    webPreferences: {
      preload: previewPreload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const contents = window.webContents;
  previewWindows.add(window);
  let settled = false;
  let printing = false;
  let resolveResult!: (outcome: PrintOutcome) => void;
  let rejectResult!: (error: Error) => void;
  const result = new Promise<PrintOutcome>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  const finish = (outcome: PrintOutcome, error?: Error) => {
    if (settled) return;
    settled = true;
    previewWindows.delete(window);
    if (error) rejectResult(error);
    else resolveResult(outcome);
    if (!window.isDestroyed()) window.destroy();
  };
  const print = async () => {
    if (!isPreviewWindow(window) || printing) return;
    printing = true;
    try {
      const height = await contentHeightMicrons(window.webContents);
      window.webContents.print(
        { ...printSettings(profile, height), silent: false },
        (success, reason) => {
          printing = false;
          if (settled || window.isDestroyed()) return;
          if (success) finish("PRINTED");
          else
            window.webContents.send(
              "print-preview:error",
              reason || "Falló la impresión.",
            );
        },
      );
    } catch (error) {
      printing = false;
      if (!settled && !window.isDestroyed())
        window.webContents.send(
          "print-preview:error",
          error instanceof Error ? error.message : "Falló la impresión.",
        );
    }
  };
  const cancel = () => finish("SKIPPED");
  const onPrint = (event: Electron.IpcMainEvent) => {
    if (event.sender === window.webContents) print();
  };
  const onCancel = (event: Electron.IpcMainEvent) => {
    if (event.sender === window.webContents) cancel();
  };
  ipcMain.on("print-preview:print", onPrint);
  ipcMain.on("print-preview:cancel", onCancel);
  window.on("closed", cancel);
  const onNavigate = (event: Electron.Event) => event.preventDefault();
  const onGone = () =>
    finish("SKIPPED", new Error("La vista previa dejó de responder."));
  const onUnresponsive = () =>
    finish("SKIPPED", new Error("La vista previa dejó de responder."));
  window.webContents.on("will-navigate", onNavigate);
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("render-process-gone", onGone);
  window.on("unresponsive", onUnresponsive);
  // A rejection can happen while loadURL is still pending; mark it observed immediately.
  void result.catch(() => undefined);
  try {
    await window.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(previewDocument(html, profile, initialMessage))}`,
    );
    if (!window.isDestroyed()) window.show();
  } catch (error) {
    finish(
      "SKIPPED",
      error instanceof Error
        ? error
        : new Error("No se pudo abrir la vista previa."),
    );
  }
  try {
    return await result;
  } finally {
    ipcMain.removeListener("print-preview:print", onPrint);
    ipcMain.removeListener("print-preview:cancel", onCancel);
    window.removeListener("closed", cancel);
    contents.removeListener("will-navigate", onNavigate);
    contents.removeListener("render-process-gone", onGone);
    window.removeListener("unresponsive", onUnresponsive);
    previewWindows.delete(window);
  }
}

export async function printHtml(
  html: string,
  profile: PrinterProfileDto,
  options: PrintOptions = {},
): Promise<PrintOutcome> {
  const getPrinters =
    options.getPrinters ??
    (async () => {
      const owner =
        options.parent ??
        BrowserWindow.getAllWindows().find((item) => !item.isDestroyed());
      if (!owner) return [];
      return (await owner.webContents.getPrintersAsync()) as PrinterInfo[];
    });
  if (profile.mode === "SYSTEM_DIALOG") {
    return showPreview(html, profile, options.parent);
  }
  let target: string | null = null;
  try {
    target = resolvePrinterTarget(profile, await getPrinters());
  } catch {
    target = null;
  }
  if (!target) {
    if (profile.deviceName) {
      throw new Error(
        `No se encontró la impresora configurada: ${profile.deviceName}.`,
      );
    }
    return showPreview(
      html,
      profile,
      options.parent,
      "No se encontró una impresora disponible.",
    );
  }

  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  try {
    await window.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
    );
    const height = await contentHeightMicrons(window.webContents);
    await new Promise<void>((resolve, reject) => {
      window.webContents.print(
        { ...printSettings(profile, height), silent: true, deviceName: target },
        (success, reason) =>
          success
            ? resolve()
            : reject(new Error(reason || "Falló la impresión directa.")),
      );
    });
  } catch (error) {
    throw error instanceof Error
      ? error
      : new Error("Falló la impresión directa; revise la impresora y reintente.");
  } finally {
    if (!window.isDestroyed()) window.destroy();
  }
  return "PRINTED";
}
