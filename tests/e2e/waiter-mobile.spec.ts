import { launchConfiguredPos } from "./pos-fixture";
import {
  test,
  expect,
  type ElectronApplication,
} from "@playwright/test";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type AddressInfo } from "node:net";

test("QR sin impresora, tandas con y sin comandero y revocación", async ({
  page: phone,
}, testInfo) => {
  test.setTimeout(100_000);
  const { createOrdersServer } =
    await import("../../apps/orders-service/dist/server.js");
  const { decodeWebSiteQr } =
    await import("../../apps/desktop-shell/test/verify-website-qr.mjs");
  const dir = await mkdtemp(join(tmpdir(), "gastronomy-mobile-e2e-"));
  const receive = randomBytes(32).toString("base64url"),
    installationId = randomUUID();
  const hash = (v: string) => createHash("sha256").update(v).digest("hex");
  const probe = createServer();
  await new Promise<void>((ok) => probe.listen(0, "127.0.0.1", ok));
  const port = (probe.address() as AddressInfo).port,
    origin = "http://127.0.0.1:" + port;
  await new Promise<void>((ok) => probe.close(() => ok()));
  const service = createOrdersServer({
    dbPath: join(dir, "remote.sqlite"),
    waiterPublicBaseUrl: origin + "/",
    stores: [
      {
        id: "pilot",
        receiveInstallationId: installationId,
        receiveTokenHash: hash(receive),
        whatsappNumber: "5491111111111",
        sites: [{ id: "shop", submitTokenHash: hash(randomUUID()) }],
      },
    ],
  });
  let app: ElectronApplication | undefined;
  try {
    await new Promise<void>((ok) =>
      service.server.listen(port, "127.0.0.1", ok),
    );
    await writeFile(
      join(dir, "license-state.json"),
      JSON.stringify({
        schema: 1,
        installationId,
        token: null,
        lastTrustedTime: 0,
        maxSeenWallClock: Date.now(),
        lastVerifiedAt: null,
        revision: 0,
      }),
    );
    app = await launchConfiguredPos({
      args: ["apps/desktop-shell", "--user-data-dir=" + dir],
      env: {
        ...process.env,
        GASTRONOMY_WEB_ORDERS_URL: origin,
        GASTRONOMY_WEB_ORDERS_STORE_ID: "pilot",
        GASTRONOMY_WEB_ORDERS_TOKEN: receive,
      },
    });
    const pos = await app.firstWindow();
    await app.evaluate(({ app: ea, BrowserWindow }) => {
      const output: string[] = [];
      (ea as any).__waiterTickets = output;
      const install = (win: Electron.BrowserWindow) => {
        const wc = win.webContents;
        wc.getPrintersAsync = async () =>
          [{ name: "Cocina piloto", isDefault: false }] as any;
        wc.print = (opts, cb) => {
          if ((ea as any).__waiterOffline)
            return cb?.(false, "test: desconectada");
          if (opts?.deviceName !== "Cocina piloto")
            return cb?.(false, "wrong device");
          void wc
            .executeJavaScript("document.body.innerText")
            .then((s: string) => {
              output.push(s);
              cb?.(true, "");
            });
        };
      };
      BrowserWindow.getAllWindows().forEach(install);
      ea.on("browser-window-created", (_, w) => install(w));
    });
    const { table, waiter } = await pos.evaluate(async () => {
      const api = window.gastronomy,
        data = await api.bootstrap();
      await api.openCashSession({ openingAmountMinor: 0 });
      const waiter = await api.createUser({
        fullName: "Moza piloto",
        roleCode: "WAITER",
        pin: "5731",
        authorizerPin: "748259",
      });
      const table = await api.ensureTable({ number: 88 });
      for (const name of ["Plato piloto uno", "Plato piloto dos"])
        await api.createProduct({
          categoryId: data.categories[0]!.id,
          name,
          prices: [
            { priceListCode: "SALON", amountMinor: 9900 },
            { priceListCode: "TAKEAWAY", amountMinor: 9900 },
            { priceListCode: "DELIVERY", amountMinor: 9900 },
          ],
        });
      return { table, waiter };
    });
    await pos.reload();
    await pos.getByRole("link", { name: "Configuración" }).click();
    await pos.getByRole("tab", { name: "Modo Mozo", exact: true }).click();
    const panel = pos.locator("#settings-waiter");
    expect((await pos.evaluate(() => window.gastronomy.getWaiterDeskStatus())).printerReady).toBe(false);
    await panel.locator("select").selectOption(waiter.id);
    await panel.getByRole("button", { name: "Vincular teléfono" }).click();
    const img = panel.locator("img");
    await expect(img).toBeVisible();
    const image = await img.getAttribute("src");
    const address = decodeWebSiteQr(Buffer.from(image!.split(",")[1]!, "base64"));
    expect(address).toContain(origin + "/waiter#");
    await pos.getByRole("tab", { name: "Impresión", exact: true }).click();
    const kitchen = pos.getByRole("region", {
      name: "Comanda de cocina",
      exact: true,
    });
    await kitchen
      .getByRole("combobox", { name: /^Modo/ })
      .selectOption("SYSTEM_DIRECT");
    await kitchen
      .getByRole("combobox", { name: /^Impresora/ })
      .selectOption("Cocina piloto");
    // Test the unsaved profile against the selected driver; it must not reset the selection.
    await kitchen.getByRole("button", { name: "Imprimir prueba" }).click();
    await expect
      .poll(() =>
        app!.evaluate(({ app }) => (app as any).__waiterTickets.length),
      )
      .toBe(1);
    await expect(kitchen.getByRole("combobox", { name: /^Impresora/ })).toHaveValue(
      "Cocina piloto",
    );
    await app.evaluate(({ app }) => {
      (app as any).__waiterTickets.length = 0;
    });
    await pos
      .getByRole("button", { name: "Guardar configuración", exact: true })
      .click();
    await phone.setViewportSize({ width: 375, height: 812 });
    // A physical phone can be ahead of the PC. Immediate orders must use the PC time anchor,
    // not quarantine every send as a future timestamp. Only this isolated browser clock changes.
    await phone.addInitScript(() => {
      const NativeDate = Date;
      (window as any).__nativePilotDate = NativeDate;
      class AheadDate extends NativeDate {
        constructor(value?: any) { if (arguments.length === 0) super(NativeDate.now() + 300_000); else super(value); }
        static now() { return NativeDate.now() + 300_000; }
      }
      window.Date = AheadDate as DateConstructor;
    });
    await phone.setViewportSize({ width: 390, height: 844 });
    await phone.goto(address!);
    await phone.locator("#pin").fill("5731");
    await phone.getByRole("button", { name: "Vincular", exact: true }).click();
    await expect(phone.locator("#table")).toBeVisible({ timeout: 15000 });
    await phone.locator("#table").selectOption(table.id);
    const tickets = () =>
      app!.evaluate(({ app }) => (app as any).__waiterTickets as string[]);
    // Server accepts the first mobile RPC, then the phone loses the transport receipt.
    // Recover using the original business request id; no second application or paper job.
    let dropResponse = true;
    await phone.route("**/v1/waiter/rpc", async (route) => {
      if (
        dropResponse &&
        route.request().postDataJSON()?.method === "waiter.submitBatch"
      ) {
        dropResponse = false;
        await route.fetch();
        await route.abort("connectionreset");
      } else await route.continue();
    });
    for (const [index, name] of [
      "Plato piloto uno",
      "Plato piloto dos",
    ].entries()) {
      const add = phone.getByRole("button", {
        name: "Agregar " + name,
        exact: true,
      });
      if (!(await add.isVisible())) {
        for (const category of await phone
          .locator("#categories button")
          .all()) {
          await category.click();
          if (await add.isVisible()) break;
        }
      }
      await add.click();
      if (index === 0) {
        expect(await phone.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
        const screenshot = testInfo.outputPath("waiter-active-order-mobile.png");
        await phone.screenshot({ path: screenshot, fullPage: true });
        await testInfo.attach("waiter-active-order-mobile", { path: screenshot, contentType: "image/png" });
      }
      await phone.locator("#send").click();
      await expect
        .poll(async () => (await tickets()).length, { timeout: 15000 })
        .toBe(index + 1);
      if (index === 0) await phone.locator("#checkPending").click();
      await expect(phone.locator("#draft")).not.toContainText(name, {
        timeout: 12000,
      });
    }
    const slips = await tickets();
    expect(slips[0]).toMatch(/plato piloto uno/i);
    expect(slips[1]).toMatch(/plato piloto dos/i);
    expect(slips[1]).not.toMatch(/plato piloto uno/i);
    await phone.evaluate(() => { window.Date = (window as any).__nativePilotDate; });
    // A spool failure leaves the sale untouched. Only the saved ticket is retried.
    await app.evaluate(({ app }) => {
      (app as any).__waiterOffline = true;
    });
    await phone
      .getByRole("button", { name: "Agregar Plato piloto uno", exact: true })
      .click();
    await phone.locator("#send").click();
    const failed = () =>
      pos.evaluate(async () =>
        (await window.gastronomy.bootstrap()).printJobs.find(
          (j) => j.status === "FAILED",
        ),
      );
    await expect.poll(failed, { timeout: 12000 }).toBeTruthy();
    const job = (await failed())!;
    await expect(
      pos.getByRole("alert").filter({ hasText: "guardado desde Modo Mozo" }),
    ).toBeVisible();
    await expect(phone.locator("#draft")).not.toContainText("Plato piloto uno");
    await expect(phone.locator("#printStatus")).toContainText(
      /falló|revisá la impresora/i,
      { timeout: 14000 },
    );
    await app.evaluate(({ app }) => {
      (app as any).__waiterOffline = false;
    });
    await pos.evaluate(
      (id) => window.gastronomy.retryPrint({ jobId: id }),
      job.id,
    );
    const recovered = await tickets();
    expect(recovered).toHaveLength(3);
    expect(recovered[2]).toMatch(/plato piloto uno/i);
    expect(recovered[2]).not.toMatch(/plato piloto dos/i);
    const saved = await pos.evaluate(
      (orderId) => window.gastronomy.getOrder({ orderId }),
      job.orderId,
    );
    expect(saved.items.reduce((sum, i) => sum + i.quantity, 0)).toBe(3);
    // A delayed new batch must stay outside the table and printer until a cashier
    // reviews it. Replaying the same transport/body must not create a second job.
    await phone.unroute("**/v1/waiter/rpc");
    let delayedPayload: any;
    await phone.route("**/v1/waiter/rpc", async (route) => {
      const body = route.request().postDataJSON();
      if (body?.method === "waiter.submitBatch") {
        body.params.submittedAt = new Date(Date.now() - 61_000).toISOString();
        delayedPayload = body.params;
        await route.continue({ postData: JSON.stringify(body) });
      } else await route.continue();
    });
    await phone.getByRole("button", { name: "Agregar Plato piloto dos", exact: true }).click();
    await phone.locator("#send").click();
    await expect(phone.locator("#pendingTitle")).toContainText("Pedido pendiente de revisión", { timeout: 12000 });
    await expect(phone.locator("#send")).toBeEnabled();
    expect(await tickets()).toHaveLength(3);
    expect((await pos.evaluate(() => window.gastronomy.listDelayedWaiterBatches()))).toHaveLength(1);
    const stillThree = await pos.evaluate((id) => window.gastronomy.getOrder({ orderId: id }), job.orderId);
    expect(stillThree.items.reduce((sum, i) => sum + i.quantity, 0)).toBe(3);
    await phone.locator("#checkPending").click();
    await expect(phone.locator("#pendingTitle")).toContainText("Pedido pendiente de revisión");
    expect(await tickets()).toHaveLength(3);
    await pos.getByRole("link", { name: "Salón", exact: true }).click();
    await pos.getByRole("tab", { name: /Mozos/ }).click();
    await pos.getByRole("button", { name: /Mesa 88.*Moza piloto/ }).click();
    await expect(pos.getByText("1 × Plato piloto dos", { exact: true })).toBeVisible();
    await pos.getByRole("button", { name: "Aprobar pedido", exact: true }).click();
    await expect.poll(async () => (await tickets()).length, { timeout: 12000 }).toBe(4);
    const once = await pos.evaluate((requestId) => window.gastronomy.confirmDelayedWaiterBatch({ requestId }), delayedPayload.requestId);
    expect(once.created).toBe(false);
    expect(await tickets()).toHaveLength(4);
    expect((await tickets())[3]).toMatch(/plato piloto dos/i);
    expect((await tickets())[3]).not.toMatch(/plato piloto uno/i);
    await phone.locator("#checkPending").click();
    await expect(phone.locator("#draft")).not.toContainText("Plato piloto dos");
    await expect(pos.getByText("No hay pedidos pendientes de revisión.")).toBeVisible();
    // No configured kitchen device: subsequent orders still reach the same table
    // and clear the phone draft without a spool job, a retry or a print error.
    await phone.unroute("**/v1/waiter/rpc");
    const jobsBeforeDigital = await pos.evaluate(async () => {
      const { settings, printJobs } = await window.gastronomy.bootstrap();
      settings.printing.kitchen.mode = "SYSTEM_DIALOG";
      settings.printing.kitchen.deviceName = "";
      await window.gastronomy.saveSettings(settings);
      return printJobs.length;
    });
    await phone.getByRole("button", { name: "Agregar Plato piloto uno", exact: true }).click();
    await phone.locator("#send").click();
    await expect(phone.locator("#printStatus")).toContainText(/registrado.*sin impresión/i, { timeout: 12000 });
    await expect(phone.locator("#draft")).not.toContainText("Plato piloto uno");
    const digitalOrder = await pos.evaluate((orderId) => window.gastronomy.getOrder({ orderId }), job.orderId);
    expect(digitalOrder.items.reduce((sum, i) => sum + i.quantity, 0)).toBe(5);
    expect((await pos.evaluate(() => window.gastronomy.bootstrap())).printJobs).toHaveLength(jobsBeforeDigital);
    await pos.getByRole("link", { name: "Configuración", exact: true }).click();
    await pos.getByRole("tab", { name: "Modo Mozo", exact: true }).click();
    await panel.getByRole("button", { name: "Revocar", exact: true }).click();
    await phone.locator("#reconnect").click();
    await expect(phone.locator("#pin")).toBeVisible({ timeout: 12000 });
    expect(await tickets()).toHaveLength(4);
  } finally {
    await app
      ?.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().forEach((w) => w.destroy()),
      )
      .catch(() => {});
    await app?.close();
    await service.close();
    await rm(dir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
});
