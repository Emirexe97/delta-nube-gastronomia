import { test, expect } from "@playwright/test";
import { randomBytes, generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

async function listen(s: Server) {
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  return "http://127.0.0.1:" + (s.address() as AddressInfo).port;
}

test("registro del comercio → aprobación → carta propia → pedido para su POS", async ({
  page,
  request,
}) => {
  const { createLicenseServer } =
    await import("../../apps/licensing-service/dist/server.js");
  const { hashPanelPassword } =
    await import("../../apps/licensing-service/dist/panel-auth.js");
  const { createOrdersServer } =
    await import("../../apps/orders-service/dist/server.js");
  const { setTenantDesignMode } =
    await import("../../apps/orders-service/dist/tenant-registry.js");
  const { DesktopLicensing } =
    await import("../../apps/desktop-shell/src/licensing");
  const { WebSiteProvisioning } =
    await import("../../apps/desktop-shell/src/web-site-provisioning");
  const dir = await mkdtemp(join(tmpdir(), "gastronomy-registration-"));
  const keys = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { format: "pem", type: "spki" },
    privateKeyEncoding: { format: "pem", type: "pkcs8" },
  });
  const secret = randomBytes(32).toString("hex");
  const owner = "https://owner.example.test";
  const password = randomBytes(32).toString("hex");
  const licenses = createLicenseServer({
    dbPath: join(dir, "license.sqlite"),
    adminToken: randomBytes(32).toString("hex"),
    privateKey: keys.privateKey,
    webSiteProvisionSecret: secret,
    panelAuth: {
      username: "owner",
      passwordHash: await hashPanelPassword(password),
      origin: owner,
    },
  });
  const orders = createOrdersServer({
    dbPath: join(dir, "orders.sqlite"),
    stores: [],
    provisioning: { baseDomain: "example.test", secret },
  });
  try {
    const api = await listen(orders.server),
      licenseUrl = await listen(licenses.server);
    // All traffic stays on loopback. The OS keychain is replaced only in this fixture.
    const safeStorage = {
      isAvailable: () => true,
      encryptString: (s: string) => Buffer.from(s),
      decryptString: (b: Buffer) => b.toString(),
    };
    const desktop = new DesktopLicensing({
      userDataPath: dir,
      isPackaged: true,
      safeStorage,
      config: { serverUrl: owner, publicKey: keys.publicKey },
      fetch: (url, init) =>
        fetch(licenseUrl + new URL(String(url)).pathname, init),
    });
    await desktop.initialize();
    const installationId = (await desktop.getStatus()).installationId;
    const workerEnv: NodeJS.ProcessEnv = {};
    const site = new WebSiteProvisioning({
      baseUrl: api,
      env: workerEnv,
      userDataPath: dir,
      installationId: () => installationId,
      safeStorage,
    });
    await site.initialize();
    desktop.setWebSiteProvisioner({
      provision: (ticket, signup) => site.provision(ticket, signup),
      getChoice: () => site.selectedSignup(),
      selectChoice: (signup) => site.select(signup),
      getStatus: () => site.status(),
    });
    const pending = await desktop.requestLicenseAccess({
      businessName: "Bonis",
      webSite: { slug: "bonis", whatsappNumber: "5491112345678" },
    });
    expect(pending.enrollment?.status).toBe("PENDING");
    const appUrl = "https://bonis.example.test";
    // Substitute only DNS + the TLS terminator. The browser and both services are real.
    await page.route(appUrl + "/**", async (route) => {
      const req = route.request(),
        path = new URL(req.url()).pathname;
      const headers = {
        ...(await req.allHeaders()),
        host: "bonis.example.test",
      };
      const upstream = await request.fetch(api + path, {
        method: req.method(),
        headers,
        data: req.postDataBuffer() ?? undefined,
      });
      await route.fulfill({ response: upstream });
    });
    expect((await page.goto(appUrl))?.status()).toBe(404);
    const login = await fetch(licenseUrl + "/manage/api/login", {
      method: "POST",
      headers: { origin: owner, "content-type": "application/json" },
      body: JSON.stringify({ username: "owner", password }),
    });
    expect(login.status).toBe(200);
    const approval = await fetch(
      licenseUrl +
        "/manage/api/requests/" +
        pending.enrollment!.requestId +
        "/approve",
      {
        method: "POST",
        headers: {
          origin: owner,
          cookie: login.headers.get("set-cookie")!.split(";")[0]!,
          "x-panel-csrf": (await login.json()).csrfToken,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          businessName: "Bonis",
          paidThrough: new Date(Date.now() + 86_400_000).toISOString(),
          reason: "Huella comprobada en piloto local",
        }),
      },
    );
    expect(approval.status).toBe(200);
    expect((await desktop.refresh()).state).toBe("ACTIVE");
    await expect.poll(() => site.status().state).toBe("ACTIVE");
    expect(site.status().url).toBe(appUrl);
    await page.goto(appUrl);
    await expect(
      page.getByRole("heading", { name: "La carta todavía no está publicada" }),
    ).toBeVisible();
    await expect(
      page.getByText("La carta no tiene productos disponibles por el momento."),
    ).toBeVisible();
    expect(JSON.stringify(site.status())).not.toContain(
      workerEnv.GASTRONOMY_WEB_ORDERS_TOKEN,
    );
    const headers = {
      "content-type": "application/json",
      authorization: "Bearer " + workerEnv.GASTRONOMY_WEB_ORDERS_TOKEN,
      "x-pos-installation": installationId,
      "x-expected-store-id": workerEnv.GASTRONOMY_WEB_ORDERS_STORE_ID!,
    };
    const publish = await fetch(api + "/v1/web-catalog", {
      method: "PUT",
      headers,
      body: JSON.stringify({
        products: [
          {
            productRef: "pizza",
            name: "Pizza piloto",
            category: "Pizzas",
            takeawayPriceMinor: 80000,
            deliveryPriceMinor: 90000,
          },
        ],
      }),
    });
    expect(publish.status).toBe(200);
    await site.updateBranding({
      displayName: "Bonis al horno",
      tagline: "Pizza de la casa",
      accent: "#773311",
    });
    await page.goto(appUrl);
    await expect(
      page.getByRole("heading", { name: "Bonis al horno" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: /Agregar/ })
      .first()
      .click();
    await page
      .getByLabel(/Nombre/i)
      .first()
      .fill("Cliente web");
    await page.getByLabel(/Teléfono/i).fill("1123456789");
    await page.getByRole("button", { name: /Enviar solicitud/ }).click();
    await expect(page.getByText(/WEB-[a-f0-9]/i).first()).toBeVisible();
    const inbox = await fetch(api + "/v1/web-orders", { headers });
    expect(inbox.status).toBe(200);
    expect((await inbox.json()).orders).toHaveLength(1);
    const storeId = headers["x-expected-store-id"];
    setTenantDesignMode(
      join(dir, "orders.sqlite"),
      storeId,
      "CUSTOM",
      "midnight-market-v1",
    );
    const branding = api + "/v1/web-sites/branding";
    expect((await (await fetch(branding, { headers })).json()).designMode).toBe(
      "CUSTOM",
    );
    const edit = () =>
      fetch(branding, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          displayName: "Nuevo nombre",
          tagline: "",
          accent: "#cc8844",
        }),
      });
    expect((await edit()).status).toBe(403);
    await page.reload();
    await expect(page.locator(".hero")).toHaveCSS(
      "background-color",
      "rgb(23, 35, 33)",
    );
    await expect(
      page.getByRole("heading", { name: "Bonis al horno" }),
    ).toBeVisible();
    setTenantDesignMode(join(dir, "orders.sqlite"), storeId, "STANDARD");
    expect((await edit()).status).toBe(200);
  } finally {
    await orders.close();
    licenses.close();
    await rm(dir, { recursive: true, force: true, maxRetries: 4 });
  }
});
