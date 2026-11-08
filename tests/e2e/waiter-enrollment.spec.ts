import { launchConfiguredPos } from "./pos-fixture";
import { test, expect, type ElectronApplication } from "@playwright/test";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type AddressInfo } from "node:net";

for (const existing of [false, true]) {
  test(`Modo Mozo sin tienda ni impresora: ${existing ? "cuenta existente en próxima validación" : "primera activación"}`, async () => {
    const { createLicenseServer } = await import("../../apps/licensing-service/dist/server.js");
    const { createOrdersServer } = await import("../../apps/orders-service/dist/server.js");
    const profile = await mkdtemp(join(tmpdir(), "gastronomy-local-pilot-waiter-"));
    const keys = generateKeyPairSync("ed25519");
    const secret = randomBytes(32).toString("hex"), admin = randomBytes(32).toString("hex");
    const config = { dbPath: join(profile, "authority.sqlite"), adminToken: admin,
      privateKey: keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      waiterProvisionSecret: existing ? undefined : secret };
    const authority = createLicenseServer(config);
    const probe = createServer();
    await new Promise<void>(resolve => probe.listen(0, "127.0.0.1", resolve));
    const port = (probe.address() as AddressInfo).port;
    await new Promise<void>(resolve => probe.close(() => resolve()));
    const waiterOrigin = "http://127.0.0.1:" + port;
    const orders = createOrdersServer({ dbPath: join(profile, "orders.sqlite"), stores: [],
      waiterProvisionSecret: secret, waiterPublicBaseUrl: waiterOrigin });
    let desktop: ElectronApplication | undefined;
    try {
      await new Promise<void>(resolve => authority.server.listen(0, "127.0.0.1", resolve));
      await new Promise<void>(resolve => orders.server.listen(port, "127.0.0.1", resolve));
      const origin = "http://127.0.0.1:" + (authority.server.address() as AddressInfo).port;
      const adminPost = async (path: string, data: unknown) => {
        const response = await fetch(origin + path, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + admin }, body: JSON.stringify(data) });
        expect(response.ok).toBe(true); return response.json();
      };
      const account = { email: "waiter@example.test", password: randomBytes(24).toString("hex") };
      const { license } = await adminPost("/admin/licenses", { businessName: "Salón QA", paidThrough: new Date(Date.now() + 86400_000).toISOString() });
      await adminPost("/admin/accounts", { ...account, licenseId: license.id });
      await writeFile(join(profile, "local-license-config.json"), JSON.stringify({ serverUrl: origin, publicKey: keys.publicKey.export({ type: "spki", format: "pem" }).toString() }));
      const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GASTRONOMY_") || k === "GASTRONOMY_E2E_BACKGROUND"));
      desktop = await launchConfiguredPos({ args: ["apps/desktop-shell", "--user-data-dir=" + profile],
        env: { ...env, GASTRONOMY_LOCAL_PILOT: "1", GASTRONOMY_WAITER_PROVISION_URL: waiterOrigin } });
      const page = await desktop.firstWindow();
      expect((await page.evaluate(input => window.gastronomy.signInLicenseAccount(input), account)).state).toBe("ACTIVE");
      const status = () => page.evaluate(() => window.gastronomy.getWaiterDeskStatus());
      if (existing) {
        expect((await status()).configured).toBe(false);
        config.waiterProvisionSecret = secret; // Enable the authority feature after the original activation.
        expect((await page.evaluate(() => window.gastronomy.refreshLicense())).state).toBe("ACTIVE");
      }
      await expect.poll(status).toMatchObject({ configured: true, printerReady: false });
      await page.evaluate(async () => {
        await window.gastronomy.openCashSession({ openingAmountMinor: 0 });
        const waiter = await window.gastronomy.createUser({ fullName: "Moza QA", roleCode: "WAITER", pin: "5731", authorizerPin: "748259" });
        const qr = await window.gastronomy.issueWaiterQr({ waiterId: waiter.id });
        if (!qr.image.startsWith("data:image/")) throw new Error("No se generó QR");
      });
      expect((await page.evaluate(() => window.gastronomy.getWebSiteStatus())).state).not.toBe("ACTIVE");
    } finally {
      await desktop?.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())).catch(() => {});
      await desktop?.close().catch(() => {});
      authority.close(); await orders.close();
      await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  });
}
