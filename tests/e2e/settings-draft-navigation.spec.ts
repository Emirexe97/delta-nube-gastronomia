import { launchConfiguredPos } from "./pos-fixture";
import {
  test,
  expect,
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
  profile = await mkdtemp(join(tmpdir(), "gastronomy-settings-draft-nav-"));
  app = await launchConfiguredPos({
    args: ["apps/desktop-shell", `--user-data-dir=${profile}`],
    cwd: process.cwd(),
  });
  page = await app.firstWindow();
  expect(resolve(await app.evaluate(({ app }) => app.getPath("userData")))).toBe(
    resolve(profile),
  );
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
      !basename(profile).startsWith("gastronomy-settings-draft-nav-")
    )
      throw new Error("Unsafe disposable profile cleanup");
    await rm(profile, { recursive: true, force: true });
  }
});

test("settings tab navigation preserves drafts and guards only real page history", async () => {
  await page.getByRole("link", { name: "Resumen", exact: true }).click();
  await expect(page).toHaveURL(/#\/resumen$/);
  await page.getByRole("link", { name: "Productos", exact: true }).click();
  await expect(page).toHaveURL(/#\/catalogo$/);
  await page.getByRole("link", { name: "Configuración", exact: true }).click();
  await expect(page.getByRole("tab", { name: "General", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  const businessName = page.getByLabel("Nombre visible", { exact: true });
  const initialName = await businessName.inputValue();
  await businessName.fill("Borrador de navegación E2E");
  await expect
    .poll(() => page.evaluate(() => window.history.state?.gastronomyDirtyGuard))
    .toBe(true);

  await page.getByRole("tab", { name: "Impresión", exact: true }).click();
  await page.getByRole("tab", { name: "Textos", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab", { name: "Textos", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  // In-panel settings links replace the settings route/hash and must not trigger
  // the page-level dirty guard or discard the shared form draft.
  await page.getByRole("link", { name: "Configuración", exact: true }).click();
  await page.getByRole("tab", { name: "General", exact: true }).click();
  await expect(businessName).toHaveValue("Borrador de navegación E2E");

  const activateLicense = page.getByRole("link", {
    name: /Activar licencia|Ver licencia/,
    exact: true,
  });
  if ((await activateLicense.count()) > 0 && (await activateLicense.isVisible())) {
    await activateLicense.click();
    await expect(page).toHaveURL(/#\/configuracion(?:#settings-license)?$/);
    await page.getByRole("tab", { name: "General", exact: true }).click();
    await expect(businessName).toHaveValue("Borrador de navegación E2E");
  }

  const cancelBack = page.waitForEvent("dialog").then(async (dialog) => {
    expect(dialog.message()).toContain("cambios sin guardar");
    await dialog.dismiss();
  });
  await Promise.all([page.goBack(), cancelBack]);
  await expect(page).toHaveURL(/#\/configuracion(?:#settings-general)?$/);
  await expect(businessName).toHaveValue("Borrador de navegación E2E");

  const acceptBack = page.waitForEvent("dialog").then(async (dialog) => {
    expect(dialog.message()).toContain("cambios sin guardar");
    await dialog.accept();
  });
  await Promise.all([page.goBack(), acceptBack]);
  await expect(page).toHaveURL(/#\/catalogo$/);
  await expect(page.getByRole("link", { name: "Productos", exact: true })).toBeVisible();

  await page.goForward();
  await expect(page).toHaveURL(/#\/configuracion(?:#settings-general)?$/);
  await expect(page.getByRole("tab", { name: "General", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(businessName).toHaveValue(initialName);
  await expect(page.locator('[data-navigation-dirty="true"]')).toHaveCount(0);

  await page.goBack();
  await expect(page).toHaveURL(/#\/catalogo$/);
  await page.goForward();
  await expect(page).toHaveURL(/#\/configuracion(?:#settings-general)?$/);
  await page.goBack();
  await expect(page).toHaveURL(/#\/catalogo$/);
  await page.goBack();
  await expect(page).toHaveURL(/#\/resumen$/);
  await page.goForward();
  await expect(page).toHaveURL(/#\/catalogo$/);
  await page.goForward();
  await expect(page).toHaveURL(/#\/configuracion(?:#settings-general)?$/);
});
