import { launchConfiguredPos } from "./pos-fixture";
import { expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

test("crear lista, aislar modificadores, fijar precios desde la lista y volver a heredar", async () => {
  const profile = await mkdtemp(join(tmpdir(), "gastronomy-price-books-ui-"));
  const app = await launchConfiguredPos({
    args: ["apps/desktop-shell", `--user-data-dir=${profile}`],
    cwd: process.cwd(),
  });
  try {
    const page = await app.firstWindow();
    expect(
      resolve(await app.evaluate(({ app }) => app.getPath("userData"))),
    ).toBe(resolve(profile));
    await expect(page.getByText("Delta Nube", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Productos", exact: true }).click();
    // The price-list tab is a separate catalog workspace, not the modifier editor.
    await page
      .getByRole("tab", { name: "Listas de precios", exact: true })
      .click();

    const overview = page.getByRole("region", { name: "Listas disponibles" });
    const editor = page.getByRole("region", { name: "Editor de lista de precios" });
    const tab = (name: string) => page.getByRole("tab", { name, exact: true });
    const bookName = "Delivery E2E UI";
    const productName = "Producto override E2E UI";
    const bookRow = overview.getByRole("listitem").filter({ hasText: bookName });
    const productRow = editor.getByRole("group", { name: productName, exact: true });
    const search = () => editor.getByLabel("Buscar producto en lista de precios").fill(productName);
    const readProduct = () => page.evaluate(async (name) =>
      (await window.gastronomy.bootstrap()).products.find((p) => p.name === name)!, productName);
    const saveList = async (reason: string) => {
      await editor.getByLabel("Motivo de la lista").fill(reason);
      await editor.getByLabel("PIN para guardar la lista").fill("748259");
      await editor.getByRole("button", { name: "Guardar lista", exact: true }).click();
      await expect(page.getByText("Lista de precios guardada.", { exact: true })).toBeVisible();
      await expect(overview).toBeVisible();
    };

    await expect(overview).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Modificador", exact: true })).toHaveCount(0);
    await expect(page.getByText("Creá modificadores, como queso extra o sin salsa")).toHaveCount(0);
    const newModifier = page.getByRole("button", { name: "Nuevo modificador", exact: true });
    await expect(newModifier).toHaveCount(0);
    await tab("Modificadores").click();
    await expect(newModifier.first()).toBeVisible();

    // Create a base product, then create a new list and an exact exception in a single save.
    await tab("Productos").click();
    const categoryId = await page.evaluate(async () =>
      (await window.gastronomy.bootstrap()).categories.find((c) => c.active)!.id);
    await page.getByRole("button", { name: "Nuevo producto", exact: true }).click();
    const create = page.getByRole("dialog", { name: "Nuevo producto", exact: true });
    await create.getByLabel("Nombre", { exact: true }).fill(productName);
    await create.getByLabel("Categoría", { exact: true }).selectOption(categoryId);
    await create.getByLabel("Precio Principal").fill("1250");
    await create.getByRole("button", { name: "Guardar producto" }).click();
    await expect(create).not.toBeVisible();

    await tab("Listas de precios").click();
    await overview.getByRole("button", { name: "Nueva lista" }).click();
    await editor.getByLabel("Nombre", { exact: true }).fill(bookName);
    await editor.getByLabel("Porcentaje sobre Principal", { exact: true }).fill("15");
    const rounding = editor.getByLabel("Redondeo de precios calculados", { exact: true });
    await rounding.selectOption({ label: "A las unidades de mil" });
    await search();
    await expect(productRow).toContainText("1.000");
    await productRow.getByRole("button", { name: "Fijar precio" }).click();
    await productRow.getByLabel(`Precio fijo ${productName}`).fill("2.037,25");
    await test.info().attach("Editor con precio puntual", { body: await page.screenshot(), contentType: "image/png" });
    await saveList("Precio puntual al crear la lista");
    const bookId = await page.evaluate(async (name) =>
      (await window.gastronomy.getPriceBooks()).books.find((b) => b.name === name)!.id, bookName);
    expect((await readProduct()).priceBook).toEqual({ baseMinor: 125000, overrides: { [bookId]: 203725 } });

    const channels = page.getByRole("region", { name: "Listas por canal" });
    await channels.getByLabel("Delivery", { exact: true }).selectOption({ label: bookName });
    await channels.getByLabel("Motivo de asignación").fill("Asignar Delivery");
    await channels.getByLabel("PIN para guardar la asignación").fill("748259");
    await channels.getByRole("button", { name: "Guardar asignación" }).click();
    await expect(page.getByText("Asignaciones de listas guardadas.", { exact: true })).toBeVisible();
    expect((await readProduct()).prices.find((p) => p.priceListCode === "DELIVERY")?.amountMinor).toBe(203725);

    // Preview inheritance in the product sheet; save it, then verify the charged channel amount.
    await tab("Productos").click();
    await page.getByRole("button", { name: `Editar ${productName}`, exact: true }).click();
    const sheet = page.getByRole("dialog", { name: `Editar · ${productName}` });
    await sheet.getByRole("tab", { name: "Precios", exact: true }).click();
    const sheetBook = sheet.getByRole("group", { name: bookName, exact: true });
    await expect(sheetBook.getByLabel(`Precio fijo ${bookName}`)).toHaveValue("2.037,25");
    await sheetBook.getByRole("checkbox", { name: "Precio propio" }).uncheck();
    await expect(sheetBook.getByText(/^\$\s*1\.000$/)).toBeVisible();
    await sheet.getByLabel("Motivo del cambio").fill("Volver al precio calculado");
    await sheet.getByLabel("PIN de autorización").fill("748259");
    await sheet.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(sheet).not.toBeVisible();
    expect((await readProduct()).prices.find((p) => p.priceListCode === "DELIVERY")?.amountMinor).toBe(100000);

    // Edit, reopen and actually remove a persisted price from the list (zero is not absence).
    await tab("Listas de precios").click();
    await bookRow.getByRole("button", { name: "Editar", exact: true }).click();
    await expect(rounding).toHaveValue("100000");
    await search();
    await productRow.getByRole("button", { name: "Fijar precio" }).click();
    await productRow.getByLabel(`Precio fijo ${productName}`).fill("0");
    await saveList("Fijar precio de muestra");
    expect((await readProduct()).priceBook?.overrides[bookId]).toBe(0);

    await bookRow.getByRole("button", { name: "Editar", exact: true }).click();
    await editor.getByRole("checkbox", { name: /precios propios/i }).check();
    await expect(productRow.getByLabel(`Precio fijo ${productName}`)).toHaveValue("0");
    await productRow.getByRole("button", { name: "Heredar" }).click();
    await expect(productRow).toHaveCount(0);
    await saveList("Volver a heredar desde la lista");
    const product = await readProduct();
    expect(product.priceBook).toEqual({ baseMinor: 125000, overrides: {} });
    expect(product.prices.find((p) => p.priceListCode === "DELIVERY")?.amountMinor).toBe(100000);
  } finally {
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().forEach((win) => win.destroy()),
    );
    await app.close();
    if (
      dirname(resolve(profile)) !== resolve(tmpdir()) ||
      !basename(profile).startsWith("gastronomy-price-books-ui-")
    )
      throw new Error("Perfil de prueba no válido");
    await rm(profile, { recursive: true, force: true });
  }
});
