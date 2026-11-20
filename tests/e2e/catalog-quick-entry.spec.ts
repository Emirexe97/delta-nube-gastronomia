import { launchConfiguredPos } from "./pos-fixture";
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

let app: ElectronApplication;
let page: Page;
let profile = "";

test.beforeEach(async () => {
  profile = await mkdtemp(join(tmpdir(), "gastronomy-catalog-quick-entry-"));
  app = await launchConfiguredPos({
    args: ["apps/desktop-shell", `--user-data-dir=${profile}`],
    cwd: process.cwd(),
  });
  page = await app.firstWindow();
  await expect(page.getByText("Delta Nube", { exact: true })).toBeVisible();
  expect(resolve(await app.evaluate(({ app }) => app.getPath("userData")))).toBe(resolve(profile));
});

test.afterEach(async () => {
  await app?.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) window.destroy();
  });
  await app?.close();
  if (
    dirname(resolve(profile)) !== resolve(tmpdir()) ||
    !basename(profile).startsWith("gastronomy-catalog-quick-entry-")
  ) {
    throw Error("Unsafe test profile cleanup");
  }
  await rm(profile, { recursive: true, force: true });
});

async function products() {
  return page.evaluate(async () => (await window.gastronomy.bootstrap()).products);
}

async function openCatalog() {
  await page.getByRole("link", { name: "Productos", exact: true }).click();
}

test("duplica una ficha simple a borrador, preserva precio e inventario y al guardar crea un producto independiente", async ({}, testInfo) => {
  const source = await page.evaluate(async () => {
    const api = window.gastronomy;
    const data = await api.bootstrap();
    const category = data.categories.find((entry) => entry.active)!;
    const derived = await api.savePriceBook({
      name: "Lista propia copia E2E",
      adjustmentBps: 1000,
      authorizerPin: "748259",
      reason: "Preparar copia",
    });
    const book = derived.books.find((entry) => entry.name === "Lista propia copia E2E")!;
    const product = await api.createProduct({
      categoryId: category.id,
      name: "Ficha base para duplicar E2E",
      code: "DUP-SRC-E2E",
      stockMinor: 12345,
      stockTargetMinor: 30000,
      stockMinMinor: 12000,
      stockCriticalMinor: 5000,
      imageDataUrl: "data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJaQAA3AA/v89WAAAAA==",
      priceBook: { baseMinor: 12345, overrides: { [book.id]: 20100 } },
      prices: [],
    });
    return { product, bookId: book.id };
  });
  await page.reload();
  await openCatalog();
  await page.getByRole("button", { name: `Editar ${source.product.name}`, exact: true }).click();
  const sourceDialog = page.getByRole("dialog", { name: `Editar · ${source.product.name}`, exact: true });
  await sourceDialog.getByRole("button", { name: "Duplicar producto", exact: true }).click();

  const draft = page.getByRole("dialog", { name: "Nuevo producto", exact: true });
  await expect(draft.getByLabel("Nombre", { exact: true })).toHaveValue(`${source.product.name} (copia)`);
  await expect(draft.getByLabel("Categoría", { exact: true })).toHaveValue(source.product.categoryId);
  await expect(draft.getByLabel("Código", { exact: true })).toHaveValue("");
  await expect(draft.getByRole("note")).toBeVisible();
  await expect(draft.getByLabel("Precio Principal", { exact: true })).toHaveValue("123,45");
  await expect(draft.getByLabel("Precio fijo Lista propia copia E2E", { exact: true })).toHaveValue("201");
  await expect(draft.getByLabel("Controlar stock de este producto")).toBeChecked();
  await expect(draft.getByLabel("Stock actual", { exact: true })).toHaveValue("0");
  await expect(draft.getByLabel("Objetivo", { exact: true })).toHaveValue("30");
  await expect(draft.getByLabel("Mínimo", { exact: true })).toHaveValue("12");
  await expect(draft.getByLabel("Crítico", { exact: true })).toHaveValue("5");

  expect((await products()).some((entry) => entry.name === `${source.product.name} (copia)`)).toBe(false);
  await draft.screenshot({ path: testInfo.outputPath("catalog-copy-draft.png") });
  await draft.getByRole("button", { name: "Guardar producto", exact: true }).click();
  await expect(draft).toBeHidden();
  const after = await products();
  const saved = after.find((entry) => entry.name === `${source.product.name} (copia)`)!;
  expect(saved).toMatchObject({
    categoryId: source.product.categoryId,
    code: null,
    stockMinor: 0,
    stockTargetMinor: 30000,
    stockMinMinor: 12000,
    stockCriticalMinor: 5000,
    imageDataUrl: null,
    hasImage: true,
    parentProductId: null,
  });
  expect(saved.priceBook).toEqual({ baseMinor: 12345, overrides: { [source.bookId]: 20100 } });
  expect(after.find((entry) => entry.id === source.product.id)).toMatchObject({
    code: "DUP-SRC-E2E",
    stockMinor: 12345,
    priceBook: { baseMinor: 12345, overrides: { [source.bookId]: 20100 } },
  });
  expect(await page.evaluate(id => window.gastronomy.getProductImage({ productId: id }), saved.id)).toBe(source.product.imageDataUrl);
  expect(await page.evaluate(id => window.gastronomy.getProductImage({ productId: id }), source.product.id)).toBe(source.product.imageDataUrl);
});

test("Guardar y crear otro crea IDs distintos y reinicia los datos según la política de stock de la categoría", async ({}, testInfo) => {
  const categoryId = await page.evaluate(async () => {
    const category = await window.gastronomy.createCategory({
      name: "Categoría sin stock consecutiva E2E",
      stockControlEnabled: false,
    });
    return category.id;
  });
  await page.reload();
  await openCatalog();
  await page.getByRole("button", { name: "Nuevo producto", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "Nuevo producto", exact: true });
  await dialog.getByLabel("Categoría", { exact: true }).selectOption(categoryId);
  await dialog.getByLabel("Nombre", { exact: true }).fill("Alta consecutiva uno E2E");
  await dialog.getByLabel("Código", { exact: true }).fill("ALT-UNO-E2E");
  await dialog.getByLabel("Precio Principal", { exact: true }).fill("175,25");
  await expect(dialog.getByLabel("Controlar stock de este producto")).not.toBeChecked();
  await dialog.getByLabel("Controlar stock de este producto").check();
  await dialog.getByLabel("Stock actual", { exact: true }).fill("5");
  await dialog.getByLabel("Objetivo", { exact: true }).fill("10");
  await dialog.getByLabel("Mínimo", { exact: true }).fill("3");
  await dialog.getByLabel("Crítico", { exact: true }).fill("1");
  await dialog.getByRole("button", { name: "Guardar y crear otro", exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Nombre", { exact: true })).toHaveValue("");
  await expect(dialog.getByLabel("Nombre", { exact: true })).toBeFocused();
  await expect(dialog.getByLabel("Categoría", { exact: true })).toHaveValue(categoryId);
  await expect(dialog.getByLabel("Código", { exact: true })).toHaveValue("");
  await expect(dialog.getByLabel("Precio Principal", { exact: true })).toHaveValue("");
  await expect(dialog.getByLabel("Controlar stock de este producto")).not.toBeChecked();
  await expect(dialog.getByLabel("Stock actual", { exact: true })).toHaveCount(0);
  await dialog.screenshot({ path: testInfo.outputPath("catalog-after-create-another-reset.png") });
  await dialog.getByLabel("Nombre", { exact: true }).fill("Alta consecutiva dos E2E");
  await dialog.getByLabel("Precio Principal", { exact: true }).fill("199,75");
  await dialog.getByRole("button", { name: "Guardar producto", exact: true }).click();
  await expect(dialog).toBeHidden();
  const created = (await products()).filter((entry) => entry.code === "ALT-UNO-E2E" || entry.name === "Alta consecutiva dos E2E");
  expect(created).toHaveLength(2);
  expect(new Set(created.map((entry) => entry.id)).size).toBe(2);
  expect(created.map((entry) => entry.categoryId)).toEqual([categoryId, categoryId]);
  expect(created.find((entry) => entry.code === "ALT-UNO-E2E")).toMatchObject({
    name: "Alta consecutiva uno E2E",
    stockMinor: 5000,
    stockTargetMinor: 10000,
    stockMinMinor: 3000,
    stockCriticalMinor: 1000,
  });
  expect(created.find((entry) => entry.name === "Alta consecutiva dos E2E")).toMatchObject({
    code: null,
    stockMinor: null,
    stockTargetMinor: null,
    stockMinMinor: null,
    stockCriticalMinor: null,
  });
});

test("el borrador de duplicado queda protegido ante Escape y conserva datos al cancelar la confirmación", async () => {
  const source = await page.evaluate(async () => {
    const data = await window.gastronomy.bootstrap();
    const item = data.products.find((entry) => entry.active && !entry.parentProductId && !entry.comboDefinition)!;
    return item;
  });
  await openCatalog();
  await page.getByRole("button", { name: "Nuevo producto", exact: true }).click();
  const creation = page.getByRole("dialog", { name: "Nuevo producto", exact: true });
  await creation.getByLabel("Nombre", { exact: true }).fill("Alta con borrador E2E");
  const cancelCreation = page.waitForEvent("dialog").then(async (dialog) => {
    expect(dialog.message()).toContain("cambios sin guardar");
    await dialog.dismiss();
  });
  await Promise.all([creation.press("Escape"), cancelCreation]);
  await expect(creation.getByLabel("Nombre", { exact: true })).toHaveValue("Alta con borrador E2E");
  expect((await products()).some((entry) => entry.name === "Alta con borrador E2E")).toBe(false);

  const closeCreation = page.waitForEvent("dialog").then((dialog) => dialog.accept());
  await Promise.all([creation.getByRole("button", { name: "Cancelar", exact: true }).click(), closeCreation]);
  await page.getByRole("button", { name: `Editar ${source.name}`, exact: true }).click();
  const editor = page.getByRole("dialog", { name: `Editar · ${source.name}`, exact: true });
  await editor.getByRole("button", { name: "Duplicar producto", exact: true }).click();
  const draft = page.getByRole("dialog", { name: "Nuevo producto", exact: true });
  await draft.getByLabel("Nombre", { exact: true }).fill("Copia con borrador E2E");
  const confirm = page.waitForEvent("dialog").then(async (dialog) => {
    expect(dialog.message()).toContain("cambios sin guardar");
    await dialog.dismiss();
  });
  await Promise.all([draft.press("Escape"), confirm]);
  await expect(draft.getByLabel("Nombre", { exact: true })).toHaveValue("Copia con borrador E2E");
  expect((await products()).some((entry) => entry.name === "Copia con borrador E2E")).toBe(false);
});

test("cancelar fichas sin cambios no escribe y la ficha de un producto con hijos o un combo no ofrece duplicación", async () => {
  const seeded = await page.evaluate(async () => {
    const api = window.gastronomy;
    const data = await api.bootstrap();
    const categoryId = data.categories.find((entry) => entry.active)!.id;
    const prices = [
      { priceListCode: "SALON" as const, amountMinor: 12500 },
      { priceListCode: "TAKEAWAY" as const, amountMinor: 12500 },
      { priceListCode: "DELIVERY" as const, amountMinor: 12500 },
    ];
    const parent = await api.createProduct({ categoryId, name: "Base con hija para no duplicar E2E", prices });
    await api.createProduct({ categoryId, name: "Hija para no duplicar E2E", parentProductId: parent.id, prices });
    const combo = await api.createCombo({
      categoryId,
      name: "Combo para no duplicar E2E",
      prices,
      definition: { slots: [{ id: "slot-principal", name: "Principal", quantity: 1, productIds: [parent.id] }] },
      reason: "Preparar elegibilidad E2E",
      authorizerPin: "748259",
    });
    const untracked = await api.createProduct({
      categoryId,
      name: "Producto sin control stock para copiar E2E",
      stockMinor: null,
      prices,
    });
    return { parent, combo, untracked };
  });
  await page.reload();
  await openCatalog();
  const initialCount = (await products()).length;

  await page.getByRole("button", { name: "Nuevo producto", exact: true }).click();
  let draft = page.getByRole("dialog", { name: "Nuevo producto", exact: true });
  await draft.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(draft).toBeHidden();

  await page.getByRole("button", { name: `Editar ${seeded.parent.name}`, exact: true }).click();
  let editor = page.getByRole("dialog", { name: `Editar · ${seeded.parent.name}`, exact: true });
  await expect(editor.getByRole("button", { name: "Duplicar producto", exact: true })).toHaveCount(0);
  await editor.getByRole("button", { name: "Cancelar", exact: true }).click();

  await page.getByRole("button", { name: `Editar ${seeded.combo.name}`, exact: true }).click();
  editor = page.getByRole("dialog", { name: `Editar · ${seeded.combo.name}`, exact: true });
  await expect(editor.getByRole("button", { name: "Duplicar producto", exact: true })).toHaveCount(0);
  await editor.getByRole("button", { name: "Cancelar", exact: true }).click();

  const source = seeded.untracked;
  await page.getByRole("button", { name: `Editar ${source.name}`, exact: true }).click();
  editor = page.getByRole("dialog", { name: `Editar · ${source.name}`, exact: true });
  await editor.getByRole("button", { name: "Duplicar producto", exact: true }).click();
  draft = page.getByRole("dialog", { name: "Nuevo producto", exact: true });
  await expect(draft.getByLabel("Controlar stock de este producto")).not.toBeChecked();
  await expect(draft.getByLabel("Stock actual", { exact: true })).toHaveCount(0);
  await draft.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(draft).toBeHidden();
  expect(await products()).toHaveLength(initialCount);
});

test("un error al guardar conserva el borrador y reintentar mientras pendiente no duplica el producto", async () => {
  await openCatalog();
  await page.getByRole("button", { name: "Nuevo producto", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Nuevo producto", exact: true });
  await dialog.getByLabel("Nombre", { exact: true }).fill("Alta con error recuperable E2E");
  await dialog.getByLabel("Precio Principal", { exact: true }).fill("250");
  const baseline = (await products()).length;
  await app.evaluate(({ ipcMain }) => {
    const channel = "gastronomy:createProduct";
    const handlers = (ipcMain as any)._invokeHandlers as Map<string, (...args: unknown[]) => unknown>;
    const original = handlers.get(channel);
    if (!original) throw new Error(`No se encontró el handler ${channel}`);
    (globalThis as any).__catalogCreateCalls = 0;
    (globalThis as any).__catalogCreateRelease = null;
    handlers.set(channel, async (...args: unknown[]) => {
      (globalThis as any).__catalogCreateCalls += 1;
      const call = (globalThis as any).__catalogCreateCalls as number;
      if (call === 1) throw new Error("Fallo IPC de prueba");
      await new Promise<void>((resolve) => { (globalThis as any).__catalogCreateRelease = resolve; });
      return original(...args);
    });
  });
  await dialog.getByRole("button", { name: "Guardar y crear otro", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Fallo IPC de prueba");
  await expect(dialog.getByLabel("Nombre", { exact: true })).toHaveValue("Alta con error recuperable E2E");
  expect((await products()).filter((entry) => entry.name === "Alta con error recuperable E2E")).toHaveLength(0);

  await dialog.getByRole("button", { name: "Guardar producto", exact: true }).click();
  await expect.poll(() => app.evaluate(() => (globalThis as any).__catalogCreateCalls as number)).toBe(2);
  await expect(dialog.getByRole("button", { name: "Guardando…", exact: true })).toBeDisabled();
  await expect(dialog.getByLabel("Nombre", { exact: true })).toBeDisabled();
  await dialog.locator("form").evaluate((form) => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  await expect.poll(() => app.evaluate(() => (globalThis as any).__catalogCreateCalls as number)).toBe(2);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await app.evaluate(() => (globalThis as any).__catalogCreateRelease());
  await expect(dialog).toBeHidden();
  const created = (await products()).filter((entry) => entry.name === "Alta con error recuperable E2E");
  expect(created).toHaveLength(1);
  expect((await products()).length).toBe(baseline + 1);
});
