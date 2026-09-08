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
  userData = await mkdtemp(join(tmpdir(), "gastronomy-floor-plan-"));
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

test("crea un sector, diseña una mesa y la opera desde el plano", async () => {
  await page.getByRole("link", { name: "Salón" }).click();
  await expect(page.getByText("Carga rápida por teclado")).toBeVisible();
  await page.getByRole("tab", { name: "Plano por sectores" }).click();

  await expect(page.getByRole("tab", { name: /Salón ·/ })).toBeVisible();
  await page.getByRole("button", { name: "Editar plano" }).click();
  await page.getByRole("button", { name: "Crear sector" }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nombre del sector").fill("Terraza");
  await dialog.getByRole("button", { name: "Guardar" }).click();

  await expect(page.getByRole("tab", { name: "Terraza · 0" })).toBeVisible();
  await page.getByRole("button", { name: "Nueva mesa" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Número de mesa").fill("91");
  await dialog.getByRole("button", { name: "Agregar mesa" }).click();

  await expect(
    page.getByRole("button", { name: "Editar mesa 91" }),
  ).toBeVisible();
  await page.getByLabel("Nombre opcional").fill("Ventana");
  await page.getByLabel("Forma").selectOption("ROUND");
  await page.getByRole("button", { name: "Guardar mesa" }).click();
  await expect(page.getByText("Plano guardado.")).toBeVisible();

  const before = await page
    .getByRole("button", { name: "Editar mesa 91" })
    .boundingBox();
  expect(before).not.toBeNull();
  if (before) {
    await page.mouse.move(
      before.x + before.width / 2,
      before.y + before.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      before.x + before.width + 80,
      before.y + before.height + 40,
    );
    await page.mouse.up();
  }

  await page.getByRole("button", { name: "Terminar edición" }).click();
  await page.getByRole("button", { name: "Abrir mesa 91" }).click();
  dialog = page.getByRole("dialog");
  await expect(
    dialog.getByText("Abrir mesa 91", { exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Abrir mesa" }).click();
  const editor = page.getByRole("dialog", { name: /Pedido #\d+ · Salón/ });
  await expect(editor).toBeVisible();
  await editor.getByRole("button", { name: "Cerrar", exact: true }).click();
  await page.getByRole("tab", { name: "Vista clásica" }).click();
  await expect(
    page.getByRole("button", { name: "Abrir pedido de mesa 91" }),
  ).toBeVisible();
  await expect(page.getByText("Ventana", { exact: true })).toBeVisible();

  const persisted = await page.evaluate(async () => {
    const data = await window.gastronomy.bootstrap();
    const sector = data.tableSectors.find((item) => item.name === "Terraza");
    const table = data.tables.find((item) => item.number === 91);
    return { sector, table };
  });
  expect(persisted.table).toMatchObject({
    name: "Ventana",
    sectorId: persisted.sector?.id,
    shape: "ROUND",
  });
  expect(persisted.table?.layoutX).toBeGreaterThan(5);
});

test("sincroniza altas, cambios y eliminaciones entre ambas vistas", async () => {
  await page.getByRole("link", { name: "Salón" }).click();
  const tableCount = page.getByLabel("Mesas activas");
  const newNumber = Number(await tableCount.inputValue()) + 1;
  await tableCount.fill(String(newNumber));
  await page.getByRole("button", { name: "Actualizar salón" }).click();
  await expect(
    page.getByRole("button", { name: `Abrir mesa ${newNumber}` }),
  ).toBeVisible();

  await page.getByRole("tab", { name: "Plano por sectores" }).click();
  await page.getByRole("button", { name: "Editar plano" }).click();
  const planTable = page.getByRole("button", {
    name: `Editar mesa ${newNumber}`,
  });
  await expect(planTable).toBeVisible();
  await planTable.click();
  await page.getByLabel("Nombre opcional").fill("Mesa compartida");
  await page.getByRole("button", { name: "Guardar mesa" }).click();
  await expect(page.getByText("Plano guardado.")).toBeVisible();

  await page.getByRole("button", { name: "Terminar edición" }).click();
  await page.getByRole("tab", { name: "Vista clásica" }).click();
  await expect(
    page.getByText("Mesa compartida", { exact: true }),
  ).toBeVisible();

  await page.getByRole("tab", { name: "Plano por sectores" }).click();
  await page.getByRole("button", { name: "Editar plano" }).click();
  await page.getByRole("button", { name: `Editar mesa ${newNumber}` }).click();
  await page
    .getByRole("button", { name: "Eliminar mesa", exact: true })
    .click();
  const deleteDialog = page.getByRole("dialog", {
    name: `Eliminar mesa ${newNumber}`,
  });
  await deleteDialog
    .getByLabel("Confirmación número de mesa")
    .fill(String(newNumber));
  await deleteDialog
    .getByRole("button", { name: "Eliminar mesa", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: `Editar mesa ${newNumber}` }),
  ).toHaveCount(0);

  await page.getByRole("tab", { name: "Vista clásica" }).click();
  await expect(
    page.getByRole("button", { name: `Abrir mesa ${newNumber}` }),
  ).toHaveCount(0);
});

test("dibuja y personaliza figuras persistentes dentro de un sector", async () => {
  await page.getByRole("link", { name: "Salón" }).click();
  await page.getByRole("tab", { name: "Plano por sectores" }).click();
  await page.getByRole("button", { name: "Editar plano" }).click();
  await page.getByRole("button", { name: "Nueva figura" }).click();

  await expect(page.getByLabel("Tipo de figura")).toHaveValue("RECTANGLE");
  await page.getByLabel("Tipo de figura").selectOption("ELLIPSE");
  await page.getByLabel("Etiqueta opcional").fill("Macetero central");
  await page.getByLabel("Código de color").fill("#22C55E");
  await page.getByLabel("Ancho figura %").fill("26");
  await page.getByLabel("Alto figura %").fill("18");
  await page.getByRole("button", { name: "Guardar figura" }).click();
  await expect(page.getByText("Figura guardada.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Editar figura Macetero central" }),
  ).toBeVisible();
  const figure = page.getByRole("button", {
    name: "Editar figura Macetero central",
  });
  const bounds = await figure.boundingBox();
  expect(bounds).not.toBeNull();
  if (bounds) {
    await page.mouse.move(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width / 2 + 90, bounds.y + 60);
    await page.mouse.up();
  }

  const saved = await page.evaluate(async () => {
    const data = await window.gastronomy.bootstrap();
    return data.floorPlanShapes.find(
      (shape) => shape.label === "Macetero central",
    );
  });
  expect(saved).toMatchObject({
    kind: "ELLIPSE",
    color: "#22C55E",
    layoutWidth: 26,
    layoutHeight: 18,
  });
  expect(saved?.layoutX).toBeGreaterThan(12);

  await page.reload();
  await page.getByRole("link", { name: "Salón" }).click();
  await page.getByRole("tab", { name: "Plano por sectores" }).click();
  await expect(
    page.getByText("Macetero central", { exact: true }),
  ).toBeVisible();
});
