import { test, expect, type ElectronApplication } from "@playwright/test";
import { launchConfiguredPos } from "./pos-fixture";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { generateKeyPairSync, randomBytes } from "node:crypto";

test("registro real sin tarjeta → correo → cuenta → desktop → trial y subdominio → reinicio offline", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const { createLicenseServer } =
    await import("../../apps/licensing-service/dist/server.js");
  const { createOrdersServer } =
    await import("../../apps/orders-service/dist/server.js");
  const profile = await mkdtemp(
    join(tmpdir(), "gastronomy-local-pilot-e2e-trial-"),
  );
  const keys = generateKeyPairSync("ed25519"),
    secret = randomBytes(32).toString("hex");
  const email = "trial-real@example.test",
    password = "Una contraseña real de ensayo 2026!";
  const mail: Array<{ to: string; subject: string; text: string }> = [];
  const reserve = createServer();
  await new Promise<void>((resolve) => reserve.listen(0, "127.0.0.1", resolve));
  const port = (reserve.address() as { port: number }).port;
  await new Promise<void>((resolve) => reserve.close(() => resolve()));
  const origin = `http://127.0.0.1:${port}`;
  const authority = createLicenseServer({
    dbPath: join(profile, "authority.sqlite"),
    adminToken: randomBytes(32).toString("hex"),
    privateKey: keys.privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString(),
    webSiteProvisionSecret: secret,
    publicRegistration: {
      origin,
      sendMail: async (message: (typeof mail)[number]) => {
        mail.push(message);
      },
    },
  });
  const orders = createOrdersServer({
    dbPath: join(profile, "orders.sqlite"),
    stores: [],
    provisioning: { secret, baseDomain: "trial.example.test" },
  });
  let app: ElectronApplication | undefined,
    authorityClosed = false;
  try {
    await new Promise<void>((resolve) =>
      authority.server.listen(port, "127.0.0.1", resolve),
    );
    await new Promise<void>((resolve) =>
      orders.server.listen(0, "127.0.0.1", resolve),
    );
    const ordersOrigin = `http://127.0.0.1:${(orders.server.address() as { port: number }).port}`;
    await page.goto(`${origin}/registro/`);
    await expect(
      page.getByRole("heading", { name: "Probá gratis 30 días" }),
    ).toBeVisible();
    await expect(page.locator('input[autocomplete="cc-number"]')).toHaveCount(
      0,
    );
    await page.screenshot({
      path: testInfo.outputPath("registro.png"),
      fullPage: true,
    });
    await page.getByLabel("Correo electrónico").fill(email);
    await page
      .getByRole("button", { name: "Enviar enlace", exact: true })
      .click();
    await expect.poll(() => mail.length).toBe(1);
    const db = new DatabaseSync(join(profile, "authority.sqlite"));
    try {
      expect(db.prepare("SELECT count(*) n FROM accounts").get()?.n).toBe(0);
      const link = mail[0]!.text.match(/http:\/\/\S+/)![0];
      await page.goto(link);
      await expect(page).toHaveURL(`${origin}/registro/`);
      await page.getByLabel("Nombre del negocio").fill("Café Trial");
      await page.getByLabel("Contraseña", { exact: true }).fill(password);
      await page
        .getByRole("button", { name: "Crear cuenta", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "¡Tu cuenta está lista!" }),
      ).toBeVisible();
      expect(
        db.prepare("SELECT started_at FROM license_trials").get()?.started_at,
      ).toBeNull();
      await page.goto(`${origin}/descargas/`);
      await expect(page.locator("#downloads-status")).toContainText(
        "Todavía no hay instaladores",
      );
      await writeFile(
        join(profile, "local-license-config.json"),
        JSON.stringify({
          serverUrl: origin,
          publicKey: keys.publicKey
            .export({ type: "spki", format: "pem" })
            .toString(),
        }),
      );
      const env = { ...process.env };
      for (const key of Object.keys(env))
        if (
          key.startsWith("GASTRONOMY_") &&
          key !== "GASTRONOMY_E2E_BACKGROUND"
        )
          delete env[key];
      Object.assign(env, {
        GASTRONOMY_LOCAL_PILOT: "1",
        GASTRONOMY_WEB_PROVISION_URL: ordersOrigin,
      });
      const launch = async () => {
        app = await launchConfiguredPos({
          args: ["apps/desktop-shell", `--user-data-dir=${profile}`],
          env,
        });
        return app.firstWindow();
      };
      let pos = await launch();
      expect(
        await pos.evaluate(() => window.gastronomy.getLicenseStatus()),
      ).toMatchObject({ state: "UNACTIVATED", canOperate: false });
      await pos
        .getByRole("link", { name: "Configuración", exact: true })
        .click();
      await pos.getByRole("tab", { name: "Licencia", exact: true }).click();
      await pos.getByLabel("Correo de la cuenta", { exact: true }).fill(email);
      await pos
        .getByLabel("Contraseña de la cuenta", { exact: true })
        .fill(password);
      await pos
        .getByRole("button", { name: "Ingresar y activar este equipo" })
        .click();
      await expect
        .poll(() => pos.evaluate(() => window.gastronomy.getLicenseStatus()))
        .toMatchObject({
          state: "ACTIVE",
          canOperate: true,
          account: { email },
        });
      const status = await pos.evaluate(() =>
        window.gastronomy.getLicenseStatus(),
      );
      expect(status.trial).toBeTruthy();
      expect(
        Date.parse(status.trial!.endsAt) - Date.parse(status.trial!.startedAt),
      ).toBe(30 * 86_400_000);
      await expect(
        pos.getByText(/Prueba gratuita · 30 días restantes/),
      ).toBeVisible();
      const site = await pos.evaluate(() =>
        window.gastronomy.registerWebSite({
          slug: "cafe-trial",
          whatsappNumber: "5491112345678",
        }),
      );
      expect(site.state).toBe("ACTIVE");
      const siteDb = new DatabaseSync(join(profile, "orders.sqlite"));
      try {
        expect(
          siteDb.prepare("SELECT access_until FROM tenant_sites").get()
            ?.access_until,
        ).toBe(status.trial!.endsAt);
      } finally {
        siteDb.close();
      }
      await app!.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().forEach((win) => win.destroy()),
      );
      await app!.close();
      app = undefined;
      authority.close();
      authorityClosed = true;
      pos = await launch();
      const offline = await pos.evaluate(() =>
        window.gastronomy.refreshLicense(),
      );
      expect(offline).toMatchObject({
        state: "ACTIVE",
        canOperate: true,
        trial: status.trial,
        account: { email },
      });
      for (const file of ["license-state.json", "device-identity.json"])
        expect(await readFile(join(profile, file), "utf8")).not.toContain(
          password,
        );
    } finally {
      db.close();
    }
  } finally {
    if (app) {
      await app
        .evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().forEach((win) => win.destroy()),
        )
        .catch(() => {});
      await app.close().catch(() => {});
    }
    if (!authorityClosed) authority.close();
    await orders.close();
    await rm(profile, { recursive: true, force: true });
  }
});
