import { launchConfiguredPos } from "./pos-fixture";
import {
  test,
  expect,
  type ElectronApplication,
} from "@playwright/test";
import { randomBytes, createHash, randomUUID } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { createServer, type Server, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const token = () => randomBytes(32).toString("base64url");
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
async function listen(server: Server, port = 0) {
  await new Promise<void>((ok, fail) => {
    server.once("error", fail);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", fail);
      ok();
    });
  });
  return (server.address() as AddressInfo).port;
}

test("carta pública de un POS → edición en Pedidos → una comanda sin cobro", async ({
  page: shopPage,
}) => {
  const { createOrdersServer } =
    await import("../../apps/orders-service/dist/server.js");
  const { createStorefrontServer } =
    await import("../../apps/orders-service/dist/storefront.js");
  const profile = await mkdtemp(join(tmpdir(), "gastronomy-web-commerce-"));
  const receive = token(),
    submit = token(),
    installationId = randomUUID();
  const orders = createOrdersServer({
    dbPath: join(profile, "remote.sqlite"),
    stores: [
      {
        id: "bonis",
        receiveInstallationId: installationId,
        receiveTokenHash: hash(receive),
        whatsappNumber: "5491111111111",
        sites: [{ id: "bonis-web", submitTokenHash: hash(submit) }],
      },
    ],
  });
  let app: ElectronApplication | undefined;
  let shop: ReturnType<typeof createStorefrontServer> | undefined;
  try {
    const ordersUrl = "http://127.0.0.1:" + (await listen(orders.server));
    const socket = createServer();
    const port = await listen(socket);
    await new Promise<void>((ok) => socket.close(() => ok()));
    const origin = "http://127.0.0.1:" + port;
    shop = createStorefrontServer({
      ordersUrl,
      submitToken: submit,
      storeId: "bonis",
      siteId: "bonis-web",
      origin,
      rateLimit: 200,
    });
    await listen(shop.server, port);
    await writeFile(
      join(profile, "license-state.json"),
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
      args: ["apps/desktop-shell", "--user-data-dir=" + profile],
      env: {
        ...process.env,
        GASTRONOMY_WEB_ORDERS_URL: ordersUrl,
        GASTRONOMY_WEB_ORDERS_STORE_ID: "bonis",
        GASTRONOMY_WEB_ORDERS_TOKEN: receive,
      },
    });
    const pos = await app.firstWindow();
    // Only the physical printer driver is mocked. The real print queue and
    // renderer/main bridge remain in use and must record exactly one print.
    await app.evaluate(({ app: ea, BrowserWindow }) => {
      const install = (win: Electron.BrowserWindow) => {
        win.webContents.getPrintersAsync = async () =>
          [{ name: "Piloto", isDefault: true }] as any;
        win.webContents.print = (_options, callback) => {
          callback?.(true, "");
        };
      };
      BrowserWindow.getAllWindows().forEach(install);
      ea.on("browser-window-created", (_event, win) => install(win));
    });
    const id = await pos.evaluate(async () => {
      const api = window.gastronomy,
        data = await api.bootstrap();
      await api.saveSettings({
        ...data.settings,
        printing: {
          ...data.settings.printing,
          kitchen: {
            ...data.settings.printing.kitchen,
            mode: "SYSTEM_DIRECT",
            deviceName: "Piloto",
          },
        },
      });
      const p = await api.createProduct({
        categoryId: data.categories[0]!.id,
        name: "Pizza piloto",
        prices: [
          { priceListCode: "TAKEAWAY", amountMinor: 120000 },
          { priceListCode: "DELIVERY", amountMinor: 120000 },
          { priceListCode: "SALON", amountMinor: 90000 },
        ],
      });
      return p.id;
    });
    await pos.reload();
    await pos.getByRole("link", { name: "Productos", exact: true }).click();
    await pos
      .getByRole("button", {
        name: "Mostrar Pizza piloto en la web",
        exact: true,
      })
      .click();
    const published = async () => {
      const response = await fetch(ordersUrl + "/v1/web-catalog", {
        headers: { authorization: "Bearer " + submit },
      });
      return response.ok ? (await response.json()).snapshot.products : [];
    };
    await expect
      .poll(
        async () =>
          (await published()).find((p: any) => p.productRef === id)
            ?.takeawayPriceMinor,
        { timeout: 25000 },
      )
      .toBe(120000);
    await shopPage.goto(origin);
    await shopPage
      .getByRole("button", { name: /Agregar/ })
      .first()
      .click();
    await shopPage
      .getByLabel(/Nombre/i)
      .first()
      .fill("Cliente de la web");
    await shopPage.getByLabel(/Teléfono/i).fill("1123456789");
    // The browser has the old price in its cart. A POS change publishes
    // automatically, but it cannot silently re-price an already open cart.
    await pos.evaluate(
      (id) =>
        window.gastronomy.bulkUpdateProducts({
          productIds: [id],
          priceAdjustment: {
            mode: "FIXED",
            value: 30000,
            priceListCodes: ["TAKEAWAY", "DELIVERY"],
          },
          reason: "Revisar precios de la carta piloto",
          authorizerPin: "748259",
        }),
      id,
    );
    await expect
      .poll(
        async () =>
          (await published()).find((p: any) => p.productRef === id)
            ?.takeawayPriceMinor,
        { timeout: 25000 },
      )
      .toBe(150000);
    await shopPage.getByRole("button", { name: /Enviar solicitud/ }).click();
    await expect(
      shopPage.getByRole("button", { name: /Aceptar.*(cambios|precios)/i }),
    ).toBeVisible();
    await expect(
      shopPage.getByRole("button", { name: /Enviar solicitud/ }),
    ).toBeDisabled();
    await shopPage
      .getByRole("button", { name: /Aceptar.*(cambios|precios)/i })
      .click();
    await shopPage.getByRole("button", { name: /Enviar solicitud/ }).click();
    await expect(shopPage.getByText(/WEB-[a-f0-9]/i).first()).toBeVisible();
    await pos.evaluate(() => window.gastronomy.retryWebSync());
    await pos.getByRole("link", { name: "Pedidos", exact: true }).click();
    await expect(pos.getByRole("tab", { name: /Pedidos web/ })).toContainText(
      "1",
      { timeout: 20000 },
    );
    await pos.getByRole("tab", { name: /Pedidos web/ }).click();
    await pos.getByRole("button", { name: /Cliente de la web/ }).click();
    await pos.getByLabel("Cantidad artículo 1").fill("2");
    await pos.getByLabel("Nota artículo 1").fill("Sin aceitunas");
    await pos.getByRole("button", { name: /Guardar borrador/ }).click();
    await expect
      .poll(() =>
        pos.evaluate(
          async () =>
            (await window.gastronomy.listWebOrders())[0]?.draft.items[0]
              ?.quantity,
        ),
      )
      .toBe(2);
    expect(
      await pos.evaluate(
        async () => (await window.gastronomy.bootstrap()).orders.length,
      ),
    ).toBe(0);
    await pos.evaluate(() =>
      window.gastronomy.openCashSession({ openingAmountMinor: 0 }),
    );
    await pos.reload();
    await pos.getByRole("tab", { name: /Pedidos web/ }).click();
    await pos.getByRole("button", { name: /Cliente de la web/ }).click();
    await pos.getByRole("button", { name: /^Confirmar y/ }).click();
    await expect
      .poll(
        () =>
          pos.evaluate(
            async () =>
              (await window.gastronomy.bootstrap()).orders[0]?.printCount,
          ),
        { timeout: 20000 },
      )
      .toBe(1);
    const result = await pos.evaluate(async () => {
      const api = window.gastronomy,
        [entry] = await api.listWebOrders();
      const again = await api.confirmWebOrder({
        id: entry!.original.id,
        revision: 1,
        expectedTotalMinor: 300000,
      });
      return {
        entry,
        again: again.created,
        orders: (await api.bootstrap()).orders,
      };
    });
    expect(result.entry?.original.submission.items[0]?.quantity).toBe(1);
    expect(result.again).toBe(false);
    expect(result.orders).toHaveLength(1);
    expect(result.orders[0]).toMatchObject({
      totalMinor: 300000,
      paymentStatus: "UNPAID",
      payments: [],
      items: [
        expect.objectContaining({
          productId: id,
          quantity: 2,
          notes: "Sin aceitunas",
        }),
      ],
    });
    await pos.getByRole("link", { name: "Productos", exact: true }).click();
    await pos
      .getByRole("button", {
        name: "Ocultar Pizza piloto en la web",
        exact: true,
      })
      .click();
    await expect
      .poll(async () => (await published()).length, { timeout: 25000 })
      .toBe(0);
    await shopPage.reload();
    await expect(
      shopPage.getByRole("button", { name: "Agregar Pizza piloto" }),
    ).toHaveCount(0);
    expect(
      await pos.evaluate(
        async (id) =>
          (await window.gastronomy.bootstrap()).products.find(
            (p) => p.id === id,
          )?.active,
        id,
      ),
    ).toBe(true);
  } finally {
    await app?.close();
    await shop?.close();
    await orders.close();
    await rm(profile, {
      recursive: true,
      force: true,
      maxRetries: 4,
      retryDelay: 150,
    });
  }
});
