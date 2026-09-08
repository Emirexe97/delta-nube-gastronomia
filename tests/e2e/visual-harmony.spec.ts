import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Locator,
  type Page,
} from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let app: ElectronApplication;
let page: Page;
let userData: string;

async function expectSameControlRow(...controls: Locator[]) {
  const boxes = await Promise.all(
    controls.map((control) => control.boundingBox()),
  );
  for (const box of boxes) expect(box).not.toBeNull();
  const normalized = boxes as NonNullable<(typeof boxes)[number]>[];
  const first = normalized[0]!;
  const rest = normalized.slice(1);
  for (const box of rest) {
    expect(Math.abs(box.y - first.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.height - first.height)).toBeLessThanOrEqual(1);
  }
}

test.beforeAll(async () => {
  userData = await mkdtemp(join(tmpdir(), "gastronomy-visual-harmony-"));
  app = await electron.launch({
    args: ["apps/desktop-shell", `--user-data-dir=${userData}`],
    cwd: process.cwd(),
  });
  page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(1280, 820);
  });
  await expect(page.getByText("Delta Nube", { exact: true })).toBeVisible();
});

test.afterAll(async () => {
  await app?.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) window.destroy();
  });
  await app?.close();
  if (userData) await rm(userData, { recursive: true, force: true });
});

test("alinea controles vecinos aunque sólo uno tenga texto de ayuda", async () => {
  await page.getByRole("link", { name: "Clientes" }).click();
  await page
    .getByRole("button", { name: "Nuevo cliente", exact: true })
    .first()
    .click();

  let dialog = page.getByRole("dialog", { name: "Nuevo cliente" });
  await expectSameControlRow(
    dialog.getByLabel("Teléfono"),
    dialog.getByLabel("Nombre"),
  );
  await dialog.getByRole("button", { name: "Cerrar" }).click();

  await page.getByRole("link", { name: "Productos" }).click();
  await page
    .getByRole("button", { name: "Nuevo producto", exact: true })
    .click();

  dialog = page.getByRole("dialog", { name: "Nuevo producto" });
  await expectSameControlRow(
    dialog.getByLabel("Nombre"),
    dialog.getByLabel("Código"),
    dialog.getByLabel("Stock inicial"),
  );
});
