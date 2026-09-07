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
  userData = await mkdtemp(join(tmpdir(), "gastronomy-form-keyboard-"));
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

test("producto nuevo y edición: Enter avanza y Shift+Enter vuelve", async () => {
  await page.getByRole("link", { name: "Productos" }).click();

  await page
    .getByRole("button", { name: "Nuevo producto", exact: true })
    .click();
  const create = page.getByRole("dialog", { name: "Nuevo producto" });
  const createName = create.getByLabel("Nombre", { exact: true });
  const createCode = create.getByLabel("Código", { exact: true });
  await createName.press("Enter");
  await expect(createCode).toBeFocused();
  await createCode.press("Shift+Enter");
  await expect(createName).toBeFocused();
  await create.getByRole("button", { name: "Cancelar" }).click();

  await page
    .getByRole("button", { name: /^Editar / })
    .first()
    .click();
  const edit = page.getByRole("dialog", { name: /Editar ·/ });
  const editName = edit.getByLabel("Nombre", { exact: true });
  const editCode = edit.getByLabel("Código", { exact: true });
  await editName.press("Enter");
  await expect(editCode).toBeFocused();
  await editCode.press("Shift+Enter");
  await expect(editName).toBeFocused();
  await edit.getByRole("button", { name: "Cancelar" }).click();
});

test("usuario multi-campo respeta Enter y Shift+Enter", async () => {
  await page.getByRole("link", { name: "Usuarios" }).click();
  await page
    .getByRole("button", { name: "Nuevo usuario", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Nuevo usuario" });
  const name = dialog.getByLabel("Nombre completo", { exact: true });
  const role = dialog.getByRole("combobox", { name: "Rol" });
  await name.press("Enter");
  await expect(role).toBeFocused();
  await role.press("Shift+Enter");
  await expect(name).toBeFocused();
  await dialog.getByRole("button", { name: "Cancelar" }).click();
});

test("textarea conserva Enter y Shift+Enter sin cambiar el foco", async () => {
  await page.getByRole("link", { name: "Clientes" }).click();
  await page
    .getByRole("button", { name: "Nuevo cliente", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog", { name: "Nuevo cliente" });
  const notes = dialog.getByLabel("Notas del cliente", { exact: true });
  await notes.focus();
  await notes.press("Enter");
  await notes.press("Shift+Enter");
  await expect(notes).toBeFocused();
  await expect(notes).toHaveValue("\n\n");
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await page
    .getByRole("dialog", { name: "Cambios sin guardar" })
    .getByRole("button", { name: "Descartar cambios" })
    .click();
});

test("Enter en el último campo de un formulario válido conserva el submit nativo", async () => {
  await page.getByRole("link", { name: "Clientes" }).click();
  await page
    .getByRole("button", { name: "Nuevo cliente", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog", { name: "Nuevo cliente" });
  await dialog.getByLabel("Teléfono").fill("11 5555-7788");
  await dialog.getByLabel("Nombre").fill("Cliente navegación");
  await dialog
    .getByLabel("Dirección", { exact: true })
    .first()
    .fill("Corrientes 123");
  const lastField = dialog.getByLabel("Valor del envío").first();
  await lastField.focus();
  await lastField.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Editar Cliente navegación" }),
  ).toBeVisible();
});

test("combobox abierto: Enter selecciona la opción y no salta el campo", async () => {
  await page.getByRole("link", { name: "Clientes" }).click();
  await page
    .getByRole("button", { name: "Nuevo cliente", exact: true })
    .first()
    .click();
  const customer = page.getByRole("dialog", { name: "Nuevo cliente" });
  await customer.getByLabel("Teléfono").fill("11 5555-9900");
  await customer.getByLabel("Nombre").fill("Cliente combobox");
  await customer
    .getByLabel("Dirección", { exact: true })
    .first()
    .fill("Santa Fe 456");
  await customer.getByRole("button", { name: "Guardar cliente" }).click();
  await expect(
    page.getByRole("button", { name: "Editar Cliente combobox" }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Caja" }).click();
  await page.getByRole("button", { name: /Abrir caja/ }).click();
  await page.getByLabel("Cambio / fondo inicial").fill("50000");
  await page
    .getByRole("dialog", { name: "Abrir caja" })
    .getByRole("button", { name: "Abrir caja", exact: true })
    .click();
  await page.getByRole("link", { name: "Pedidos" }).click();
  await page.getByRole("button", { name: /F4 Envío/ }).click();
  const delivery = page.getByRole("dialog", { name: "Nuevo Envío" });
  const search = delivery.getByRole("combobox", { name: /Buscar cliente/ });
  await search.fill("Cliente combobox");
  await expect(
    page.getByRole("option", { name: /Cliente combobox/ }),
  ).toBeVisible();
  await search.press("Enter");
  await expect(delivery.getByLabel("Teléfono *", { exact: true })).toHaveValue(
    "11 5555-9900",
  );
  await expect(delivery).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await delivery.getByRole("button", { name: "Cerrar" }).click();
  await expect(delivery).toBeHidden();
});
