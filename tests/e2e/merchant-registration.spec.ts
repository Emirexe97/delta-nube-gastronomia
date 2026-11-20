import { test, expect } from "@playwright/test";
import { randomBytes, generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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
}, testInfo) => {
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
        path = new URL(req.url()).pathname + new URL(req.url()).search;
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
            productRef: "tagliatelle",
            name: "Tagliatelle al ragú",
            category: "Pastas frescas",
            takeawayPriceMinor: 1250000,
            deliveryPriceMinor: 1350000,
          },
          {
            productRef: "ravioles",
            name: "Ravioles de ricota",
            category: "Pastas frescas",
            takeawayPriceMinor: 1380000,
            deliveryPriceMinor: 1480000,
          },
          {
            productRef: "flan",
            name: "Flan con dulce de leche",
            category: "Postres",
            takeawayPriceMinor: 420000,
            deliveryPriceMinor: 450000,
          },
        ],
      }),
    });
    expect(publish.status).toBe(200);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator("[data-storefront-cover] img")).toHaveCount(0);
    // Exercise Chromium's real JPEG encoder and the desktop → service → tenant path.
    const examplePhoto = await readFile(
      join(
        process.cwd(),
        "apps/gastronomy-portal/public/portal-assets/mesa.webp",
      ),
    );
    const { banner, logo, dish } = await page.evaluate(async (encoded) => {
      const canvas = document.createElement("canvas");
      canvas.width = 720;
      canvas.height = 288;
      const source = await createImageBitmap(
        new Blob([Uint8Array.from(atob(encoded), (ch) => ch.charCodeAt(0))], {
          type: "image/webp",
        }),
      );
      const scale = Math.max(
        canvas.width / source.width,
        canvas.height / source.height,
      );
      const w = source.width * scale,
        h = source.height * scale;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(source, (720 - w) / 2, (288 - h) / 2, w, h);
      const banner = canvas.toDataURL("image/jpeg", 0.82);
      canvas.width = 640;
      canvas.height = 480;
      const fit = Math.max(640 / source.width, 480 / source.height);
      ctx.drawImage(
        source,
        (640 - source.width * fit) / 2,
        (480 - source.height * fit) / 2,
        source.width * fit,
        source.height * fit,
      );
      const dish = canvas.toDataURL("image/jpeg", 0.8);
      source.close();
      canvas.width = 192;
      canvas.height = 192;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, 192, 192);
      ctx.fillStyle = "#4b231c";
      ctx.beginPath();
      ctx.arc(96, 96, 86, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#e9c9a0";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(96, 96, 77, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "#fff7e5";
      ctx.font = "italic 112px Georgia";
      ctx.textAlign = "center";
      ctx.fillText("B", 90, 128);
      return { banner, dish, logo: canvas.toDataURL("image/jpeg", 0.86) };
    }, examplePhoto.toString("base64"));
    const identity = {
      displayName: "Bonis al horno",
      tagline: "Pastas frescas, salsas lentas y cocina de casa.",
      accent: "#773311",
      bannerDataUrl: banner,
      logoDataUrl: logo,
    };
    const sample = {
      productRef: "tagliatelle",
      name: "Tagliatelle al ragú",
      category: "Pastas frescas",
      priceMinor: 1250000,
      photoDataUrl: dish,
    };
    const privateView = await site.createMobilePreview({
      ...identity,
      product: sample,
    });
    await page.goto(privateView.url, { waitUntil: "commit" });
    await expect(
      page.getByText("Vista privada · Sin publicar · No recibe pedidos"),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: sample.name }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Agregar " + sample.name }),
    ).toBeDisabled();
    await expect(
      page.getByRole("heading", { name: "Ravioles de ricota" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Agregar Flan con dulce de leche" }),
    ).toBeDisabled();
    await expect(page.locator(".dn-cover__logo")).toBeVisible();
    await expect(page.locator(".dn-product__photo")).toBeVisible();
    const draftPhoto = await page
      .locator(".dn-product__photo-wrap")
      .boundingBox();
    expect(new URL(page.url()).hash).toBe("");
    await page.screenshot({
      path: testInfo.outputPath("borrador-en-celular.png"),
    });
    await page.goto(appUrl);
    await expect(
      page.locator(".dn-cover__logo, .dn-product__photo"),
    ).toHaveCount(0);
    expect((await site.getProductPhoto("tagliatelle")).dataUrl).toBeNull();
    const presentation = await site.updateBranding({
      ...identity,
      productPhoto: { productRef: "tagliatelle", dataUrl: dish },
    });
    expect(presentation.bannerDataUrl).toBe(banner);
    expect(presentation.logoDataUrl).toBe(logo);
    expect((await site.getProductPhoto("tagliatelle")).dataUrl).toBe(dish);
    const logoOnly = await site.createMobilePreview({
      ...identity,
      product: null,
    });
    await page.goto(logoOnly.url, { waitUntil: "commit" });
    await expect(
      page.getByRole("button", { name: "Agregar " + sample.name }),
    ).toBeDisabled();
    await expect
      .poll(() =>
        page
          .locator(".dn-product__photo")
          .evaluate((el: HTMLImageElement) => el.naturalWidth),
      )
      .toBe(640);
    await page.goto(appUrl);
    const photo = page.locator(".dn-cover__photo");
    await expect(photo).toHaveAttribute("src", "/media/banner.jpg");
    await expect
      .poll(() => photo.evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBe(720);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(390);
    await expect(
      page.getByRole("button", { name: "Agregar Tagliatelle al ragú" }),
    ).toBeVisible();
    await expect(page.locator(".dn-cover__logo")).toHaveAttribute(
      "src",
      "/media/logo.jpg",
    );
    await expect
      .poll(() =>
        page
          .locator(".dn-product__photo")
          .evaluate((el: HTMLImageElement) => el.naturalWidth),
      )
      .toBe(640);
    await page.screenshot({ path: testInfo.outputPath("carta-movil.png") });
    const publicPhoto = await page
      .locator(".dn-product__photo-wrap")
      .boundingBox();
    expect(
      Math.abs(publicPhoto!.width - draftPhoto!.width),
    ).toBeLessThanOrEqual(2);
    expect(
      Math.abs(publicPhoto!.height - draftPhoto!.height),
    ).toBeLessThanOrEqual(2);
    // Mixed menus must keep usable actions even when a dish has no assigned photograph.
    await expect(page.locator(".dn-product--text-only")).toHaveCount(2);
    const menuHeading = page.getByRole("heading", {
      name: "La carta",
      exact: true,
    });
    await menuHeading.evaluate((el) =>
      el.scrollIntoView({ block: "start", behavior: "instant" }),
    );
    await page.screenshot({
      path: testInfo.outputPath("platos-con-y-sin-foto.png"),
    });
    for (const width of [320, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      const action = await page
        .getByRole("button", { name: "Agregar Tagliatelle al ragú" })
        .boundingBox();
      expect(action!.width).toBeGreaterThanOrEqual(40);
      expect(action!.x + action!.width).toBeLessThanOrEqual(width);
      if (width === 1440) {
        await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
        await page.screenshot({ path: testInfo.outputPath("carta-escritorio.png") });
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    const dessertFilter = page.getByRole("button", { name: "Postres", exact: true });
    await dessertFilter.click();
    await expect(dessertFilter).toBeFocused();
    await expect(page.getByRole("heading", { name: "Pastas frescas" })).toBeHidden();
    await expect(page.getByRole("heading", { name: "Postres" })).toBeVisible();
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
    await page.reload();
    await expect(photo).toBeVisible(); // A legacy, text-only edit preserves the photo.
    const removed = await site.updateBranding({
      displayName: "Bonis",
      tagline: "",
      accent: "#773311",
      bannerDataUrl: null,
      logoDataUrl: null,
      productPhoto: { productRef: "tagliatelle", dataUrl: null },
    });
    expect(removed.bannerDataUrl).toBeNull();
    await page.reload();
    await expect(photo).toHaveCount(0);
    await expect(
      page.locator(".dn-cover__logo, .dn-product__photo"),
    ).toHaveCount(0);
  } finally {
    await orders.close();
    licenses.close();
    await rm(dir, { recursive: true, force: true, maxRetries: 4 });
  }
});
