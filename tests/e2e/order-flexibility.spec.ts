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

test.beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), "gastronomy-order-flex-"));
  app = await electron.launch({
    args: ["apps/desktop-shell", `--user-data-dir=${userData}`],
    cwd: process.cwd(),
  });
  page = await app.firstWindow();
  await expect(page.getByText("Delta Nube", { exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const bootstrap = await window.gastronomy.bootstrap();
    if (!bootstrap.cashSession)
      await window.gastronomy.openCashSession({
        openingAmountMinor: 5_000_000,
      });
  });
  // Opening a session through the API does not refresh the renderer's cached
  // view, so reload before exercising actions gated by an open cash session.
  await page.reload();
});

test.afterEach(async () => {
  await app?.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) window.destroy();
  });
  await app?.close();
  if (userData) await rm(userData, { recursive: true, force: true });
});

async function seedOrder(type: "TAKEAWAY" | "DELIVERY", feeMinor = 0) {
  return page.evaluate(
    async ({ type, feeMinor }) => {
      const api = window.gastronomy;
      const data = await api.bootstrap();
      if (!data.settings.deliverySettlementEnabled) {
        await api.saveSettings({
          ...data.settings,
          deliverySettlementEnabled: true,
        });
      }
      const driver =
        type === "DELIVERY"
          ? await api.createDriver({
              fullName: "Repartidor flex E2E",
              authorizerPin: "1234",
            })
          : null;
      const order = await api.createOrder({
        type,
        customerName: "Cliente flex E2E",
        customerPhone: "11 5555-9090",
        deliveryAddress: type === "DELIVERY" ? "Calle Flex 123" : undefined,
        deliveryFeeMinor: feeMinor,
        driverUserId: driver?.id,
        promisedAt: new Date(Date.now() + 3_600_000).toISOString(),
        scheduled: true,
      });
      const product = data.products.find((candidate) => candidate.active)!;
      await api.addOrderItem({ orderId: order.id, productId: product.id });
      const confirmed = await api.confirmOrder({ orderId: order.id });
      return {
        id: order.id,
        number: confirmed.number,
        productId: product.id,
        totalMinor: confirmed.totalMinor,
        feeMinor,
        driverId: driver?.id ?? null,
      };
    },
    { type, feeMinor },
  );
}

test("permite cargar productos primero, bloquea confirmar sin cliente y conserva ítems", async () => {
  await page.getByRole("link", { name: "Pedidos", exact: true }).click();
  await page.getByRole("button", { name: /F3 Para retirar/ }).click();
  const create = page.getByRole("dialog", { name: "Nuevo Para retirar" });
  await create
    .getByRole("button", { name: "Cargar productos primero" })
    .click();

  const editor = page.getByRole("dialog", {
    name: /Pedido #\d+ · Para retirar/,
  });
  await editor.getByRole("button", { name: /Muzzarella grande/ }).click();
  await page
    .getByRole("dialog", { name: /Agregar · Muzzarella grande/ })
    .getByRole("button", { name: "Agregar al pedido" })
    .click();
  const addedItem = editor.getByRole("article");
  await expect(addedItem.getByText("Muzzarella grande")).toBeVisible();
  await expect(
    addedItem.getByLabel("Cantidad de Muzzarella grande"),
  ).toHaveValue("1");
  await expect(
    editor.getByRole("button", { name: "Confirmar pedido" }),
  ).toBeDisabled();

  const result = await page.evaluate(async () => {
    const api = window.gastronomy;
    const draft = (await api.bootstrap()).orders.find(
      (candidate) =>
        candidate.lifecycleStatus === "DRAFT" && candidate.items.length > 0,
    )!;
    let error = "";
    try {
      await api.confirmOrder({ orderId: draft.id });
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
    return { id: draft.id, error, retainedItems: draft.items.length };
  });
  expect(result.error).toMatch(/cliente|teléfono|datos/i);
  expect(result.retainedItems).toBe(1);
  await editor
    .getByRole("button", { name: "Volver a datos del cliente y envío" })
    .click();
  const metadata = page.getByRole("dialog", {
    name: "Editar datos · Para retirar",
  });
  await metadata
    .getByLabel("Nombre del cliente *", { exact: true })
    .fill("Cliente agregado luego");
  await metadata.getByLabel("Teléfono *", { exact: true }).fill("11 5555-0101");
  await metadata
    .getByRole("button", { name: "Guardar y volver al pedido" })
    .click();
  await expect(editor).toBeVisible();
  await expect(
    editor.getByRole("button", { name: "Confirmar pedido" }),
  ).toBeEnabled();
  await editor.getByRole("button", { name: "Confirmar pedido" }).click();
  const confirmed = await page.evaluate(
    async (id) =>
      (await window.gastronomy.bootstrap()).orders.find(
        (candidate) => candidate.id === id,
      )!,
    result.id,
  );
  expect(confirmed.lifecycleStatus).toBe("CONFIRMED");
  expect(confirmed.items).toHaveLength(1);
});

test("la modalidad se elige en modal y el pedido sin cobrar conserva identidad, precios, stock y horario", async () => {
  const seeded = await seedOrder("TAKEAWAY");
  await page.reload();
  const before = await page.evaluate(async ({ id, productId }) => {
    const data = await window.gastronomy.bootstrap();
    const order = data.orders.find((candidate) => candidate.id === id)!;
    return {
      order,
      stock: data.products.find((product) => product.id === productId)!
        .stockMinor,
    };
  }, seeded);

  await page.getByRole("link", { name: "Pedidos", exact: true }).click();
  await page.getByRole("row").filter({ hasText: "Cliente flex E2E" }).click();
  const editor = page.getByRole("dialog", {
    name: /Pedido #\d+ · Para retirar/,
  });
  await editor
    .getByRole("button", { name: "Volver a datos del cliente y envío" })
    .click();
  const modeDialog = page.getByRole("dialog", { name: /Editar datos ·/ });
  await modeDialog.getByLabel("Modalidad del pedido").selectOption("DELIVERY");
  await modeDialog.getByLabel("Dirección").fill("Calle Flex 123");
  await modeDialog.getByLabel("Costo de envío").fill("2500");
  await modeDialog
    .getByRole("button", { name: "Guardar y volver al pedido" })
    .click();

  const switched = await page.evaluate(async ({ id, productId }) => {
    const api = window.gastronomy;
    const current = (await api.bootstrap()).orders.find(
      (candidate) => candidate.id === id,
    )!;
    const updated = await api.updateDraftOrder({
      orderId: current.id,
      type: "DELIVERY",
      customerName: current.customerNameSnapshot,
      customerPhone: current.customerPhoneSnapshot,
      deliveryAddress: "Calle Flex 123",
      deliveryFeeMinor: 250_000,
      promisedAt: current.promisedAt,
      scheduled: current.scheduled,
    });
    const data = await api.bootstrap();
    return {
      updated,
      stock: data.products.find((product) => product.id === productId)!
        .stockMinor,
    };
  }, seeded);
  expect(switched.updated.id).toBe(seeded.id);
  expect(switched.updated.type).toBe("DELIVERY");
  expect(switched.updated.items[0]).toMatchObject({
    id: before.order.items[0]!.id,
    unitPriceMinorSnapshot: before.order.items[0]!.unitPriceMinorSnapshot,
  });
  expect(switched.updated.promisedAt).toBe(before.order.promisedAt);
  expect(switched.updated.scheduled).toBe(true);
  expect(switched.stock).toBe(before.stock);

  const returned = await page.evaluate(async ({ id, productId }) => {
    const api = window.gastronomy;
    const current = (await api.bootstrap()).orders.find(
      (candidate) => candidate.id === id,
    )!;
    const updated = await api.updateDraftOrder({
      orderId: current.id,
      type: "TAKEAWAY",
      customerName: current.customerNameSnapshot,
      customerPhone: current.customerPhoneSnapshot,
      deliveryAddress: null,
      deliveryFeeMinor: 0,
      promisedAt: current.promisedAt,
      scheduled: current.scheduled,
    });
    const data = await api.bootstrap();
    return {
      updated,
      stock: data.products.find((product) => product.id === productId)!
        .stockMinor,
    };
  }, seeded);
  expect(returned.updated.id).toBe(seeded.id);
  expect(returned.updated.type).toBe("TAKEAWAY");
  expect(returned.updated.items[0]!.id).toBe(before.order.items[0]!.id);
  expect(returned.updated.promisedAt).toBe(before.order.promisedAt);
  expect(returned.stock).toBe(before.stock);
});

test("el cambio de modalidad cobrado requiere PIN y devuelve exactamente el excedente", async () => {
  const seeded = await seedOrder("TAKEAWAY");
  const paid = await page.evaluate(async ({ id, totalMinor }) => {
    const order = await window.gastronomy.payOrder({
      orderId: id,
      payments: [{ methodCode: "CASH", amountMinor: totalMinor }],
    });
    return { id: order.id, total: order.totalMinor };
  }, seeded);
  const outcome = await page.evaluate(async ({ id }) => {
    const api = window.gastronomy;
    const input = {
      orderId: id,
      type: "DELIVERY" as const,
      customerName: "Cliente flex E2E",
      customerPhone: "11 5555-9090",
      deliveryAddress: "Calle Flex 123",
      deliveryFeeMinor: 250_000,
      reason: "Cambio a envío E2E",
    };
    let noPin = "";
    try {
      await api.updateDraftOrder(input);
    } catch (error) {
      noPin = error instanceof Error ? error.message : String(error);
    }
    const surcharge = await api.updateDraftOrder({
      ...input,
      authorizerPin: "1234",
    });
    const completedSurcharge = await api.payOrder({
      orderId: id,
      payments: [
        {
          methodCode: "CASH",
          amountMinor: surcharge.totalMinor - surcharge.paidMinor,
        },
      ],
    });
    const lowerFeeInput = {
      ...input,
      type: "TAKEAWAY" as const,
      deliveryAddress: null,
      deliveryFeeMinor: 0,
      reason: "Volver a retiro E2E",
      authorizerPin: "1234",
      refunds: [
        {
          paymentId: completedSurcharge.payments.at(-1)!.id,
          amountMinor: 250_000,
        },
      ],
    };
    const refunded = await api.updateDraftOrder(lowerFeeInput);
    return {
      noPin,
      surchargeTotal: surcharge.totalMinor,
      refundedTotal: refunded.totalMinor,
      refundedPaid: refunded.paidMinor,
    };
  }, paid);
  expect(outcome.noPin).toMatch(/autorización|PIN/i);
  expect(outcome.surchargeTotal).toBe(paid.total + 250_000);
  expect(outcome.refundedTotal).toBe(paid.total);
  expect(outcome.refundedPaid).toBe(outcome.refundedTotal);
});

test("el editor cobrado exige PIN y motivo para pasar a envío, cobrar saldo y devolver excedente exacto al volver a retiro", async () => {
  const seeded = await seedOrder("TAKEAWAY");
  const baseline = await page.evaluate(
    async () =>
      (await window.gastronomy.bootstrap()).cashSession!.expectedAmountMinor,
  );
  await page.evaluate(async ({ id, totalMinor }) => {
    await window.gastronomy.payOrder({
      orderId: id,
      payments: [{ methodCode: "CASH", amountMinor: totalMinor }],
    });
  }, seeded);

  await page.reload();
  await page.getByRole("link", { name: "Pedidos", exact: true }).click();
  await page.getByRole("row").filter({ hasText: "Cliente flex E2E" }).click();
  let editor = page.getByRole("dialog", { name: /Pedido #\d+ · Para retirar/ });
  await editor
    .getByRole("button", {
      name: "Cambiar cliente, modalidad o envío (requiere autorización)",
    })
    .click();
  let editModal = page.getByRole("dialog", { name: /Editar datos ·/ });
  await editModal.getByLabel("Modalidad del pedido").selectOption("DELIVERY");
  await editModal.getByLabel("Dirección").fill("Calle Flex 123");
  await editModal.getByLabel("Costo de envío").fill("2500");
  await editModal
    .getByLabel("Motivo del cambio (obligatorio)")
    .fill("Cliente cambia a envío");
  await editModal.getByLabel("PIN de autorización (obligatorio)").fill("1234");
  await editModal
    .getByRole("button", { name: "Guardar y volver al pedido" })
    .click();

  const afterSurcharge = await page.evaluate(async ({ id }) => {
    const api = window.gastronomy;
    const order = (await api.bootstrap()).orders.find(
      (candidate) => candidate.id === id,
    )!;
    const updated = await api.payOrder({
      orderId: id,
      payments: [
        { methodCode: "CASH", amountMinor: order.totalMinor - order.paidMinor },
      ],
    });
    return {
      order: updated,
      expected: (await api.bootstrap()).cashSession!.expectedAmountMinor,
    };
  }, seeded);
  expect(afterSurcharge.order.type).toBe("DELIVERY");
  expect(afterSurcharge.order.paymentStatus).toBe("PAID");
  expect(afterSurcharge.expected).toBe(baseline + seeded.totalMinor + 250_000);

  await page.reload();
  await page.getByRole("link", { name: "Pedidos", exact: true }).click();
  await page.getByRole("row").filter({ hasText: "Cliente flex E2E" }).click();
  editor = page.getByRole("dialog", { name: /Pedido #\d+ · Envío/ });
  await editor
    .getByRole("button", {
      name: "Cambiar cliente, modalidad o envío (requiere autorización)",
    })
    .click();
  editModal = page.getByRole("dialog", { name: /Editar datos ·/ });
  await editModal.getByLabel("Modalidad del pedido").selectOption("TAKEAWAY");
  await editModal
    .getByLabel("Motivo del cambio (obligatorio)")
    .fill("Cliente vuelve a retirar");
  await editModal.getByLabel("PIN de autorización (obligatorio)").fill("1234");
  const cashRefund = editModal.getByLabel(/Efectivo · máximo/).first();
  await cashRefund.fill("2499");
  await expect(
    editModal.getByText(/Distribuido:.*\$\s*2\.499 de \$\s*2\.500/),
  ).toBeVisible();
  const saveEdit = editModal.getByRole("button", {
    name: "Guardar y volver al pedido",
  });
  await expect(saveEdit).toBeDisabled();
  await cashRefund.fill("2500");
  await expect(
    editModal.getByText(/Distribuido:.*\$\s*2\.500 de \$\s*2\.500/),
  ).toBeVisible();
  await expect(saveEdit).toBeEnabled();
  await saveEdit.click();

  const final = await page.evaluate(async ({ id }) => {
    const api = window.gastronomy;
    const data = await api.bootstrap();
    const order = data.orders.find((candidate) => candidate.id === id)!;
    return {
      order,
      expected: data.cashSession!.expectedAmountMinor,
      ledger: data.deliveryLedger.find((row) => row.orderId === id),
    };
  }, seeded);
  expect(final.order.type).toBe("TAKEAWAY");
  expect(final.order.paidMinor).toBe(seeded.totalMinor);
  expect(final.order.totalMinor).toBe(seeded.totalMinor);
  expect(final.expected).toBe(baseline + seeded.totalMinor);
  expect(final.ledger).toBeUndefined();
});

test("la sección Repartidores permite liquidar y revertir una rendición desde la interfaz", async () => {
  const seeded = await seedOrder("DELIVERY", 250_000);
  const prepared = await page.evaluate(async ({ id, totalMinor }) => {
    const api = window.gastronomy;
    const before = await api.bootstrap();
    await api.payOrder({
      orderId: id,
      collectedByDriver: true,
      payments: [{ methodCode: "CASH", amountMinor: totalMinor }],
    });
    await api.updateOrderStatus({ orderId: id, status: "READY" });
    await api.updateOrderStatus({ orderId: id, status: "OUT_FOR_DELIVERY" });
    await api.updateOrderStatus({ orderId: id, status: "DELIVERED" });
    const after = await api.bootstrap();
    return {
      id,
      number: after.orders.find((order) => order.id === id)!.number,
      expected: after.cashSession!.expectedAmountMinor,
      ledger: after.deliveryLedger.find((row) => row.orderId === id)!,
    };
  }, seeded);
  expect(prepared.ledger.status).toBe("PENDING");
  const beforeSettlementExpected = prepared.expected;

  await page.reload();
  await page.getByRole("link", { name: "Repartidores", exact: true }).click();
  await page
    .getByLabel(`Seleccionar movimiento del pedido ${prepared.number}`)
    .check();
  await page
    .getByRole("button", { name: /Registrar rendición del repartidor \(1\)/ })
    .click();
  const review = page.getByRole("dialog", { name: "Revisar pago o rendición" });
  await review.getByLabel("Motivo").fill("Rendición E2E");
  await review.getByLabel("PIN de autorización").fill("1234");
  await review.getByRole("button", { name: "Revisar liquidación" }).click();
  const confirm = page.getByRole("dialog", {
    name: "Confirmar movimiento de caja",
  });
  await confirm.getByRole("button", { name: "Confirmar movimiento" }).click();
  await expect(
    page.getByRole("button", {
      name: `Revertir liquidación del pedido ${prepared.number}`,
    }),
  ).toBeVisible();
  const settled = await page.evaluate(
    async ({ id }) => ({
      ledger: (await window.gastronomy.bootstrap()).deliveryLedger.find(
        (row) => row.orderId === id,
      )!,
      expected: (await window.gastronomy.bootstrap()).cashSession!
        .expectedAmountMinor,
    }),
    prepared,
  );
  expect(settled.ledger.status).toBe("SETTLED");
  expect(settled.expected).toBe(
    beforeSettlementExpected + prepared.ledger.amountDueMinor,
  );

  await page
    .getByRole("button", {
      name: `Revertir liquidación del pedido ${prepared.number}`,
    })
    .click();
  const reverse = page.getByRole("dialog", {
    name: "Revertir liquidación del repartidor",
  });
  await reverse.getByLabel("Motivo de la reversión").fill("Reversión E2E");
  await reverse.getByLabel("PIN de autorización").fill("1234");
  await reverse.locator('input[type="checkbox"]').check();
  await reverse.getByRole("button", { name: "Confirmar reversión" }).click();
  const final = await page.evaluate(async ({ id }) => {
    const data = await window.gastronomy.bootstrap();
    return {
      ledger: data.deliveryLedger.find((row) => row.orderId === id)!,
      expected: data.cashSession!.expectedAmountMinor,
    };
  }, prepared);
  expect(final.ledger.status).toBe("PENDING");
  expect(final.ledger.settledAmountMinor).toBe(0);
  expect(final.expected).toBe(beforeSettlementExpected);
});

test("una devolución parcial después de liquidar revierte caja y conserva la rendición pendiente neta", async () => {
  const seeded = await seedOrder("DELIVERY", 250_000);
  const result = await page.evaluate(async ({ id, totalMinor }) => {
    const api = window.gastronomy;
    const initialExpected = (await api.bootstrap()).cashSession!
      .expectedAmountMinor;
    await api.payOrder({
      orderId: id,
      payments: [{ methodCode: "TRANSFER", amountMinor: totalMinor }],
    });
    await api.updateOrderStatus({ orderId: id, status: "READY" });
    await api.updateOrderStatus({ orderId: id, status: "OUT_FOR_DELIVERY" });
    await api.completeOrder({
      orderId: id,
      payments: [],
      finalStatus: "DELIVERED",
    });
    const paid = (await api.bootstrap()).orders.find(
      (order) => order.id === id,
    )!;
    const ledger = (await api.bootstrap()).deliveryLedger.find(
      (row) => row.orderId === id,
    )!;
    await api.settleDelivery({
      ledgerIds: [ledger.id],
      reason: "Pago de envío normal",
      authorizerPin: "1234",
    });
    const afterSettlement = await api.bootstrap();
    const expectedAfterSettlement =
      afterSettlement.cashSession!.expectedAmountMinor;
    let missingReversalError = "";
    try {
      await api.refundPayment({
        orderId: id,
        paymentId: paid.payments[0]!.id,
        amountMinor: 100_000,
        reason: "Devolución sin reversión",
        authorizerPin: "1234",
      });
    } catch (error) {
      missingReversalError =
        error instanceof Error ? error.message : String(error);
    }
    const refunded = await api.refundPayment({
      orderId: id,
      paymentId: paid.payments[0]!.id,
      amountMinor: 100_000,
      reason: "Devolución parcial luego de liquidar",
      authorizerPin: "1234",
      reverseDeliverySettlement: true,
    });
    const afterRefund = await api.bootstrap();
    return {
      paidMinor: refunded.paidMinor,
      missingReversalError,
      initialExpected,
      expectedBefore: expectedAfterSettlement,
      expectedAfter: afterRefund.cashSession!.expectedAmountMinor,
      ledger: afterRefund.deliveryLedger.find((row) => row.orderId === id),
    };
  }, seeded);
  expect(result.missingReversalError).toMatch(/liquidación|anulá/i);
  expect(result.paidMinor).toBe(seeded.totalMinor - 100_000);
  expect(result.expectedAfter).toBe(result.expectedBefore + 250_000);
  expect(result.expectedAfter).toBe(result.initialExpected);
  expect(result.ledger?.status).toBe("PENDING");
  expect(result.ledger?.settledAmountMinor).toBe(0);
  expect(result.ledger?.amountDueMinor).toBe(250_000);
});

test("un pedido cancelado no admite cambios de modalidad como bypass", async () => {
  const seeded = await seedOrder("TAKEAWAY");
  const draft = await page.evaluate(async (id) => {
    const api = window.gastronomy;
    const order = (await api.bootstrap()).orders.find(
      (candidate) => candidate.id === id,
    )!;
    await api.cancelOrder({
      orderId: order.id,
      reason: "Cancelación E2E",
      authorizerPin: "1234",
    });
    let error = "";
    try {
      await api.updateDraftOrder({
        orderId: order.id,
        type: "DELIVERY",
        deliveryAddress: "Calle 1",
        deliveryFeeMinor: 1_000,
      });
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
    return {
      status: (await api.bootstrap()).orders.find(
        (candidate) => candidate.id === order.id,
      )!.operationalStatus,
      error,
    };
  }, seeded.id);
  expect(draft.status).toBe("CANCELLED");
  expect(draft.error).toMatch(/finalizado|cancelado/i);
});

test("seña del 100% permite entregar con saldo cero sin cobro extra", async () => {
  const seeded = await seedOrder("DELIVERY", 50_000);
  const result = await page.evaluate(async ({ id }) => {
    const api = window.gastronomy;
    const order = (await api.bootstrap()).orders.find(
      (candidate) => candidate.id === id,
    )!;
    await api.applyOrderDeposit({
      orderId: id,
      depositMinor: order.subtotalMinor + order.deliveryFeeMinor,
      authorizerPin: "1234",
    });
    const zero = (await api.bootstrap()).orders.find(
      (candidate) => candidate.id === id,
    )!;
    await api.updateOrderStatus({ orderId: id, status: "READY" });
    await api.updateOrderStatus({ orderId: id, status: "OUT_FOR_DELIVERY" });
    const delivered = await api.completeOrder({
      orderId: id,
      payments: [],
      finalStatus: "DELIVERED",
    });
    return {
      zeroTotal: zero.totalMinor,
      zeroPaid: zero.paidMinor,
      delivered: delivered.operationalStatus,
      totalAfter: delivered.totalMinor,
    };
  }, seeded);
  expect(result.zeroTotal).toBe(0);
  expect(result.zeroPaid).toBe(0);
  expect(result.delivered).toBe("DELIVERED");
  expect(result.totalAfter).toBe(0);
});

test("la liquidación de envío bloquea el cambio hasta anularla con reversión explícita", async () => {
  const seeded = await seedOrder("DELIVERY", 250_000);
  const result = await page.evaluate(async ({ id, totalMinor }) => {
    const api = window.gastronomy;
    await api.payOrder({
      orderId: id,
      payDriverNow: true,
      payments: [{ methodCode: "CASH", amountMinor: totalMinor }],
    });
    const ledger = (await api.bootstrap()).deliveryLedger.find(
      (row) => row.orderId === id,
    )!;
    const input = {
      orderId: id,
      type: "TAKEAWAY" as const,
      customerName: "Cliente flex E2E",
      customerPhone: "11 5555-9090",
      deliveryAddress: null,
      deliveryFeeMinor: 0,
      promisedAt: null,
      scheduled: false,
      reason: "Volver a retiro E2E",
      authorizerPin: "1234",
      refunds: [
        {
          paymentId: (await api.bootstrap()).orders.find(
            (order) => order.id === id,
          )!.payments[0]!.id,
          amountMinor: 250_000,
        },
      ],
    };
    let denied = "";
    try {
      await api.updateDraftOrder(input);
    } catch (error) {
      denied = error instanceof Error ? error.message : String(error);
    }
    const changed = await api.updateDraftOrder({
      ...input,
      reverseDeliverySettlement: true,
    });
    const after = await api.bootstrap();
    return {
      denied,
      changedType: changed.type,
      ledger: after.deliveryLedger.find((row) => row.id === ledger.id),
    };
  }, seeded);
  expect(result.denied).toMatch(/liquidación|anulá/i);
  expect(result.changedType).toBe("TAKEAWAY");
  expect(result.ledger).toBeUndefined();
});
