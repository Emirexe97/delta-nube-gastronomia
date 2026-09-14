import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let app: ElectronApplication;
let page: Page;
let userData = "";

test.beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), "gastronomy-floor-zoom-"));
  app = await electron.launch({
    args: ["apps/desktop-shell", `--user-data-dir=${userData}`],
    cwd: process.cwd(),
  });
  page = await app.firstWindow();
  await expect(page.getByText("Delta Nube", { exact: true })).toBeVisible();
  await page.evaluate(() =>
    window.gastronomy.openCashSession({ openingAmountMinor: 0 }),
  );
  await page.reload();
});

test.afterEach(async () => {
  await app?.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) window.destroy();
  });
  await app?.close();
  if (userData) await rm(userData, { recursive: true, force: true });
});

test("permite hacer zoom y alejar con controles y con la rueda del mouse en el plano", async () => {
  await page.getByRole("link", { name: "Salón" }).click();
  await page.getByRole("tab", { name: "Plano por sectores" }).click();

  // 1. Controles flotantes de zoom presentes y en 100%
  const zoomControls = page.getByTestId("floor-plan-zoom-controls");
  await expect(zoomControls).toBeVisible();
  await expect(page.getByRole("button", { name: "Restablecer zoom" })).toHaveText("100%");

  const canvas = page.locator("[data-floor-canvas]");
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveCSS("transform", /matrix\(1,\s*0,\s*0,\s*1/);

  // 2. Acercar con el botón flotante (+)
  await page.getByRole("button", { name: "Acercar plano" }).click();
  await expect(page.getByRole("button", { name: "Restablecer zoom" })).toHaveText("118%");
  await expect(canvas).toHaveCSS("transform", /matrix\(1\.18/);

  // 3. Alejar con el botón flotante (-)
  await page.getByRole("button", { name: "Alejar plano" }).click();
  await expect(page.getByRole("button", { name: "Restablecer zoom" })).toHaveText("100%");

  // 4. Zoom mediante rueda del mouse (wheel event)
  const viewport = page.getByRole("region", { name: "Editor del plano" });
  await viewport.hover();
  await page.mouse.wheel(0, -200); // Rueda hacia arriba (zoom in)
  await expect(page.getByRole("button", { name: "Restablecer zoom" })).not.toHaveText("100%");

  // 5. Restablecer con el botón de porcentaje o centrar
  await page.getByRole("button", { name: "Centrar y restablecer" }).click();
  await expect(page.getByRole("button", { name: "Restablecer zoom" })).toHaveText("100%");
  await expect(canvas).toHaveCSS("transform", /matrix\(1,\s*0,\s*0,\s*1/);

  // 6. Verificar que las mesas se pueden abrir aun con zoom aplicado
  await page.getByRole("button", { name: "Acercar plano" }).click();
  await page.getByRole("button", { name: "Acercar plano" }).click();
  const tableBtn = page.getByRole("button", { name: /Abrir mesa 3\b/ });
  await expect(tableBtn).toBeVisible();
  await tableBtn.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Abrir mesa 3", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Cerrar", exact: true }).click();

  // 7. Paneo con arrastre del fondo
  const beforePanTransform = await canvas.evaluate(
    (el) => window.getComputedStyle(el).transform,
  );
  const viewportBounds = await viewport.boundingBox();
  expect(viewportBounds).not.toBeNull();
  if (viewportBounds) {
    await page.mouse.move(
      viewportBounds.x + viewportBounds.width / 2,
      viewportBounds.y + viewportBounds.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      viewportBounds.x + viewportBounds.width / 2 + 60,
      viewportBounds.y + viewportBounds.height / 2 + 40,
    );
    await page.mouse.up();
  }
  const afterPanTransform = await canvas.evaluate(
    (el) => window.getComputedStyle(el).transform,
  );
  expect(afterPanTransform).not.toEqual(beforePanTransform);

  // 8. Edición y selección de mesa con zoom activo
  await page.getByRole("button", { name: "Editar plano" }).click();
  await page.getByRole("button", { name: "Editar mesa 3" }).click();
  await expect(page.getByLabel("Número", { exact: true })).toHaveValue("3");
  await page.getByRole("button", { name: "Terminar edición" }).click();

  // 9. Crear nuevo sector y verificar restablecimiento automático a 100%
  await page.getByRole("button", { name: "Editar plano" }).click();
  await page.getByRole("button", { name: "Crear sector" }).click();
  const sectorDialog = page.getByRole("dialog");
  await sectorDialog.getByLabel("Nombre del sector").fill("Patio");
  await sectorDialog.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByRole("tab", { name: "Patio · 0" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Restablecer zoom" })).toHaveText("100%");
  await expect(canvas).toHaveCSS("transform", /matrix\(1,\s*0,\s*0,\s*1/);
});
