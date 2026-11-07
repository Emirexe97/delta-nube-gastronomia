import { test, expect, _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

let app: ElectronApplication;
let page: Page;
let profile = "";

test.beforeEach(async () => {
  profile = await mkdtemp(join(tmpdir(), "gastronomy-settings-sections-"));
  app = await electron.launch({
    args: ["apps/desktop-shell", `--user-data-dir=${profile}`],
    cwd: process.cwd(),
  });
  page = await app.firstWindow();
  expect(resolve(await app.evaluate(({ app }) => app.getPath("userData")))).toBe(resolve(profile));
  await expect(page.getByText("Delta Nube", { exact: true })).toBeVisible();
});

test.afterEach(async () => {
  await app?.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((window) => window.destroy()));
  await app?.close();
  if (profile) {
    if (dirname(resolve(profile)) !== resolve(tmpdir()) || !basename(profile).startsWith("gastronomy-settings-sections-"))
      throw new Error("Unsafe disposable profile cleanup");
    await rm(profile, { recursive: true, force: true });
  }
});

test("settings sections use HashRouter URLs, preserve drafts, and lazy-load printer discovery", async () => {
  const originalName = await page.evaluate(async () => (await window.gastronomy.bootstrap()).settings.businessName);
  await app.evaluate(({ipcMain}) => {
    (globalThis as any).__printerScanCount = 0;
    ipcMain.removeHandler("gastronomy:listPrinters");
    ipcMain.handle("gastronomy:listPrinters", () => {
      (globalThis as any).__printerScanCount++;
      return [];
    });
  });
  await page.evaluate(() => {
    window.location.hash = "/configuracion#settings-license";
  });
  await expect(page.getByRole("tab", { name: "Licencia", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#settings-license")).toBeVisible();
  await expect(page).toHaveURL(/#\/configuracion#settings-license$/);
  expect(await app.evaluate(() => (globalThis as any).__printerScanCount)).toBe(0);
  for (const tab of await page.getByRole("tab").all()) {
    const panelId = await tab.getAttribute("aria-controls");
    await expect(page.locator(`#${panelId}`)).toHaveCount(1);
  }

  await page.getByRole("tab", { name: "Actualizaciones", exact: true }).click();
  await expect(page.locator("#settings-updates")).toBeVisible();
  await expect(page).toHaveURL(/#\/configuracion#settings-updates$/);
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Resumen", exact: true })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole("tab", { name: "Actualizaciones", exact: true })).toHaveAttribute("aria-selected", "true");

  await page.getByRole("tab", {name:"Actualizaciones",exact:true}).focus();
  await page.keyboard.press("Home");
  await expect(page.getByRole("tab", { name: "General", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Impresión", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => app.evaluate(() => (globalThis as any).__printerScanCount)).toBe(1);
  const terminal = page.getByLabel("Nombre de la terminal", { exact: true });
  await terminal.fill("Caja de prueba");
  await expect.poll(() => page.evaluate(() => window.history.state?.gastronomyDirtyGuard)).toBe(true);
  const dirtyHistoryLength = await page.evaluate(() => window.history.length);
  await page.getByRole("tab", { name: "Textos", exact: true }).click();
  const header = page.getByLabel("Encabezado de cuenta", { exact: true });
  await header.fill("Cuenta borrador");
  await page.getByRole("tab", { name: "Impresión", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Impresión", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(terminal).toHaveValue("Caja de prueba");
  await page.getByRole("tab", { name: "Textos", exact: true }).click();
  await expect(header).toHaveValue("Cuenta borrador");
  expect(await page.evaluate(() => window.history.length)).toBe(dirtyHistoryLength);
  await page.getByRole("tab", { name: "General", exact: true }).click();
  await expect(page.getByLabel("Nombre visible", { exact: true })).toHaveValue(originalName);
  await page.getByRole("tab", { name: "Impresión", exact: true }).click();
  await expect(terminal).toHaveValue("Caja de prueba");
  await page.getByRole("tab", { name: "Textos", exact: true }).click();
  await expect(header).toHaveValue("Cuenta borrador");

  await page.getByRole("tab", { name: "General", exact: true }).click();
  await page.getByLabel("Nombre visible", { exact: true }).fill("Local actualizado");
  await page.evaluate(async () => {
    const current = await window.gastronomy.bootstrap();
    await window.gastronomy.saveSettings({...current.settings,businessName:"Actualización externa"});
  });
  await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0]!.webContents.send("gastronomy:waiterOrderChanged"));
  await expect(page.getByLabel("Nombre visible", { exact: true })).toHaveValue("Local actualizado");
  await page.getByRole("button", { name: "Guardar configuración", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Configuración guardada." })).toBeVisible();
  await expect.poll(async () => (await page.evaluate(() => window.gastronomy.bootstrap())).settings.businessName).toBe("Local actualizado");
  const saved=await page.evaluate(async()=> (await window.gastronomy.bootstrap()).settings);
  expect(saved.printing.terminalLabel).toBe("Caja de prueba");
  expect(saved.printing.receiptTemplate.title).toBe("Cuenta borrador");
  await expect(page.locator('[data-navigation-dirty="true"]')).toHaveCount(0);
});
