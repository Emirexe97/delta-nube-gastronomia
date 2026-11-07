import { _electron as electron, expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

test("crear lista, asignarla a un modo y pasar un producto de precio propio a heredado desde la ficha", async () => {
  const profile = await mkdtemp(join(tmpdir(), "gastronomy-price-books-ui-"));
  const app = await electron.launch({
    args: ["apps/desktop-shell", `--user-data-dir=${profile}`],
    cwd: process.cwd(),
  });
  try {
    const page = await app.firstWindow();
    expect(
      resolve(await app.evaluate(({ app }) => app.getPath("userData"))),
    ).toBe(resolve(profile));
    await expect(page.getByText("Delta Nube", { exact: true })).toBeVisible();
    const categoryId = await page.evaluate(
      async () =>
        (await window.gastronomy.bootstrap()).categories.find(
          (item) => item.active,
        )!.id,
    );
    await page.getByRole("link", { name: "Productos", exact: true }).click();
    await page
      .getByRole("tab", { name: "Listas de precios", exact: true })
      .click();

    const booksPanel = page.getByRole("region", { name: "Listas disponibles" });
    await booksPanel
      .getByLabel("Nombre", { exact: true })
      .fill("Delivery E2E UI");
    await booksPanel
      .getByRole("textbox", { name: "Porcentaje sobre Principal", exact: true })
      .fill("15");
    await booksPanel
      .getByLabel("Motivo de la lista", { exact: true })
      .fill("Alta lista E2E UI");
    await booksPanel
      .getByLabel("PIN para guardar la lista", { exact: true })
      .fill("1234");
    await booksPanel
      .getByRole("button", { name: "Guardar lista", exact: true })
      .click();
    await expect(
      booksPanel.getByText("Delivery E2E UI", { exact: true }),
    ).toBeVisible();

    const channelsPanel = page.getByRole("region", {
      name: "Listas por canal",
    });
    await channelsPanel
      .getByLabel("Delivery", { exact: true })
      .selectOption({ label: "Delivery E2E UI" });
    await channelsPanel
      .getByLabel("Motivo de asignación", { exact: true })
      .fill("Asignación Delivery E2E UI");
    await channelsPanel
      .getByLabel("PIN para guardar la asignación", { exact: true })
      .fill("1234");
    await channelsPanel
      .getByRole("button", { name: "Guardar asignación", exact: true })
      .click();
    await expect(
      page.getByText("Asignaciones de listas guardadas.", { exact: true }),
    ).toBeVisible();

    await page.getByRole("tab", { name: "Productos", exact: true }).click();
    await page
      .getByRole("button", { name: "Nuevo producto", exact: true })
      .click();
    const create = page.getByRole("dialog", {
      name: "Nuevo producto",
      exact: true,
    });
    await create
      .getByLabel("Nombre", { exact: true })
      .fill("Producto override E2E UI");
    await create
      .getByLabel("Categoría", { exact: true })
      .selectOption(categoryId);
    await create.getByLabel("Precio Principal", { exact: true }).fill("1000");
    await create
      .getByRole("checkbox", { name: "Precio propio", exact: true })
      .check();
    await create
      .getByLabel("Precio fijo Delivery E2E UI", { exact: true })
      .fill("2000");
    await create
      .getByRole("button", { name: "Guardar producto", exact: true })
      .click();
    await expect(create).not.toBeVisible();
    let product = (
      await page.evaluate(
        async () => (await window.gastronomy.bootstrap()).products,
      )
    ).find((item) => item.name === "Producto override E2E UI")!;
    const deliveryBookId = await page.evaluate(
      async () =>
        (await window.gastronomy.getPriceBooks()).assignments.DELIVERY,
    );
    expect(product.priceBook).toEqual({
      baseMinor: 100000,
      overrides: { [deliveryBookId]: 200000 },
    });

    await page
      .getByRole("button", {
        name: "Editar Producto override E2E UI",
        exact: true,
      })
      .click();
    const edit = page.getByRole("dialog", {
      name: "Editar · Producto override E2E UI",
      exact: true,
    });
    await edit.getByRole("tab", { name: "Precios", exact: true }).click();
    await expect(
      edit.getByLabel("Precio fijo Delivery E2E UI", { exact: true }),
    ).toHaveValue("2.000");
    await edit
      .getByRole("checkbox", { name: "Precio propio", exact: true })
      .uncheck();
    await expect(
      edit.getByLabel("Precio fijo Delivery E2E UI", { exact: true }),
    ).toHaveCount(0);
    await expect(edit.getByText(/Calculado:/)).toBeVisible();
    await edit
      .getByLabel("Motivo del cambio", { exact: true })
      .fill("Volver a precio derivado");
    await edit.getByLabel("PIN de autorización", { exact: true }).fill("1234");
    await edit
      .getByRole("button", { name: "Guardar cambios", exact: true })
      .click();
    await expect(edit).not.toBeVisible();
    product = (
      await page.evaluate(
        async () => (await window.gastronomy.bootstrap()).products,
      )
    ).find((item) => item.name === "Producto override E2E UI")!;
    expect(product.priceBook).toEqual({ baseMinor: 100000, overrides: {} });
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
