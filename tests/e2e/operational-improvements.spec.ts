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

test.beforeEach(async () => {
  profile = await mkdtemp(join(tmpdir(), "gastronomy-operations-"));
  app = await electron.launch({
    args: ["apps/desktop-shell", `--user-data-dir=${profile}`],
    cwd: process.cwd(),
  });
  page = await app.firstWindow();
  await expect(page.getByText("Delta Nube", { exact: true })).toBeVisible();
  expect(
    resolve(await app.evaluate(({ app }) => app.getPath("userData"))),
  ).toBe(resolve(profile));
});

test.afterEach(async () => {
  await app?.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().forEach((window) => window.destroy()),
  );
  await app?.close();
  if (profile) {
    if (
      dirname(resolve(profile)) !== resolve(tmpdir()) ||
      !basename(profile).startsWith("gastronomy-operations-")
    )
      throw new Error("Unsafe disposable profile cleanup");
    await rm(profile, { recursive: true, force: true });
  }
});

test("purchase product correction and cancellation are contextual, authorized and documentary only", async ({}, info) => {
  const seeded = await page.evaluate(async () => {
    const api = window.gastronomy;
    const boot = await api.bootstrap();
    const first = boot.products[0]!,
      second = boot.products[1]!;
    const purchase = await api.createPurchase({
      supplierName: "Proveedor QA",
      invoiceNumber: "QA-001",
      items: [
        { productId: first.id, quantityMinor: 2000, unitCostMinor: 10000 },
      ],
      authorizerPin: "1234",
    });
    return {
      purchase,
      first,
      second,
      stocks: (await api.bootstrap()).products.map((product) => ({
        id: product.id,
        stockMinor: product.stockMinor,
      })),
    };
  });
  await page.reload();
  await page.getByRole("link", { name: "Compras", exact: true }).click();
  await page
    .getByRole("button", { name: "Corregir producto", exact: true })
    .click();
  const correction = page.getByRole("dialog", {
    name: "Corregir producto de compra",
    exact: true,
  });
  await correction
    .getByRole("combobox", { name: /^Producto vigente/ })
    .selectOption(seeded.second.id);
  await correction
    .getByLabel("Motivo", { exact: false })
    .fill("Producto ingresado por error");
  await correction.getByLabel("PIN autorizador").fill("0000");
  await correction
    .getByRole("button", { name: "Guardar corrección", exact: true })
    .click();
  await expect(correction.getByRole("alert")).toContainText(/PIN/i);
  await expect(
    correction.getByRole("combobox", { name: /^Producto vigente/ }),
  ).toHaveValue(seeded.second.id);
  await correction.getByLabel("PIN autorizador").fill("1234");
  await correction
    .getByRole("button", { name: "Guardar corrección", exact: true })
    .click();
  await expect(correction).toHaveCount(0);
  expect(
    await page.evaluate(
      async (id) =>
        (await window.gastronomy.listPurchases()).find(
          (purchase) => purchase.id === id,
        )!.items[0]!.effectiveProductId,
      seeded.purchase.id,
    ),
  ).toBe(seeded.second.id);
  await page
    .getByRole("button", { name: "Anular compra", exact: true })
    .click();
  const cancel = page.getByRole("dialog", {
    name: "Anular compra",
    exact: true,
  });
  await expect(cancel).toContainText(
    "Existencias, ventas, costo de ventas y caja permanecen intactos",
  );
  await cancel.getByLabel("Motivo", { exact: false }).fill("Compra duplicada");
  await cancel.getByLabel("PIN autorizador").fill("1234");
  await cancel
    .getByRole("button", { name: "Anular compra", exact: true })
    .click();
  await expect(cancel).toHaveCount(0);
  await expect(page.getByText("Anulada", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Corregir producto", exact: true }),
  ).toHaveCount(0);
  const after = await page.evaluate(
    async (id) => ({
      purchase: (await window.gastronomy.listPurchases()).find(
        (purchase) => purchase.id === id,
      )!,
      stocks: (await window.gastronomy.bootstrap()).products.map((product) => ({
        id: product.id,
        stockMinor: product.stockMinor,
      })),
    }),
    seeded.purchase.id,
  );
  expect(after.purchase.cancelledAt).toBeTruthy();
  expect(after.purchase.items[0]!.productId).toBe(seeded.first.id);
  expect(after.stocks).toEqual(seeded.stocks);
  await page.screenshot({ path: info.outputPath("purchase-annulled.png") });
});

test("configure and order a real combo with variant extras, fixed price and component stock", async ({}, info) => {
  const seeded = await page.evaluate(async () => {
    const api = window.gastronomy;
    const boot = await api.bootstrap();
    const prices = ["SALON", "TAKEAWAY", "DELIVERY"].map((priceListCode) => ({
      priceListCode: priceListCode as "SALON" | "TAKEAWAY" | "DELIVERY",
      amountMinor: 1000000,
    }));
    const base = await api.createProduct({
      categoryId: boot.categories[0]!.id,
      name: "Burger base QA",
      stockMinor: 10000,
      prices,
    });
    const variant = await api.createProduct({
      categoryId: base.categoryId,
      name: "Burger doble QA",
      parentProductId: base.id,
      stockMinor: 10000,
      prices,
    });
    const combo = await api.createProduct({
      categoryId: base.categoryId,
      name: "Combo QA",
      code: "COMBOQA",
      prices,
    });
    const extra = await api.createModifier({
      groupName: "Extras QA",
      name: "Cheddar QA",
      priceMinor: 15000,
    });
    await api.saveSettings({ ...boot.settings, stockEnabled: true });
    await api.openCashSession({ openingAmountMinor: 0 });
    const order = await api.createOrder({
      type: "TAKEAWAY",
      customerName: "Cliente Combo QA",
      customerPhone: "1155559876",
    });
    await api.addOrderItem({ orderId: order.id, productId: "starter-gaseosa" });
    await api.confirmOrder({ orderId: order.id });
    return { combo, variant, base, extra, order };
  });
  await page.reload();
  await page.getByRole("link", { name: "Productos", exact: true }).click();
  await page
    .getByRole("button", { name: "Configurar combo Combo QA", exact: true })
    .click();
  const config = page.getByRole("dialog", {
    name: "Configurar combo · Combo QA",
    exact: true,
  });
  await config.getByLabel("Opción 1", { exact: true }).fill("Principal");
  await config.getByLabel("Cantidad", { exact: true }).fill("2");
  await config
    .getByRole("checkbox", { name: "Burger doble QA", exact: true })
    .check();
  await config
    .getByLabel("Motivo", { exact: true })
    .fill("Alta de menú combo QA");
  await config.getByLabel("PIN de autorización", { exact: true }).fill("1234");
  await config
    .getByRole("button", { name: "Guardar combo", exact: true })
    .click();
  await expect(config).toHaveCount(0);
  await page.getByRole("link", { name: "Pedidos", exact: true }).click();
  await page.getByRole("row").filter({ hasText: "Cliente Combo QA" }).click();
  const editor = page.getByRole("dialog", {
    name: new RegExp(`Pedido #${seeded.order.number}`),
  });
  await editor.getByPlaceholder(/^Código, nombre, categoría/).fill("COMBOQA");
  await editor.getByPlaceholder(/^Código, nombre, categoría/).press("Enter");
  const chooser = page.getByRole("dialog", {
    name: "Armar Combo QA",
    exact: true,
  });
  await expect(chooser).toBeVisible();
  await chooser.press("F6");
  await expect(
    page.getByRole("dialog", { name: "Pizza mitad y mitad", exact: true }),
  ).toHaveCount(0);
  await chooser
    .getByRole("button", { name: "Burger doble QA", exact: true })
    .click();
  await chooser.getByRole("checkbox", { name: /Cheddar QA/ }).check();
  await chooser
    .getByRole("spinbutton", { name: /Cantidad del combo/ })
    .fill("2");
  await chooser
    .getByRole("button", { name: "Agregar combo", exact: true })
    .click();
  await expect(chooser).toHaveCount(0);
  const after = await page.evaluate(
    async (id) => ({
      order: await window.gastronomy.getOrder({ orderId: id }),
      products: (await window.gastronomy.bootstrap()).products,
    }),
    seeded.order.id,
  );
  const item = after.order.items.find(
    (item) => item.productId === seeded.combo.id,
  )!;
  expect(item.quantity).toBe(2);
  expect(item.unitPriceMinorSnapshot).toBe(1030000);
  expect(item.comboComponents![0]!.modifiers[0]!.modifierId).toBe(
    seeded.extra.id,
  );
  expect(
    after.products.find((product) => product.id === seeded.variant.id)!
      .stockMinor,
  ).toBe(6000);
  expect(
    after.products.find((product) => product.id === seeded.base.id)!.stockMinor,
  ).toBe(10000);
  expect(
    after.products.find((product) => product.id === seeded.combo.id)!
      .stockMinor,
  ).toBeNull();
  await expect(editor.getByText(/Principal: 2.*Burger doble QA/)).toBeVisible();
  await page.screenshot({ path: info.outputPath("combo-ordered.png") });
});

test("repeat from customer history opens a current-price unpaid draft that can edit details and confirm", async ({}, info) => {
  const seeded = await page.evaluate(async () => {
    const api = window.gastronomy;
    const boot = await api.bootstrap();
    await api.openCashSession({ openingAmountMinor: 0 });
    const customer = await api.createCustomer({
      name: "Repetir QA",
      phone: "1155551122",
      addresses: [
        { label: "Casa", address: "Dirección QA", deliveryFeeMinor: 40000 },
      ],
    });
    const prices = ["SALON", "TAKEAWAY", "DELIVERY"].map((priceListCode) => ({
      priceListCode: priceListCode as "SALON" | "TAKEAWAY" | "DELIVERY",
      amountMinor: 100000,
    }));
    const product = await api.createProduct({
      categoryId: boot.categories[0]!.id,
      name: "Producto repetido QA",
      prices,
    });
    const order = await api.createOrder({
      type: "TAKEAWAY",
      customerId: customer.id,
    });
    await api.addOrderItem({
      orderId: order.id,
      productId: product.id,
      quantity: 2,
    });
    const source = await api.confirmOrder({ orderId: order.id });
    await api.updateProduct({
      ...product,
      productId: product.id,
      prices: prices.map((price) => ({ ...price, amountMinor: 200000 })),
      reason: "Precio de hoy",
      authorizerPin: "1234",
    });
    return { source, customer };
  });
  await page.reload();
  await page.getByRole("link", { name: "Clientes", exact: true }).click();
  await page
    .getByRole("button", { name: "Ver ficha de Repetir QA", exact: true })
    .click();
  const profile = page.getByRole("dialog", {
    name: "Ficha · Repetir QA",
    exact: true,
  });
  await profile.getByRole("button", { name: "Repetir", exact: true }).click();
  const repeat = page.getByRole("dialog", {
    name: "Repetir pedido",
    exact: true,
  });
  await expect(repeat).toContainText("precios actuales");
  await repeat
    .getByRole("button", { name: "Crear borrador y revisar", exact: true })
    .click();
  await expect(repeat).toHaveCount(0);
  await expect(profile).toHaveCount(0);
  const editor = page.getByRole("dialog", {
    name: /Pedido #\d+ · Para retirar/,
  });
  await expect(editor).toBeVisible();
  const fresh = await page.evaluate(
    async (id) =>
      (await window.gastronomy.bootstrap()).orders.find(
        (order) => order.customerId === id && order.lifecycleStatus === "DRAFT",
      )!,
    seeded.customer.id,
  );
  expect(fresh.id).not.toBe(seeded.source.id);
  expect(fresh.totalMinor).toBe(400000);
  expect(fresh.paidMinor).toBe(0);
  expect(
    await page.evaluate(
      async (id) => window.gastronomy.getOrder({ orderId: id }),
      seeded.source.id,
    ),
  ).toEqual(seeded.source);
  await editor
    .getByRole("button", {
      name: "Volver a datos del cliente y envío",
      exact: true,
    })
    .click();
  const details = page.getByRole("dialog", {
    name: "Editar datos · Para retirar",
    exact: true,
  });
  await expect(details).toBeVisible();
  await details
    .getByLabel("Nombre del cliente *", { exact: true })
    .fill("Repetir QA editado");
  await details
    .getByRole("button", { name: "Guardar y volver al pedido", exact: true })
    .click();
  await expect(editor).toBeVisible();
  expect(
    await page.evaluate(
      async (id) =>
        (await window.gastronomy.getOrder({ orderId: id }))
          .customerNameSnapshot,
      fresh.id,
    ),
  ).toBe("Repetir QA editado");
  await editor
    .getByRole("button", { name: "Confirmar pedido", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(
        async (id) =>
          (await window.gastronomy.getOrder({ orderId: id })).lifecycleStatus,
        fresh.id,
      ),
    )
    .toBe("CONFIRMED");
  await page.screenshot({ path: info.outputPath("repeated-confirmed.png") });
});
