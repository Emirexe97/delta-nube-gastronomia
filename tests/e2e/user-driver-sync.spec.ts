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
  userData = await mkdtemp(join(tmpdir(), "gastronomy-user-driver-sync-"));
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

test("sincroniza repartidores creados en Repartos hacia la sección de Usuarios", async () => {
  await page.setViewportSize({ width: 1366, height: 768 });

  // 1. Ir a Repartos y crear un repartidor
  await page.getByRole("link", { name: "Repartidores" }).click();
  await expect(
    page.getByRole("button", { name: "Nuevo repartidor" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Nuevo repartidor" }).click();
  const driverDialog = page.getByRole("dialog", { name: "Nuevo repartidor" });
  await driverDialog.getByLabel("Nombre completo").fill("Carlos Envíos");
  await driverDialog.getByLabel(/PIN de autorización/).fill("1234");
  await driverDialog.getByRole("button", { name: "Crear repartidor" }).click();
  await expect(driverDialog).not.toBeVisible();

  // 2. Ir a Usuarios y verificar que aparece en el listado con rol Repartidor
  await page.getByRole("link", { name: "Usuarios" }).click();
  await expect(
    page.getByRole("heading", { name: "Usuarios y permisos" }),
  ).toBeVisible();

  const userRow = page.locator("tr", { hasText: "Carlos Envíos" });
  await expect(userRow).toBeVisible();
  await expect(userRow.getByText("Repartidor")).toBeVisible();
  await expect(userRow.getByText("Activo")).toBeVisible();
});

test("permite crear repartidores desde la sección de Usuarios sin PIN obligatorio y los sincroniza a Repartos", async () => {
  await page.getByRole("link", { name: "Usuarios" }).click();
  await page.getByRole("button", { name: "Nuevo usuario" }).click();

  const userDialog = page.getByRole("dialog", { name: "Nuevo usuario" });
  await userDialog.getByLabel("Nombre completo").fill("Lucía Repartos");
  await userDialog.getByLabel("Rol").selectOption("DELIVERY_DRIVER");

  // El PIN de usuario debe ser opcional para rol Repartidor
  const submitButton = userDialog.getByRole("button", {
    name: "Crear usuario",
  });
  // Sin PIN de autorización debe estar deshabilitado
  await expect(submitButton).toBeDisabled();

  // Completando solo PIN autorizante debe habilitarse y permitir la creación
  await userDialog.getByLabel("PIN de autorización").fill("1234");
  await expect(submitButton).toBeEnabled();
  await submitButton.click();
  await expect(userDialog).not.toBeVisible();

  // Verificar presencia en tabla de Usuarios
  const userRow = page.locator("tr", { hasText: "Lucía Repartos" });
  await expect(userRow).toBeVisible();
  await expect(userRow.getByText("Repartidor")).toBeVisible();

  // Ir a Repartos y verificar que está disponible en el filtro
  await page.getByRole("link", { name: "Repartidores" }).click();
  const filterSelect = page.getByRole("combobox", { name: /Repartidor/ });
  await expect(
    filterSelect.getByRole("option", { name: "Lucía Repartos" }),
  ).toBeAttached();
});

test("permite crear repartidor desde Usuarios con PIN propio y refleja cambios de estado en Repartos", async () => {
  // Crear repartidor con PIN propio
  await page.getByRole("link", { name: "Usuarios" }).click();
  await page.getByRole("button", { name: "Nuevo usuario" }).click();

  const userDialog = page.getByRole("dialog", { name: "Nuevo usuario" });
  await userDialog.getByLabel("Nombre completo").fill("Marcos Express");
  await userDialog.getByLabel("Rol").selectOption("DELIVERY_DRIVER");
  await userDialog.getByLabel(/PIN del usuario/).fill("4321");
  await userDialog.getByLabel("PIN de autorización").fill("1234");
  await userDialog.getByRole("button", { name: "Crear usuario" }).click();
  await expect(userDialog).not.toBeVisible();

  // Desactivar a Carlos Envíos desde la sección de Usuarios
  await page
    .getByRole("button", { name: "Editar Carlos Envíos" })
    .click();
  const editDialog = page.getByRole("dialog", {
    name: "Editar Carlos Envíos",
  });
  await editDialog.getByLabel("Usuario activo").uncheck();
  await editDialog.getByLabel("Motivo").fill("Baja temporal");
  await editDialog.getByLabel("PIN de autorización").fill("1234");
  await editDialog.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(editDialog).not.toBeVisible();

  // Verificar en Usuarios que Carlos está Inactivo
  const inactiveRow = page.locator("tr", { hasText: "Carlos Envíos" });
  await expect(inactiveRow.getByText("Inactivo")).toBeVisible();

  // Verificar en Repartos: Marcos Express está disponible, Carlos Envíos ya no está activo
  await page.getByRole("link", { name: "Repartidores" }).click();
  const filterSelect = page.getByRole("combobox", { name: /Repartidor/ });
  await expect(
    filterSelect.getByRole("option", { name: "Marcos Express" }),
  ).toBeAttached();
  await expect(
    filterSelect.getByRole("option", { name: "Carlos Envíos" }),
  ).not.toBeAttached();
});
