import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

let app: ElectronApplication;
let page: Page;
let profile = "";

test.beforeEach(async () => {
  profile = await mkdtemp(join(tmpdir(), "gastronomy-customer-modality-"));
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
      join(
        test.info().outputPath(),
        `customer-modality-failed-${test.info().title.replace(/[^a-z0-9]/gi, "_")}.json`,
      ),
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
      !basename(profile).startsWith("gastronomy-customer-modality-")
    )
      throw new Error("Unsafe disposable profile cleanup");
    await rm(profile, { recursive: true, force: true });
    profile = "";
  }
});

async function settle() {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      document
        .getAnimations()
        .filter(
          (animation) => animation.effect?.getTiming().iterations !== Infinity,
        )
        .map((animation) => animation.finished.catch(() => {})),
    );
    await new Promise<void>((done) =>
      requestAnimationFrame(() => requestAnimationFrame(() => done())),
    );
  });
}

async function capture(name: string, payload: unknown) {
  const output = test.info().outputPath();
  await mkdir(output, { recursive: true });
  await settle();
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

async function openNewOrder() {
  await page.getByRole("link", { name: "Pedidos", exact: true }).click();
  await page.keyboard.press("F3");
  return page.getByRole("dialog", { name: "Nuevo Para retirar" });
}

async function createCustomer() {
  return page.evaluate(async () => {
    const suffix = Date.now().toString().slice(-6);
    return window.gastronomy.createCustomer({
      name: `QA modality ${suffix}`,
      phone: `11 7777-${suffix}`,
      addresses: [
        {
          label: "Casa",
          address: `Calle Uno ${suffix}`,
          deliveryFeeMinor: 1250,
        },
        {
          label: "Trabajo",
          address: `Calle Dos ${suffix}`,
          deliveryFeeMinor: 2500,
        },
      ],
    });
  });
}

test("QA02 conserva selector y dirección guardada tras alternar retiro y envío", async () => {
  test.setTimeout(90_000);
  const customer = await createCustomer();
  const dialog = await openNewOrder();
  await dialog.getByLabel("Modalidad del pedido").selectOption("DELIVERY");
  const delivery = page.getByRole("dialog", { name: "Nuevo Envío" });
  const search = delivery.getByPlaceholder("Ej.: Ana o 11 4444");
  await search.fill(customer.phone);
  await expect(
    delivery.getByText(customer.name, { exact: true }),
  ).toBeVisible();
  await delivery
    .getByRole("option", { name: new RegExp(customer.name) })
    .click();
  await expect(
    delivery.getByRole("combobox", { name: /Buscar cliente/ }),
  ).toHaveCount(0);
  await expect(
    delivery.getByRole("button", { name: "Cambiar cliente" }),
  ).toBeVisible();
  const address = delivery.getByLabel("Dirección *", { exact: true });
  await expect(address).toHaveValue(customer.addresses[0]!.address);
  const savedAddress = delivery.getByLabel("Dirección guardada");
  await expect(savedAddress).toBeVisible();
  await savedAddress.selectOption(customer.addresses[1]!.id);
  await expect(address).toHaveValue(customer.addresses[1]!.address);

  await delivery.getByLabel("Modalidad del pedido").selectOption("TAKEAWAY");
  const takeaway = page.getByRole("dialog", { name: "Nuevo Para retirar" });
  await expect(takeaway.getByLabel("Dirección *", { exact: true })).toHaveCount(
    0,
  );
  await takeaway.getByLabel("Modalidad del pedido").selectOption("DELIVERY");
  const reopenedDelivery = page.getByRole("dialog", { name: "Nuevo Envío" });
  await expect(
    reopenedDelivery.getByLabel("Nombre del cliente *", { exact: true }),
  ).toHaveValue(customer.name);
  await expect(
    reopenedDelivery.getByLabel("Teléfono *", { exact: true }),
  ).toHaveValue(customer.phone);
  await expect(
    reopenedDelivery.getByLabel("Dirección *", { exact: true }),
  ).toHaveValue(customer.addresses[1]!.address);
  const reopenedSelector = reopenedDelivery.getByLabel("Dirección guardada");
  await expect(reopenedSelector).toBeVisible();
  await expect(reopenedSelector.locator("option")).toHaveCount(
    customer.addresses.length + 1,
  );
  await expect(reopenedSelector.locator('option[value=""]')).toHaveText(
    "Otra dirección para este pedido",
  );
  for (const entry of customer.addresses)
    await expect(
      reopenedSelector.locator(`option[value="${entry.id}"]`),
    ).toHaveCount(1);
  await expect(reopenedSelector).toHaveValue(customer.addresses[1]!.id);
  await capture("customer-modality-qa02-addresses-preserved", {
    customerId: customer.id,
    selectedAddressId: customer.addresses[1]!.id,
    address: customer.addresses[1]!.address,
  });
});

test("QA03 conserva cliente elegido entre modalidades y requiere acción explícita para reemplazarlo", async () => {
  test.setTimeout(90_000);
  const customer = await createCustomer();
  const dialog = await openNewOrder();
  await dialog.getByLabel("Modalidad del pedido").selectOption("DELIVERY");
  const delivery = page.getByRole("dialog", { name: "Nuevo Envío" });
  const search = delivery.getByPlaceholder("Ej.: Ana o 11 4444");
  await search.fill(customer.phone);
  await expect(
    delivery.getByText(customer.name, { exact: true }),
  ).toBeVisible();
  await delivery
    .getByRole("option", { name: new RegExp(customer.name) })
    .click();
  await expect(
    delivery.getByLabel("Nombre del cliente *", { exact: true }),
  ).toHaveValue(customer.name);

  await delivery.getByLabel("Modalidad del pedido").selectOption("TAKEAWAY");
  const takeaway = page.getByRole("dialog", { name: "Nuevo Para retirar" });
  await takeaway.getByLabel("Modalidad del pedido").selectOption("DELIVERY");
  const reopenedDelivery = page.getByRole("dialog", { name: "Nuevo Envío" });
  await expect(
    reopenedDelivery.getByRole("combobox", { name: /Buscar cliente/ }),
  ).toHaveCount(0);
  await expect(
    reopenedDelivery.getByRole("button", { name: "Cambiar cliente" }),
  ).toBeVisible();
  await reopenedDelivery
    .getByRole("button", { name: "Cambiar cliente" })
    .click();
  const query = reopenedDelivery.getByRole("combobox", {
    name: /Buscar cliente/,
  });
  await query.fill(customer.phone);
  await expect(reopenedDelivery.getByRole("listbox")).toBeVisible();
  await query.press("Tab");
  await expect(
    reopenedDelivery.getByLabel("Nombre del cliente *", { exact: true }),
  ).toHaveValue("");
  await query.focus();
  await expect(reopenedDelivery.getByRole("listbox")).toBeVisible();
  await reopenedDelivery
    .getByRole("option", { name: new RegExp(customer.name) })
    .click();
  await expect(
    reopenedDelivery.getByLabel("Nombre del cliente *", { exact: true }),
  ).toHaveValue(customer.name);
  await expect(
    reopenedDelivery.getByLabel("Teléfono *", { exact: true }),
  ).toHaveValue(customer.phone);
  await expect(
    reopenedDelivery.getByLabel("Dirección *", { exact: true }),
  ).toHaveValue(customer.addresses[0]!.address);
  const state = await page.evaluate(() => window.gastronomy.bootstrap());
  expect(state.orders).toEqual([]);
  await capture("customer-modality-qa03-phone-search-selected", {
    customerId: customer.id,
    phoneQuery: customer.phone,
    selectedName: customer.name,
    orderCount: state.orders.length,
  });
});

test("hydration failure preserves linked customer and shows recovery instead of an unhandled rejection", async () => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const customer = await createCustomer();
  const dialog = await openNewOrder();
  await dialog.getByLabel("Modalidad del pedido").selectOption("DELIVERY");
  const delivery = page.getByRole("dialog", { name: "Nuevo Envío" });
  const search = delivery.getByPlaceholder("Ej.: Ana o 11 4444");
  await search.fill(customer.phone);
  await expect(
    delivery.getByText(customer.name, { exact: true }),
  ).toBeVisible();
  await delivery
    .getByRole("option", { name: new RegExp(customer.name) })
    .click();
  await expect(delivery.getByLabel("Dirección guardada")).toBeVisible();
  await app.evaluate(({ ipcMain }) => {
    const original = (ipcMain as any)._invokeHandlers.get(
      "gastronomy:getCustomerProfile",
    );
    if (typeof original !== "function") throw Error("missing profile handler");
    (globalThis as any).__profileOriginal = original;
    ipcMain.removeHandler("gastronomy:getCustomerProfile");
    ipcMain.handle("gastronomy:getCustomerProfile", () => {
      throw Error("Ficha no disponible");
    });
  });
  await delivery.getByLabel("Modalidad del pedido").selectOption("TAKEAWAY");
  const takeaway = page.getByRole("dialog", { name: "Nuevo Para retirar" });
  await expect(
    takeaway.getByText(/No se pudo recuperar la ficha/i),
  ).toBeVisible();
  await expect(
    takeaway.getByLabel("Nombre del cliente *", { exact: true }),
  ).toHaveValue(customer.name);
  expect(errors).toEqual([]);
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler("gastronomy:getCustomerProfile");
    ipcMain.handle(
      "gastronomy:getCustomerProfile",
      (globalThis as any).__profileOriginal,
    );
  });
  await takeaway.getByRole("button", { name: "Reintentar ficha" }).click();
  await expect(
    takeaway.getByText(/No se pudo recuperar la ficha/i),
  ).toHaveCount(0);
  await takeaway.getByLabel("Modalidad del pedido").selectOption("DELIVERY");
  const restored = page.getByRole("dialog", { name: "Nuevo Envío" });
  await expect(restored.getByLabel("Dirección guardada")).toBeVisible();
  await expect(restored.getByLabel("Dirección *", { exact: true })).toHaveValue(
    customer.addresses[0]!.address,
  );
  expect(errors).toEqual([]);
});
