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
  userData = await mkdtemp(join(tmpdir(), "gastronomy-e2e-"));
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

test("abre caja y crea un takeaway desde la interfaz", async () => {
  await page.setViewportSize({ width: 1366, height: 680 });
  await page.getByRole("link", { name: "Caja" }).click();
  await page.getByRole("button", { name: /Abrir caja/ }).click();
  await page.getByLabel("Cambio / fondo inicial").fill("50000");
  await page
    .getByRole("dialog", { name: "Abrir caja" })
    .getByRole("button", { name: "Abrir caja", exact: true })
    .click();
  await expect(page.getByText("Caja #1")).toBeVisible();

  await page.getByRole("link", { name: "Pedidos" }).click();
  await page.getByRole("button", { name: /F3 Para retirar/ }).click();
  await expect(page.getByLabel("Hora de entrega")).toBeVisible();
  const createOrderButton = page.getByRole("button", { name: "Crear pedido" });
  await expect(createOrderButton).toBeDisabled();
  await page.getByRole("button", { name: "Crear cliente" }).click();
  const customerDialog = page.getByRole("dialog", {
    name: "Crear cliente sin salir del pedido",
  });
  await customerDialog.getByLabel("Nombre", { exact: true }).fill("Retiro E2E");
  await customerDialog
    .getByLabel("Teléfono", { exact: true })
    .fill("11 5555-0101");
  await expect(
    customerDialog.getByLabel("Dirección (opcional)", { exact: true }),
  ).toHaveValue("");
  await expect(
    customerDialog.getByRole("button", { name: "Guardar y seleccionar" }),
  ).toBeEnabled();
  await customerDialog
    .getByRole("button", { name: "Guardar y seleccionar" })
    .click();
  await expect(
    page.getByText("Retiro E2E vinculado a la base de datos"),
  ).toBeVisible();
  await expect(
    page.getByLabel("Dirección (opcional)", { exact: true }),
  ).toHaveValue("");
  await expect(createOrderButton).toBeEnabled();
  await page.getByRole("button", { name: "Crear pedido" }).click();
  await expect(page.getByText(/Pedido #1/)).toBeVisible();
  const overlayBox = await page.getByTestId("modal-overlay").boundingBox();
  const dialogBox = await page
    .getByRole("dialog", { name: /Pedido #1/ })
    .boundingBox();
  expect(overlayBox).toMatchObject({ x: 0, y: 0, width: 1366, height: 680 });
  expect(dialogBox).not.toBeNull();
  expect(dialogBox!.y).toBeGreaterThanOrEqual(0);
  expect(dialogBox!.y + dialogBox!.height).toBeLessThanOrEqual(680);
  await expect(
    page.getByPlaceholder(/Código, nombre, categoría/),
  ).toBeVisible();
  await page.getByRole("button", { name: /Muzzarella grande/ }).click();
  await page
    .getByRole("dialog", { name: "Agregar · Muzzarella grande" })
    .getByRole("button", { name: "Agregar a la mesa" })
    .click();
  await expect(page.getByText("1×Muzzarella grande")).toBeVisible();
  await page.getByRole("button", { name: "Confirmar pedido" }).click();
  await page.getByRole("button", { name: /Cobrar/ }).click();
  await page.getByLabel("Efectivo recibido").fill("20000");
  await expect(
    page
      .getByRole("dialog", { name: "Cobrar pedido" })
      .getByText(/\$\s*5\.000/),
  ).toBeVisible();
  await page.getByRole("button", { name: /Confirmar cobro/ }).click();
  await expect(
    page
      .getByRole("dialog", { name: /Pedido #1/ })
      .getByText("Pagado", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Devolver pago" }).click();
  const refundDialog = page.getByRole("dialog", {
    name: "Devolver o anular pago",
  });
  await refundDialog.getByLabel("Motivo").fill("Cobro duplicado E2E");
  await refundDialog.getByLabel("PIN de autorización").fill("1234");
  await refundDialog
    .getByRole("button", { name: "Confirmar devolución" })
    .click();
  await expect(
    page
      .getByRole("dialog", { name: /Pedido #1/ })
      .getByText("Impago", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Devuelto", { exact: false })).toBeVisible();
});

test("crea un repartidor y lo ofrece al cargar un delivery", async () => {
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "Repartidores" }).click();
  await page.getByRole("button", { name: /Nuevo repartidor/ }).click();
  await page.getByLabel("Nombre completo").fill("Repartidor E2E");
  await page.getByLabel("PIN de autorización del responsable").fill("1234");
  await page.getByRole("button", { name: "Crear repartidor" }).click();
  await expect(
    page.getByRole("cell", { name: "Repartidor E2E" }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Pedidos" }).click();
  await page.getByRole("button", { name: /F4 Envío/ }).click();
  await page.getByRole("button", { name: "Crear cliente" }).click();
  const customerDialog = page.getByRole("dialog", {
    name: "Crear cliente sin salir del pedido",
  });
  await customerDialog.getByLabel("Nombre").fill("Cliente E2E");
  await customerDialog.getByLabel("Teléfono").fill("11 2222-9090");
  await customerDialog
    .getByLabel("Dirección", { exact: true })
    .fill("Belgrano 100");
  await customerDialog.getByLabel("Valor del envío").fill("2500");
  await customerDialog
    .getByRole("button", { name: "Guardar y seleccionar" })
    .click();
  await expect(
    page.getByText("Cliente E2E vinculado a la base de datos"),
  ).toBeVisible();
  const customerSearch = page.getByRole("combobox", { name: /Buscar cliente/ });
  await customerSearch.fill("Cliente E2");
  await expect(page.getByRole("option", { name: /Cliente E2E/ })).toBeVisible();
  await customerSearch.press("ArrowDown");
  await customerSearch.press("Tab");
  await expect(page.getByLabel("Teléfono *", { exact: true })).toHaveValue(
    "11 2222-9090",
  );
  await expect(
    page
      .getByLabel("Repartidor")
      .getByRole("option", { name: "Repartidor E2E" }),
  ).toHaveCount(1);
  await page.keyboard.press("Escape");

  await page.getByRole("link", { name: "Clientes" }).click();
  await expect(
    page.getByRole("button", { name: "Editar Cliente E2E" }),
  ).toBeVisible();
  await expect(
    page.getByText("Directorio completo", { exact: true }),
  ).toBeVisible();
  await page
    .getByPlaceholder("Nombre, teléfono o dirección")
    .fill("Cliente E2E");
  await page.getByRole("button", { name: "Editar Cliente E2E" }).click();
  const editCustomerDialog = page.getByRole("dialog", {
    name: /Editar · Cliente E2E/,
  });
  await editCustomerDialog
    .getByRole("button", { name: "Agregar dirección" })
    .click();
  await editCustomerDialog
    .getByLabel("Etiqueta", { exact: true })
    .fill("Trabajo");
  await editCustomerDialog
    .getByLabel("Dirección", { exact: true })
    .nth(1)
    .fill("Mitre 900");
  await editCustomerDialog.getByLabel("Valor del envío").nth(1).fill("3500");
  await editCustomerDialog
    .getByRole("button", { name: "Guardar cambios" })
    .click();
  await expect(page.getByText("Trabajo:", { exact: false })).toBeVisible();

  await page.getByRole("link", { name: "Pedidos" }).click();
  await page.getByRole("button", { name: /F4 Envío/ }).click();
  const deliverySearch = page.getByRole("combobox", { name: /Buscar cliente/ });
  await deliverySearch.fill("Cliente E2E");
  await page.getByRole("option", { name: /Cliente E2E/ }).click();
  const addressSelector = page.getByLabel("Dirección guardada");
  await expect(addressSelector).toBeVisible();
  await addressSelector.selectOption({ index: 1 });
  await expect(page.getByLabel("Dirección *", { exact: true })).toHaveValue(
    "Mitre 900",
  );
  const newDeliveryDialog = page.getByRole("dialog", { name: "Nuevo Envío" });
  await expect(newDeliveryDialog.getByLabel("Costo de envío")).toHaveValue(
    "3500",
  );
  await newDeliveryDialog.getByLabel("Costo de envío").fill("4200");
  await newDeliveryDialog.getByRole("button", { name: "Crear pedido" }).click();

  const draftDialog = page.getByRole("dialog", { name: /Pedido #\d+ · Envío/ });
  await draftDialog
    .getByRole("button", { name: "Volver a datos del cliente y envío" })
    .click();
  const editDraftDialog = page.getByRole("dialog", {
    name: "Editar datos · Envío",
  });
  await expect(editDraftDialog.getByLabel("Costo de envío")).toHaveValue(
    "4200",
  );
  await editDraftDialog.getByLabel("Costo de envío").fill("4600");
  await editDraftDialog
    .getByRole("button", { name: "Guardar y volver al pedido" })
    .click();
  await expect(draftDialog).toBeVisible();
  await draftDialog.getByRole("button", { name: "Cerrar" }).click();

  await page.getByRole("link", { name: "Clientes" }).click();
  await page.getByPlaceholder("Nombre, teléfono o dirección").fill("Mitre 900");
  await expect(page.getByText("Envío: $ 4.600", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Usuarios" }).click();
  await expect(
    page.getByRole("cell", { name: "Repartidor E2E", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "Auditoría" }).click();
  await expect(
    page.getByRole("table").getByText("Repartidor creado", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Informes" }).click();
  await expect(
    page.getByRole("heading", { name: "Informes operativos" }),
  ).toBeVisible();
});

test("asigna un mesero al abrir una mesa", async () => {
  await page.getByRole("link", { name: "Usuarios" }).click();
  await page.getByRole("button", { name: "Nuevo usuario" }).click();
  await page.getByLabel("Nombre completo").fill("Mesero E2E");
  await page.getByLabel("Rol").selectOption("WAITER");
  await page.getByLabel("PIN del usuario").fill("2468");
  await page.getByLabel("PIN de autorización").fill("1234");
  await page.getByRole("button", { name: "Crear usuario" }).click();
  await expect(
    page.getByRole("cell", { name: "Mesero E2E", exact: true }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Salón" }).click();
  await page.getByRole("button", { name: "Abrir mesa 1", exact: true }).click();
  await expect(
    page.getByLabel("Mesero responsable").locator("option:checked"),
  ).toContainText("Mesero E2E");
  await page
    .getByRole("dialog", { name: "Abrir mesa 1" })
    .getByRole("button", { name: "Abrir mesa" })
    .click();
  await expect(
    page.getByRole("dialog", { name: /Pedido #\d+ · Salón/ }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page
      .getByRole("region", { name: "Mesas del salón" })
      .getByText(/Mesero E2E ·/),
  ).toBeVisible();
});

test("edita precios de producto con autorización e historial", async () => {
  await page.getByRole("link", { name: "Productos" }).click();
  await page.getByRole("tab", { name: "Categorías" }).click();
  await page.getByRole("button", { name: "Nueva categoría" }).click();
  const categoryDialog = page.getByRole("dialog", {
    name: "Nueva categoría",
  });
  const overlay = page.getByTestId("modal-overlay");
  await overlay.click({ position: { x: 4, y: 4 } });
  await expect(categoryDialog).toBeVisible();
  await categoryDialog.getByLabel("Nombre de la categoría").fill("Postres E2E");
  await categoryDialog.getByRole("button", { name: "Crear categoría" }).click();
  await expect(page.getByText("Postres E2E", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Productos", exact: true }).click();

  const originalRow = page
    .getByRole("row")
    .filter({ hasText: "Muzzarella grande" });
  await originalRow
    .getByRole("button", { name: "Editar Muzzarella grande" })
    .click();
  const dialog = page.getByRole("dialog", {
    name: /Editar · Muzzarella grande/,
  });
  await dialog.getByLabel("Nombre").fill("Muzzarella E2E");
  await dialog.getByLabel("Delivery / Para retirar").fill("16500");
  await dialog.getByLabel("Motivo del cambio").fill("Actualización E2E");
  await dialog.getByLabel("PIN de autorización").fill("1234");
  await dialog.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(
    page.getByRole("cell", { name: "Muzzarella E2E", exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Editar Muzzarella E2E" }).click();
  await expect(
    page
      .getByRole("dialog", { name: /Editar · Muzzarella E2E/ })
      .getByText("Actualización E2E", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByLabel("Seleccionar Muzzarella E2E").check();
  await page.getByLabel("Seleccionar Napolitana grande").check();
  await page.getByRole("button", { name: /Operación masiva · 2/ }).click();
  const bulkDialog = page.getByRole("dialog", {
    name: /Operación masiva · 2 productos/,
  });
  await bulkDialog.getByLabel("Ajustar precios").check();
  await bulkDialog.getByLabel("Variación (%)").fill("10");
  await bulkDialog.getByLabel("Delivery / Para retirar").uncheck();
  await bulkDialog.getByLabel("Motivo").fill("Aumento masivo E2E");
  await bulkDialog.getByLabel("PIN de autorización").fill("1234");
  await bulkDialog
    .getByRole("button", { name: "Aplicar a seleccionados" })
    .click();
  await expect(
    page.getByRole("row").filter({ hasText: "Muzzarella E2E" }),
  ).toContainText("$ 16.500");
});

test("carga una mesa y productos de punta a punta solo con teclado", async () => {
  await page.getByRole("link", { name: "Salón" }).click();
  const tableInput = page.getByLabel("Número de mesa");
  await tableInput.fill("37");
  await tableInput.press("Tab");
  await expect(page.getByText("Mesa 37 creada", { exact: true })).toBeVisible();

  const waiterInput = page.getByLabel(/^Número de mozo/);
  const waiterName = page.getByLabel(/^Nombre de mozo/);
  await expect(waiterInput).toBeFocused();
  await waiterInput.fill("999");
  await expect(waiterName).toHaveValue("");
  await waiterInput.press("Tab");
  await expect(waiterName).toBeFocused();
  await waiterName.press("Tab");
  await expect(page.getByRole("alert")).toContainText(
    "No existe un mozo activo",
  );
  await waiterInput.fill("3");
  await expect(waiterName.locator("option:checked")).toContainText(
    "Mesero E2E",
  );
  await waiterName.selectOption({ label: "Administrador" });
  await expect(waiterInput).toHaveValue("1");
  await waiterName.selectOption({ label: "Mesero E2E" });
  await expect(waiterInput).toHaveValue("3");
  await waiterName.press("Tab");
  await expect(page.getByText(/Mesa 37 · Mesero E2E/)).toBeVisible();

  const quantity = page.getByLabel("Cantidad");
  const code = page.getByLabel("Código / ID");
  const product = page.getByRole("combobox", {
    name: "Producto",
    exact: true,
  });
  const price = page.getByLabel("Precio salón");
  await quantity.fill("2");
  await quantity.press("Enter");
  await expect(code).toBeFocused();
  await code.fill("MUZG");
  await expect(product).toHaveValue("Muzzarella E2E");
  await expect(price).toHaveValue("16500");
  await code.press("Enter");
  await expect(product).toBeFocused();
  await product.press("Enter");
  await expect(price).toBeFocused();
  await price.press("Enter");
  await expect(
    page.getByText("2 × Muzzarella E2E agregado", { exact: true }),
  ).toBeVisible();
  await expect(quantity).toBeFocused();

  await quantity.fill("1");
  await product.fill("gra");
  const options = page.getByRole("listbox", {
    name: "Productos disponibles",
  });
  await expect(options).toBeVisible();
  await expect(options.getByRole("option").first()).toContainText(
    "Especial grande",
  );
  await expect(code).toHaveValue("ESPG");
  await product.press("ArrowDown");
  await expect(code).toHaveValue("MUZG");
  await product.press("ArrowDown");
  await expect(code).toHaveValue("NAPG");
  await product.press("Tab");
  await expect(product).toHaveValue("Napolitana grande");
  await expect(price).toBeFocused();
  await price.press("Tab");
  await expect(page.getByRole("button", { name: /Agregar/ })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByText("1 × Napolitana grande agregado", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/3 unidades/)).toBeVisible();

  await quantity.fill("1");
  await product.fill("Gas");
  await page.getByRole("option", { name: /Gaseosa 1,5 L/ }).click();
  await expect(product).toHaveValue("Gaseosa 1,5 L");
  await expect(code).toHaveValue("GAS15");
  const catalogPrice = await price.inputValue();
  await price.fill("9999");
  await page.getByRole("button", { name: /Agregar/ }).click();
  let authorization = page.getByRole("dialog", {
    name: "Autorizar precio manual",
  });
  await expect(authorization).toBeVisible();
  await expect(
    authorization.getByText("El precio del catálogo no se modifica.", {
      exact: false,
    }),
  ).toBeVisible();
  await authorization
    .getByRole("button", { name: "Volver sin modificar el precio" })
    .click();
  await expect(authorization).toBeHidden();
  await expect(price).toHaveValue(catalogPrice);

  await price.fill("9999");
  await page.getByRole("button", { name: /Agregar/ }).click();
  authorization = page.getByRole("dialog", {
    name: "Autorizar precio manual",
  });
  await authorization.getByLabel("PIN de autorización").fill("0000");
  await authorization
    .getByRole("button", { name: "Confirmar precio y agregar" })
    .click();
  await expect(authorization.getByRole("alert")).toContainText(
    "PIN incorrecto",
  );
  await authorization.getByLabel("PIN de autorización").fill("1234");
  await authorization
    .getByRole("button", { name: "Confirmar precio y agregar" })
    .click();
  await expect(
    page.getByText("1 × Gaseosa 1,5 L agregado con precio autorizado", {
      exact: true,
    }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Pedidos" }).click();
  await expect(
    page.getByRole("table").getByText("Salón", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "Resumen" }).click();
  await expect(
    page.getByText("Mesas por cobrar", { exact: true }),
  ).toBeVisible();
});

test("protege modales anidados y completa atajos y recuperación por teclado", async () => {
  await page.getByRole("link", { name: "Pedidos" }).click();

  await page.keyboard.press("F3");
  const newOrder = page.getByRole("dialog", { name: "Nuevo Para retirar" });
  await expect(newOrder).toBeVisible();
  await page.keyboard.press("F4");
  await expect(newOrder).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Nuevo Envío" })).toHaveCount(
    0,
  );

  await newOrder.getByRole("button", { name: "Crear cliente" }).click();
  const nestedCustomer = page.getByRole("dialog", {
    name: "Crear cliente sin salir del pedido",
  });
  await expect(nestedCustomer).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(nestedCustomer).toBeHidden();
  await expect(newOrder).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(newOrder).toBeHidden();

  await page.keyboard.press("F6");
  await expect(
    page.getByPlaceholder("Pedido, cliente, teléfono o dirección"),
  ).toBeFocused();

  await page.getByText("#1", { exact: true }).click();
  const editor = page.getByRole("dialog", { name: /Pedido #1 · Para retirar/ });
  await expect(editor).toBeVisible();
  await editor.getByRole("button", { name: "Aplicar descuento" }).click();
  const discount = page.getByRole("dialog", { name: "Aplicar descuento" });
  await discount.getByLabel("Porcentaje", { exact: true }).fill("10");
  await discount.getByLabel("Motivo").fill("Error humano E2E");
  await discount.getByLabel("PIN de autorización").fill("0000");
  await discount.getByRole("button", { name: "Aplicar", exact: true }).click();
  await expect(discount.getByRole("alert")).toContainText("PIN incorrecto");
  await page.keyboard.press("Escape");
  await expect(discount).toBeHidden();
  await expect(editor).toBeVisible();

  await page.keyboard.press("F8");
  const payment = page.getByRole("dialog", { name: "Cobrar pedido" });
  await expect(payment).toBeVisible();
  await expect(payment.getByLabel("Efectivo", { exact: true })).toBeFocused();
  await payment.getByRole("button", { name: "Confirmar cobro" }).click();
  await expect(payment).toBeHidden();
  await expect(editor.getByText("Pagado", { exact: true })).toBeVisible();

  await editor.getByRole("button", { name: "Devolver pago" }).click();
  const refund = page.getByRole("dialog", {
    name: "Devolver o anular pago",
  });
  await refund.getByLabel("Motivo").fill("Restaurar estado E2E");
  await refund.getByLabel("PIN de autorización").fill("1234");
  await refund
    .getByRole("button", { name: "Confirmar devolución" })
    .press("Enter");
  await expect(refund).toBeHidden();
  await expect(editor.getByText("Impago", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.keyboard.press("F3");
  const draftCreation = page.getByRole("dialog", {
    name: "Nuevo Para retirar",
  });
  await draftCreation
    .getByLabel("Nombre del cliente *", { exact: true })
    .fill("Borrador protegido E2E");
  await draftCreation
    .getByLabel("Teléfono *", { exact: true })
    .fill("2625 000 000");
  await expect(
    draftCreation.getByLabel("Dirección (opcional)", { exact: true }),
  ).toHaveValue("");
  await draftCreation.getByRole("button", { name: "Crear pedido" }).click();
  const draftEditor = page.getByRole("dialog", {
    name: /Pedido #\d+ · Para retirar/,
  });
  await draftEditor.getByRole("button", { name: /Muzzarella/ }).click();
  await page
    .getByRole("dialog", { name: /Agregar · Muzzarella/ })
    .getByRole("button", { name: "Agregar a la mesa" })
    .click();
  await expect(draftEditor.getByText(/1×Muzzarella/)).toBeVisible();
  await draftEditor.getByRole("button", { name: "Descartar borrador" }).click();
  const discard = page.getByRole("dialog", { name: "Descartar borrador" });
  await expect(discard).toBeVisible();
  await discard.getByRole("button", { name: "Conservar borrador" }).click();
  await expect(draftEditor).toBeVisible();
  await draftEditor.getByRole("button", { name: "Descartar borrador" }).click();
  await page
    .getByRole("dialog", { name: "Descartar borrador" })
    .getByRole("button", { name: "Descartar definitivamente" })
    .click();
  await expect(draftEditor).toBeHidden();
});

test("guarda perfiles de impresión compatibles con el POS", async () => {
  await page.getByRole("link", { name: "Configuración" }).click();
  await expect(
    page.getByRole("heading", { name: "Impresión", exact: true }),
  ).toBeVisible();
  const kitchenProfile = page.getByRole("region", {
    name: "Comanda de cocina",
  });
  await kitchenProfile.getByLabel("Nombre del perfil").fill("Cocina E2E");
  await kitchenProfile.getByLabel("Ancho de papel").selectOption("58mm");
  await kitchenProfile.getByLabel("Copias").fill("2");
  await expect(
    page.getByRole("heading", { name: "Textos de impresión" }),
  ).toBeVisible();
  const kitchenTexts = page.getByRole("region", { name: "Textos de comanda" });
  const billTexts = page.getByRole("region", { name: "Textos de cuenta" });
  await kitchenTexts.getByLabel("Encabezado de comanda").fill("COCINA E2E");
  await kitchenTexts.getByLabel("Pie de comanda").fill("Revisar pedido E2E");
  await billTexts.getByLabel("Encabezado de cuenta").fill("Restaurante E2E");
  await billTexts.getByLabel("Pie de cuenta").fill("Gracias E2E");
  await page.getByRole("button", { name: "Guardar configuración" }).click();
  await expect(
    page.getByRole("status", { name: "Configuración guardada." }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Caja" }).click();
  await page.getByRole("link", { name: "Configuración" }).click();
  const persistedKitchen = page.getByRole("region", {
    name: "Comanda de cocina",
  });
  await expect(persistedKitchen.getByLabel("Nombre del perfil")).toHaveValue(
    "Cocina E2E",
  );
  await expect(persistedKitchen.getByLabel("Copias")).toHaveValue("2");
  await expect(page.getByLabel("Encabezado de comanda")).toHaveValue(
    "COCINA E2E",
  );
  await expect(page.getByLabel("Pie de comanda")).toHaveValue(
    "Revisar pedido E2E",
  );
  await expect(page.getByLabel("Encabezado de cuenta")).toHaveValue(
    "Restaurante E2E",
  );
  await expect(page.getByLabel("Pie de cuenta")).toHaveValue("Gracias E2E");
});

test("configura sólo la cantidad de mesas desde Salón", async () => {
  await page.getByRole("link", { name: "Configuración" }).click();
  await expect(page.getByLabel("Secciones de configuración")).not.toContainText(
    "Mesas",
  );
  await expect(page.getByLabel("Mesas activas")).toHaveCount(0);

  await page.getByRole("link", { name: "Salón" }).click();
  await expect(
    page.getByRole("heading", { name: "Cantidad de mesas" }),
  ).toBeVisible();
  const tableCountInput = page.getByLabel("Mesas activas");
  const currentCount = Number(await tableCountInput.inputValue());
  const requestedCount = Math.min(currentCount + 1, 200);
  await tableCountInput.fill(String(requestedCount));
  await page.getByRole("button", { name: "Actualizar salón" }).click();
  await expect(page.locator("#table-count-status")).toContainText(
    "Salón actualizado:",
  );
  await expect(
    page.getByRole("button", { name: `Abrir mesa ${requestedCount}` }),
  ).toBeVisible();
});

test("concilia la caja con cambio final distinto y confirmación definitiva", async () => {
  await page.getByRole("link", { name: "Caja" }).click();
  await page.getByRole("button", { name: /Conciliar y cerrar caja/ }).click();
  const dialog = page.getByRole("dialog", {
    name: "Conciliar y cerrar caja",
  });
  await expect(
    dialog.getByText("Composición del efectivo esperado"),
  ).toBeVisible();
  await dialog.getByLabel("Efectivo contado").fill("50000");
  await dialog.getByLabel("Cambio final para la próxima caja").fill("30000");
  await expect(dialog.getByText("Efectivo a retirar")).toBeVisible();
  await dialog
    .getByLabel(/Forzar cierre si existen pedidos pendientes/)
    .check();
  await dialog.getByLabel("Motivo del cierre forzado").fill("Cierre E2E");
  await dialog.getByLabel("PIN de autorización").fill("1234");
  await dialog.getByRole("button", { name: "Revisar cierre" }).click();
  const confirmation = page.getByRole("dialog", {
    name: "Confirmar cierre definitivo",
  });
  await expect(
    confirmation
      .getByText("Efectivo a retirar")
      .locator("..")
      .getByText("$ 20.000", { exact: true }),
  ).toBeVisible();
  await confirmation
    .getByRole("button", { name: "Confirmar cierre definitivo" })
    .click();
  await expect(page.getByText("La caja está cerrada")).toBeVisible();
});
