import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

let app: ElectronApplication;
let page: Page;
let profile = "";

async function launch() {
  app = await electron.launch({
    args: ["apps/desktop-shell", `--user-data-dir=${profile}`],
    cwd: process.cwd(),
  });
  page = await app.firstWindow();
  await expect(page.getByText("Delta Nube", { exact: true })).toBeVisible();
  expect(
    resolve(await app.evaluate(({ app }) => app.getPath("userData"))),
  ).toBe(resolve(profile));
}

async function close() {
  await app?.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().forEach((window) => window.destroy()),
  );
  await app?.close();
}

test.beforeEach(async () => {
  profile = await mkdtemp(join(tmpdir(), "gastronomy-half-settings-"));
  await launch();
});

test.afterEach(async () => {
  await close();
  if (profile) {
    if (
      dirname(resolve(profile)) !== resolve(tmpdir()) ||
      !basename(profile).startsWith("gastronomy-half-settings-")
    )
      throw new Error("Unsafe disposable profile cleanup");
    await rm(profile, { recursive: true, force: true });
  }
});

test("settings persist the half-and-half toggle, block all new entry points and preserve existing pizzas", async ({}, testInfo) => {
  const seeded = await page.evaluate(async () => {
    const api = window.gastronomy;
    const boot = await api.bootstrap();
    if (boot.settings.halfAndHalfEnabled !== true)
      throw new Error("Fresh default must be enabled");
    await api.openCashSession({ openingAmountMinor: 0 });
    const order = await api.createOrder({
      type: "TAKEAWAY",
      customerName: "Cliente mitad toggle E2E",
      customerPhone: "1155000707",
    });
    await api.addHalfAndHalfItem({
      orderId: order.id,
      firstProductId: "starter-muzza-grande",
      secondProductId: "starter-napo-grande",
    });
    const confirmed = await api.confirmOrder({ orderId: order.id });
    return {
      id: order.id,
      number: order.number,
      items: confirmed.items,
      totalMinor: confirmed.totalMinor,
    };
  });
  await page.reload();
  await page.getByRole("link", { name: "Configuración", exact: true }).click();
  let toggle = page.getByRole("checkbox", {
    name: "Habilitar pizzas mitad y mitad",
    exact: true,
  });
  let pricing = page.getByRole("combobox", { name: /^Precio mitad y mitad/ });
  await expect(toggle).toBeChecked();
  await pricing.selectOption("MOST_EXPENSIVE");
  await toggle.uncheck();
  await expect(pricing).toBeDisabled();
  await page
    .getByRole("button", { name: "Guardar configuración", exact: true })
    .click();
  await expect(
    page.getByText("Configuración guardada.", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("half-disabled-settings.png"),
  });
  await close();
  await launch();
  toggle = page.getByRole("checkbox", {
    name: "Habilitar pizzas mitad y mitad",
    exact: true,
  });
  pricing = page.getByRole("combobox", { name: /^Precio mitad y mitad/ });
  expect(
    await page.evaluate(
      async () =>
        (await window.gastronomy.bootstrap()).settings.halfAndHalfEnabled,
    ),
  ).toBe(false);

  async function openOrder() {
    await page.getByRole("link", { name: "Pedidos", exact: true }).click();
    await page
      .getByRole("row")
      .filter({ hasText: "Cliente mitad toggle E2E" })
      .click();
    const editor = page.getByRole("dialog", {
      name: new RegExp(`Pedido #${seeded.number}`),
    });
    await expect(editor).toBeVisible();
    return editor;
  }
  const editor = await openOrder();
  const halfModal = page.getByRole("dialog", {
    name: "Pizza mitad y mitad",
    exact: true,
  });
  await expect(
    editor.getByRole("button", { name: "Pizza mitad y mitad", exact: true }),
  ).toBeDisabled();
  await expect(page.locator("#order-editor-half-and-half-card")).toHaveCount(0);
  const search = editor.getByPlaceholder(/^Código, nombre, categoría/);
  await expect(search).not.toHaveAttribute("placeholder", /F6/);
  await search.press("F6");
  await expect(halfModal).toHaveCount(0);
  for (const alias of ["mitad", "media", "mm", "mym"]) {
    await search.fill(alias);
    await search.press("Enter");
    await expect(halfModal).toHaveCount(0);
    await expect(page.locator("#order-editor-half-and-half-card")).toHaveCount(
      0,
    );
  }
  const blocked = await page.evaluate(async (id) => {
    const api = window.gastronomy;
    let error = "";
    try {
      await api.addHalfAndHalfItem({
        orderId: id,
        firstProductId: "starter-muzza-grande",
        secondProductId: "starter-napo-grande",
      });
    } catch (value) {
      error = String(value);
    }
    return { error, order: await api.getOrder({ orderId: id }) };
  }, seeded.id);
  expect(blocked.error).toMatch(/mitad y mitad.*deshabilitada/i);
  expect(blocked.order.items).toEqual(seeded.items);
  expect(blocked.order.totalMinor).toBe(seeded.totalMinor);
  await search.fill("");
  await page.screenshot({
    path: testInfo.outputPath("half-disabled-order.png"),
  });
  await search.press("Escape");
  await expect(editor).toHaveCount(0);

  await page.getByRole("link", { name: "Configuración", exact: true }).click();
  await expect(toggle).not.toBeChecked();
  await expect(pricing).toHaveValue("MOST_EXPENSIVE");
  await toggle.check();
  await expect(pricing).toBeEnabled();
  await page
    .getByRole("button", { name: "Guardar configuración", exact: true })
    .click();
  await expect(
    page.getByText("Configuración guardada.", { exact: true }),
  ).toBeVisible();
  const enabledEditor = await openOrder();
  await expect(
    enabledEditor.getByRole("button", { name: /Pizza mitad y mitad/ }),
  ).toBeEnabled();
  await enabledEditor
    .getByPlaceholder(/^Código, nombre, categoría/)
    .press("F6");
  await expect(halfModal).toBeVisible();
  await halfModal.getByPlaceholder(/^Buscar primera mitad/).fill("Muzzarella");
  await halfModal.getByRole("option").first().click();
  await halfModal.getByPlaceholder(/^Buscar segunda mitad/).fill("Napolitana");
  await halfModal.getByRole("option").first().click();
  await halfModal
    .getByRole("button", { name: "Agregar pizza", exact: true })
    .click();
  await expect(halfModal).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        async (id) =>
          (await window.gastronomy.getOrder({ orderId: id })).items.length,
        seeded.id,
      ),
    )
    .toBe(2);
  const after = await page.evaluate(
    async (id) => window.gastronomy.getOrder({ orderId: id }),
    seeded.id,
  );
  expect(after.items.find((item) => item.id === seeded.items[0]!.id)).toEqual(
    seeded.items[0],
  );
  expect(after.items.every((item) => item.halves.length === 2)).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("half-reenabled-order.png"),
  });
});
