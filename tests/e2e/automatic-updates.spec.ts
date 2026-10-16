import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

let app: ElectronApplication;
let page: Page;
let profile = "";

test.beforeEach(async () => {
  profile = await mkdtemp(join(tmpdir(), "gastronomy-updates-"));
  app = await electron.launch({
    args: ["apps/desktop-shell", `--user-data-dir=${profile}`],
    cwd: process.cwd(),
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
    if (
      dirname(resolve(profile)) !== resolve(tmpdir()) ||
      !basename(profile).startsWith("gastronomy-updates-")
    )
      throw new Error("Unsafe disposable updater profile cleanup");
    await rm(profile, { recursive: true, force: true });
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

test("simulated update IPC shows progress and READY notice, confirms explicitly, preserves readiness after refusal", async ({}, testInfo) => {
  // UI fixture only, inside an isolated main process. No feed, download or executable is run.
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
      throw new Error("Cerrá la caja antes de instalar la actualización.");
    });
  });
  await page.reload();
  await page.getByRole("link", { name: "Configuración", exact: true }).click();
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
  await page
    .getByRole("button", { name: "Instalar y reiniciar", exact: true })
    .click();
  const modal = page.getByRole("dialog", {
    name: "¿Instalar la actualización?",
    exact: true,
  });
  await expect(modal).toBeVisible();
  expect(
    await app.evaluate(
      () => (globalThis as any).__updateUiFixture.installCalls,
    ),
  ).toBe(0);
  await modal.getByRole("button", { name: "Ahora no", exact: true }).click();
  await expect(modal).toHaveCount(0);
  expect(
    await app.evaluate(
      () => (globalThis as any).__updateUiFixture.installCalls,
    ),
  ).toBe(0);
  await page
    .getByRole("button", { name: "Instalar y reiniciar", exact: true })
    .click();
  await modal
    .getByRole("button", { name: "Confirmar instalación", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Cerrá la caja");
  expect(
    await app.evaluate(
      () => (globalThis as any).__updateUiFixture.installCalls,
    ),
  ).toBe(1);
  await expect(
    page.getByRole("button", { name: "Instalar y reiniciar", exact: true }),
  ).toBeEnabled();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .locator("#settings-updates")
    .screenshot({ path: testInfo.outputPath("updates-ready-refusal.png") });
});
