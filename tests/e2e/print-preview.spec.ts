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

async function launch(printers: unknown[], failDirect = false) {
  userData = await mkdtemp(join(tmpdir(), "gastronomy-print-preview-"));
  app = await electron.launch({
    args: ["apps/desktop-shell", `--user-data-dir=${userData}`],
    cwd: process.cwd(),
  });
  page = await app.firstWindow();
  await app.evaluate(
    ({ app: electronApp, BrowserWindow }, { available, fail }) => {
      (electronApp as any).__printCount = 0;
      const install = (window: any) => {
        window.webContents.getPrintersAsync = async () => available;
        window.webContents.print = (
          _options: unknown,
          callback: (ok: boolean, reason?: string) => void,
        ) => {
          (electronApp as any).__printCount += 1;
          const count = (electronApp as any).__printCount;
          callback(
            !(fail && count === 1),
            fail && count === 1 ? "offline" : undefined,
          );
        };
      };
      electronApp.on("browser-window-created", (_event: unknown, window: any) =>
        install(window),
      );
      for (const window of BrowserWindow.getAllWindows()) install(window);
    },
    { available: printers, fail: failDirect },
  );
}

async function settingsFor(
  mode: "SYSTEM_DIALOG" | "SYSTEM_DIRECT",
  deviceName = "",
) {
  return page.evaluate(
    async ({ mode, deviceName }) => {
      const data = await (window as any).gastronomy.bootstrap();
      return {
        ...data.settings,
        printing: {
          ...data.settings.printing,
          bill: { ...data.settings.printing.bill, mode, deviceName },
        },
      };
    },
    { mode, deviceName },
  );
}

async function startTest(settings: unknown) {
  await page.evaluate((value) => {
    (window as any).__printResult = null;
    void (window as any).gastronomy
      .testPrinter({ kind: "CUSTOMER_BILL", settings: value })
      .then((result: unknown) => ((window as any).__printResult = result))
      .catch(
        (error: Error) =>
          ((window as any).__printResult = { error: error.message }),
      );
  }, settings);
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

async function result() {
  return expect
    .poll(() => page.evaluate(() => (window as any).__printResult))
    .not.toBeNull();
}

test.afterEach(async () => {
  await app?.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) window.destroy();
  });
  await app?.close();
  if (userData) await rm(userData, { recursive: true, force: true });
});

test("SYSTEM_DIALOG muestra ticket real y cancelar no imprime", async () => {
  await launch([]);
  await startTest(await settingsFor("SYSTEM_DIALOG"));
  const preview = await previewWindow();
  await expect(preview.getByText("PRUEBA DE IMPRESIÓN")).toBeVisible();
  await preview.screenshot({ path: test.info().outputPath("preview.png") });
  await preview.getByRole("button", { name: "Cancelar" }).click();
  await result();
  expect(await page.evaluate(() => (window as any).__printResult)).toEqual({
    printed: false,
    message: "Impresión cancelada. No se imprimió nada.",
  });
  expect(
    await app.evaluate(
      ({ app: electronApp }) => (electronApp as any).__printCount,
    ),
  ).toBe(0);
});

test("SYSTEM_DIRECT sin destino abre preview y cancelar no imprime", async () => {
  await launch([]);
  await startTest(await settingsFor("SYSTEM_DIRECT"));
  const preview = await previewWindow();
  await expect(preview.getByText("PRUEBA DE IMPRESIÓN")).toBeVisible();
  await preview.getByRole("button", { name: "Cancelar" }).click();
  await result();
  expect(
    await app.evaluate(
      ({ app: electronApp }) => (electronApp as any).__printCount,
    ),
  ).toBe(0);
});

test("SYSTEM_DIRECT con default válido imprime sin preview", async () => {
  await launch([{ name: "Mock Printer", isDefault: true }]);
  await startTest(await settingsFor("SYSTEM_DIRECT"));
  await result();
  await expect
    .poll(
      () =>
        app
          .windows()
          .filter((candidate) =>
            candidate.url().includes("print-preview-controls"),
          ).length,
    )
    .toBe(0);
  await expect
    .poll(() => page.evaluate(() => (window as any).__printResult.printed))
    .toBe(true);
  expect(
    await app.evaluate(
      ({ app: electronApp }) => (electronApp as any).__printCount,
    ),
  ).toBe(1);
});

test("fallo directo cae en preview y reintento exitoso imprime", async () => {
  await launch([{ name: "Mock Printer", isDefault: true }], true);
  await startTest(await settingsFor("SYSTEM_DIRECT"));
  const preview = await previewWindow();
  await expect(preview.getByText("offline")).toBeVisible();
  await preview.getByRole("button", { name: "Imprimir" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__printResult?.printed))
    .toBe(true);
  expect(
    await app.evaluate(
      ({ app: electronApp }) => (electronApp as any).__printCount,
    ),
  ).toBe(2);
});

test("cancelar un job real libera la mesa y permite imprimir después", async () => {
  await launch([]);
  const setup = await page.evaluate(async () => {
    const api = (window as any).gastronomy;
    const data = await api.bootstrap();
    const cash = await api.openCashSession({ openingAmountMinor: 0 });
    const table = await api.ensureTable({ number: 61 });
    const product =
      data.products.find((item: any) => item.code === "MUZG") ??
      data.products[0];
    const order = await api.createOrder({ type: "DINE_IN", tableId: table.id });
    await api.addOrderItem({
      orderId: order.id,
      productId: product.id,
      quantity: 1,
    });
    await api.confirmOrder({ orderId: order.id });
    await api.saveSettings({
      ...data.settings,
      printing: {
        ...data.settings.printing,
        bill: {
          ...data.settings.printing.bill,
          mode: "SYSTEM_DIALOG",
          deviceName: "",
        },
      },
    });
    return { orderId: order.id, cashId: cash.id };
  });
  await page.reload();
  await page.getByRole("link", { name: "Salón" }).click();
  await page.getByRole("button", { name: "Abrir pedido de mesa 61" }).click();
  const editor = page.getByRole("dialog", { name: /Pedido #/ });
  await editor.getByRole("button", { name: "Cuenta", exact: true }).click();
  const preview = await previewWindow();
  const queued = await page.evaluate(
    async (orderId) =>
      (await (window as any).gastronomy.bootstrap()).printJobs.find(
        (job: any) => job.orderId === orderId,
      ),
    setup.orderId,
  );
  expect(queued.status).toBe("QUEUED");
  expect(
    await page.evaluate(
      async (orderId) =>
        (await (window as any).gastronomy.bootstrap()).orders.find(
          (order: any) => order.id === orderId,
        ).printCount,
      setup.orderId,
    ),
  ).toBe(0);
  await preview.getByRole("button", { name: "Cancelar" }).click();
  await expect(
    editor.getByText(
      "Cuenta no impresa. Podés continuar trabajando y volver a imprimirla cuando quieras.",
    ),
  ).toBeVisible();
  await expect(
    editor.getByRole("button", { name: "Reintentar cuenta" }),
  ).toBeEnabled();
  await expect
    .poll(
      async () =>
        await page.evaluate(
          async (jobId) =>
            !(await (window as any).gastronomy.bootstrap()).printJobs.some(
              (job: any) => job.id === jobId,
            ),
          queued.id,
        ),
    )
    .toBe(true);
  const canceledJob = await page.evaluate(
    async (jobId) =>
      (await (window as any).gastronomy.bootstrap()).printJobs.find(
        (job: any) => job.id === jobId,
      ),
    queued.id,
  );
  expect(canceledJob).toBeUndefined();
  await page.evaluate(async (orderId) => {
    const api = (window as any).gastronomy;
    const data = await api.bootstrap();
    const product =
      data.products.find((item: any) => item.code === "MUZG") ??
      data.products[0];
    await api.addOrderItem({ orderId, productId: product.id, quantity: 1 });
  }, setup.orderId);
  await editor.getByRole("button", { name: "Reintentar cuenta" }).click();
  const retryPreview = await previewWindow();
  await retryPreview.getByRole("button", { name: "Imprimir" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        async (orderId) =>
          (await (window as any).gastronomy.bootstrap()).orders.find(
            (order: any) => order.id === orderId,
          ).printCount,
        setup.orderId,
      ),
    )
    .toBe(1);
  expect(
    await page.evaluate(
      async (orderId) =>
        (await (window as any).gastronomy.bootstrap()).orders.find(
          (order: any) => order.id === orderId,
        ).printCount,
      setup.orderId,
    ),
  ).toBe(1);
});
