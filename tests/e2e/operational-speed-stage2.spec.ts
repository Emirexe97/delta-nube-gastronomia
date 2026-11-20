import { launchConfiguredPos } from "./pos-fixture";
import { test, expect, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let app: ElectronApplication;
let page: Page;
let profile = "";

test.beforeEach(async () => {
  profile = await mkdtemp(join(tmpdir(), "gastronomy-operational-speed-"));
  app = await launchConfiguredPos({ args: ["apps/desktop-shell", `--user-data-dir=${profile}`], cwd: process.cwd() });
  page = await app.firstWindow();
  await expect(page.getByText("Delta Nube", { exact: true })).toBeVisible();
  await page.evaluate(async () => {
    if (!(await window.gastronomy.bootstrap()).cashSession)
      await window.gastronomy.openCashSession({ openingAmountMinor: 1_000_000 });
  });
  await page.reload();
});

test.afterEach(async () => {
  await app?.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((window) => window.destroy()));
  await app?.close();
  if (profile) await rm(profile, { recursive: true, force: true });
});

async function startDraft(type: "TAKEAWAY" | "DELIVERY" = "TAKEAWAY") {
  await page.getByRole("link", { name: "Pedidos", exact: true }).click();
  await page.keyboard.press(type === "DELIVERY" ? "F4" : "F3");
  const create = page.getByRole("dialog", { name: type === "DELIVERY" ? "Nuevo Envío" : "Nuevo Para retirar" });
  await create.getByRole("button", { name: "Cargar productos primero", exact: true }).click();
  const editor = page.getByRole("dialog", { name: new RegExp(type === "DELIVERY" ? "Pedido #\\d+ · Envío" : "Pedido #\\d+ · Para retirar") });
  await expect(editor).toBeVisible();
  return editor;
}

async function addProduct(editor: ReturnType<typeof page.getByRole>, query = "GAS15") {
  const search = editor.getByPlaceholder(/Código, nombre, categoría/);
  await search.fill(query);
  const card = editor.locator('[id^="order-editor-product-"]').filter({ hasText: "Gaseosa 1,5 L" });
  await expect(card).toBeVisible();
  await card.click();
  await expect(editor.getByLabel("Cantidad de Gaseosa 1,5 L")).toHaveValue("1");
  return search;
}

async function fillInlineCustomer(editor: ReturnType<typeof page.getByRole>, name: string) {
  await editor.getByRole("button", { name: "Cliente y envío", exact: true }).click();
  const panel = editor.getByRole("region", { name: "Datos del cliente y envío" });
  await expect(panel).toBeVisible();
  await panel.getByLabel("Nombre del cliente *", { exact: true }).fill(name);
  await panel.getByLabel("Teléfono *", { exact: true }).fill("11 5555-1234");
  return panel;
}

async function completeCustomer(panel: ReturnType<typeof page.getByRole>) {
  await panel.getByRole("button", { name: "Guardar datos", exact: true }).click();
  await expect(panel).toBeHidden();
}

async function confirmDraft(editor: ReturnType<typeof page.getByRole>) {
  await editor.getByRole("button", { name: "Confirmar pedido", exact: true }).click();
  await expect(editor.getByRole("button", { name: "Confirmar pedido", exact: true })).toBeHidden();
  await editor.getByRole("button", { name: /Cobrar.*F8/ }).click();
  const payment = page.getByRole("dialog", { name: "Cobrar pedido", exact: true });
  await expect(payment).toBeVisible();
  return payment;
}

async function draftWithOneItem() {
  return page.evaluate(async () => (await window.gastronomy.bootstrap()).orders.find((order) => order.lifecycleStatus === "DRAFT" && order.items.length === 1)!);
}

async function orderState(id: string) {
  return page.evaluate(async (orderId) => {
    const order = (await window.gastronomy.bootstrap()).orders.find((candidate) => candidate.id === orderId)!;
    return {
      id: order.id, status: order.lifecycleStatus, paymentStatus: order.paymentStatus, customerId: order.customerId,
      items: order.items.map((item) => ({ id: item.id, productId: item.productId, quantity: item.quantity, lineTotalMinor: item.lineTotalMinor })),
      totalMinor: order.totalMinor, paidMinor: order.paidMinor,
      payments: order.payments.map((payment) => ({ methodCode: payment.methodCode, amountMinor: payment.amountMinor })),
    };
  }, id);
}

test("carga productos primero, datos inline sin mutaciones F7/F8 y conserva identidad y búsqueda", async ({}, info) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1366, height: 768 });
  const editor = await startDraft();
  const search = await addProduct(editor);
  const before = await draftWithOneItem();
  await search.fill("GAS15");
  const panel = await fillInlineCustomer(editor, "Stage2 inline cliente");
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(editor.getByRole("button", { name: "Confirmar pedido", exact: true })).toBeDisabled();
  await page.keyboard.press("F7");
  await page.keyboard.press("F8");
  await expect(page.getByRole("dialog")).toHaveCount(1);
  const save = panel.getByRole("button", { name: "Guardar datos", exact: true });
  await expect(save).toBeEnabled();
  await save.focus();
  await expect(save).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(save).not.toBeFocused();
  expect(await page.evaluate(() => {
    const active = document.activeElement;
    return active instanceof HTMLElement && active !== document.body && !active.matches(":disabled") && !active.closest("[hidden], [inert]");
  })).toBe(true);
  expect((await orderState(before.id)).items).toEqual(before.items.map((item) => ({ id: item.id, productId: item.productId, quantity: item.quantity, lineTotalMinor: item.lineTotalMinor })));
  await page.screenshot({ path: info.outputPath("operational-speed-stage2-1366x768.png") });
  await completeCustomer(panel);
  await expect(editor).toBeVisible();
  await expect(search).toHaveValue("GAS15");
  const saved = await orderState(before.id);
  expect(saved.status).toBe("DRAFT");
  expect(saved.items).toEqual(before.items.map((item) => ({ id: item.id, productId: item.productId, quantity: item.quantity, lineTotalMinor: item.lineTotalMinor })));
  await confirmDraft(editor);
  const confirmed = await orderState(before.id);
  expect(confirmed.status).toBe("CONFIRMED");
  expect(confirmed.items).toEqual(saved.items);
});

test("dirty inline respeta cancelar y descartar; error IPC conserva datos y permite reintentar", async () => {
  test.setTimeout(90_000);
  const editor = await startDraft();
  const search = await addProduct(editor);
  const before = await draftWithOneItem();
  await search.fill("GAS15");
  let panel = await fillInlineCustomer(editor, "Cliente no guardado");
  page.once("dialog", (dialog) => dialog.dismiss());
  await panel.getByRole("button", { name: "Volver a productos", exact: true }).click();
  await expect(panel).toBeVisible();
  await expect(panel.getByLabel("Nombre del cliente *", { exact: true })).toHaveValue("Cliente no guardado");
  page.once("dialog", (dialog) => dialog.accept());
  await panel.getByRole("button", { name: "Volver a productos", exact: true }).click();
  await expect(panel).toBeHidden();
  await expect(editor.getByLabel("Cantidad de Gaseosa 1,5 L")).toHaveValue("1");
  await expect(search).toHaveValue("GAS15");
  expect((await orderState(before.id)).items.map((item) => item.id)).toEqual(before.items.map((item) => item.id));

  panel = await fillInlineCustomer(editor, "Cliente con error de guardado");
  await app.evaluate(({ ipcMain }) => {
    const channel = "gastronomy:updateDraftOrder";
    const original = (ipcMain as any)._invokeHandlers.get(channel);
    if (typeof original !== "function") throw new Error(`No se encontró el handler ${channel}`);
    (globalThis as any).__stage2UpdateDraftHandler = original;
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, () => { throw new Error("Error de guardado E2E"); });
  });
  await panel.getByRole("button", { name: "Guardar datos", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("Error de guardado E2E");
  await expect(panel.getByLabel("Nombre del cliente *", { exact: true })).toHaveValue("Cliente con error de guardado");
  expect((await orderState(before.id)).items.map((item) => item.id)).toEqual(before.items.map((item) => item.id));
  await app.evaluate(({ ipcMain }) => {
    const channel = "gastronomy:updateDraftOrder";
    const original = (globalThis as any).__stage2UpdateDraftHandler;
    if (typeof original !== "function") throw new Error("Falta handler original para reintento");
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, original);
    delete (globalThis as any).__stage2UpdateDraftHandler;
  });
  await completeCustomer(panel);
  expect((await orderState(before.id)).items.map((item) => item.id)).toEqual(before.items.map((item) => item.id));
  await expect(search).toHaveValue("GAS15");
});

test("guardado inline pendiente bloquea Escape y conserva productos hasta resolver IPC", async () => {
  test.setTimeout(90_000);
  const editor = await startDraft();
  await addProduct(editor);
  const before = await draftWithOneItem();
  const panel = await fillInlineCustomer(editor, "Cliente pending stage2");
  await app.evaluate(({ ipcMain }) => {
    const channel = "gastronomy:updateDraftOrder";
    const original = (ipcMain as any)._invokeHandlers.get(channel);
    if (typeof original !== "function") throw new Error(`No se encontró el handler ${channel}`);
    (globalThis as any).__stage2PendingOriginal = original;
    (globalThis as any).__stage2PendingGate = new Promise<void>((resolve) => {
      (globalThis as any).__stage2ReleasePending = resolve;
    });
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, async (event, input) => {
      await (globalThis as any).__stage2PendingGate;
      return original(event, input);
    });
  });
  const save = panel.getByRole("button", { name: "Guardar datos", exact: true });
  await expect(save).toBeEnabled();
  await save.click();
  await expect(panel.getByRole("button", { name: "Guardando…" })).toBeDisabled();
  await expect(panel.getByLabel("Nombre del cliente *", { exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(editor).toBeVisible();
  await expect(panel).toBeVisible();
  expect((await orderState(before.id)).items.map((item) => item.id)).toEqual(before.items.map((item) => item.id));
  await app.evaluate(({ ipcMain }) => {
    const channel = "gastronomy:updateDraftOrder";
    const release = (globalThis as any).__stage2ReleasePending;
    const original = (globalThis as any).__stage2PendingOriginal;
    if (typeof release !== "function" || typeof original !== "function") throw new Error("Falta gate IPC pendiente");
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, original);
    release();
    delete (globalThis as any).__stage2ReleasePending;
    delete (globalThis as any).__stage2PendingOriginal;
    delete (globalThis as any).__stage2PendingGate;
  });
  await expect(panel).toBeHidden();
  const saved = await orderState(before.id);
  expect(saved.status).toBe("DRAFT");
  expect(saved.items.map((item) => item.id)).toEqual(before.items.map((item) => item.id));
});

test("efectivo exacto por defecto y doble clic no duplica pagos", async ({}, info) => {
  test.setTimeout(90_000);
  const editor = await startDraft();
  await addProduct(editor);
  await completeCustomer(await fillInlineCustomer(editor, "Cliente efectivo stage2"));
  const draft = await draftWithOneItem();
  const payment = await confirmDraft(editor);
  await expect(payment.getByRole("button", { name: "Usar Efectivo", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(payment.getByLabel("Efectivo", { exact: true })).toHaveValue(String(draft.totalMinor / 100));
  await page.screenshot({ path: info.outputPath("operational-speed-stage2-payment-default.png") });
  await payment.getByRole("button", { name: "Confirmar cobro", exact: true }).dblclick();
  await expect(payment).toBeHidden();
  const state = await orderState(draft.id);
  expect(state.paidMinor).toBe(state.totalMinor);
  expect(state.payments).toEqual([{ methodCode: "CASH", amountMinor: state.totalMinor }]);
});

test("transferencia única cobra saldo exacto sin requerir referencia opcional", async () => {
  test.setTimeout(90_000);
  const editor = await startDraft();
  await addProduct(editor);
  await completeCustomer(await fillInlineCustomer(editor, "Cliente transferencia stage2"));
  const draft = await draftWithOneItem();
  const payment = await confirmDraft(editor);
  await payment.getByRole("button", { name: "Usar Transferencia", exact: true }).click();
  await expect(payment.getByLabel("Transferencia", { exact: true })).toHaveValue(String(draft.totalMinor / 100));
  await expect(payment.getByLabel("Efectivo", { exact: true })).toHaveCount(0);
  await expect(payment.getByLabel("Referencia / comprobante", { exact: true })).toHaveAttribute("placeholder", "Opcional");
  await payment.getByRole("button", { name: "Confirmar cobro", exact: true }).click();
  await expect(payment).toBeHidden();
  const state = await orderState(draft.id);
  expect(state.paidMinor).toBe(state.totalMinor);
  expect(state.payments).toEqual([{ methodCode: "TRANSFER", amountMinor: state.totalMinor }]);
});

test("pago mixto registra importes brutos y vuelto, pero saldo pagado neto exacto", async () => {
  test.setTimeout(90_000);
  const editor = await startDraft();
  await addProduct(editor);
  await completeCustomer(await fillInlineCustomer(editor, "Cliente mixto stage2"));
  const draft = await draftWithOneItem();
  const payment = await confirmDraft(editor);
  await payment.getByRole("button", { name: "Pago mixto", exact: true }).click();
  const cash = Math.floor(draft.totalMinor / 200) * 100;
  const transfer = draft.totalMinor - cash;
  const change = 500;
  await payment.getByLabel("Efectivo", { exact: true }).fill(String((cash + change) / 100));
  await payment.getByLabel("Transferencia", { exact: true }).fill("-1");
  await expect(payment.getByRole("button", { name: "Confirmar cobro", exact: true })).toBeDisabled();
  await expect(payment.getByRole("alert")).toContainText("importes válidos");
  await payment.getByLabel("Transferencia", { exact: true }).fill(String(transfer / 100));
  await expect(payment.getByText("Vuelto a entregar", { exact: true })).toBeVisible();
  await expect(payment.getByText(/Sobrepago recibido:/)).toContainText(/Sobrepago recibido:.*5\b/);
  await payment.getByRole("button", { name: "Confirmar cobro", exact: true }).click();
  await expect(payment).toBeHidden();
  const paid = await orderState(draft.id);
  expect(paid.totalMinor).toBe(draft.totalMinor);
  expect(paid.paidMinor).toBe(draft.totalMinor);
  expect(paid.payments).toHaveLength(2);
  expect(paid.payments.find((item) => item.methodCode === "CASH")?.amountMinor).toBe(cash + change);
  expect(paid.payments.find((item) => item.methodCode === "TRANSFER")?.amountMinor).toBe(transfer);
  expect(paid.payments.reduce((sum, item) => sum + item.amountMinor, 0)).toBe(draft.totalMinor + change);
});

test("cuenta corriente exige ficha activa aunque el pedido tenga nombre y teléfono", async () => {
  test.setTimeout(90_000);
  const editor = await startDraft();
  await addProduct(editor);
  await completeCustomer(await fillInlineCustomer(editor, "Cliente cuenta stage2"));
  const draft = await draftWithOneItem();
  expect(draft.customerId).toBeNull();
  const customer = await page.evaluate(() => window.gastronomy.createCustomer({ name: "Cliente cuenta stage2", phone: "1155551234" }));
  const payment = await confirmDraft(editor);
  await payment.getByRole("button", { name: "Cargar saldo completo a cuenta corriente", exact: true }).click();
  await expect(payment.getByRole("alert")).toContainText("ficha de cliente activa");
  await expect(payment.getByRole("button", { name: "Confirmar cobro", exact: true })).toBeDisabled();
  expect((await orderState(draft.id)).payments).toHaveLength(0);
  await payment.getByLabel("Buscar cliente para cuenta corriente").fill("Cliente cuenta stage2");
  await payment.getByRole("button", { name: "Buscar", exact: true }).click();
  await payment.getByRole("button", { name: /Cliente cuenta stage2 ·/ }).click();
  await expect(payment.getByRole("button", { name: "Confirmar cobro", exact: true })).toBeEnabled();
  await payment.getByRole("button", { name: "Confirmar cobro", exact: true }).click();
  await expect(payment).toBeHidden();
  const paid = await orderState(draft.id);
  expect(paid.customerId).toBe(customer.id);
  expect(paid.paidMinor).toBe(paid.totalMinor);
  expect(paid.payments).toEqual([{ methodCode: "ACCOUNT", amountMinor: paid.totalMinor }]);
});
