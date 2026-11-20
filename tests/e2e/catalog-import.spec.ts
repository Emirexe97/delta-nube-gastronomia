import { expect, test, type ElectronApplication, type Locator, type Page } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { launchConfiguredPos } from "./pos-fixture";

let app: ElectronApplication;
let page: Page;
let userData = "";

test.beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), "gastronomy-catalog-import-"));
  app = await launchConfiguredPos({ args: ["apps/desktop-shell", `--user-data-dir=${userData}`], cwd: process.cwd() });
  page = await app.firstWindow();
  await expect(page.getByText("Delta Nube", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Productos", exact: true }).click();
});

test.afterEach(async () => {
  await app?.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.destroy(); });
  await app?.close();
  if (userData) {
    const absolute = resolve(userData);
    const beneathTemp = relative(resolve(tmpdir()), absolute);
    if (!beneathTemp || beneathTemp === ".." || beneathTemp.startsWith(`..${sep}`) || isAbsolute(beneathTemp) || !absolute.split(sep).at(-1)?.startsWith("gastronomy-catalog-import-")) {
      throw new Error("Refusing to remove a catalog-import E2E profile outside its verified temp directory.");
    }
    await rm(absolute, { recursive: true, force: true });
  }
});

const header = "codigo;nombre;categoria;precio_principal\r\n";
function csvFile(name: string, text: string) { return { name, mimeType: "text/csv", buffer: Buffer.from(text, "utf8") }; }
async function importDialog() {
  await page.getByRole("button", { name: "Importar CSV" }).click();
  return page.getByRole("dialog", { name: "Importar productos desde CSV" });
}
async function seedProduct(code: string, name = "Producto previo") {
  return page.evaluate(async ({ code, name }) => {
    const data = await window.gastronomy.bootstrap();
    const category = data.categories.find((item) => item.active && item.name === "Bebidas")!;
    return window.gastronomy.importProducts({
      idempotencyKey: crypto.randomUUID(),
      rows: [{ code, name, categoryId: category.id, basePriceMinor: 1234 }],
    });
  }, { code, name });
}
async function confirmAndImport(modal: Locator, label: string) {
  page.once("dialog", (dialog) => dialog.accept());
  await modal.getByRole("button", { name: label, exact: true }).click();
}

test("descarga plantilla UTF-8 BOM y previsualiza CSV con separador punto y coma, decimales con coma y comas entrecomilladas", async ({}, info) => {
  const modal = await importDialog();
  await page.evaluate(() => {
    (window as any).__catalogTemplateBlob = null;
    URL.createObjectURL = ((original) => (blob: Blob) => { (window as any).__catalogTemplateBlob = blob; return original.call(URL, blob); })(URL.createObjectURL);
  });
  await modal.getByRole("button", { name: "Descargar plantilla CSV" }).click();
  const bytes = Buffer.from(await page.evaluate(async () => new Uint8Array(await ((window as any).__catalogTemplateBlob as Blob).arrayBuffer())));
  expect(bytes[0]).toBe(0xef);
  expect(bytes[1]).toBe(0xbb);
  expect(bytes[2]).toBe(0xbf);
  expect(bytes.toString("utf8")).toContain("codigo;nombre;categoria;precio_principal");

  await modal.getByLabel("Archivo CSV").setInputFiles(csvFile("productos.csv", `${header}IMP-COLA;"Gaseosa, cola";Bebidas;12,50\r\nIMP-AGUA;Agua mineral;Bebidas;0`));
  await expect(modal.getByText("2 válidas · 0 filas con errores")).toBeVisible();
  await expect(modal.getByText("Gaseosa, cola")).toBeVisible();
  await expect(modal.getByRole("button", { name: "Importar 2 productos" })).toBeEnabled();
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.screenshot({ path: info.outputPath("csv-preview-1100.png") });
});

test("una sola fila inválida bloquea todo el lote y el catálogo no recibe las filas válidas vecinas", async () => {
  const modal = await importDialog();
  await modal.getByLabel("Archivo CSV").setInputFiles(csvFile("mixto.csv", `${header}IMP-VALIDA;Válido;Bebidas;2,00\r\nIMP-INVALIDA;Inválido;Bebidas;1.000`));
  await expect(modal.getByText(/Precio inválido/)).toBeVisible();
  await expect(modal.getByRole("button", { name: "Importar 1 productos" })).toBeDisabled();
  const all = await page.evaluate(() => window.gastronomy.bootstrap());
  expect(all.products.some((product) => product.code === "IMP-VALIDA")).toBe(false);
});

test("rechaza un código que ya existe y conserva el producto existente sin cambios", async () => {
  const [before] = await seedProduct("IMP-EXISTENTE", "Existente sin tocar");
  await page.reload();
  await page.getByRole("link", { name: "Productos", exact: true }).click();
  const modal = await importDialog();
  await modal.getByLabel("Archivo CSV").setInputFiles(csvFile("duplicado.csv", `${header}IMP-EXISTENTE;Intento de alta;Bebidas;99,00`));
  await expect(modal.getByText(/Código duplicado en archivo o catálogo/)).toBeVisible();
  await expect(modal.getByRole("button", { name: "Importar 0 productos" })).toBeDisabled();
  const now = await page.evaluate(() => window.gastronomy.bootstrap());
  const product = now.products.find((item) => item.id === before!.id)!;
  expect(product.name).toBe("Existente sin tocar");
  expect(product.priceBook?.baseMinor).toBe(1234);
  expect(product.stockMinor).toBe(0);
});

test("importa en SQLite con precio principal, stock inicial controlado y existentes intactos; el reintento tras perder respuesta usa igual clave/payload e IDs", async () => {
  const [existing] = await seedProduct("IMP-KEEP", "No modificar");
  const noStockCategory = await page.evaluate(() => window.gastronomy.createCategory({ name: "Importación sin stock QA", stockControlEnabled: false }));
  await page.reload();
  await page.getByRole("link", { name: "Productos", exact: true }).click();
  const modal = await importDialog();
  await modal.getByLabel("Archivo CSV").setInputFiles(csvFile("alta.csv", `${header}IMP-LOST;Importación recuperable;Bebidas;45,67\r\nIMP-NULL;Importación sin stock;${noStockCategory.name};12,34`));
  await expect(modal.getByText("2 válidas · 0 filas con errores")).toBeVisible();
  await app.evaluate(({ ipcMain }) => {
    const channel = "gastronomy:importProducts";
    const handlers = (ipcMain as any)._invokeHandlers as Map<string, (...args: any[]) => Promise<any>>;
    const original = handlers.get(channel);
    if (!original) throw new Error(`No se encontró el handler ${channel}`);
    (globalThis as any).__catalogImportCalls = [];
    (globalThis as any).__catalogImportIds = [];
    let loseOnce = true;
    handlers.set(channel, async (...args: any[]) => {
      (globalThis as any).__catalogImportCalls.push(structuredClone(args[1]));
      const result = await original(...args);
      (globalThis as any).__catalogImportIds.push(result.map((product: { id: string }) => product.id));
      if (loseOnce) { loseOnce = false; throw new Error("Respuesta de importación perdida para prueba"); }
      return result;
    });
  });
  await confirmAndImport(modal, "Importar 2 productos");
  await expect(modal.getByRole("alert")).toContainText("Respuesta de importación perdida");
  await expect(modal.getByRole("button", { name: "Reintentar mismo lote" })).toBeEnabled();
  await modal.getByRole("button", { name: "Reintentar mismo lote" }).click();
  await expect(modal.getByRole("status")).toContainText("Se crearon 2 productos");
  const evidence = await app.evaluate(() => ({ calls: (globalThis as any).__catalogImportCalls, ids: (globalThis as any).__catalogImportIds }));
  expect(evidence.calls).toHaveLength(2);
  expect(evidence.calls[1]).toEqual(evidence.calls[0]);
  expect(evidence.calls[0].idempotencyKey).toMatch(/^[0-9a-f-]{36}$/i);
  expect(evidence.ids[1]).toEqual(evidence.ids[0]);
  const after = await page.evaluate(() => window.gastronomy.bootstrap());
  const imported = after.products.filter((product) => product.code === "IMP-LOST");
  expect(imported).toHaveLength(1);
  expect(imported[0]!.priceBook?.baseMinor).toBe(4567);
  expect(imported[0]!.stockMinor).toBe(0);
  const nullStock = after.products.filter((product) => product.code === "IMP-NULL");
  expect(nullStock).toHaveLength(1);
  expect(nullStock[0]!.priceBook?.baseMinor).toBe(1234);
  expect(nullStock[0]!.stockMinor).toBeNull();
  const unchanged = after.products.find((product) => product.id === existing!.id)!;
  expect(unchanged.name).toBe("No modificar");
  expect(unchanged.priceBook?.baseMinor).toBe(1234);
  expect(unchanged.stockMinor).toBe(0);
});

test("impide lotes de más de 500 filas", async () => {
  const modal = await importDialog();
  const rows = Array.from({ length: 501 }, (_, i) => `IMP-${i};Producto ${i};Bebidas;1`).join("\r\n");
  await modal.getByLabel("Archivo CSV").setInputFiles(csvFile("limite.csv", `${header}${rows}`));
  await expect(modal.getByText(/Máximo 500 filas por importación/)).toBeVisible();
  await expect(modal.getByRole("button", { name: "Importar 500 productos" })).toBeDisabled();
});

test("oculta acción sin permiso frontend y la API rechaza solicitudes inválidas", async () => {
  await app.evaluate(({ ipcMain }) => {
    const channel = "gastronomy:bootstrap";
    const handlers = (ipcMain as any)._invokeHandlers as Map<string, (...args: any[]) => Promise<any>>;
    const original = handlers.get(channel);
    if (!original) throw new Error("No se encontró el handler de bootstrap");
    handlers.set(channel, async (...args: any[]) => {
      const data = await original(...args);
      return { ...data, currentUser: { ...data.currentUser, permissions: [] } };
    });
  });
  await page.reload();
  await page.getByRole("link", { name: "Productos", exact: true }).click();
  await expect(page.getByRole("button", { name: "Importar CSV" })).toHaveCount(0);
  const rejection = await page.evaluate(async () => {
    try { await window.gastronomy.importProducts({ idempotencyKey: "no-es-uuid", rows: [] }); return "sin error"; }
    catch (error) { return String(error); }
  });
  expect(rejection).toMatch(/clave|importación/i);
});

test("una lectura anterior demorada no reemplaza el archivo nuevo y un error de archivo limpia la vista previa previa", async () => {
  const modal = await importDialog();
  await page.evaluate(() => {
    const nativeArrayBuffer = File.prototype.arrayBuffer;
    (window as any).__nativeFileArrayBuffer = nativeArrayBuffer;
    File.prototype.arrayBuffer = function () {
      if (this.name === "lento.csv") return new Promise<ArrayBuffer>((resolve) => { (window as any).__resolveSlowCsv = () => { void nativeArrayBuffer.call(this).then(resolve); }; });
      return nativeArrayBuffer.call(this);
    };
  });
  const input = modal.getByLabel("Archivo CSV");
  await input.setInputFiles(csvFile("lento.csv", `${header}IMP-SLOW;Lento;Bebidas;1`));
  await expect(modal.getByText("Leyendo archivo…")).toBeVisible();
  // Synthesize the second change while React has disabled the file control for the first read.
  await page.evaluate((csvHeader) => {
    const input = document.querySelector('input[type="file"]')!;
    const files = new DataTransfer();
    files.items.add(new File([`${csvHeader}IMP-FAST;Rápido;Bebidas;2`], "rapido.csv", { type: "text/csv" }));
    Object.defineProperty(input, "files", { configurable: true, value: files.files });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    delete (input as any).files;
  }, header);
  await expect(modal.getByText("1 válidas · 0 filas con errores")).toBeVisible();
  await expect(modal.getByText("Rápido")).toBeVisible();
  await page.evaluate(() => (window as any).__resolveSlowCsv());
  await expect(modal.getByText("Rápido")).toBeVisible();
  await expect(modal.getByText("Lento")).toHaveCount(0);
  await page.evaluate(() => { File.prototype.arrayBuffer = (window as any).__nativeFileArrayBuffer; });
  await expect(modal.getByText("Leyendo archivo…")).toHaveCount(0);
  await expect(input).toBeEnabled();
  const latin1 = Buffer.concat([
    Buffer.from(`${header}IMP-LATIN;`, "utf8"),
    Buffer.from([0xe9]),
    Buffer.from(";Bebidas;1", "utf8"),
  ]);
  await input.setInputFiles({ name: "legacy-latin1.csv", mimeType: "text/csv", buffer: latin1 });
  await expect(modal.getByRole("alert")).toContainText("Guardalo como CSV UTF-8");
  await expect(modal.getByText("Rápido")).toHaveCount(0);
  await expect(modal.getByRole("button", { name: "Importar 0 productos" })).toBeDisabled();
  const unchanged = await page.evaluate(() => window.gastronomy.bootstrap());
  expect(unchanged.products.some((product) => product.code === "IMP-LATIN")).toBe(false);
  await input.setInputFiles(csvFile("demasiado-grande.csv", "x".repeat(1024 * 1024 + 1)));
  await expect(modal.getByRole("alert")).toContainText("supera el máximo de 1 MiB");
  await expect(modal.getByText("Rápido")).toHaveCount(0);
  await expect(modal.getByRole("button", { name: /Importar/ })).toBeDisabled();
});

test("bloquea doble envío y cierre mientras una importación está pendiente", async () => {
  const modal = await importDialog();
  await modal.getByLabel("Archivo CSV").setInputFiles(csvFile("pendiente.csv", `${header}IMP-PENDING;Pendiente;Bebidas;1`));
  await app.evaluate(({ ipcMain }) => {
    const channel = "gastronomy:importProducts";
    const handlers = (ipcMain as any)._invokeHandlers as Map<string, (...args: any[]) => Promise<any>>;
    const original = handlers.get(channel);
    (globalThis as any).__pendingImportCount = 0;
    (globalThis as any).__releaseCatalogImport = null;
    handlers.set(channel, async (...args: any[]) => {
      (globalThis as any).__pendingImportCount += 1;
      await new Promise<void>((resolve) => { (globalThis as any).__releaseCatalogImport = resolve; });
      return original!(...args);
    });
  });
  await confirmAndImport(modal, "Importar 1 productos");
  await expect.poll(() => app.evaluate(() => (globalThis as any).__pendingImportCount)).toBe(1);
  const submit = modal.getByRole("button", { name: "Importando…" });
  await expect(submit).toBeDisabled();
  await expect(modal.getByRole("button", { name: "Cerrar", exact: true }).last()).toBeDisabled();
  await app.evaluate(() => (globalThis as any).__releaseCatalogImport());
  await expect(modal.getByRole("status")).toContainText("Se crearon 1 productos");
  expect(await app.evaluate(() => (globalThis as any).__pendingImportCount)).toBe(1);
});
