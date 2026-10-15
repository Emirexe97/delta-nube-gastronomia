import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { randomBytes, generateKeyPairSync } from "node:crypto";
import {
  createServer as createHttpServer,
  request as httpRequest,
} from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const run = promisify(execFile);
const root = process.cwd();
let profile = "";
let fixtureRoot = "";
let app: ElectronApplication | undefined;
let page: Page | undefined;
let licenseServer:
  | { server: ReturnType<typeof createHttpServer>; close: () => void }
  | undefined;
let proxy: ReturnType<typeof createHttpsServer> | undefined;
let licenseId = "";
let activationCode = "";
let adminToken = "";
let servicePort = 0;
let panelUrl = "";
const ownerPassword = "Isolated-owner-" + randomBytes(16).toString("hex");

test.setTimeout(180_000);
test.describe.configure({ mode: "serial" });
test.skip(
  process.platform !== "win32",
  "This packaged-runtime fixture is Windows-only.",
);

test.beforeAll(async () => {
  profile = await mkdtemp(join(tmpdir(), "gastronomy-license-packaged-"));
  fixtureRoot = join(profile, "fixture");
  const buildOutput = join(fixtureRoot, "electron-builder");
  await mkdir(fixtureRoot, { recursive: true });

  // A temporary unpacked Windows directory, never NSIS/MSI and never published.
  // Limit this suite to one fixture build and keep builder output out of the repository.
  // Playwright's spawned Node process cannot resolve the pnpm.cmd shim as an
  // executable on Windows. Run Corepack's JS entrypoint with this Node binary.
  const corepack = join(
    dirname(process.execPath),
    "node_modules",
    "corepack",
    "dist",
    "corepack.js",
  );
  await run(
    process.execPath,
    [
      corepack,
      "pnpm",
      "--filter",
      "@gastronomy/desktop-shell",
      "exec",
      "electron-builder",
      "--win",
      "dir",
      "--x64",
      "--publish",
      "never",
      "-c.asar=false",
      `-c.directories.output=${buildOutput}`,
    ],
    {
      cwd: root,
      timeout: 120_000,
      maxBuffer: 1024 * 1024,
    },
  );
  const appDirectory = join(buildOutput, "win-unpacked", "resources", "app");
  const packageApp = join(appDirectory, "package.json");
  await readFile(join(appDirectory, "dist", "main.js"));
  await readFile(join(appDirectory, "renderer", "index.html"));
  await readFile(packageApp);

  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  adminToken = randomBytes(48).toString("base64url");
  const serviceDb = join(profile, "license-service.sqlite");
  const serviceModule = await import(
    pathToFileURL(resolve(root, "apps/licensing-service/dist/server.js")).href
  );
  const openssl = "C:/Program Files/Git/usr/bin/openssl.exe";
  const caKey = join(profile, "ca.key.pem");
  const caCert = join(profile, "ca.cert.pem");
  await run(
    openssl,
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      caKey,
      "-out",
      caCert,
      "-days",
      "2",
      "-subj",
      "/CN=Delta Nube isolated E2E CA",
      "-addext",
      "subjectAltName=DNS:localhost,IP:127.0.0.1",
    ],
    { cwd: root, timeout: 30_000, maxBuffer: 256 * 1024 },
  );
  const key = await readFile(caKey);
  const cert = await readFile(caCert);
  proxy = createHttpsServer({ key, cert }, (incoming, outgoing) => {
    const upstream = httpRequest(
      {
        host: "127.0.0.1",
        port: servicePort,
        path: incoming.url,
        method: incoming.method,
        headers: { ...incoming.headers, host: "127.0.0.1" },
      },
      (response) => {
        outgoing.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(outgoing);
      },
    );
    upstream.on("error", () => {
      if (!outgoing.headersSent) outgoing.writeHead(502);
      outgoing.end();
    });
    incoming.pipe(upstream);
  });
  await listen(proxy, "127.0.0.1");
  const proxyAddress = proxy.address();
  if (!proxyAddress || typeof proxyAddress === "string")
    throw new Error("No se pudo abrir el proxy HTTPS local.");
  panelUrl = `https://127.0.0.1:${proxyAddress.port}`;
  const { hashPanelPassword } = await import(
    pathToFileURL(resolve(root, "apps/licensing-service/dist/panel-auth.js"))
      .href
  );
  licenseServer = serviceModule.createLicenseServer({
    dbPath: serviceDb,
    adminToken,
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    rateLimit: 500,
    panelAuth: {
      username: "owner-fixture",
      passwordHash: await hashPanelPassword(ownerPassword),
      origin: panelUrl,
      secureCookies: true,
    },
  });
  await listen(licenseServer.server, "127.0.0.1");
  const serviceAddress = licenseServer.server.address();
  if (!serviceAddress || typeof serviceAddress === "string")
    throw new Error("No se pudo abrir el servicio de licencias local.");
  servicePort = serviceAddress.port;
  await writeFile(
    join(appDirectory, "licensing-config.json"),
    JSON.stringify({
      serverUrl: panelUrl,
      publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
    }),
  );

  // Create a real license through the real local service and admin HTTP API.
  const paidThrough = new Date(
    Date.now() - 3 * 86_400_000 + 30_000,
  ).toISOString();
  const created = await fetch(
    `http://127.0.0.1:${serviceAddress.port}/admin/licenses`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${adminToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        businessName: "E2E aislado, no POS real",
        paidThrough,
      }),
    },
  );
  expect(created.status).toBe(201);
  const license = (await created.json()) as {
    license: { id: string };
    activationCode: string;
  };
  licenseId = license.license.id;
  activationCode = license.activationCode;
  servicePort = serviceAddress.port;
  await writeFile(
    join(profile, "license-fixture.json"),
    JSON.stringify({ licenseId, paidThrough }),
  );
});

test.afterAll(async () => {
  await app
    ?.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().forEach((window) => window.destroy()),
    )
    .catch(() => undefined);
  await app?.close().catch(() => undefined);
  proxy?.close();
  licenseServer?.close();
  if (profile) {
    if (
      !resolve(profile).startsWith(
        resolve(tmpdir()) + sep + "gastronomy-license-packaged-",
      )
    )
      throw new Error("Unsafe disposable fixture path");
    await rm(profile, { recursive: true, force: true });
  }
});

test("packaged runtime enforces expired writes, preserves read access, and resumes after real renewal", async ({}, testInfo) => {
  const buildOutput = join(fixtureRoot, "electron-builder", "win-unpacked");
  const renamed = join(buildOutput, "GastronomyLicenseTest.exe");
  const originalExe = join(buildOutput, "Delta Nube Gastronomía.exe");
  const { rename } = await import("node:fs/promises");
  await rename(originalExe, renamed);
  const userData = join(profile, "packaged-user-data");
  await mkdir(userData, { recursive: true });
  // Require the app's real packaged state before any test writes through IPC.
  app = await electron.launch({
    executablePath: renamed,
    args: [`--user-data-dir=${userData}`],
    cwd: buildOutput,
    env: { ...process.env, NODE_EXTRA_CA_CERTS: join(profile, "ca.cert.pem") },
    dumpio: true,
  });
  const packagedApp = app;
  expect(await packagedApp.evaluate(({ app }) => app.isPackaged)).toBe(true);
  const runtimeApp = await packagedApp.evaluate(({ app }) => app.getAppPath());
  expect(resolve(runtimeApp)).toBe(
    resolve(join(buildOutput, "resources", "app")),
  );
  expect(
    resolve(await packagedApp.evaluate(({ app }) => app.getPath("userData"))),
  ).toBe(resolve(userData));
  page = await packagedApp.firstWindow();
  const packagedPage = page;
  await expect(
    packagedPage.getByText("Delta Nube", { exact: true }),
  ).toBeVisible();
  const runtimeLog = {
    isPackaged: await packagedApp.evaluate(({ app }) => app.isPackaged),
    appPath: runtimeApp,
    executable: renamed,
    fixtureApp: join(buildOutput, "resources", "app"),
  };
  await writeFile(
    join(profile, "packaged-runtime-log.json"),
    JSON.stringify(runtimeLog, null, 2),
  );

  // Only native file-picker selection is stubbed; preload, IPC, SQLite, licensing and backup/export work are real.
  await packagedApp.evaluate(
    ({ app, dialog }, { userData }) => {
      const path = process.getBuiltinModule("path");
      if (path.resolve(app.getPath("userData")) !== path.resolve(userData))
        throw new Error("Wrong isolated userData");
      let selection = 0;
      dialog.showSaveDialog = async () => {
        const csv = selection++ > 0;
        return {
          canceled: false,
          filePath: path.join(
            userData,
            csv ? "sales-export.csv" : "gastronomy-backup.sqlite",
          ),
        };
      };
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [path.join(userData, "gastronomy-backup.sqlite")],
      });
      let messageBox = 0;
      dialog.showMessageBox = async () => ({
        response: messageBox++ === 0 ? 1 : 0,
        checkboxChecked: false,
      });
    },
    { userData },
  );

  const status0 = await packagedPage.evaluate(() =>
    window.gastronomy.getLicenseStatus(),
  );
  expect(status0).toMatchObject({ state: "UNACTIVATED", canOperate: false });
  const activated = await packagedPage.evaluate(
    (code) => window.gastronomy.activateLicense({ code }),
    activationCode,
  );
  expect(activated).toMatchObject({ state: "GRACE", canOperate: true });
  const opened = await packagedPage.evaluate(() =>
    window.gastronomy.openCashSession({
      openingAmountMinor: 0,
      note: "Fixture E2E",
    }),
  );
  const snapshot = await packagedPage.evaluate(() =>
    window.gastronomy.bootstrap(),
  );
  const expiresAt = Date.parse(activated.graceUntil!);
  while (Date.now() < expiresAt)
    await delay(Math.min(500, Math.max(50, expiresAt - Date.now())));
  let expired:
    Awaited<ReturnType<typeof window.gastronomy.getLicenseStatus>> | undefined;
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    expired = await packagedPage.evaluate(() =>
      window.gastronomy.getLicenseStatus(),
    );
    if (expired.state === "EXPIRED") break;
    await delay(250);
  }
  expect(expired).toMatchObject({ state: "EXPIRED", canOperate: false });
  await packagedPage
    .getByRole("link", { name: "Configuración", exact: true })
    .click();
  await packagedPage
    .getByRole("button", { name: "Licencia", exact: true })
    .click();
  const licensePanel = packagedPage.locator("#settings-license");
  await expect(
    licensePanel.getByText("Vencida", { exact: true }),
  ).toBeVisible();
  await expect(licensePanel.getByText(/venció/i)).toBeVisible();

  await expect(
    packagedPage.evaluate(
      (cashSessionId) =>
        window.gastronomy.registerCashMovement({
          cashSessionId,
          type: "INCOME",
          amountMinor: 100,
          reason: "Debe quedar bloqueado",
          idempotencyKey: "expired_income_001",
        }),
      opened.id,
    ),
  ).rejects.toThrow(/licencia|licencia/i);
  const afterDeniedWrite = await packagedPage.evaluate(() =>
    window.gastronomy.bootstrap(),
  );
  expect(afterDeniedWrite.cashSession).toEqual(snapshot.cashSession);
  expect(afterDeniedWrite.products).toEqual(snapshot.products);
  expect(afterDeniedWrite.orders).toEqual(snapshot.orders);
  expect(
    await packagedPage.evaluate(() =>
      window.gastronomy.listCashSessionHistory(),
    ),
  ).toBeDefined();

  const backup = await packagedPage.evaluate(() =>
    window.gastronomy.createBackup(),
  );
  expect(backup.path).toBe(join(userData, "gastronomy-backup.sqlite"));
  if (!backup.path) throw new Error("Backup handler returned no path.");
  expect((await readFile(backup.path)).byteLength).toBeGreaterThan(0);
  const exported = await packagedPage.evaluate(() =>
    window.gastronomy.exportSalesCsv(),
  );
  expect(exported.path).toBe(join(userData, "sales-export.csv"));
  if (!exported.path) throw new Error("Export handler returned no path.");
  await readFile(exported.path);

  // Restoration runs through the real packaged IPC/repository path. Only the
  // native picker and dialogs are stubbed; the fixture supplies a real backup.
  const restored = await packagedPage.evaluate(() =>
    window.gastronomy.restoreBackup(),
  );
  expect(restored).toMatchObject({
    path: backup.path,
    restored: true,
  });
  expect(
    await packagedPage.evaluate(() => window.gastronomy.getLicenseStatus()),
  ).toMatchObject({ state: "EXPIRED", canOperate: false });
  const afterRestore = await packagedPage.evaluate(() =>
    window.gastronomy.bootstrap(),
  );
  expect(afterRestore.cashSession).toEqual(snapshot.cashSession);
  expect(afterRestore.products).toEqual(snapshot.products);
  expect(afterRestore.orders).toEqual(snapshot.orders);

  await licensePanel.scrollIntoViewIfNeeded();
  await expect(licensePanel).toBeInViewport();
  const screenshot = testInfo.outputPath("packaged-license-expired.png");
  await packagedPage.screenshot({ path: screenshot, fullPage: false });
  await testInfo.attach("packaged-runtime-log", {
    path: join(profile, "packaged-runtime-log.json"),
    contentType: "application/json",
  });
  await testInfo.attach("packaged-license-expired-screen", {
    path: screenshot,
    contentType: "image/png",
  });

  const renewedThrough = new Date(Date.now() + 20 * 86_400_000).toISOString();
  const renewed = await fetch(
    `http://127.0.0.1:${servicePort}/admin/licenses/${licenseId}/renew`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${adminToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        paidThrough: renewedThrough,
        reason: "E2E renewal",
        idempotencyKey: "renewal_test_123456",
      }),
    },
  );
  expect(renewed.status).toBe(200);
  const active = await packagedPage.evaluate(() =>
    window.gastronomy.refreshLicense(),
  );
  expect(active).toMatchObject({ state: "ACTIVE", canOperate: true });
  await packagedPage.evaluate(
    (cashSessionId) =>
      window.gastronomy.registerCashMovement({
        cashSessionId,
        type: "INCOME",
        amountMinor: 100,
        reason: "Permitido tras renovación",
        idempotencyKey: "active_income_001",
      }),
    opened.id,
  );
  const finalState = await packagedPage.evaluate(() =>
    window.gastronomy.bootstrap(),
  );
  expect(finalState.cashSession?.expectedAmountMinor).toBe(
    (snapshot.cashSession?.expectedAmountMinor ?? 0) + 100,
  );
});

test("owner panel approves a packaged device without codes, suspends it and preserves offline access", async ({
  browser,
}, testInfo) => {
  await app?.close();
  app = undefined;
  const buildOutput = join(fixtureRoot, "electron-builder", "win-unpacked");
  const userData = join(profile, "panel-device-user-data");
  const launch = () =>
    electron.launch({
      executablePath: join(buildOutput, "GastronomyLicenseTest.exe"),
      args: [`--user-data-dir=${userData}`],
      cwd: buildOutput,
      env: {
        ...process.env,
        NODE_EXTRA_CA_CERTS: join(profile, "ca.cert.pem"),
      },
    });
  app = await launch();
  expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(true);
  page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().forEach((w) => w.hide()),
  );
  await page.getByRole("link", { name: "Configuración", exact: true }).click();
  await page.getByRole("button", { name: "Licencia", exact: true }).click();
  const client = page.locator("#settings-license");
  await expect(client.getByPlaceholder("Código de activación")).toHaveCount(0);
  await client.getByPlaceholder("Nombre del negocio").fill("E2E Panel Café");
  await client
    .getByRole("button", { name: "Solicitar habilitación", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await page!.evaluate(() => window.gastronomy.getLicenseStatus()))
          .enrollment?.status,
    )
    .toBe("PENDING");
  const pending = await page.evaluate(() =>
    window.gastronomy.getLicenseStatus(),
  );
  expect(pending).toMatchObject({
    state: "UNACTIVATED",
    canOperate: false,
    enrollment: { status: "PENDING" },
  });
  expect(pending.enrollment?.keyFingerprint).toHaveLength(64);
  await expect(
    page.evaluate(() =>
      window.gastronomy.openCashSession({
        openingAmountMinor: 0,
        note: "Should remain denied",
      }),
    ),
  ).rejects.toThrow(/licencia|habilitación/i);
  const identityBytes = await readFile(
    join(userData, "device-identity.json"),
    "utf8",
  );
  expect(identityBytes).not.toContain("BEGIN PRIVATE KEY");
  expect(JSON.parse(identityBytes).encryptedPrivateKey).toBeTruthy();

  // Real owner browser -> cookie session -> CSRF protected HTTP API -> SQLite.
  const ownerContext = await browser.newContext({ ignoreHTTPSErrors: true });
  const owner = await ownerContext.newPage();
  const errors: string[] = [];
  owner.on("pageerror", (error) => errors.push(error.message));
  await owner.goto(panelUrl + "/manage/");
  await owner.getByLabel("Usuario", { exact: true }).fill("owner-fixture");
  await owner.getByLabel("Contraseña", { exact: true }).fill(ownerPassword);
  await owner.getByRole("button", { name: /Ingresar/ }).click();
  await expect(
    owner.getByRole("heading", { name: "Licencias", exact: true }),
  ).toBeVisible();
  const requestedRow = owner
    .locator("#requestsBody tr")
    .filter({ hasText: pending.installationId });
  await expect(requestedRow).toContainText(pending.enrollment!.keyFingerprint!);
  await requestedRow.getByRole("button", { name: "Revisar" }).click();
  const dialog = owner.getByRole("dialog");
  await dialog.getByRole("checkbox", { name: /Comparé esta huella/ }).check();
  await dialog.getByLabel("Cómo asignar la licencia").selectOption("new");
  await dialog.locator('[name="reason"]').fill("Aprobación de prueba aislada");
  await dialog
    .getByRole("button", { name: "Aprobar solicitud", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  const licenseRow = owner
    .locator("#licensesBody tr")
    .filter({ hasText: "E2E Panel Café" });
  await expect(licenseRow).toContainText("Sin vencimiento");
  await client
    .getByRole("button", { name: "Verificar habilitación", exact: true })
    .last()
    .click();
  await expect
    .poll(
      async () =>
        (await page!.evaluate(() => window.gastronomy.getLicenseStatus()))
          .state,
    )
    .toBe("ACTIVE");
  await expect(
    client.getByText("Sin vencimiento", { exact: true }).first(),
  ).toBeVisible();
  const encryptedIdentityBeforeRestart =
    JSON.parse(identityBytes).encryptedPrivateKey;

  await licenseRow
    .getByRole("button", { name: "Suspender", exact: true })
    .click();
  await dialog.locator('[name="reason"]').fill("Suspensión de prueba aislada");
  await dialog
    .getByRole("button", { name: "Suspender licencia", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  expect(
    await page.evaluate(() => window.gastronomy.refreshLicense()),
  ).toMatchObject({ state: "SUSPENDED", canOperate: false });
  await expect(
    page.evaluate(() =>
      window.gastronomy.openCashSession({
        openingAmountMinor: 0,
        note: "Suspended deny",
      }),
    ),
  ).rejects.toThrow(/licencia/i);
  await licenseRow
    .getByRole("button", { name: "Reactivar", exact: true })
    .click();
  await dialog
    .locator('[name="reason"]')
    .fill("Reactivación de prueba aislada");
  await dialog
    .getByRole("button", { name: "Reactivar licencia", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  expect(
    await page.evaluate(() => window.gastronomy.refreshLicense()),
  ).toMatchObject({ state: "ACTIVE", canOperate: true });
  expect(errors).toEqual([]);
  await owner.screenshot({
    path: testInfo.outputPath("private-owner-panel.png"),
    fullPage: true,
  });
  await owner.setViewportSize({ width: 390, height: 844 });
  expect(
    await owner.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await owner.screenshot({
    path: testInfo.outputPath("private-owner-panel-mobile.png"),
    fullPage: true,
  });
  await ownerContext.close();
  await new Promise<void>((resolveClose, reject) =>
    proxy!.close((error) => (error ? reject(error) : resolveClose())),
  );
  expect(
    await page.evaluate(() => window.gastronomy.refreshLicense()),
  ).toMatchObject({ state: "ACTIVE", canOperate: true });
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  expect(
    await page.evaluate(() => window.gastronomy.getLicenseStatus()),
  ).toMatchObject({ state: "ACTIVE", canOperate: true });
  expect(
    JSON.parse(await readFile(join(userData, "device-identity.json"), "utf8"))
      .encryptedPrivateKey,
  ).toBe(encryptedIdentityBeforeRestart);
});

async function listen(
  server: {
    once(event: "error", listener: (error: Error) => void): unknown;
    removeListener(event: "error", listener: (error: Error) => void): unknown;
    listen(port: number, host: string, callback: () => void): unknown;
  },
  host: string,
) {
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => {
      server.removeListener("error", reject);
      resolveListen();
    });
  });
}
