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
let userData: string;

test.beforeAll(async () => {
  userData = await mkdtemp(join(tmpdir(), "gastronomy-customers-e2e-"));
  app = await electron.launch({
    args: ["apps/desktop-shell", `--user-data-dir=${userData}`],
    cwd: process.cwd(),
  });
  page = await app.firstWindow();
  await expect(page.getByText("Delta Nube", { exact: true })).toBeVisible();
});

test.afterAll(async () => {
  await app?.close();
  await rm(userData, { recursive: true, force: true });
});

async function createCustomer(input: {
  name: string;
  phone: string;
  address: string;
}) {
  await page
    .getByRole("button", { name: "Nuevo cliente", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog", { name: "Nuevo cliente" });
  await dialog.getByLabel("Teléfono").fill(input.phone);
  await dialog.getByLabel("Nombre").fill(input.name);
  await dialog.getByLabel("Dirección", { exact: true }).fill(input.address);
  await dialog.getByLabel("Dirección", { exact: true }).press("Tab");
  await dialog.getByRole("button", { name: "Guardar cliente" }).click();
  await expect(
    page.getByRole("button", { name: `Editar ${input.name}` }),
  ).toBeVisible();
}

test("valida la ficha y evita reutilizar un cliente anterior durante autocompletar", async () => {
  await page.getByRole("link", { name: "Clientes" }).click();
  await expect(
    page.getByText("Directorio completo", { exact: true }),
  ).toBeVisible();

  await createCustomer({
    name: "Ana Selección QA",
    phone: "11 4444-1000",
    address: "Rivadavia 100",
  });
  await createCustomer({
    name: "Mariana Selección QA",
    phone: "11 5555-2000",
    address: "Mitre 200",
  });
  const persistedMariana = await page.evaluate(
    async () => await window.gastronomy.searchCustomers("Mariana Selección QA"),
  );
  expect(persistedMariana[0]?.addresses[0]?.address).toBe("Mitre 200");

  await page.getByRole("button", { name: "Ver ficha" }).first().click();
  const profile = page.getByRole("dialog", { name: /Ficha ·/ });
  await expect(
    profile.getByRole("heading", { name: "Historial completo" }),
  ).toBeVisible();
  await expect(profile.getByText("Ticket promedio")).toBeVisible();
  await expect(
    profile.getByRole("heading", { name: "Productos habituales" }),
  ).toBeVisible();
  await expect(
    profile.getByText("Todavía no hay pedidos vinculados a esta ficha."),
  ).toBeVisible();
  await profile.getByText("Cerrar", { exact: true }).click();

  await page
    .getByRole("button", { name: "Nuevo cliente", exact: true })
    .first()
    .click();
  let customerDialog = page.getByRole("dialog", { name: "Nuevo cliente" });
  await customerDialog.getByLabel("Teléfono").fill("11 4444-1000");
  await customerDialog.getByLabel("Nombre").fill("Familiar de Ana");
  await expect(
    customerDialog.getByText("Posibles coincidencias"),
  ).toBeVisible();
  await expect(
    customerDialog.getByText(/podés guardar igualmente/i),
  ).toBeVisible();
  await customerDialog
    .getByRole("button", { name: "Agregar dirección" })
    .click();
  await customerDialog
    .getByLabel("Referencia", { exact: true })
    .nth(1)
    .fill("Portón azul");
  await expect(
    customerDialog.getByText(/Completá la dirección o eliminá esta fila/),
  ).toBeVisible();
  await expect(
    customerDialog.getByRole("button", { name: "Guardar cliente" }),
  ).toBeDisabled();
  await customerDialog.getByRole("button", { name: "Cancelar" }).click();
  const discardDialog = page.getByRole("dialog", {
    name: "Cambios sin guardar",
  });
  await expect(
    discardDialog.getByText(
      "Si salís ahora se perderán los cambios de este formulario.",
    ),
  ).toBeVisible();
  await discardDialog
    .getByRole("button", { name: "Descartar cambios" })
    .click();

  await page.getByRole("link", { name: "Caja" }).click();
  await page.getByRole("button", { name: /Abrir caja/ }).click();
  await page.getByLabel("Cambio / fondo inicial").fill("50000");
  await page
    .getByRole("dialog", { name: "Abrir caja" })
    .getByRole("button", { name: "Abrir caja", exact: true })
    .click();

  await page.getByRole("link", { name: "Pedidos" }).click();
  await page.getByRole("button", { name: /F4 Envío/ }).click();
  const newOrder = page.getByRole("dialog", { name: "Nuevo Envío" });
  const search = newOrder.getByRole("combobox", { name: /Buscar cliente/ });

  await search.fill("Ana Selección QA");
  await search.press("Tab");
  await expect(newOrder.getByLabel("Teléfono *", { exact: true })).toHaveValue(
    "11 4444-1000",
  );

  await search.fill("Mariana Selección QA");
  await expect(newOrder.getByLabel("Teléfono *", { exact: true })).toHaveValue(
    "",
  );
  await search.press("Enter");
  await expect(newOrder).toBeVisible();
  await expect(newOrder.getByLabel("Teléfono *", { exact: true })).toHaveValue(
    "11 5555-2000",
  );
  await expect(newOrder.getByLabel("Dirección *", { exact: true })).toHaveValue(
    "Mitre 200",
  );
  await newOrder.getByRole("button", { name: "Crear pedido" }).click();
  await expect(
    page
      .getByRole("dialog", { name: /Pedido #\d+ · Envío/ })
      .getByText("Mariana Selección QA", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("dialog", { name: /Pedido #\d+ · Envío/ })
    .getByRole("button", { name: "Cerrar" })
    .click();
  await page.getByRole("link", { name: "Clientes" }).click();
  await page
    .getByPlaceholder("Nombre, teléfono o dirección")
    .fill("Mariana Selección QA");
  await page
    .getByRole("button", { name: "Ver ficha de Mariana Selección QA" })
    .click();
  const advancedProfile = page.getByRole("dialog", { name: /Ficha ·/ });
  await advancedProfile.getByRole("button", { name: "Nuevo pedido" }).click();
  const prefilledOrder = page.getByRole("dialog", { name: "Nuevo Envío" });
  await expect(
    prefilledOrder.getByLabel("Teléfono *", { exact: true }),
  ).toHaveValue("11 5555-2000");
  await expect(
    prefilledOrder.getByLabel("Dirección *", { exact: true }),
  ).toHaveValue("Mitre 200");
});
