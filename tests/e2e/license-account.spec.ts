import { test, expect, _electron as electron, type ElectronApplication } from "@playwright/test";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync, randomBytes } from "node:crypto";

test("cuenta activa una PC nueva, conserva licencia tras reiniciar y permite caja sin red", async () => {
  test.setTimeout(100_000);
  const { createLicenseServer } = await import("../../apps/licensing-service/dist/server.js");
  const profile = await mkdtemp(join(tmpdir(), "gastronomy-local-pilot-e2e-"));
  const keys = generateKeyPairSync("ed25519");
  const admin = randomBytes(32).toString("base64url");
  const email = "caja-piloto@example.test", password = randomBytes(24).toString("base64url");
  const authority = createLicenseServer({ dbPath: join(profile, "authority.sqlite"), adminToken: admin, privateKey: keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString() });
  let authorityClosed = false;
  let app: ElectronApplication | undefined;
  try {
    await new Promise<void>((ok) => authority.server.listen(0, "127.0.0.1", ok));
    const origin = `http://127.0.0.1:${(authority.server.address() as { port: number }).port}`;
    const post = async (path: string, body: unknown) => {
      const res = await fetch(origin + path, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${admin}` }, body: JSON.stringify(body) });
      expect(res.ok).toBeTruthy(); return res.json();
    };
    const created = await post("/admin/licenses", { businessName: "Caja ficticia", paidThrough: new Date(Date.now() + 30 * 86400_000).toISOString() });
    await post("/admin/accounts", { licenseId: created.license.id, email, password });
    await writeFile(join(profile, "local-license-config.json"), JSON.stringify({ serverUrl: origin, publicKey: keys.publicKey.export({ type: "spki", format: "pem" }).toString() }));
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (key.startsWith("GASTRONOMY_") && key !== "GASTRONOMY_E2E_BACKGROUND") delete env[key];
    Object.assign(env, { GASTRONOMY_LOCAL_PILOT: "1", GASTRONOMY_WEB_PROVISION_URL: origin });
    const launch = async () => {
      app = await electron.launch({ args: ["apps/desktop-shell", `--user-data-dir=${profile}`], env });
      return app.firstWindow();
    };
    let pos = await launch();
    expect(await pos.evaluate(() => window.gastronomy.getLicenseStatus())).toMatchObject({ state: "UNACTIVATED", canOperate: false });
    await expect(pos.evaluate(() => window.gastronomy.openCashSession({ openingAmountMinor: 0 }))).rejects.toThrow();
    await pos.getByRole("link", { name: "Configuración", exact: true }).click();
    await pos.getByRole("tab", { name: "Licencia", exact: true }).click();
    await pos.getByLabel("Correo de la cuenta", { exact: true }).fill(email);
    await pos.getByLabel("Contraseña de la cuenta", { exact: true }).fill("incorrecta-de-prueba");
    await pos.getByRole("button", { name: "Ingresar y activar este equipo" }).click();
    await expect(pos.locator("#settings-license").getByRole("alert")).toContainText(/contraseña incorrectos/i);
    await pos.getByLabel("Contraseña de la cuenta", { exact: true }).fill(password);
    await pos.getByRole("button", { name: "Ingresar y activar este equipo" }).click();
    await expect.poll(() => pos.evaluate(() => window.gastronomy.getLicenseStatus())).toMatchObject({ state: "ACTIVE", canOperate: true, account: { email } });
    await expect(pos.getByLabel("Contraseña de la cuenta", { exact: true })).toHaveValue("");
    await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((win) => win.destroy()));
    await app!.close(); app = undefined;
    authority.close(); authorityClosed = true;
    pos = await launch();
    const offline = await pos.evaluate(() => window.gastronomy.refreshLicense());
    expect(offline).toMatchObject({ state: "ACTIVE", canOperate: true, account: { email } });
    const local = await pos.evaluate(async () => {
      const api = window.gastronomy;
      await api.openCashSession({ openingAmountMinor: 0 });
      const order = await api.createOrder({ type: "TAKEAWAY", customerName: "Mostrador offline", customerPhone: "1111111111" });
      const data = await api.bootstrap();
      const product = data.products.find((item) => item.active && !item.comboDefinition && item.prices.some((p) => p.priceListCode === "TAKEAWAY"))!;
      await api.addOrderItem({ orderId: order.id, productId: product.id, quantity: 1 });
      const confirmed = await api.confirmOrder({ orderId: order.id });
      await api.payOrder({ orderId: order.id, payments: [{ methodCode: "CASH", amountMinor: confirmed.totalMinor }] });
      return api.getOrder({ orderId: order.id });
    });
    expect(local.id).toBeTruthy();
    expect(local.paymentStatus).toBe("PAID");
    for (const name of ["license-state.json", "device-identity.json"]) expect(await readFile(join(profile, name), "utf8")).not.toContain(password);
  } finally {
    if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((win) => win.destroy())).catch(() => {}); await app.close().catch(() => {}); }
    if (!authorityClosed) authority.close();
    await rm(profile, { recursive: true, force: true });
  }
});
