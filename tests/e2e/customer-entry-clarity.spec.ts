import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

let app: ElectronApplication;
let page: Page;
let profile = "";

test.beforeEach(async () => {
  profile = await mkdtemp(join(tmpdir(), "gastronomy-customer-entry-"));
  app = await electron.launch({
    args: ["apps/desktop-shell", `--user-data-dir=${profile}`],
    cwd: process.cwd(),
  });
  page = await app.firstWindow();
  await expect(page.getByText("Delta Nube", { exact: true })).toBeVisible();
  expect(
    resolve(await app.evaluate(({ app }) => app.getPath("userData"))),
  ).toBe(resolve(profile));
  await page.evaluate(() =>
    window.gastronomy.openCashSession({ openingAmountMinor: 0 }),
  );
  await page.reload();
});

test.afterEach(async () => {
  if (
    test.info().status !== test.info().expectedStatus &&
    page &&
    !page.isClosed()
  ) {
    await mkdir(test.info().outputPath(), { recursive: true });
    await writeFile(
      join(test.info().outputPath(), "failure-state.json"),
      JSON.stringify(
        await page.evaluate(() => ({
          dialogs: [...document.querySelectorAll('[role="dialog"]')].map(
            (el) => ({ text: el.textContent, html: el.outerHTML }),
          ),
          focused: document.activeElement?.outerHTML,
        })),
        null,
        2,
      ),
    ).catch(() => {});
  }
  await app?.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().forEach((window) => window.destroy()),
  );
  await app?.close();
  if (profile) {
    if (
      dirname(resolve(profile)) !== resolve(tmpdir()) ||
      !basename(profile).startsWith("gastronomy-customer-entry-")
    )
      throw new Error("Unsafe disposable profile cleanup");
    await rm(profile, { recursive: true, force: true });
    profile = "";
  }
});

async function openOrder(type: "DELIVERY" | "TAKEAWAY" = "DELIVERY") {
  await page.getByRole("link", { name: "Pedidos", exact: true }).click();
  await page.keyboard.press(type === "DELIVERY" ? "F4" : "F3");
  const dialog = page.getByRole("dialog", {
    name: type === "DELIVERY" ? "Nuevo Envío" : "Nuevo Para retirar",
  });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function fixtureCustomer(name = `QA Cliente ${Date.now()}`) {
  return page.evaluate(
    async (customerName) =>
      window.gastronomy.createCustomer({
        name: customerName,
        phone: `11 8888-${Date.now().toString().slice(-4)}`,
        addresses: [
          { label: "Casa", address: "Calle Casa 10", deliveryFeeMinor: 1250 },
          {
            label: "Trabajo",
            address: "Calle Trabajo 20",
            deliveryFeeMinor: 2500,
          },
        ],
      }),
    name,
  );
}

async function capture(name: string, payload: unknown) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((done) =>
      requestAnimationFrame(() => requestAnimationFrame(() => done())),
    );
  });
  const output = test.info().outputPath();
  await mkdir(output, { recursive: true });
  const image = await app.evaluate(async ({ BrowserWindow }) => {
    const bitmap =
      await BrowserWindow.getAllWindows()[0]!.webContents.capturePage();
    return { size: bitmap.getSize(), data: bitmap.toPNG().toString("base64") };
  });
  expect(image.size.width).toBeGreaterThan(0);
  await writeFile(
    join(output, `${name}.png`),
    Buffer.from(image.data, "base64"),
  );
  await writeFile(
    join(output, `${name}.json`),
    JSON.stringify(
      {
        ...((payload ?? {}) as object),
        capture: image.size,
        realElectronSqliteAndIpc: true,
      },
      null,
      2,
    ),
  );
}

test("permite pedido manual sin ficha guardada, con customerId nulo", async () => {
  test.setTimeout(90_000);
  const before = await page.evaluate(() => window.gastronomy.bootstrap());
  const dialog = await openOrder();
  await dialog
    .getByLabel("Nombre del cliente *", { exact: true })
    .fill("Cliente ocasional");
  await dialog.getByLabel("Teléfono *", { exact: true }).fill("11 1234-5678");
  await dialog
    .getByLabel("Dirección *", { exact: true })
    .fill("Calle Manual 42");
  await capture("manual-customer-entry", {
    name: "Cliente ocasional",
    customerId: null,
  });
  await dialog
    .getByRole("button", { name: "Crear pedido", exact: true })
    .click();
  const created = await page.evaluate(() => window.gastronomy.bootstrap());
  expect(created.orders).toHaveLength(before.orders.length + 1);
  const order = created.orders.at(-1)!;
  expect(order.customerId).toBeNull();
  expect(order.customerNameSnapshot).toBe("Cliente ocasional");
  expect(order.customerPhoneSnapshot).toBe("11 1234-5678");
  expect(
    await page.evaluate(() =>
      window.gastronomy.searchCustomers("Cliente ocasional"),
    ),
  ).toEqual([]);
  // The order is left as a draft; never confirm it or invoke physical printing.
});

test("Tab no selecciona ni envía; navegación con flechas y Enter selecciona explícitamente", async () => {
  test.setTimeout(90_000);
  await fixtureCustomer("QA Ambigua Ana");
  const selected = await fixtureCustomer("QA Ambigua Anabel");
  const dialog = await openOrder();
  const query = dialog.getByRole("combobox", { name: /Buscar cliente/ });
  await query.fill("QA Ambigua Ana");
  await expect(dialog.getByRole("listbox")).toBeVisible();
  await query.press("Tab");
  await expect(
    dialog.getByRole("combobox", { name: /Buscar cliente/ }),
  ).toHaveValue("QA Ambigua Ana");
  await expect(
    dialog.getByRole("button", { name: "Cambiar cliente" }),
  ).toHaveCount(0);
  await expect(
    dialog.getByLabel("Nombre del cliente *", { exact: true }),
  ).toHaveValue("");
  await expect(page.getByRole("dialog", { name: /Pedido #\d+/ })).toHaveCount(
    0,
  );
  await query.focus();
  await expect(dialog.getByRole("listbox")).toBeVisible();
  await expect(
    dialog.getByLabel("Nombre del cliente *", { exact: true }),
  ).toHaveValue("");
  await query.press("ArrowDown");
  await query.press("Enter");
  await expect(
    dialog.getByRole("button", { name: "Cambiar cliente" }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("combobox", { name: /Buscar cliente/ }),
  ).toHaveCount(0);
  await expect(
    dialog.getByLabel("Nombre del cliente *", { exact: true }),
  ).toHaveValue(selected.name);
  await capture("explicit-customer-selection", {
    selectedCustomerId: selected.id,
    tabDidNotSelect: true,
  });
});

test("tarjeta seleccionada permite editar snapshot local sin modificar ficha persistida", async () => {
  test.setTimeout(90_000);
  const customer = await fixtureCustomer();
  const baseline = await page.evaluate(() => window.gastronomy.bootstrap());
  const dialog = await openOrder();
  const query = dialog.getByRole("combobox", { name: /Buscar cliente/ });
  await query.fill(customer.name);
  await dialog.getByRole("option", { name: new RegExp(customer.name) }).click();
  await expect(
    dialog.getByRole("combobox", { name: /Buscar cliente/ }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Crear cliente", exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Cambiar cliente" }),
  ).toBeVisible();
  await dialog
    .getByLabel("Nombre del cliente *", { exact: true })
    .fill("Nombre sólo para este pedido");
  await dialog.getByLabel("Teléfono *", { exact: true }).fill("11 9999-9999");
  const persisted = await page.evaluate(
    (id) => window.gastronomy.searchCustomers(id),
    customer.name,
  );
  expect(persisted).toHaveLength(1);
  expect(persisted[0]!.name).toBe(customer.name);
  expect(persisted[0]!.phone).toBe(customer.phone);
  await capture("selected-card-local-snapshot", {
    originalName: customer.name,
    localName: "Nombre sólo para este pedido",
  });
  await dialog
    .getByRole("button", { name: "Crear pedido", exact: true })
    .click();
  const after = await page.evaluate(() => window.gastronomy.bootstrap());
  expect(after.orders).toHaveLength(baseline.orders.length + 1);
  const order = after.orders.at(-1)!;
  expect(order.customerId).toBe(customer.id);
  expect(order.customerNameSnapshot).toBe("Nombre sólo para este pedido");
  expect(order.customerPhoneSnapshot).toBe("11 9999-9999");
  const unchanged = await page.evaluate(
    (name) => window.gastronomy.searchCustomers(name),
    customer.name,
  );
  expect(unchanged[0]!.name).toBe(customer.name);
  expect(unchanged[0]!.phone).toBe(customer.phone);
});

test("otra dirección vacía mantiene dirección y vínculo entre TAKEAWAY y DELIVERY", async () => {
  test.setTimeout(90_000);
  const customer = await fixtureCustomer();
  const dialog = await openOrder();
  const query = dialog.getByRole("combobox", { name: /Buscar cliente/ });
  await query.fill(customer.name);
  await dialog.getByRole("option", { name: new RegExp(customer.name) }).click();
  const saved = dialog.getByLabel("Dirección guardada");
  await expect(saved.locator("option")).toHaveCount(
    customer.addresses.length + 1,
  );
  await saved.selectOption(customer.addresses[1]!.id);
  const address = dialog.getByLabel("Dirección *", { exact: true });
  await address.fill("Calle personalizada 99");
  await expect(saved).toHaveValue("");
  await dialog.getByLabel("Modalidad del pedido").selectOption("TAKEAWAY");
  const takeaway = page.getByRole("dialog", { name: "Nuevo Para retirar" });
  await expect(takeaway.getByLabel("Dirección *", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    takeaway.getByRole("button", { name: "Cambiar cliente" }),
  ).toBeVisible();
  await takeaway.getByLabel("Modalidad del pedido").selectOption("DELIVERY");
  const reopened = page.getByRole("dialog", { name: "Nuevo Envío" });
  await expect(reopened.getByLabel("Dirección *", { exact: true })).toHaveValue(
    "Calle personalizada 99",
  );
  await expect(reopened.getByLabel("Dirección guardada")).toHaveValue("");
  await capture("custom-address-modality-recovery", {
    addressId: null,
    address: "Calle personalizada 99",
    customerId: customer.id,
  });
});

test("el alta opcional valida nombre, teléfono y dirección de envío antes de guardar", async () => {
  test.setTimeout(90_000);
  const baseline = await page.evaluate(() => window.gastronomy.bootstrap());
  const dialog = await openOrder("DELIVERY");
  await dialog
    .getByRole("button", { name: "Crear cliente", exact: true })
    .click();
  const modal = page.getByRole("dialog", {
    name: "Crear cliente sin salir del pedido",
  });
  const save = modal.getByRole("button", {
    name: "Guardar y seleccionar",
    exact: true,
  });
  await expect(save).toBeDisabled();
  await modal.getByLabel("Nombre", { exact: true }).fill("A");
  await modal.getByLabel("Teléfono", { exact: true }).fill("123");
  await expect(save).toBeDisabled();
  await modal.getByLabel("Nombre", { exact: true }).fill("QA Alta válida");
  await modal.getByLabel("Teléfono", { exact: true }).fill("11 1111-2222");
  await expect(save).toBeDisabled();
  await modal
    .getByLabel("Dirección", { exact: true })
    .fill("Calle requerida 1");
  await expect(save).toBeEnabled();
  await capture("inline-create-required-fields", {
    nameMinLength: 2,
    phoneMinDigits: 6,
    deliveryAddressRequired: true,
  });
  await modal.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(
    page.evaluate(() => window.gastronomy.bootstrap()),
  ).resolves.toEqual(baseline);
  expect(
    await page.evaluate(() =>
      window.gastronomy.searchCustomers("QA Alta válida"),
    ),
  ).toEqual([]);
});

test("cancelar alta inline y nuevo pedido no deja pedido ni cliente parcial", async () => {
  test.setTimeout(90_000);
  const before = await page.evaluate(() => window.gastronomy.bootstrap());
  const dialog = await openOrder("TAKEAWAY");
  await dialog
    .getByRole("button", { name: "Crear cliente", exact: true })
    .click();
  const modal = page.getByRole("dialog", {
    name: "Crear cliente sin salir del pedido",
  });
  await modal
    .getByLabel("Nombre", { exact: true })
    .fill("QA Cancelación parcial");
  await modal.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(modal).toBeHidden();
  await dialog
    .getByLabel("Nombre del cliente *", { exact: true })
    .fill("Cliente no guardado");
  await dialog.getByLabel("Teléfono *", { exact: true }).fill("11 4567-8901");
  page.once("dialog", (confirmation) => confirmation.accept());
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(dialog).toBeHidden();
  const after = await page.evaluate(() => window.gastronomy.bootstrap());
  expect(after.orders).toEqual(before.orders);
  expect(
    await page.evaluate(() =>
      window.gastronomy.searchCustomers("QA Cancelación parcial"),
    ),
  ).toEqual([]);
  expect(
    await page.evaluate(() =>
      window.gastronomy.searchCustomers("Cliente no guardado"),
    ),
  ).toEqual([]);
  await capture("cancelled-customer-and-order", {
    ordersUnchanged: true,
    customerRowsUnchanged: true,
  });
});

test("error de búsqueda se muestra sin mensaje engañoso de cero coincidencias", async () => {
  test.setTimeout(90_000);
  const dialog = await openOrder();
  await app.evaluate(({ ipcMain }) => {
    const original = (ipcMain as any)._invokeHandlers.get(
      "gastronomy:searchCustomers",
    );
    if (typeof original !== "function")
      throw new Error("missing search handler");
    (globalThis as any).__customerSearchOriginal = original;
    ipcMain.removeHandler("gastronomy:searchCustomers");
    ipcMain.handle("gastronomy:searchCustomers", () => {
      throw new Error("Búsqueda de clientes temporalmente no disponible");
    });
  });
  await dialog
    .getByRole("combobox", { name: /Buscar cliente/ })
    .fill("consulta temporal");
  await expect(
    dialog.getByText(/Búsqueda de clientes temporalmente no disponible/i),
  ).toBeVisible();
  await expect(dialog.getByText(/No encontramos coincidencias/i)).toHaveCount(
    0,
  );
  await capture("customer-search-error-recovery", {
    errorVisible: true,
    falseNoResults: false,
  });
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler("gastronomy:searchCustomers");
    ipcMain.handle(
      "gastronomy:searchCustomers",
      (globalThis as any).__customerSearchOriginal,
    );
  });
});

test("retirar no exige validar un costo de envío oculto al guardar la ficha", async () => {
  const dialog = await openOrder();
  await dialog
    .getByLabel("Nombre del cliente *", { exact: true })
    .fill("Cliente retiro");
  await dialog.getByLabel("Teléfono *", { exact: true }).fill("11 4455-6677");
  await dialog.getByLabel("Costo de envío").fill("importe inválido");
  await dialog.getByLabel("Modalidad del pedido").selectOption("TAKEAWAY");
  const takeaway = page.getByRole("dialog", { name: "Nuevo Para retirar" });
  await takeaway
    .getByRole("button", { name: "Crear cliente", exact: true })
    .click();
  const create = page.getByRole("dialog", {
    name: "Crear cliente sin salir del pedido",
  });
  await expect(create.getByLabel("Valor del envío")).toHaveCount(0);
  await expect(
    create.getByRole("button", { name: "Guardar y seleccionar" }),
  ).toBeEnabled();
  await create.getByRole("button", { name: "Guardar y seleccionar" }).click();
  await expect(create).toBeHidden();
  await expect(
    takeaway.getByRole("button", { name: "Cambiar cliente" }),
  ).toBeVisible();
  expect(
    (await page.evaluate(() => window.gastronomy.bootstrap())).orders,
  ).toHaveLength(0);
});

test("Tab durante búsqueda pendiente no selecciona y reenfocar recupera la misma consulta", async () => {
  const customer = await fixtureCustomer();
  const dialog = await openOrder();
  await app.evaluate(({ ipcMain }) => {
    const original = (ipcMain as any)._invokeHandlers.get(
      "gastronomy:searchCustomers",
    );
    const state = globalThis as any;
    state.__searchReleases = [];
    ipcMain.removeHandler("gastronomy:searchCustomers");
    ipcMain.handle("gastronomy:searchCustomers", async (event, query) => {
      await new Promise<void>((resolve) =>
        state.__searchReleases.push(resolve),
      );
      return original(event, query);
    });
  });
  const query = dialog.getByRole("combobox", { name: /Buscar cliente/ });
  await query.fill(customer.name);
  await expect
    .poll(() => app.evaluate(() => (globalThis as any).__searchReleases.length))
    .toBe(1);
  await query.press("Enter");
  await expect
    .poll(() => app.evaluate(() => (globalThis as any).__searchReleases.length))
    .toBe(2);
  await query.press("Tab");
  await app.evaluate(() => {
    const state = globalThis as any;
    state.__searchReleases
      .splice(0)
      .forEach((release: () => void) => release());
  });
  await expect(
    dialog.getByRole("button", { name: "Cambiar cliente" }),
  ).toHaveCount(0);
  await expect(
    dialog.getByLabel("Nombre del cliente *", { exact: true }),
  ).toHaveValue("");
  await query.focus();
  await expect
    .poll(() => app.evaluate(() => (globalThis as any).__searchReleases.length))
    .toBe(1);
  await app.evaluate(() => (globalThis as any).__searchReleases.shift()());
  await dialog.getByRole("option", { name: new RegExp(customer.name) }).click();
  await expect(
    dialog.getByLabel("Nombre del cliente *", { exact: true }),
  ).toHaveValue(customer.name);
});

test("una ficha tardía recupera direcciones sin sobrescribir los datos editados del pedido", async () => {
  const customer = await fixtureCustomer();
  const dialog = await openOrder();
  await app.evaluate(({ ipcMain }) => {
    const original = (ipcMain as any)._invokeHandlers.get(
      "gastronomy:getCustomerProfile",
    );
    const state = globalThis as any;
    ipcMain.removeHandler("gastronomy:getCustomerProfile");
    ipcMain.handle("gastronomy:getCustomerProfile", async (event, input) => {
      await new Promise<void>((resolve) => {
        state.__profileRelease = resolve;
      });
      const result = await original(event, input);
      result.customer.addresses[0].label = "Ficha recuperada";
      return result;
    });
  });
  await dialog
    .getByRole("combobox", { name: /Buscar cliente/ })
    .fill(customer.name);
  await dialog.getByRole("option", { name: new RegExp(customer.name) }).click();
  await expect
    .poll(() => app.evaluate(() => typeof (globalThis as any).__profileRelease))
    .toBe("function");
  await dialog
    .getByLabel("Nombre del cliente *", { exact: true })
    .fill("Nombre editado");
  await dialog.getByLabel("Teléfono *", { exact: true }).fill("11 1234-9090");
  await dialog
    .getByLabel("Dirección *", { exact: true })
    .fill("Dirección propia 123");
  await dialog.getByLabel("Costo de envío").fill("37,5");
  await app.evaluate(() => (globalThis as any).__profileRelease());
  await expect(
    dialog.getByLabel("Dirección guardada").locator("option"),
  ).toContainText(["Ficha recuperada"]);
  await expect(dialog.getByLabel("Dirección guardada")).toHaveValue("");
  await expect(
    dialog.getByLabel("Nombre del cliente *", { exact: true }),
  ).toHaveValue("Nombre editado");
  await expect(dialog.getByLabel("Teléfono *", { exact: true })).toHaveValue(
    "11 1234-9090",
  );
  await expect(dialog.getByLabel("Dirección *", { exact: true })).toHaveValue(
    "Dirección propia 123",
  );
  await expect(dialog.getByLabel("Costo de envío")).toHaveValue("37,5");
});
