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

const evidence = join(
  process.cwd(),
  "docs/qa/evidence/system-usability-customer-selector-fix-2026-10-08",
);
let app: ElectronApplication;
let page: Page;
let profile = "";

test.beforeEach(async () => {
  await mkdir(evidence, { recursive: true });
  profile = await mkdtemp(join(tmpdir(), "gastronomy-customer-selector-"));
  app = await electron.launch({
    args: ["apps/desktop-shell", `--user-data-dir=${profile}`],
    cwd: process.cwd(),
  });
  page = await app.firstWindow();
  await expect(page.getByText("Delta Nube", { exact: true })).toBeVisible();
  expect(
    resolve(await app.evaluate(({ app }) => app.getPath("userData"))),
  ).toBe(resolve(profile));
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]!.isVisible(),
      ),
    )
    .toBe(process.env.GASTRONOMY_E2E_BACKGROUND !== "1");
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
    await writeFile(
      join(
        evidence,
        `failed-${test.info().title.replace(/[^a-z0-9]/gi, "_")}.json`,
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
      !basename(profile).startsWith("gastronomy-customer-selector-")
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

async function setWindow(width: number, zoom = 1) {
  await app.evaluate(
    ({ BrowserWindow }, { width, zoom }) => {
      const window = BrowserWindow.getAllWindows()[0]!;
      window.setSize(width, 820);
      window.webContents.setZoomFactor(zoom);
    },
    { width, zoom },
  );
  await settle();
}

async function capture(name: string, payload: unknown) {
  const image = await app.evaluate(async ({ BrowserWindow }) => {
    const bitmap =
      await BrowserWindow.getAllWindows()[0]!.webContents.capturePage();
    return { size: bitmap.getSize(), data: bitmap.toPNG().toString("base64") };
  });
  expect(image.size.width).toBeGreaterThan(0);
  await writeFile(
    join(evidence, `${name}.png`),
    Buffer.from(image.data, "base64"),
  );
  await writeFile(
    join(evidence, `${name}.json`),
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

async function openNewTakeaway() {
  await page.getByRole("link", { name: "Pedidos", exact: true }).click();
  await page.keyboard.press("F3");
  const dialog = page.getByRole("dialog", { name: "Nuevo Para retirar" });
  await expect(dialog).toBeVisible();
  return dialog;
}

test("selector y Crear cliente alinean bordes inferiores; formulario alcanza controles al 200%", async () => {
  test.setTimeout(90_000);
  page.on("dialog", (dialog) => dialog.accept());
  for (const width of [1100, 1366]) {
    for (const type of ["TAKEAWAY", "DELIVERY"]) {
      await setWindow(width);
      let dialog = await openNewTakeaway();
      await dialog.getByLabel("Modalidad del pedido").selectOption(type);
      dialog = page.getByRole("dialog", {
        name: type === "DELIVERY" ? "Nuevo Envío" : "Nuevo Para retirar",
      });
      await settle();
      const search = dialog.getByPlaceholder("Ej.: Ana o 11 4444");
      const createCustomer = dialog.getByRole("button", {
        name: "Crear cliente",
        exact: true,
      });
      const hint = dialog.getByText(
        "Escribí nombre o teléfono para buscar un cliente.",
        { exact: true },
      );
      await expect(hint).toBeVisible();
      const measured = await Promise.all(
        [search, createCustomer, hint].map((el) =>
          el.evaluate((node) => {
            const rect = node.getBoundingClientRect();
            return {
              top: rect.top,
              bottom: rect.bottom,
              left: rect.left,
              right: rect.right,
            };
          }),
        ),
      );
      const bottoms = Math.abs(measured[0]!.bottom - measured[1]!.bottom);
      await capture(`customer-selector-${width}-${type}`, {
        width,
        search: measured[0],
        createCustomer: measured[1],
        hint: measured[2],
        bottomEdgeDifference: bottoms,
      });
      expect(
        bottoms,
        `search and create button bottom edges at ${width}px`,
      ).toBeLessThanOrEqual(2);
      expect(
        await search.evaluate((el) =>
          document
            .getElementById(el.getAttribute("aria-describedby") || "")
            ?.textContent?.trim(),
        ),
      ).toBe("Escribí nombre o teléfono para buscar un cliente.");
      await dialog
        .getByRole("button", { name: "Cancelar", exact: true })
        .click();
      await expect(dialog).toBeHidden();
    }
  }
  await setWindow(1100, 2);
  const dialog = await openNewTakeaway();
  await dialog
    .getByRole("button", { name: "Crear cliente", exact: true })
    .scrollIntoViewIfNeeded();
  await settle();
  await expect(
    dialog.getByRole("button", { name: "Crear cliente", exact: true }),
  ).toBeInViewport();
  await capture("customer-selector-search-zoom-200", { reachable: true });
  await dialog
    .getByRole("button", { name: "Crear pedido", exact: true })
    .scrollIntoViewIfNeeded();
  await expect(
    dialog.getByRole("button", { name: "Crear pedido", exact: true }),
  ).toBeInViewport();
  await expect(
    dialog.getByText("* Campos obligatorios.", { exact: true }),
  ).toBeVisible();
  await capture("customer-selector-zoom-200", {
    viewport: await page.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
    })),
  });
});

test("búsqueda real por teclado selecciona cliente y dirección; Escape no cierra ni altera pedido", async () => {
  test.setTimeout(90_000);
  const fixture = await page.evaluate(async () => {
    const customer = await window.gastronomy.createCustomer({
      name: "US10 Selector teclado",
      phone: "11 6000-1010",
      addresses: [
        { label: "Casa", address: "Calle Uno 10", deliveryFeeMinor: 0 },
        { label: "Trabajo", address: "Calle Dos 20", deliveryFeeMinor: 0 },
      ],
    });
    return { customer, before: await window.gastronomy.bootstrap() };
  });
  const dialog = await openNewTakeaway();
  await dialog.getByLabel("Modalidad del pedido").selectOption("DELIVERY");
  const delivery = page.getByRole("dialog", { name: "Nuevo Envío" });
  const search = delivery.getByPlaceholder("Ej.: Ana o 11 4444");
  await search.fill("US10 Selector");
  await expect(
    delivery.getByText("US10 Selector teclado", { exact: true }),
  ).toBeVisible();
  await search.press("Escape");
  await expect(delivery).toBeVisible();
  await expect(delivery.getByRole("listbox")).toHaveCount(0);
  expect(await page.evaluate(() => window.gastronomy.bootstrap())).toEqual(
    fixture.before,
  );
  await search.press("ArrowDown");
  await search.press("Enter");
  await expect(
    delivery.getByLabel("Nombre del cliente *", { exact: true }),
  ).toHaveValue(fixture.customer.name);
  await expect(delivery.getByLabel("Teléfono *", { exact: true })).toHaveValue(
    fixture.customer.phone,
  );

  await expect(
    delivery.getByLabel("Nombre del cliente *", { exact: true }),
  ).toHaveValue(fixture.customer.name);
  await expect(delivery.getByLabel("Teléfono *", { exact: true })).toHaveValue(
    fixture.customer.phone,
  );
  const address = delivery.getByLabel("Dirección *", { exact: true });
  await expect(address).toHaveValue("Calle Uno 10");
  const savedAddress = delivery.getByLabel("Dirección guardada");
  await savedAddress.selectOption(fixture.customer.addresses[1]!.id);
  await expect(address).toHaveValue("Calle Dos 20");
  await delivery.getByLabel("Modalidad del pedido").selectOption("TAKEAWAY");
  const takeaway = page.getByRole("dialog", { name: "Nuevo Para retirar" });
  await expect(
    takeaway.getByLabel("Dirección (opcional)", { exact: true }),
  ).toHaveValue("Calle Dos 20");
  await takeaway.getByLabel("Modalidad del pedido").selectOption("DELIVERY");
  await expect(address).toHaveValue("Calle Dos 20");
  const query = delivery.getByRole("combobox", { name: /Buscar cliente/ });
  // Validate pending phone search via the existing Tab path, independently of
  // the known deferred popover close after modality changes (QA-03).
  await query.fill(fixture.customer.phone);
  await query.press("Tab");
  await expect(delivery.getByLabel("Teléfono *", { exact: true })).toHaveValue(
    fixture.customer.phone,
  );
  const after = await page.evaluate(() => window.gastronomy.bootstrap());
  expect(after.orders).toEqual(fixture.before.orders);
  await capture("customer-selector-keyboard-preserved", {
    selectedCustomerId: fixture.customer.id,
    addressAfterEscape: await address.inputValue(),
    orderCount: after.orders.length,
  });
});

test("crear inline guarda y selecciona sin pedido; cancelar no crea pedido", async () => {
  test.setTimeout(90_000);
  const baseline = await page.evaluate(
    async () => await window.gastronomy.bootstrap(),
  );
  const dialog = await openNewTakeaway();
  await dialog
    .getByRole("button", { name: "Crear cliente", exact: true })
    .click();
  const modal = page.getByRole("dialog", {
    name: "Crear cliente sin salir del pedido",
  });
  await modal
    .getByLabel("Nombre", { exact: true })
    .fill("US10 Cancelado inline");
  await modal.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(modal).toBeHidden();
  expect(
    await page.evaluate(() =>
      window.gastronomy.searchCustomers("US10 Cancelado inline"),
    ),
  ).toEqual([]);
  expect(await page.evaluate(() => window.gastronomy.bootstrap())).toEqual(
    baseline,
  );
  await dialog
    .getByRole("button", { name: "Crear cliente", exact: true })
    .click();
  await modal.getByLabel("Nombre", { exact: true }).fill("US10 Cliente inline");
  await modal.getByLabel("Teléfono", { exact: true }).fill("11 6000-2020");
  await modal
    .getByRole("button", { name: "Guardar y seleccionar", exact: true })
    .click();
  await expect(modal).toBeHidden();
  await expect(
    dialog.getByLabel("Nombre del cliente *", { exact: true }),
  ).toHaveValue("US10 Cliente inline");
  const afterSave = await page.evaluate(
    async () => await window.gastronomy.bootstrap(),
  );
  expect(afterSave.orders).toEqual(baseline.orders);
  const persisted = await page.evaluate(() =>
    window.gastronomy.searchCustomers("US10 Cliente inline"),
  );
  expect(persisted).toHaveLength(1);
  page.once("dialog", (dialog) => dialog.accept());
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(dialog).toBeHidden();
  const finalState = await page.evaluate(
    async () => await window.gastronomy.bootstrap(),
  );
  expect(finalState.orders).toEqual(baseline.orders);
  await capture("customer-selector-inline-create-no-order", {
    baselineOrders: baseline.orders.length,
    ordersAfterCreateAndDismiss: finalState.orders.length,
    createdCustomer: "US10 Cliente inline",
  });
});

test("productos primero conserva borrador y validación al confirmar sin datos de cliente", async () => {
  const create = await openNewTakeaway();
  await create.getByLabel("Modalidad del pedido").selectOption("DELIVERY");
  const delivery = page.getByRole("dialog", { name: "Nuevo Envío" });
  await expect(
    delivery.getByRole("button", { name: "Crear pedido", exact: true }),
  ).toBeDisabled();
  await delivery
    .getByRole("button", { name: "Cargar productos primero", exact: true })
    .click();
  const editor = page.getByRole("dialog", { name: /Pedido #\d+ · Envío/ });
  await expect(editor).toBeVisible();
  await editor.getByRole("button", { name: /Muzzarella grande/ }).click();
  await page
    .getByRole("dialog", { name: /Agregar · Muzzarella grande/ })
    .getByRole("button", { name: "Agregar al pedido" })
    .click();
  await expect(
    editor.getByRole("button", { name: "Confirmar pedido" }),
  ).toBeDisabled();
  const baseline = await page.evaluate(() => window.gastronomy.bootstrap());
  expect(baseline.orders).toHaveLength(1);
  expect(baseline.orders[0]!.lifecycleStatus).toBe("DRAFT");
  expect(baseline.orders[0]!.items).toHaveLength(1);
  await editor
    .getByRole("button", { name: "Volver a datos del cliente y envío" })
    .click();
  const metadata = page.getByRole("dialog", { name: "Editar datos · Envío" });
  await expect(
    metadata.getByLabel("Nombre del cliente *", { exact: true }),
  ).toHaveValue("");
  await expect(metadata.getByLabel("Dirección *", { exact: true })).toHaveValue(
    "",
  );
  await expect(
    metadata.getByRole("button", { name: "Guardar y volver al pedido" }),
  ).toBeDisabled();
  await metadata.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(metadata).toBeHidden();
  expect(await page.evaluate(() => window.gastronomy.bootstrap())).toEqual(
    baseline,
  );
  await capture("customer-selector-products-first-preserved", {
    draft: baseline.orders[0],
    validationPreserved: true,
  });
});
