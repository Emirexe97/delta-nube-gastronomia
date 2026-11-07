import { test, expect, _electron as electron, type Page } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:http";

const primary = "#c2410c";

async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {})));
    await new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
  });
  // Hidden Electron windows submit their next compositor frame asynchronously.
  await page.waitForTimeout(300);
}

test("shell de escritorio conserva tema compartido en Salón y Resumen", async ({}, testInfo) => {
  const profile = await mkdtemp(join(tmpdir(), "gastronomy-shared-visual-"));
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    app = await electron.launch({
      args: ["apps/desktop-shell", `--user-data-dir=${profile}`],
      cwd: process.cwd(),
    });
    const page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1366, 900));
    await expect(page.getByText("Delta Nube", { exact: true })).toBeVisible();
    const themeColor = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--dn-color-primary").trim());
    expect(await themeColor()).toBe(primary);

    await page.getByRole("link", { name: "Salón", exact: true }).click();
    await expect(page.getByRole("heading", { name: /Salón/i }).first()).toBeVisible();
    await expect(page.getByRole("tab", { name: "Mesas", exact: true })).toBeVisible();
    await settle(page);
    const salonScreenshot = testInfo.outputPath("shared-style-salon-desktop.png");
    await page.screenshot({ path: salonScreenshot, fullPage: true });
    await testInfo.attach("shared-style-salon-desktop", {
      path: salonScreenshot, contentType: "image/png",
    });
    await page.getByRole("link", { name: "Resumen", exact: true }).click();
    await expect(page.getByRole("heading", { name: /Resumen/i }).first()).toBeVisible();
    expect(await themeColor()).toBe(primary);
    await expect(page.getByRole("heading", { name: "Pedidos con pagos registrados" })).toBeVisible();
    await settle(page);
    await page.screenshot({ path: testInfo.outputPath("shared-style-summary-desktop.png"), fullPage: true });
    await testInfo.attach("shared-style-summary-desktop", {
      path: testInfo.outputPath("shared-style-summary-desktop.png"),
      contentType: "image/png",
    });
    const paymentsHelp = page.getByRole("button", { name: /Pagos registrados/ }).first();
    const paymentsTooltip = page.getByRole("tooltip").filter({ hasText: "Incluye pagos parciales" });
    await paymentsHelp.hover();
    await expect(paymentsTooltip).toBeVisible();
    await page.mouse.move((await paymentsTooltip.boundingBox())!.x + 8, (await paymentsTooltip.boundingBox())!.y + 8);
    await page.waitForTimeout(275);
    await expect(paymentsTooltip).toBeVisible();
    await paymentsHelp.focus();
    await page.keyboard.press("Escape");
    await expect(paymentsTooltip).toBeHidden();
    await expect(paymentsHelp).toBeFocused();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await paymentsHelp.click();
    await expect(paymentsTooltip).toBeVisible();
    await page.getByRole("heading", { name: /Resumen/i }).first().click();
    await expect(paymentsTooltip).toBeHidden();

    await page.getByRole("link", { name: "Configuración", exact: true }).click();
    await page.getByRole("tab", { name: "Impresión", exact: true }).click();
    const terminalLabel = page.getByLabel("Nombre de la terminal", { exact: true });
    await page.getByText("Nombre de la terminal", { exact: true }).click();
    await expect(terminalLabel).toBeFocused();
    const terminalHelp = page.getByRole("button", { name: "Ayuda: Nombre de la terminal", exact: true });
    const terminalTooltip = page.getByRole("tooltip").filter({ hasText: "Identifica esta caja" });
    await terminalHelp.focus();
    await expect(terminalTooltip).toBeVisible();
    await terminalHelp.click();
    await expect(terminalTooltip).toBeVisible();
    await page.getByRole("heading", { name: "Impresión", exact: true }).click();
    await expect(terminalTooltip).toBeHidden();
  } finally {
    await app?.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {});
    await app?.close();
    if (resolve(profile).startsWith(resolve(tmpdir()) + "\\")) await rm(profile, { recursive: true, force: true });
  }
});

test("Modo Mozo móvil: tema, ayudas accesibles, etiqueta PIN y controles táctiles", async ({ browser }, testInfo) => {
  test.setTimeout(30_000);
  // Use the built waiterHtml as a static page: no backend, RPC, or persistent app profile.
  const { waiterHtml } = await import("../../apps/orders-service/dist/waiter-page.js");
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(waiterHtml);
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No se pudo iniciar el servidor local de prueba");
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 320, height: 844 } });
  const page = await context.newPage();
  try {
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`http://127.0.0.1:${address.port}/waiter`);
      await expect(page.getByRole("heading", { name: "Ingresar como mozo" })).toBeVisible();
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--dn-color-primary").trim())).toBe(primary);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);

      const pin = page.getByLabel("PIN", { exact: true });
      await page.getByText("PIN", { exact: true }).tap();
      await expect(pin).toBeFocused();
      const help = page.getByRole("button", { name: "Ayuda sobre el PIN" });
      const tooltip = page.locator("#help-pin");
      const target = await help.boundingBox();
      expect(target?.width).toBeGreaterThanOrEqual(44);
      expect(target?.height).toBeGreaterThanOrEqual(44);

      // Keyboard focus opens the contextual help; Escape closes it safely.
      await help.focus();
      await expect(tooltip).toBeVisible();
      await expect(help).toHaveAttribute("aria-expanded", "true");
      await page.keyboard.press("Escape");
      await expect(tooltip).toBeHidden();
      await expect(help).toHaveAttribute("aria-expanded", "false");

      // A real touch toggles it; tap an unobstructed header target to dismiss.
      await help.tap();
      await expect(tooltip).toBeVisible();
      const panelBox = await tooltip.boundingBox();
      expect(panelBox!.x).toBeGreaterThanOrEqual(0);
      expect(panelBox!.x + panelBox!.width).toBeLessThanOrEqual(width);
      await help.tap();
      await expect(tooltip).toBeHidden();
      await help.tap();
      await expect(tooltip).toBeVisible();
      await page.locator("header h1").tap();
      await expect(tooltip).toBeHidden();
      const submitBox = await page.locator("#pairForm button[type=submit]").boundingBox();
      expect(submitBox?.height).toBeGreaterThanOrEqual(44);
      expect(await page.locator("#pairForm button[type=submit]").evaluate((button) => button.scrollWidth <= button.clientWidth)).toBe(true);
      if (width === 390) {
        const screenshotPath = testInfo.outputPath("shared-style-waiter-login-mobile.png");
        await page.screenshot({ path: screenshotPath, fullPage: true });
        await testInfo.attach("shared-style-waiter-login-mobile", { path: screenshotPath, contentType: "image/png" });
      }
    }
  } finally {
    await context.close();
    server.closeAllConnections();
    await new Promise<void>((ok, fail) => server.close((e) => e ? fail(e) : ok()));
  }
});
