import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
  type Locator,
} from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let app: ElectronApplication;
let page: Page;
let userData = "";

async function openSalonOrder(tableNumber: number) {
  await page.getByRole("link", { name: "Caja" }).click();
  await page.getByRole("button", { name: /Abrir caja/ }).click();
  await page.getByLabel("Cambio / fondo inicial").fill("50000");
  await page
    .getByRole("dialog", { name: "Abrir caja" })
    .getByRole("button", { name: "Abrir caja", exact: true })
    .click();
  await expect(page.getByText(/Caja #/)).toBeVisible();
  await page.getByRole("link", { name: "Salón" }).click();
  await page.getByLabel("Número de mesa").fill(String(tableNumber));
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await page
    .getByLabel(/^Nombre de mozo/)
    .selectOption({ label: "Administrador" });
  await page.getByRole("button", { name: "Abrir mesa", exact: true }).click();
  const editor = page.getByRole("dialog").last();
  await expect(
    editor.getByPlaceholder(/Código, nombre, categoría/),
  ).toBeVisible();
  return editor;
}

async function selectedProductIndex(editor: Locator) {
  const selected = await editor
    .locator('[id^="order-editor-product-"]')
    .evaluateAll((cards) =>
      cards
        .filter((card) => card.className.toString().includes("ring-2"))
        .map((card) => Number(card.id.replace("order-editor-product-", ""))),
    );
  return selected[0] ?? -1;
}

test.beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), "gastronomy-product-search-arrows-"));
  app = await electron.launch({
    args: ["apps/desktop-shell", `--user-data-dir=${userData}`],
    cwd: process.cwd(),
  });
  page = await app.firstWindow();
  await expect(page.getByText("Delta Nube", { exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const api = window.gastronomy;
    const data = await api.bootstrap();
    const categoryId = data.categories.find((category) => category.active)!.id;
    const prices = [
      { priceListCode: "SALON" as const, amountMinor: 12_000 },
      { priceListCode: "TAKEAWAY" as const, amountMinor: 13_000 },
      { priceListCode: "DELIVERY" as const, amountMinor: 14_000 },
    ];
    for (let index = 0; index < 12; index += 1) {
      await api.createProduct({
        categoryId,
        name: `Prueba flechas ${String(index).padStart(2, "0")}`,
        code: `ARROW-${String(index).padStart(2, "0")}`,
        prices,
      });
    }
    await api.createProduct({
      categoryId,
      name: "Producto testigo ajeno",
      code: "ARROW-WITNESS",
      prices,
    });
  });
  await page.reload();
});

test.afterEach(async () => {
  await app?.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) window.destroy();
  });
  await app?.close();
  if (userData) await rm(userData, { recursive: true, force: true });
});

test("las flechas conservan selección visible bajo el puntero y Enter agrega el producto activo", async ({}, info) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const editor = await openSalonOrder(51);
  const search = editor.getByPlaceholder(/Código, nombre, categoría/);

  await editor.getByRole("button", { name: /Producto testigo ajeno/ }).click();
  const witnessDialog = page.getByRole("dialog", {
    name: "Agregar · Producto testigo ajeno",
  });
  await witnessDialog
    .getByRole("button", { name: "Agregar a la mesa" })
    .click();
  await expect(
    editor.getByRole("article").filter({ hasText: "Producto testigo ajeno" }),
  ).toBeVisible();

  await search.fill("Prueba flechas");
  await expect(search).toBeFocused();
  await expect(editor.locator('[id^="order-editor-product-"]')).toHaveCount(12);
  expect(await selectedProductIndex(editor)).toBe(0);

  const firstCard = editor.locator("#order-editor-product-0");
  const firstBox = await firstCard.boundingBox();
  expect(firstBox).not.toBeNull();
  await page.mouse.move(
    firstBox!.x + firstBox!.width / 2,
    firstBox!.y + firstBox!.height / 2,
  );
  await expect(search).toBeFocused();
  for (let index = 0; index < 9; index += 1) await search.press("ArrowDown");
  await expect(search).toBeFocused();

  const selectedIndex = await selectedProductIndex(editor);
  const selectedVisibility =
    selectedIndex < 0
      ? { top: false, bottom: false, text: null }
      : await editor
          .locator(`#order-editor-product-${selectedIndex}`)
          .evaluate((card) => {
            const grid = card.parentElement!.getBoundingClientRect();
            const box = card.getBoundingClientRect();
            return {
              top: box.top >= grid.top - 1,
              bottom: box.bottom <= grid.bottom + 1,
              text: card.textContent,
            };
          });
  await info.attach("arrow-selection-before-enter", {
    body: JSON.stringify({ selectedIndex, selectedVisibility }, null, 2),
    contentType: "application/json",
  });
  expect(selectedIndex).toBe(9);
  expect(selectedVisibility.top && selectedVisibility.bottom).toBe(true);
  await expect(editor.locator("#order-editor-product-9")).toContainText(
    "Prueba flechas 09",
  );

  for (let index = 0; index < 3; index += 1) await search.press("ArrowDown");
  expect(await selectedProductIndex(editor)).toBe(0);
  await search.press("ArrowUp");
  expect(await selectedProductIndex(editor)).toBe(11);
  await search.press("ArrowDown");
  expect(await selectedProductIndex(editor)).toBe(0);
  for (let index = 0; index < 9; index += 1) await search.press("ArrowDown");
  expect(await selectedProductIndex(editor)).toBe(9);

  await search.press("Enter");
  const targetDialog = page.getByRole("dialog", {
    name: "Agregar · Prueba flechas 09",
  });
  await expect(targetDialog).toBeVisible();
  await targetDialog.getByRole("button", { name: "Agregar a la mesa" }).click();
  await expect(
    editor.getByRole("article").filter({ hasText: "Producto testigo ajeno" }),
  ).toBeVisible();
  await expect(
    editor.getByRole("article").filter({ hasText: "Prueba flechas 09" }),
  ).toBeVisible();

  await search.fill("Prueba flechas 0");
  await expect(search).toBeFocused();
  await expect(editor.locator('[id^="order-editor-product-"]')).toHaveCount(11);
  await expect.poll(() => selectedProductIndex(editor)).toBe(0);

  await search.fill("Sin resultados QA");
  await expect(editor.locator('[id^="order-editor-product-"]')).toHaveCount(0);
  const dialogsBeforeEnter = await page.getByRole("dialog").count();
  await search.press("Enter");
  await expect(page.getByRole("dialog")).toHaveCount(dialogsBeforeEnter);
  await expect(
    editor.getByRole("article").filter({ hasText: "Producto testigo ajeno" }),
  ).toBeVisible();
  await expect(
    editor.getByRole("article").filter({ hasText: "Prueba flechas 09" }),
  ).toBeVisible();
});

test("las cuatro flechas navegan productos sin perder el foco ni secuestrar modificadores de texto", async () => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const editor = await openSalonOrder(52);
  const search = editor.getByPlaceholder(/Código, nombre, categoría/);
  await search.fill("Prueba flechas");
  await expect(search).toBeFocused();
  await expect(editor.locator('[id^="order-editor-product-"]')).toHaveCount(12);
  expect(await selectedProductIndex(editor)).toBe(0);

  await search.press("ArrowRight");
  await expect(search).toBeFocused();
  expect(await selectedProductIndex(editor)).toBe(1);
  await search.press("ArrowRight");
  expect(await selectedProductIndex(editor)).toBe(2);
  await search.press("ArrowLeft");
  expect(await selectedProductIndex(editor)).toBe(1);
  await search.press("ArrowLeft");
  expect(await selectedProductIndex(editor)).toBe(0);
  await search.press("ArrowLeft");
  expect(await selectedProductIndex(editor)).toBe(11);
  await search.press("ArrowRight");
  expect(await selectedProductIndex(editor)).toBe(0);
  await search.press("ArrowDown");
  expect(await selectedProductIndex(editor)).toBe(1);
  await search.press("ArrowUp");
  expect(await selectedProductIndex(editor)).toBe(0);
  await search.press("ArrowUp");
  expect(await selectedProductIndex(editor)).toBe(11);
  await search.press("ArrowDown");
  expect(await selectedProductIndex(editor)).toBe(0);

  const queryBeforeModifiers = await search.inputValue();
  await search.press("Shift+ArrowLeft");
  await expect(search).toBeFocused();
  expect(await selectedProductIndex(editor)).toBe(0);
  const selection = await search.evaluate((input: HTMLInputElement) => ({
    start: input.selectionStart,
    end: input.selectionEnd,
    value: input.value,
  }));
  expect(selection.value).toBe(queryBeforeModifiers);
  expect(selection.end! - selection.start!).toBe(1);
  await search.press("Control+ArrowLeft");
  await expect(search).toBeFocused();
  expect(await selectedProductIndex(editor)).toBe(0);
  const caret = await search.evaluate((input: HTMLInputElement) => ({
    start: input.selectionStart,
    end: input.selectionEnd,
    value: input.value,
  }));
  expect(caret.value).toBe(queryBeforeModifiers);
  expect(caret.start).toBe(caret.end);
  expect(caret.start).toBeLessThan(selection.start!);

  await search.press("ArrowRight");
  expect(await selectedProductIndex(editor)).toBe(1);
  await search.press("Enter");
  const targetDialog = page.getByRole("dialog", {
    name: "Agregar · Prueba flechas 01",
  });
  await expect(targetDialog).toBeVisible();
  await targetDialog.getByRole("button", { name: "Agregar a la mesa" }).click();
  await expect(
    editor.getByRole("article").filter({ hasText: "Prueba flechas 01" }),
  ).toBeVisible();
});
