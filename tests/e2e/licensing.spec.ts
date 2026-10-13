import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

let app: ElectronApplication;
let page: Page;
let profile: string;

test.beforeEach(async () => {
  profile = await mkdtemp(join(tmpdir(), "gastronomy-licensing-"));
  app = await electron.launch({
    args: ["apps/desktop-shell", `--user-data-dir=${profile}`],
    cwd: process.cwd(),
  });
  page = await app.firstWindow();
  await expect(page.getByText("Delta Nube", { exact: true })).toBeVisible();
  expect(
    resolve(await app.evaluate(({ app }) => app.getPath("userData"))),
  ).toBe(resolve(profile));
});

test.afterEach(async () => {
  await app?.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().forEach((window) => window.destroy()),
  );
  await app?.close();
  if (
    !resolve(profile).startsWith(
      resolve(tmpdir()) + sep + "gastronomy-licensing-",
    )
  )
    throw new Error("Unsafe disposable profile path");
  await rm(profile, { recursive: true, force: true });
});

test("development runtime reports DEVELOPMENT through the real preload and IPC", async () => {
  const status = await page.evaluate(async () =>
    window.gastronomy.getLicenseStatus(),
  );
  expect(status).toMatchObject({ state: "DEVELOPMENT", canOperate: true });
  expect(status.installationId).toBeTruthy();
  expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(false);
});

test("settings license panel shows the live development status without activation UI or a blocking banner", async () => {
  await page.getByRole("link", { name: "Configuración", exact: true }).click();
  await page.getByRole("button", { name: "Licencia", exact: true }).click();
  const panel = page.locator("#settings-license");
  await expect(panel).toBeVisible();
  await expect(
    panel.getByText("Modo de desarrollo", { exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByText("Modo desarrollo: licencia no requerida.", { exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Verificar licencia" }),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Activar licencia" }),
  ).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  // Development must not render an interruptive license banner or modal.
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("license settings coexist with the existing backup section", async () => {
  await page.getByRole("link", { name: "Configuración", exact: true }).click();
  await page.getByRole("button", { name: "Licencia", exact: true }).click();
  await expect(page.locator("#settings-license")).toBeVisible();
  await page
    .getByRole("button", { name: "Copias de seguridad", exact: true })
    .click();
  await expect(page.locator("#settings-backup")).toBeVisible();
  await expect(
    page
      .locator("#settings-backup")
      .getByRole("button", { name: "Crear copia local", exact: true }),
  ).toBeVisible();
});
