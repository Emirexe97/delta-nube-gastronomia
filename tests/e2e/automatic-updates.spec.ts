import { launchConfiguredPos } from "./pos-fixture";
import {
  test,
  expect,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

let app: ElectronApplication;
let page: Page;
let profile = "";

test.beforeEach(async () => {
  profile = await mkdtemp(join(tmpdir(), "gastronomy-updates-"));
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !/^GASTRONOMY_/i.test(key)),
  );
  app = await launchConfiguredPos({
    args: [
      "apps/desktop-shell",
      `--user-data-dir=${profile}`,
      "--disable-background-networking",
      "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1",
    ],
    cwd: process.cwd(),
    env: {
      ...env,
      GASTRONOMY_E2E_BACKGROUND: process.env.GASTRONOMY_E2E_BACKGROUND,
      GASTRONOMY_WEB_PROVISION_URL: "",
      GASTRONOMY_WAITER_PROVISION_URL: "",
    },
  });
  page = await app.firstWindow();
  expect(
    resolve(await app.evaluate(({ app }) => app.getPath("userData"))),
  ).toBe(resolve(profile));
  await expect(page.getByText("Delta Nube", { exact: true })).toBeVisible();
});

test.afterEach(async () => {
  await app?.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().forEach((window) => window.destroy()),
  );
  await app?.close();
  if (profile) {
    const target = await realpath(profile);
    if (
      dirname(target) !== await realpath(tmpdir()) ||
      !basename(profile).startsWith("gastronomy-updates-")
    )
      throw new Error("Unsafe disposable updater profile cleanup");
    await rm(target, { recursive: true, force: true });
  }
});

test("development IPC reports disabled updates without affecting cash or license", async ({}, testInfo) => {
  // A stale native update-quit signal cannot close the database without an admitted install.
  await app.evaluate(({ app, autoUpdater }) => {
    autoUpdater.emit("before-quit-for-update");
    app.quit();
  });
  const result = await page.evaluate(async () => {
    const before = await window.gastronomy.bootstrap();
    const status = await window.gastronomy.getAppUpdateStatus();
    const checked = await window.gastronomy.checkAppUpdate();
    let installError = "";
    try {
      await window.gastronomy.installAppUpdate();
    } catch (error) {
      installError = String(error);
    }
    await window.gastronomy.openCashSession({ openingAmountMinor: 0 });
    return {
      status,
      checked,
      installError,
      beforeVersion: before.settings,
      after: await window.gastronomy.bootstrap(),
      license: await window.gastronomy.getLicenseStatus(),
    };
  });
  expect(result.status.state).toBe("DISABLED");
  expect(result.checked.state).toBe("DISABLED");
  expect(result.installError).toContain("No hay una actualización lista");
  expect(result.after.cashSession?.status).toBe("OPEN");
  expect(result.license.canOperate).toBe(true);
  await page.getByRole("link", { name: "Configuración", exact: true }).click();
  await page.getByRole("tab", { name: "Actualizaciones", exact: true }).click();
  await expect(
    page
      .locator("#settings-updates")
      .getByText("No disponible en esta instalación"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Buscar actualizaciones", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Instalar y reiniciar", exact: true }),
  ).toHaveCount(0);
  await page
    .locator("#settings-updates")
    .screenshot({ path: testInfo.outputPath("updates-disabled.png") });
});

test("update UI shows progress and READY, delegates install on click, and preserves READY after cancellation or refusal", async ({}, testInfo) => {
  // UI fixture only: simulates install IPC outcomes without opening a native dialog or running an update.
  await app.evaluate(({ ipcMain }) => {
    const fixture = {
      state: "DOWNLOADING",
      installCalls: 0,
      getStatus() {
        return {
          state: this.state,
          currentVersion: "0.1.24",
          availableVersion: "0.1.25",
          progress: this.state === "DOWNLOADING" ? 47 : 100,
          message: "Actualización de prueba de interfaz",
        };
      },
    };
    (globalThis as any).__updateUiFixture = fixture;
    for (const method of [
      "getAppUpdateStatus",
      "checkAppUpdate",
      "installAppUpdate",
    ])
      ipcMain.removeHandler(`gastronomy:${method}`);
    ipcMain.handle("gastronomy:getAppUpdateStatus", () => fixture.getStatus());
    ipcMain.handle("gastronomy:checkAppUpdate", () => fixture.getStatus());
    ipcMain.handle("gastronomy:installAppUpdate", () => {
      fixture.installCalls++;
      if (fixture.installCalls === 1) return fixture.getStatus();
      throw new Error("Cerrá la caja antes de instalar la actualización.");
    });
  });
  await page.reload();
  await page.getByRole("link", { name: "Configuración", exact: true }).click();
  await page.getByRole("tab", { name: "Actualizaciones", exact: true }).click();
  await expect(
    page.getByRole("progressbar", { name: "Progreso de descarga" }),
  ).toHaveAttribute("value", "47");
  await expect(
    page.getByRole("button", { name: "Buscar actualizaciones", exact: true }),
  ).toBeDisabled();
  await app.evaluate(() => {
    (globalThis as any).__updateUiFixture.state = "READY";
  });
  await page.reload();
  await expect(
    page.getByRole("link", { name: "Ver actualización" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Ver actualización" }).click();
  const installButton = page.getByRole("button", {
    name: "Instalar y reiniciar",
    exact: true,
  });
  await expect(installButton).toBeEnabled();
  await expect(installButton).toHaveAccessibleDescription(
    /La aplicación te pedirá confirmación antes de instalar y reiniciar/,
  );
  expect(
    await app.evaluate(
      () => (globalThis as any).__updateUiFixture.installCalls,
    ),
  ).toBe(0);
  await installButton.click();
  await expect
    .poll(() =>
      app.evaluate(() => (globalThis as any).__updateUiFixture.installCalls),
    )
    .toBe(1);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(installButton).toBeEnabled();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await installButton.click();
  await expect(page.getByRole("alert")).toContainText("Cerrá la caja");
  expect(
    await app.evaluate(
      () => (globalThis as any).__updateUiFixture.installCalls,
    ),
  ).toBe(2);
  await expect(installButton).toBeEnabled();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .locator("#settings-updates")
    .screenshot({ path: testInfo.outputPath("updates-ready-refusal.png") });
});
