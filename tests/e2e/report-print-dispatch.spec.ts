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

async function launch(
  printers: unknown[],
  printResult: { success: boolean; reason?: string } = { success: true },
) {
  userData = await mkdtemp(join(tmpdir(), "gastronomy-report-dispatch-"));
  app = await electron.launch({
    args: ["apps/desktop-shell", `--user-data-dir=${userData}`],
    cwd: process.cwd(),
  });
  page = await app.firstWindow();
  // Install mocks before invoking report printing so neither test can reach a physical printer.
  await app.evaluate(
    ({ app: electronApp, BrowserWindow }, { available, result }) => {
      const state = ((electronApp as any).__reportPrint = {
        count: 0,
        options: null,
        printWindows: 0,
      });
      const install = (window: any) => {
        window.webContents.getPrintersAsync = async () => available;
        window.webContents.print = (
          options: unknown,
          callback: (success: boolean, reason?: string) => void,
        ) => {
          state.count += 1;
          state.options = options;
          state.printWindows +=
            window === BrowserWindow.getAllWindows()[0] ? 0 : 1;
          callback(result.success, result.reason);
        };
      };
      electronApp.on("browser-window-created", (_event: unknown, window: any) =>
        install(window),
      );
      for (const window of BrowserWindow.getAllWindows()) install(window);
    },
    { available: printers, result: printResult },
  );
}

async function prepare(
  mode: "SYSTEM_DIALOG" | "SYSTEM_DIRECT",
  deviceName = "",
) {
  return page.evaluate(
    async ({ mode, deviceName }) => {
      const api = (window as any).gastronomy;
      const data = await api.bootstrap();
      await api.saveSettings({
        ...data.settings,
        printing: {
          ...data.settings.printing,
          bill: {
            ...data.settings.printing.bill,
            mode,
            deviceName,
            paperWidth: "58mm",
            copies: 3,
          },
        },
      });
      const session = await api.openCashSession({ openingAmountMinor: 0 });
      (window as any).__printResult = null;
      void api
        .printCashSessionReport({ filters: { cashSessionId: session.id } })
        .then((result: unknown) => ((window as any).__printResult = result))
        .catch(
          (error: Error) =>
            ((window as any).__printResult = { error: error.message }),
        );
      return session.id;
    },
    { mode, deviceName },
  );
}

async function readResult() {
  await expect
    .poll(() => page.evaluate(() => (window as any).__printResult))
    .not.toBeNull();
  return page.evaluate(() => (window as any).__printResult);
}

async function printState() {
  return app.evaluate(
    ({ app: electronApp }) => (electronApp as any).__reportPrint,
  );
}

async function expectNoPreview() {
  expect(
    await app.evaluate(
      ({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().filter((window: any) =>
          window.webContents.getURL().includes("print-preview-controls"),
        ).length,
    ),
  ).toBe(0);
}

test.afterEach(async () => {
  await app?.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) window.destroy();
  });
  await app?.close();
  if (userData) await rm(userData, { recursive: true, force: true });
});

test("report SYSTEM_DIALOG imprime vía diálogo nativo y cancelar no cierra caja", async () => {
  await launch([], { success: false, reason: "Print job canceled" });
  const sessionId = await prepare("SYSTEM_DIALOG");
  expect(await readResult()).toEqual({
    printed: false,
    message: "Impresión cancelada. No se imprimió nada.",
  });
  await expectNoPreview();
  const state = await printState();
  expect(state.count).toBe(1);
  expect(state.options.silent).toBe(false);
  expect(state.options.copies).toBe(3);
  expect(state.options.pageSize.width).toBe(58_000);
  expect(state.options.pageSize.height).toBeGreaterThan(40_000);
  expect(
    await page.evaluate(async (id) => {
      const cash = (await (window as any).gastronomy.bootstrap()).cashSession;
      return (
        (cash?.id ?? cash?.session?.id) === id &&
        (cash?.status ?? cash?.session?.status) === "OPEN"
      );
    }, sessionId),
  ).toBe(true);
});

test("report SYSTEM_DIRECT usa impresora configurada y copias sin preview", async () => {
  await launch([{ name: "Report Printer", isDefault: true }]);
  await prepare("SYSTEM_DIRECT", "Report Printer");
  expect((await readResult()).printed).toBe(true);
  await expectNoPreview();
  const state = await printState();
  expect(state.count).toBe(1);
  expect(state.options).toMatchObject({
    silent: true,
    deviceName: "Report Printer",
    copies: 3,
    pageSize: { width: 58_000 },
  });
  expect(state.options.pageSize.height).toBeGreaterThan(40_000);
});

test("report SYSTEM_DIRECT sin destino usa diálogo del sistema sin preview", async () => {
  await launch([]);
  await prepare("SYSTEM_DIRECT");
  expect((await readResult()).printed).toBe(true);
  await expectNoPreview();
  const state = await printState();
  expect(state.count).toBe(1);
  expect(state.options.silent).toBe(false);
  expect(state.options.deviceName).toBeUndefined();
});

test("report falla si el driver falla y no informa impresión exitosa", async () => {
  await launch([{ name: "Report Printer", isDefault: true }], {
    success: false,
    reason: "printer offline",
  });
  await prepare("SYSTEM_DIRECT", "Report Printer");
  const result = await readResult();
  expect(result.error).toContain("printer offline");
  expect(result.printed).toBeUndefined();
  await expectNoPreview();
  expect((await printState()).count).toBe(1);
});

test("report SYSTEM_DIRECT selecciona la predeterminada sin destino explícito", async () => {
  await launch([
    { name: "Other Printer" },
    { name: "Default Printer", isDefault: true },
  ]);
  await prepare("SYSTEM_DIRECT");
  expect((await readResult()).printed).toBe(true);
  expect((await printState()).options).toMatchObject({
    silent: true,
    deviceName: "Default Printer",
  });
  await expectNoPreview();
});

test("report no imprime en otra impresora si la configurada está ausente", async () => {
  await launch([{ name: "Other Printer", isDefault: true }]);
  await prepare("SYSTEM_DIRECT", "Missing Printer");
  expect((await readResult()).error).toContain(
    "No se encontró la impresora configurada: Missing Printer",
  );
  expect((await printState()).count).toBe(0);
  await expectNoPreview();
});

test("report SYSTEM_DIALOG no confunde un error real con cancelación", async () => {
  await launch([], { success: false, reason: "Print job failed" });
  await prepare("SYSTEM_DIALOG");
  const result = await readResult();
  expect(result.error).toContain("Print job failed");
  expect(result.printed).toBeUndefined();
  expect((await printState()).count).toBe(1);
  await expectNoPreview();
});
