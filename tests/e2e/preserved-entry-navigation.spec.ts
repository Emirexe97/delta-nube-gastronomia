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
let unexpectedDialogs: string[] = [];

test.beforeEach(async () => {
  unexpectedDialogs = [];
  userData = await mkdtemp(join(tmpdir(), "gastronomy-preserved-entry-"));
  app = await electron.launch({
    args: ["apps/desktop-shell", `--user-data-dir=${userData}`],
    cwd: process.cwd(),
  });
  page = await app.firstWindow();
  page.on("dialog", async (dialog) => {
    unexpectedDialogs.push(dialog.message());
    await dialog.dismiss();
  });
  await expect(page.getByText("Delta Nube", { exact: true })).toBeVisible();
  await page.evaluate(async () =>
    window.gastronomy.openCashSession({ openingAmountMinor: 50_000 }),
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

async function capture(name: string) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((done) =>
      requestAnimationFrame(() => requestAnimationFrame(() => done())),
    );
  });
  await page.screenshot({ path: test.info().outputPath(`${name}.png`) });
}

async function expectNavigationUsable() {
  const navigation = page.locator('[data-app-navigation="true"]');
  const salon = navigation.getByRole("link", { name: "Salón", exact: true });
  await expect(salon).toBeVisible();
  const [navBounds, linkBounds] = await Promise.all([
    navigation.boundingBox(),
    salon.boundingBox(),
  ]);
  expect(navBounds).not.toBeNull();
  expect(linkBounds).not.toBeNull();
  expect(linkBounds!.x).toBeGreaterThanOrEqual(navBounds!.x);
  expect(linkBounds!.x + linkBounds!.width).toBeLessThanOrEqual(
    navBounds!.x + navBounds!.width + 1,
  );
  await salon.focus();
  await expect(salon).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    navigation.getByRole("link", { name: "Pedidos", exact: true }),
  ).toBeFocused();
}

async function openTable(tableNumber: number) {
  await page.getByRole("link", { name: "Salón", exact: true }).click();
  const table = page.getByLabel("Número de mesa");
  await table.fill(String(tableNumber));
  await table.press("Enter");
  const waiterNumber = page.getByLabel(/^Número de mozo/);
  await expect(waiterNumber).toBeFocused();
  await waiterNumber.fill("1");
  await waiterNumber.press("Enter");
  const waiterName = page.getByLabel(/^Nombre de mozo/);
  await expect(waiterName).toBeFocused();
  await waiterName.selectOption({ index: 1 });
  await waiterName.press("Enter");
  return page.getByRole("dialog", { name: /Pedido #\d+ · Salón/ });
}

test("retoma carga de mesa y pedido de envío al alternar secciones", async () => {
  test.setTimeout(90_000);
  const tableEditor = await openTable(61);
  const search = tableEditor.getByPlaceholder(/Código, nombre, categoría/);
  await search.fill("MUZG");
  await tableEditor.getByRole("button", { name: /Muzzarella grande/ }).click();
  const add = page.getByRole("dialog", { name: "Agregar · Muzzarella grande" });
  await add.getByLabel("Cantidad", { exact: true }).fill("2");
  await capture("table-add-modal-with-navigation");
  await add.getByRole("button", { name: "Agregar a la mesa" }).click();
  const addNote = tableEditor.getByRole("button", {
    name: "Agregar observación para Muzzarella grande",
  });
  await addNote.click();
  const noteDialog = page.getByRole("dialog", { name: "Agregar observación" });
  const note = noteDialog.getByLabel("Observación para comanda");
  await note.fill("sin confirmar · revisión E2E");

  await page.getByRole("link", { name: "Pedidos", exact: true }).click();
  await expect(tableEditor).toBeHidden();
  await expect(add).toHaveCount(0);
  await expectNavigationUsable();
  await capture("table-note-modal-with-navigation");
  await page.locator('[data-app-navigation="true"] button').click();
  await expect(page.locator('[data-app-navigation="true"]')).toHaveCSS(
    "width",
    "64px",
  );
  await expectNavigationUsable();
  await page.locator('[data-app-navigation="true"] button').click();
  await expect(page.locator('[data-app-navigation="true"]')).toHaveCSS(
    "width",
    "214px",
  );
  await page.keyboard.press("F4");
  const delivery = page.getByRole("dialog", { name: "Nuevo Envío" });
  await expect(delivery).not.toHaveAttribute("aria-modal", "true");
  await delivery
    .getByLabel("Nombre del cliente *", { exact: true })
    .fill("Envío pendiente E2E");
  await delivery.getByLabel("Teléfono *", { exact: true }).fill("11 5555-6161");
  await delivery
    .getByLabel("Dirección *", { exact: true })
    .fill("Calle Retenida 61");
  await delivery.getByLabel("Costo de envío").fill("1250");
  await delivery
    .getByLabel("Observaciones", { exact: true })
    .fill("tocar timbre");
  await delivery
    .getByRole("button", { name: "Fecha y hora", exact: true })
    .click();
  const scheduledAt = new Date(
    Date.now() + 3_600_000 - new Date().getTimezoneOffset() * 60_000,
  )
    .toISOString()
    .slice(0, 16);
  await delivery.locator('input[type="datetime-local"]').fill(scheduledAt);
  await capture("delivery-form-with-navigation");
  await expectNavigationUsable();

  await page.getByRole("link", { name: "Productos", exact: true }).click();
  await expect(delivery).toBeHidden();
  await expect(tableEditor).toBeHidden();
  await page.getByRole("link", { name: "Salón", exact: true }).click();
  await expect(noteDialog).toBeVisible();
  await expect(noteDialog).not.toHaveAttribute("aria-modal", "true");
  await expect(note).toHaveValue("sin confirmar · revisión E2E");
  await expect(note).toBeFocused();
  const stateWithTableDraft = await page.evaluate(() =>
    window.gastronomy.bootstrap(),
  );
  const tableOrder = stateWithTableDraft.orders.find(
    (order) => order.tableNumber === 61,
  );
  expect(tableOrder).toBeDefined();
  expect(
    tableOrder!.items.filter(
      (item) => item.productNameSnapshot === "Muzzarella grande",
    ),
  ).toHaveLength(1);
  await page.getByRole("link", { name: "Pedidos", exact: true }).click();
  await expect(delivery).toBeVisible();
  await expect(
    delivery.getByLabel("Nombre del cliente *", { exact: true }),
  ).toHaveValue("Envío pendiente E2E");
  await expect(delivery.getByLabel("Teléfono *", { exact: true })).toHaveValue(
    "11 5555-6161",
  );
  await expect(delivery.getByLabel("Dirección *", { exact: true })).toHaveValue(
    "Calle Retenida 61",
  );
  await expect(delivery.getByLabel("Costo de envío")).toHaveValue("1250");
  await expect(
    delivery.getByPlaceholder("Detalles para cocina o entrega"),
  ).toHaveValue("tocar timbre");
  await expect(delivery.locator('input[type="datetime-local"]')).toHaveValue(
    scheduledAt,
  );
  await page.getByRole("link", { name: "Caja", exact: true }).click();
  await expect(delivery).toBeHidden();
  await page.getByRole("link", { name: "Salón", exact: true }).click();
  await expect(noteDialog).toBeVisible();
  await expect(note).toHaveValue("sin confirmar · revisión E2E");
  await page.getByRole("link", { name: "Pedidos", exact: true }).click();
  await expect(delivery).toBeVisible();
  await expect(delivery.locator('input[type="datetime-local"]')).toHaveValue(
    scheduledAt,
  );

  const state = await page.evaluate(() => window.gastronomy.bootstrap());
  expect(state.orders.filter((order) => order.tableNumber === 61)).toHaveLength(
    1,
  );
  expect(
    state.orders.filter(
      (order) => order.customerNameSnapshot === "Envío pendiente E2E",
    ),
  ).toHaveLength(0);
  await page.getByRole("link", { name: "Caja", exact: true }).click();
  expect(
    await page.evaluate(
      () =>
        !window.dispatchEvent(new Event("beforeunload", { cancelable: true })),
    ),
  ).toBe(true);
  await page.getByRole("link", { name: "Pedidos", exact: true }).click();
  await delivery
    .getByRole("button", { name: "Crear pedido", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: /Pedido #\d+ · Envío/ }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Salón", exact: true }).click();
  await expect(note).toHaveValue("sin confirmar · revisión E2E");
  await noteDialog
    .getByRole("button", { name: "Cancelar", exact: true })
    .click();
  await expect(
    tableEditor.getByLabel("Cantidad de Muzzarella grande"),
  ).toHaveValue("2");
  expect(unexpectedDialogs).toEqual([]);
});

test("el editor de pedido conserva búsqueda y teclado solo opera en la sección activa", async () => {
  test.setTimeout(90_000);
  await page.getByRole("link", { name: "Pedidos", exact: true }).click();
  await page.keyboard.press("F3");
  const create = page.getByRole("dialog", { name: "Nuevo Para retirar" });
  await create
    .getByLabel("Nombre del cliente *", { exact: true })
    .fill("Editor retenido E2E");
  await create.getByLabel("Teléfono *", { exact: true }).fill("11 5555-6262");
  await create.getByRole("button", { name: "Crear pedido" }).click();
  const editor = page.getByRole("dialog", {
    name: /Pedido #\d+ · Para retirar/,
  });
  const search = editor.getByPlaceholder(/Código, nombre, categoría/);
  await search.fill("MUZG");
  await editor.getByRole("button", { name: /Muzzarella grande/ }).click();
  const add = page.getByRole("dialog", { name: "Agregar · Muzzarella grande" });
  await add.getByLabel("Cantidad", { exact: true }).fill("3");
  await add.getByRole("button", { name: "Agregar al pedido" }).click();
  await expect(editor.getByLabel("Cantidad de Muzzarella grande")).toHaveValue(
    "3",
  );
  await search.fill("COCA");
  await expect(search).toHaveValue("COCA");
  await capture("order-editor-with-navigation");
  await expectNavigationUsable();

  await page.getByRole("link", { name: "Salón", exact: true }).click();
  await expect(editor).toBeHidden();
  await expect(search).toBeHidden();
  await page.keyboard.press("Escape");
  await page.keyboard.press("F7");
  await page.keyboard.press("F8");
  const state = await page.evaluate(() => window.gastronomy.bootstrap());
  expect(
    state.orders.find(
      (order) => order.customerNameSnapshot === "Editor retenido E2E",
    )?.lifecycleStatus,
  ).toBe("DRAFT");

  const tableEditor = await openTable(62);
  await page.getByRole("link", { name: "Caja", exact: true }).click();
  await expect(tableEditor).toBeHidden();
  await page.keyboard.press("F7");
  await page.keyboard.press("F8");
  await page.keyboard.press("Escape");
  await expect(tableEditor).toBeHidden();
  await page.getByRole("link", { name: "Pedidos", exact: true }).click();
  await expect(editor).toBeVisible();
  await expect(editor.getByLabel("Cantidad de Muzzarella grande")).toHaveValue(
    "3",
  );
  await expect(search).toHaveValue("COCA");
  expect(unexpectedDialogs).toEqual([]);
});
