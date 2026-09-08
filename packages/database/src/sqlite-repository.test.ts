import assert from "node:assert/strict";
import test from "node:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3-multiple-ciphers";
import type { CreateOrderInput } from "@gastronomy/contracts";
import { migrations } from "./migrations";
import { SqliteGastronomyRepository } from "./sqlite-repository";

const takeawayOrder = (
  overrides: Partial<CreateOrderInput> = {},
): CreateOrderInput => ({
  type: "TAKEAWAY",
  customerName: "Cliente de prueba",
  customerPhone: "11 4444-5555",
  deliveryAddress: "Calle de prueba 123",
  ...overrides,
});

function withRepository(run: (repository: SqliteGastronomyRepository) => void) {
  const path = join(tmpdir(), `gastronomy-${randomUUID()}.sqlite`);
  const repository = new SqliteGastronomyRepository(path, {
    adminPin: "2468",
    seedStarterCatalog: true,
  });
  try {
    run(repository);
  } finally {
    repository.close();
    for (const suffix of ["", "-wal", "-shm"])
      rmSync(`${path}${suffix}`, { force: true });
  }
}

test("elimina mesa libre conservando historial y permite reactivar el mismo id", () => {
  withRepository((repository) => {
    const table = repository.ensureTable(51);
    assert.deepEqual(repository.deleteTable({ tableId: table.id }), {
      deleted: true,
    });
    assert.equal(
      repository.bootstrap().tables.find((t) => t.id === table.id)?.active,
      false,
    );
    const reactivated = repository.ensureTable(51);
    assert.equal(reactivated.id, table.id);
    assert.deepEqual(repository.deleteTable({ tableId: table.id }), {
      deleted: true,
    });
  });
});

test("cancela pedido vacío y desactiva mesa en una operación", () => {
  withRepository((repository) => {
    repository.openCashSession({ openingAmountMinor: 0 });
    const table = repository.ensureTable(52);
    const order = repository.createOrder({
      type: "DINE_IN",
      tableId: table.id,
    });
    repository.deleteTable({ tableId: table.id });
    assert.equal(
      repository.bootstrap().orders.find((o) => o.id === order.id)
        ?.operationalStatus,
      "CANCELLED",
    );
    assert.equal(
      repository.bootstrap().tables.find((t) => t.id === table.id)?.active,
      false,
    );
  });
});

test("rechaza mesa con consumo o impresión y conserva pedido", () => {
  withRepository((repository) => {
    repository.openCashSession({ openingAmountMinor: 0 });
    const table = repository.ensureTable(53);
    const order = repository.createOrder({
      type: "DINE_IN",
      tableId: table.id,
    });
    repository.addOrderItem({
      orderId: order.id,
      productId: "starter-muzza-grande",
    });
    assert.throws(
      () => repository.deleteTable({ tableId: table.id }),
      /consumo/,
    );
    assert.equal(
      repository.bootstrap().tables.find((t) => t.id === table.id)?.active,
      true,
    );
  });
});

test("bloquea print_job queued y permiso ausente", () => {
  withRepository((repository) => {
    repository.openCashSession({ openingAmountMinor: 0 });
    const table = repository.ensureTable(54);
    const order = repository.createOrder({
      type: "DINE_IN",
      tableId: table.id,
    });
    repository.db
      .prepare(
        "INSERT INTO print_jobs(id, order_id, kind, status, created_at) VALUES (?, ?, 'KITCHEN_ORDER', 'QUEUED', ?)",
      )
      .run(randomUUID(), order.id, new Date().toISOString());
    assert.throws(
      () => repository.deleteTable({ tableId: table.id }),
      /impresiones/,
    );
    repository.db
      .prepare(
        "DELETE FROM role_permissions WHERE permission_code = 'tables.manage'",
      )
      .run();
    assert.throws(
      () => repository.deleteTable({ tableId: table.id }),
      /permiso/,
    );
  });
});

function createPendingDeliveryLedger(
  repository: SqliteGastronomyRepository,
  suffix: string,
) {
  repository.saveSettings({
    ...repository.bootstrap().settings,
    deliverySettlementEnabled: true,
  });
  const driver = repository.createUser({
    fullName: `Repartidor ${suffix}`,
    roleCode: "DELIVERY_DRIVER",
    pin: suffix === "A" ? "3579" : "4680",
    authorizerPin: "2468",
  });
  const order = repository.createOrder({
    type: "DELIVERY",
    deliveryAddress: `Calle ${suffix} 100`,
    customerName: `Cliente ${suffix}`,
    customerPhone: `11 4000-100${suffix === "A" ? "1" : "2"}`,
    deliveryFeeMinor: 300_000,
    driverUserId: driver.id,
  });
  const populated = repository.addOrderItem({
    orderId: order.id,
    productId: "starter-muzza-grande",
  });
  repository.confirmOrder({ orderId: order.id });
  repository.payOrder({
    orderId: order.id,
    collectedByDriver: true,
    payments: [{ methodCode: "CASH", amountMinor: populated.totalMinor }],
  });
  repository.updateOrderStatus(order.id, "DELIVERED");
  return repository
    .bootstrap()
    .deliveryLedger.find((ledger) => ledger.orderId === order.id)!;
}

test("bootstrap expone métricas exactas de ventas de la caja", () => {
  withRepository((repository) => {
    repository.openCashSession({ openingAmountMinor: 0 });
    const order = repository.createOrder(takeawayOrder());
    const populated = repository.addOrderItem({
      orderId: order.id,
      productId: "starter-muzza-grande",
    });
    repository.confirmOrder({ orderId: order.id });
    repository.payOrder({
      orderId: order.id,
      payments: [{ methodCode: "CASH", amountMinor: populated.totalMinor }],
    });
    const session = repository.bootstrap().cashSession!;
    assert.equal(session.salesTotalMinor, populated.totalMinor);
    assert.equal(session.salesByType?.TAKEAWAY, populated.totalMinor);
    assert.equal(
      session.salesByPaymentMethod?.find((item) => item.code === "CASH")
        ?.amountMinor,
      populated.totalMinor,
    );
  });
});

test("pedido conserva snapshot aunque cambie el precio del producto", () => {
  withRepository((repository) => {
    repository.openCashSession({ openingAmountMinor: 5_000_000 });
    const order = repository.createOrder({
      type: "TAKEAWAY",
      customerName: "Ana",
    });
    const withItem = repository.addOrderItem({
      orderId: order.id,
      productId: "starter-muzza-grande",
    });
    assert.equal(withItem.items[0]?.unitPriceMinorSnapshot, 1_500_000);

    repository.db
      .prepare(
        `UPDATE product_prices SET amount_minor = 1_900_000 WHERE product_id = ? AND price_list_id = 'price-takeaway'`,
      )
      .run("starter-muzza-grande");
    const persisted = repository
      .bootstrap()
      .orders.find((candidate) => candidate.id === order.id);
    assert.equal(persisted?.items[0]?.unitPriceMinorSnapshot, 1_500_000);
  });
});

test("delivery conserva snapshot de observaciones de dirección aunque cambie la ficha", () => {
  withRepository((repository) => {
    repository.openCashSession({ openingAmountMinor: 0 });
    const customer = repository.createCustomer({
      name: "Cliente con indicaciones",
      phone: "11 4555-1234",
      addresses: [
        {
          label: "Casa",
          address: "Calle Snapshot 123",
          notes: "Tocar timbre rojo",
        },
      ],
    });
    const address = customer.addresses[0]!;
    const created = repository.createOrder({
      type: "DELIVERY",
      customerId: customer.id,
      customerAddressId: address.id,
      deliveryFeeMinor: 100_000,
    });
    assert.equal(created.deliveryAddressNotesSnapshot, "Tocar timbre rojo");
    repository.db
      .prepare("UPDATE customer_addresses SET notes = ? WHERE id = ?")
      .run("Dejar en recepción", address.id);
    assert.equal(
      repository.getOrder(created.id).deliveryAddressNotesSnapshot,
      "Tocar timbre rojo",
    );
  });
});

test("agrega, normaliza y quita la observación de comanda de una línea", () => {
  withRepository((repository) => {
    repository.openCashSession({ openingAmountMinor: 0 });
    const order = repository.createOrder({
      type: "DINE_IN",
      tableId: repository.bootstrap().tables[0]!.id,
      waiterUserId: "user-admin",
    });
    const populated = repository.addOrderItem({
      orderId: order.id,
      productId: "starter-muzza-grande",
    });
    const itemId = populated.items[0]!.id;

    const noted = repository.updateOrderItemNotes({
      orderId: order.id,
      itemId,
      notes: "  Sin cebolla · alergia al maní  ",
    });
    assert.equal(noted.items[0]?.notes, "Sin cebolla · alergia al maní");
    assert.throws(
      () =>
        repository.updateOrderItemNotes({
          orderId: order.id,
          itemId,
          notes: "x".repeat(501),
        }),
      /500 caracteres/,
    );

    const cleared = repository.updateOrderItemNotes({
      orderId: order.id,
      itemId,
      notes: "   ",
    });
    assert.equal(cleared.items[0]?.notes, null);
    assert.equal(
      repository.getAuditLog({ action: "ORDER_ITEM_NOTES_UPDATED" }).length,
      0,
    );
  });
});

test("precio manual exige PIN, conserva el catálogo y deja auditoría", () => {
  withRepository((repository) => {
    repository.openCashSession({ openingAmountMinor: 0 });
    const table = repository.bootstrap().tables[0]!;
    const order = repository.createOrder({
      type: "DINE_IN",
      tableId: table.id,
      waiterUserId: "user-admin",
    });
    const catalogPrice = (
      repository.db
        .prepare(
          `SELECT amount_minor FROM product_prices
           WHERE product_id = ? AND price_list_id = 'price-salon'`,
        )
        .get("starter-muzza-grande") as { amount_minor: number }
    ).amount_minor;

    assert.throws(
      () =>
        repository.addOrderItem({
          orderId: order.id,
          productId: "starter-muzza-grande",
          unitPriceMinorOverride: 1_250_000,
          authorizerPin: "0000",
        }),
      /PIN|permiso/i,
    );
    assert.equal(
      repository.bootstrap().orders.find((item) => item.id === order.id)?.items
        .length,
      0,
    );

    const updated = repository.addOrderItem({
      orderId: order.id,
      productId: "starter-muzza-grande",
      quantity: 2,
      unitPriceMinorOverride: 1_250_000,
      authorizerPin: "2468",
    });
    assert.equal(updated.items[0]?.unitPriceMinorSnapshot, 1_250_000);
    assert.equal(updated.items[0]?.lineTotalMinor, 2_500_000);
    assert.equal(
      (
        repository.db
          .prepare(
            `SELECT amount_minor FROM product_prices
             WHERE product_id = ? AND price_list_id = 'price-salon'`,
          )
          .get("starter-muzza-grande") as { amount_minor: number }
      ).amount_minor,
      catalogPrice,
    );
    const audit = repository.getAuditLog({
      action: "ORDER_ITEM_PRICE_OVERRIDDEN",
    })[0];
    assert.equal(audit?.authorizerName, "Administrador");
    assert.equal(audit?.permissionUsed, "orders.override_price");
    assert.equal(
      JSON.parse(audit?.beforeJson ?? "{}").unitPriceMinor,
      catalogPrice,
    );
    assert.equal(
      JSON.parse(audit?.afterJson ?? "{}").unitPriceMinor,
      1_250_000,
    );
  });
});

test("categoría puede renombrarse y ordenarse pero no ocultar productos activos", () => {
  withRepository((repository) => {
    const category = repository.createCategory({ name: "Postres" });
    const updated = repository.updateCategory({
      categoryId: category.id,
      name: "Dulces",
      active: true,
      sortOrder: 1,
      reason: "Reorganización del menú",
      authorizerPin: "2468",
    });
    assert.equal(updated.name, "Dulces");
    assert.equal(updated.sortOrder, 1);
    repository.createProduct({
      categoryId: category.id,
      name: "Flan",
      prices: [
        { priceListCode: "SALON", amountMinor: 500_000 },
        { priceListCode: "TAKEAWAY", amountMinor: 500_000 },
        { priceListCode: "DELIVERY", amountMinor: 500_000 },
      ],
    });
    assert.throws(
      () =>
        repository.updateCategory({
          categoryId: category.id,
          name: "Dulces",
          active: false,
          sortOrder: 1,
          reason: "Ocultar sección",
          authorizerPin: "2468",
        }),
      /producto\(s\) activo/i,
    );
    assert.equal(
      repository.getAuditLog({ action: "CATEGORY_UPDATED" }).length,
      0,
    );
  });
});

test("elimina categoría libre, audita y exige PIN", () => {
  withRepository((repository) => {
    const category = repository.createCategory({ name: "Temporal libre" });
    assert.throws(
      () =>
        repository.deleteCategory({
          categoryId: category.id,
          reason: "Limpieza",
          authorizerPin: "0000",
        }),
      /PIN|permiso/i,
    );
    assert.deepEqual(
      repository.deleteCategory({
        categoryId: category.id,
        reason: "Limpieza de catálogo",
        authorizerPin: "2468",
      }),
      { deleted: true },
    );
    const audit = repository.getAuditLog({ action: "CATEGORY_DELETED" })[0];
    assert.equal(audit?.authorizerName, "Administrador");
    assert.equal(audit?.permissionUsed, "prices.bulk_update");
  });
});

test("bloquea eliminar categoría con productos asociados", () => {
  withRepository((repository) => {
    assert.throws(
      () =>
        repository.deleteCategory({
          categoryId: "category-1",
          reason: "Limpieza",
          authorizerPin: "2468",
        }),
      /productos o historial/i,
    );
  });
});

test("pago mixto registra una venta y mantiene trazabilidad de caja", () => {
  withRepository((repository) => {
    repository.openCashSession({ openingAmountMinor: 5_000_000 });
    const order = repository.createOrder(takeawayOrder());
    const populated = repository.addOrderItem({
      orderId: order.id,
      productId: "starter-napo-grande",
    });
    repository.confirmOrder({ orderId: order.id });
    const paid = repository.payOrder({
      orderId: order.id,
      payments: [
        { methodCode: "CASH", amountMinor: 900_000, receivedMinor: 1_000_000 },
        {
          methodCode: "TRANSFER",
          amountMinor: populated.totalMinor - 900_000,
          reference: "ABC",
        },
      ],
    });
    assert.equal(paid.paymentStatus, "PAID");
    assert.equal(paid.payments.length, 2);
    assert.equal(
      paid.payments.find((payment) => payment.methodCode === "CASH")
        ?.receivedMinor,
      1_000_000,
    );
    assert.equal(
      repository.bootstrap().cashSession?.expectedAmountMinor,
      5_900_000,
    );
  });
});

test("cancelación conserva el pedido y registra auditoría con autorizante", () => {
  withRepository((repository) => {
    repository.openCashSession({ openingAmountMinor: 0 });
    const order = repository.createOrder(takeawayOrder());
    repository.addOrderItem({
      orderId: order.id,
      productId: "starter-muzza-grande",
    });
    repository.confirmOrder({ orderId: order.id });
    const cancelled = repository.cancelOrder({
      orderId: order.id,
      reason: "Cliente canceló",
      authorizerPin: "2468",
    });
    assert.equal(cancelled.operationalStatus, "CANCELLED");
    const audit = repository.db
      .prepare(
        "SELECT * FROM audit_log WHERE entity_id = ? AND action = 'ORDER_CANCELLED'",
      )
      .get(order.id) as Record<string, unknown>;
    assert.equal(audit.reason, "Cliente canceló");
    assert.equal(audit.authorizer_user_id, "user-admin");
  });
});

test("sólo una impresión física exitosa incrementa el contador", () => {
  withRepository((repository) => {
    repository.openCashSession({ openingAmountMinor: 0 });
    const order = repository.createOrder(takeawayOrder());
    repository.addOrderItem({
      orderId: order.id,
      productId: "starter-muzza-grande",
    });
    repository.confirmOrder({ orderId: order.id });
    const first = repository.queuePrint(order.id, "KITCHEN_ORDER");
    let persisted = repository.getOrder(order.id);
    assert.equal(persisted.printCount, 0);
    assert.equal(persisted.printAttemptCount, 0);
    assert.equal(persisted.printedAt, null);

    repository.markPrintJob(first.jobId, "PRINTED");
    persisted = repository.getOrder(order.id);
    assert.equal(persisted.printCount, 1);
    assert.equal(persisted.printAttemptCount, 1);
    assert.ok(persisted.printedAt);

    const second = repository.queuePrint(order.id, "KITCHEN_ORDER");
    assert.equal(repository.getOrder(order.id).printCount, 1);
    repository.markPrintJob(second.jobId, "PRINTED");
    persisted = repository.getOrder(order.id);
    assert.equal(persisted.printCount, 2);
    assert.equal(persisted.printAttemptCount, 2);
    assert.equal(
      (
        repository.db.prepare("SELECT COUNT(*) AS count FROM orders").get() as {
          count: number;
        }
      ).count,
      1,
    );
    assert.throws(
      () => repository.markPrintJob(second.jobId, "PRINTED"),
      /resuelto/i,
    );
  });
});

test("cancelar la vista previa descarta el job sin registrar un intento", () => {
  withRepository((repository) => {
    repository.openCashSession({ openingAmountMinor: 0 });
    const order = repository.createOrder(takeawayOrder());
    repository.addOrderItem({
      orderId: order.id,
      productId: "starter-muzza-grande",
    });
    repository.confirmOrder({ orderId: order.id });
    const job = repository.queuePrint(order.id, "KITCHEN_ORDER");

    repository.discardPrintJob(job.jobId);

    const persisted = repository.getOrder(order.id);
    assert.equal(persisted.printCount, 0);
    assert.equal(persisted.printAttemptCount, 0);
    assert.equal(persisted.printedAt, null);
    assert.equal(
      repository.bootstrap().printJobs.some((item) => item.id === job.jobId),
      false,
    );
    assert.doesNotThrow(() => repository.queuePrint(order.id, "KITCHEN_ORDER"));
    assert.throws(() => repository.discardPrintJob(job.jobId), /resuelto/i);
  });
});

test("reintento reutiliza el job fallido sin duplicar pedido ni contador", () => {
  withRepository((repository) => {
    repository.openCashSession({ openingAmountMinor: 0 });
    const order = repository.createOrder(takeawayOrder());
    repository.addOrderItem({
      orderId: order.id,
      productId: "starter-muzza-grande",
    });
    repository.confirmOrder({ orderId: order.id });
    const job = repository.queuePrint(order.id, "KITCHEN_ORDER");
    repository.markPrintJob(job.jobId, "FAILED", "Impresora desconectada");
    let persisted = repository.getOrder(order.id);
    assert.equal(persisted.printCount, 0);
    assert.equal(persisted.printAttemptCount, 1);
    assert.equal(persisted.printedAt, null);
    const prepared = repository.preparePrintRetry(job.jobId);
    assert.equal(prepared.jobId, job.jobId);
    assert.equal(prepared.orderId, order.id);
    assert.equal(repository.bootstrap().printJobs[0]?.status, "RECOVERING");
    assert.throws(
      () => repository.preparePrintRetry(job.jobId),
      /pendiente|reanudando|proceso/i,
    );
    repository.markPrintJob(job.jobId, "PRINTED");
    persisted = repository.getOrder(order.id);
    assert.equal(persisted.printCount, 1);
    assert.equal(persisted.printAttemptCount, 2);
    assert.ok(persisted.printedAt);
    assert.equal(repository.bootstrap().printJobs[0]?.attempts, 2);
  });
});

test("una impresión en cola tras un cierre inesperado se puede reanudar", () => {
  withRepository((repository) => {
    repository.openCashSession({ openingAmountMinor: 0 });
    const order = repository.createOrder(takeawayOrder());
    repository.addOrderItem({
      orderId: order.id,
      productId: "starter-muzza-grande",
    });
    repository.confirmOrder({ orderId: order.id });
    const queued = repository.queuePrint(order.id, "KITCHEN_ORDER");
    assert.throws(
      () => repository.queuePrint(order.id, "KITCHEN_ORDER"),
      /impresión.*curso/i,
    );

    const prepared = repository.preparePrintRetry(queued.jobId);
    assert.equal(prepared.status, "RECOVERING");
    repository.markPrintJob(queued.jobId, "PRINTED");

    assert.equal(repository.getOrder(order.id).printCount, 1);
    assert.equal(repository.getOrder(order.id).printAttemptCount, 1);
    assert.equal(
      repository.getAuditLog({ action: "PRINT_QUEUED_RECOVERED" }).length,
      0,
    );
  });
});

test("bootstrap conserva fallas de impresión aunque existan más de cien éxitos", () => {
  withRepository((repository) => {
    repository.openCashSession({ openingAmountMinor: 0 });
    const order = repository.createOrder(takeawayOrder());
    repository.addOrderItem({
      orderId: order.id,
      productId: "starter-muzza-grande",
    });
    repository.confirmOrder({ orderId: order.id });
    const failed = repository.queuePrint(order.id, "KITCHEN_ORDER");
    repository.markPrintJob(failed.jobId, "FAILED", "Sin papel");
    repository.db
      .prepare("UPDATE print_jobs SET created_at = ? WHERE id = ?")
      .run("2000-01-01T00:00:00.000Z", failed.jobId);

    const insert = repository.db.prepare(
      `INSERT INTO print_jobs(id, order_id, kind, status, copies, attempts, created_at, printed_at)
       VALUES (?, ?, 'CUSTOMER_BILL', 'PRINTED', 1, 1, ?, ?)`,
    );
    for (let index = 0; index < 101; index += 1) {
      const timestamp = new Date(
        Date.UTC(2030, 0, 1, 0, 0, index),
      ).toISOString();
      insert.run(`printed-${index}`, order.id, timestamp, timestamp);
    }

    const jobs = repository.bootstrap().printJobs;
    assert.equal(jobs.length, 101);
    assert.ok(jobs.some((job) => job.id === failed.jobId));
    assert.equal(jobs.filter((job) => job.status === "PRINTED").length, 100);
  });
});

test("bootstrap expone todos los pedidos del turno actual", () => {
  withRepository((repository) => {
    repository.openCashSession({ openingAmountMinor: 0 });
    const table = repository.ensureTable(77);
    const oldTableOrder = repository.createOrder({
      type: "DINE_IN",
      tableId: table.id,
    });
    repository.addOrderItem({
      orderId: oldTableOrder.id,
      productId: "starter-muzza-grande",
    });
    repository.confirmOrder({ orderId: oldTableOrder.id });

    const oldDelivery = repository.createOrder({
      type: "DELIVERY",
      customerName: "Cliente antiguo",
      customerPhone: "11 4000-0000",
      deliveryAddress: "Calle antigua 10",
    });
    repository.addOrderItem({
      orderId: oldDelivery.id,
      productId: "starter-napo-grande",
    });
    repository.confirmOrder({ orderId: oldDelivery.id });

    for (let index = 0; index < 205; index += 1) {
      const draft = repository.createOrder(
        takeawayOrder({
          customerName: `Histórico ${index}`,
          customerPhone: `11 5000 ${String(index).padStart(4, "0")}`,
          deliveryAddress: `Calle histórica ${index}`,
        }),
      );
      const populated = repository.addOrderItem({
        orderId: draft.id,
        productId: "starter-muzza-grande",
      });
      repository.confirmOrder({ orderId: draft.id });
      repository.payOrder({
        orderId: draft.id,
        payments: [
          { methodCode: "TRANSFER", amountMinor: populated.totalMinor },
        ],
      });
      repository.updateOrderStatus(draft.id, "DELIVERED");
    }

    const orders = repository.bootstrap().orders;
    assert.equal(orders.length, 207);
    assert.equal(new Set(orders.map((order) => order.id)).size, orders.length);
    assert.ok(orders.some((order) => order.id === oldTableOrder.id));
    assert.ok(orders.some((order) => order.id === oldDelivery.id));
    assert.equal(
      orders.filter((order) => order.operationalStatus === "DELIVERED").length,
      205,
    );
  });
});

test("bootstrap reinicia pedidos al cerrar y abrir un nuevo turno", () => {
  withRepository((repository) => {
    const firstSession = repository.openCashSession({ openingAmountMinor: 0 });
    const first = repository.createOrder(takeawayOrder());
    const populated = repository.addOrderItem({
      orderId: first.id,
      productId: "starter-muzza-grande",
    });
    repository.confirmOrder({ orderId: first.id });
    repository.payOrder({
      orderId: first.id,
      payments: [{ methodCode: "CASH", amountMinor: populated.totalMinor }],
    });
    repository.updateOrderStatus(first.id, "DELIVERED");
    repository.closeCashSession({
      countedAmountMinor:
        repository.bootstrap().cashSession!.expectedAmountMinor,
    });

    assert.deepEqual(repository.bootstrap().orders, []);
    repository.openCashSession({ openingAmountMinor: 0 });
    assert.deepEqual(repository.bootstrap().orders, []);

    const second = repository.createOrder(
      takeawayOrder({ customerName: "Turno nuevo" }),
    );
    assert.deepEqual(
      repository.bootstrap().orders.map((order) => order.id),
      [second.id],
    );
    assert.equal(repository.getOrder(first.id).id, first.id);
    assert.deepEqual(
      repository
        .getCashSessionReport({ cashSessionId: firstSession.id })
        .orders.map((order) => order.id),
      [first.id],
    );
  });
});

test("auditoría guarda sólo acciones sensibles y eliminaciones", () => {
  withRepository((repository) => {
    repository.openCashSession({ openingAmountMinor: 0 });
    const table = repository.ensureTable(78);
    repository.createCustomer({
      name: "Cliente sin evento sensible",
      phone: "11 5555-7878",
    });
    const order = repository.createOrder({
      type: "DINE_IN",
      tableId: table.id,
      waiterUserId: "user-admin",
    });
    const populated = repository.addOrderItem({
      orderId: order.id,
      productId: "starter-muzza-grande",
    });
    repository.updateOrderItemNotes({
      orderId: order.id,
      itemId: populated.items[0]!.id,
      notes: "Sin cebolla",
    });
    repository.removeOrderItem(order.id, populated.items[0]!.id);

    const actions = (
      repository.db
        .prepare("SELECT action FROM audit_log ORDER BY timestamp")
        .all() as Array<{ action: string }>
    ).map((entry) => entry.action);
    assert.deepEqual(actions, ["CASH_OPENED", "ORDER_ITEM_REMOVED"]);
    assert.equal(repository.getAuditLog({ action: "TABLE_CREATED" }).length, 0);
    assert.equal(
      repository.getAuditLog({ action: "CUSTOMER_CREATED" }).length,
      0,
    );
  });
});

test("la configuración local fuerza una sola caja", () => {
  withRepository((repository) => {
    const settings = repository.bootstrap().settings;
    assert.throws(
      () =>
        repository.saveSettings({
          ...settings,
          maxConcurrentCashSessions: 2,
        }),
      /una sola caja/i,
    );
    repository.db
      .prepare("UPDATE settings SET value_json = ? WHERE key = 'app'")
      .run(JSON.stringify({ ...settings, maxConcurrentCashSessions: 8 }));
    assert.equal(repository.bootstrap().settings.maxConcurrentCashSessions, 1);
    repository.openCashSession({ openingAmountMinor: 0 });
    assert.throws(
      () => repository.openCashSession({ openingAmountMinor: 0 }),
      /una sola caja/i,
    );
  });
});

test("la persistencia rechaza importes de caja inválidos aun sin la capa de aplicación", () => {
  withRepository((repository) => {
    assert.throws(
      () =>
        repository.openCashSession({
          openingAmountMinor: Number.MAX_SAFE_INTEGER + 1,
        }),
      /entero en centavos/i,
    );
    assert.throws(
      () => repository.openCashSession({ openingAmountMinor: -1 }),
      /no puede ser negativo/i,
    );

    repository.openCashSession({ openingAmountMinor: 10_000 });
    assert.throws(
      () =>
        repository.registerCashMovement({
          type: "INCOME",
          amountMinor: 0,
          reason: "Sin efecto",
        }),
      /distinto de cero/i,
    );
    assert.throws(
      () =>
        repository.registerCashMovement({
          type: "ADJUSTMENT",
          amountMinor: -10_001,
          reason: "Ajuste excesivo",
        }),
      /efectivo suficiente/i,
    );
    assert.throws(
      () =>
        repository.registerCashMovement({
          type: "EXPENSE",
          amountMinor: 100,
          reason: "   ",
        }),
      /requiere un motivo/i,
    );
    assert.throws(
      () => repository.closeCashSession({ countedAmountMinor: -1 }),
      /no puede ser negativo/i,
    );
    assert.throws(
      () =>
        repository.closeCashSession({
          countedAmountMinor: 10_000,
          closingFloatAmountMinor: 10_001,
        }),
      /no puede superar/i,
    );
  });
});

test("cierre bloquea pedidos pendientes por defecto", () => {
  withRepository((repository) => {
    repository.openCashSession({ openingAmountMinor: 0 });
    repository.createOrder(takeawayOrder());
    assert.throws(
      () => repository.closeCashSession({ countedAmountMinor: 0 }),
      /pedido\(s\) pendiente/,
    );
  });
});

test("cierre forzado exige PIN con permiso y audita al autorizante", () => {
  withRepository((repository) => {
    repository.openCashSession({ openingAmountMinor: 0 });
    const pendingOrder = repository.createOrder(takeawayOrder());
    assert.throws(
      () =>
        repository.closeCashSession({
          countedAmountMinor: 0,
          force: true,
          reason: "Fin de turno",
          authorizerPin: "0000",
        }),
      /PIN|permiso/i,
    );
    const closed = repository.closeCashSession({
      countedAmountMinor: 0,
      force: true,
      reason: "Fin de turno",
      authorizerPin: "2468",
    });
    assert.equal(closed.status, "CLOSED");
    const audit = repository.getAuditLog({ action: "CASH_FORCE_CLOSED" })[0];
    assert.equal(audit?.authorizerName, "Administrador");
    assert.equal(audit?.reason, "Fin de turno");
    const after = JSON.parse(audit?.afterJson ?? "{}") as {
      pending: number;
      pendingOrders: Array<{ id: string; number: number }>;
    };
    assert.equal(after.pending, 1);
    assert.deepEqual(after.pendingOrders, [
      { id: pendingOrder.id, number: pendingOrder.number },
    ]);
    repository.openCashSession({ openingAmountMinor: 0 });
    assert.throws(
      () => repository.closeCashSession({ countedAmountMinor: 0 }),
      /pedido\(s\) pendiente/i,
    );
  });
});

test("cierre normal bloquea rendiciones de delivery y el forzado las audita", () => {
  withRepository((repository) => {
    repository.openCashSession({ openingAmountMinor: 0 });
    const ledger = createPendingDeliveryLedger(repository, "A");
    assert.throws(
      () => repository.closeCashSession({ countedAmountMinor: 0 }),
      /rendici[oó]n\(es\).*pendiente/i,
    );
    const closed = repository.closeCashSession({
      countedAmountMinor: 0,
      force: true,
      reason: "Rendición diferida al siguiente turno",
      authorizerPin: "2468",
    });
    assert.equal(closed.status, "CLOSED");
    const audit = repository.getAuditLog({ action: "CASH_FORCE_CLOSED" })[0];
    assert.equal(audit?.reason, "Rendición diferida al siguiente turno");
    const details = (
      JSON.parse(audit?.afterJson ?? "{}") as {
        pendingDeliveryDetails: Array<{
          id: string;
          orderId: string;
          driverUserId: string;
          outstandingMinor: number;
        }>;
      }
    ).pendingDeliveryDetails;
    assert.deepEqual(details, [
      {
        id: ledger.id,
        orderId: ledger.orderId,
        orderNumber: ledger.orderNumber,
        driverUserId: ledger.driverUserId,
        driverName: ledger.driverName,
        direction: ledger.direction,
        outstandingMinor: ledger.amountDueMinor - ledger.settledAmountMinor,
      },
    ]);
  });
});

test("cierre persiste cambio final y efectivo retirado sin confundirlo con el arqueo", () => {
  withRepository((repository) => {
    repository.openCashSession({ openingAmountMinor: 5_000_000 });
    repository.registerCashMovement({
      type: "INCOME",
      amountMinor: 10_000_000,
      reason: "Ingreso documentado",
    });
    const closed = repository.closeCashSession({
      countedAmountMinor: 15_000_000,
      closingFloatAmountMinor: 3_000_000,
    });
    assert.equal(closed.differenceMinor, 0);
    assert.equal(closed.closingFloatAmountMinor, 3_000_000);
    assert.equal(closed.cashRemovedAmountMinor, 12_000_000);
    assert.equal(closed.floatDifferenceMinor, -2_000_000);
    assert.equal(closed.cashIncomeMinor, 10_000_000);
  });
});

test("cierre con diferencia exige motivo auditable", () => {
  withRepository((repository) => {
    repository.openCashSession({ openingAmountMinor: 5_000_000 });
    assert.throws(
      () =>
        repository.closeCashSession({
          countedAmountMinor: 4_900_000,
          closingFloatAmountMinor: 4_000_000,
        }),
      /Explicá la diferencia/,
    );
  });
});

test("modificador de media pizza cobra la mitad y recalcula", () => {
  withRepository((repository) => {
    repository.openCashSession({ openingAmountMinor: 0 });
    const modifier = repository.createModifier({
      groupName: "Extras",
      name: "Extra queso",
      priceMinor: 200_000,
    });
    const order = repository.createOrder(takeawayOrder());
    const withItem = repository.addOrderItem({
      orderId: order.id,
      productId: "starter-muzza-grande",
    });
    const changed = repository.addOrderItemModifier({
      orderId: order.id,
      itemId: withItem.items[0]!.id,
      modifierId: modifier.id,
      scope: "FIRST_HALF",
    });
    assert.equal(
      changed.items[0]?.modifiers[0]?.unitPriceMinorSnapshot,
      100_000,
    );
    assert.equal(changed.totalMinor, 1_600_000);
  });
});

test("descuento autorizado se audita y no altera snapshots", () => {
  withRepository((repository) => {
    repository.openCashSession({ openingAmountMinor: 0 });
    const order = repository.createOrder(takeawayOrder());
    const withItem = repository.addOrderItem({
      orderId: order.id,
      productId: "starter-muzza-grande",
    });
    const discounted = repository.applyOrderDiscount({
      orderId: order.id,
      mode: "PERCENTAGE",
      value: 10,
      reason: "Promoción",
      authorizerPin: "2468",
    });
    assert.equal(discounted.discountMinor, 150_000);
    assert.equal(discounted.totalMinor, 1_350_000);
    assert.equal(
      discounted.items[0]?.unitPriceMinorSnapshot,
      withItem.items[0]?.unitPriceMinorSnapshot,
    );
  });
});

test("stock opcional se reserva al confirmar y se restaura al cancelar", () => {
  withRepository((repository) => {
    const settings = repository.bootstrap().settings;
    repository.saveSettings({ ...settings, stockEnabled: true });
    repository.adjustStock({
      productId: "starter-muzza-grande",
      newStockMinor: 2_000,
      reason: "Inventario inicial",
      authorizerPin: "2468",
    });
    repository.openCashSession({ openingAmountMinor: 0 });
    const order = repository.createOrder(takeawayOrder());
    const withItem = repository.addOrderItem({
      orderId: order.id,
      productId: "starter-muzza-grande",
    });
    assert.equal(
      repository
        .bootstrap()
        .products.find((product) => product.id === "starter-muzza-grande")
        ?.stockMinor,
      2_000,
    );
    repository.confirmOrder({ orderId: order.id });
    assert.equal(
      repository
        .bootstrap()
        .products.find((product) => product.id === "starter-muzza-grande")
        ?.stockMinor,
      1_000,
    );
    repository.cancelOrder({
      orderId: order.id,
      reason: "Prueba de restitución",
      authorizerPin: "2468",
    });
    assert.equal(
      repository
        .bootstrap()
        .products.find((product) => product.id === "starter-muzza-grande")
        ?.stockMinor,
      2_000,
    );
  });
});

test("delivery efectivo genera rendición y permite liquidarla", () => {
  withRepository((repository) => {
    const settings = repository.bootstrap().settings;
    repository.saveSettings({ ...settings, deliverySettlementEnabled: true });
    const driver = repository.createUser({
      fullName: "Juan Repartidor",
      roleCode: "DELIVERY_DRIVER",
      pin: "3579",
      authorizerPin: "2468",
    });
    repository.openCashSession({ openingAmountMinor: 0 });
    const order = repository.createOrder({
      type: "DELIVERY",
      deliveryAddress: "Belgrano 100",
      customerName: "Cliente de prueba",
      customerPhone: "11 4000-1000",
      deliveryFeeMinor: 300_000,
      driverUserId: driver.id,
    });
    const populated = repository.addOrderItem({
      orderId: order.id,
      productId: "starter-napo-grande",
    });
    repository.confirmOrder({ orderId: order.id });
    repository.payOrder({
      orderId: order.id,
      collectedByDriver: true,
      payments: [{ methodCode: "CASH", amountMinor: populated.totalMinor }],
    });
    repository.updateOrderStatus(order.id, "DELIVERED");
    const ledger = repository.bootstrap().deliveryLedger[0]!;
    assert.equal(ledger.direction, "DRIVER_OWES_BUSINESS");
    assert.equal(ledger.amountDueMinor, populated.totalMinor - 300_000);
    const [settled] = repository.settleDelivery({
      ledgerIds: [ledger.id],
      reason: "Rendición de turno",
      authorizerPin: "2468",
    });
    assert.equal(settled?.status, "SETTLED");
    assert.throws(
      () =>
        repository.settleDelivery({
          ledgerIds: [ledger.id],
          reason: "Duplicado",
          authorizerPin: "2468",
        }),
      /pendiente/i,
    );
  });
});

test("actividad del repartidor cuenta entregas aunque no exista rendición", () => {
  withRepository((repository) => {
    repository.saveSettings({
      ...repository.bootstrap().settings,
      deliverySettlementEnabled: false,
    });
    repository.openCashSession({ openingAmountMinor: 0 });
    const draft = repository.createOrder({
      type: "DELIVERY",
      deliveryAddress: "Calle actividad 123",
      customerName: "Cliente actividad",
      customerPhone: "11 4000-1234",
      deliveryFeeMinor: 275_000,
    });
    const populated = repository.addOrderItem({
      orderId: draft.id,
      productId: "starter-muzza-grande",
    });
    repository.confirmOrder({ orderId: draft.id });
    const driver = repository.createUser({
      fullName: "Repartidor posterior",
      roleCode: "DELIVERY_DRIVER",
      pin: "3579",
      authorizerPin: "2468",
    });
    repository.assignDeliveryDriver({
      orderId: draft.id,
      driverUserId: driver.id,
    });
    repository.completeOrder({
      orderId: draft.id,
      finalStatus: "DELIVERED",
      collectedByDriver: true,
      payments: [{ methodCode: "CASH", amountMinor: populated.totalMinor }],
    });

    const bootstrap = repository.bootstrap();
    assert.equal(bootstrap.deliveryLedger.length, 0);
    const activity = bootstrap.driverDeliveryActivity.find(
      (row) => row.driverUserId === driver.id,
    );
    assert.ok(activity);
    assert.equal(activity.deliveryCount, 1);
    assert.equal(activity.earningsMinor, 275_000);
    assert.equal(typeof activity.lastDeliveryAt, "string");
  });
});

test("rendición rechaza duplicados, caja cerrada y mezcla de repartidores sin cambios parciales", () => {
  withRepository((repository) => {
    repository.openCashSession({ openingAmountMinor: 0 });
    const first = createPendingDeliveryLedger(repository, "A");
    const second = createPendingDeliveryLedger(repository, "B");
    assert.throws(
      () =>
        repository.settleDelivery({
          ledgerIds: [first.id, first.id],
          reason: "Duplicado humano",
          authorizerPin: "2468",
        }),
      /repetidas/i,
    );
    assert.throws(
      () =>
        repository.settleDelivery({
          ledgerIds: [first.id, second.id],
          reason: "Mezcla accidental",
          authorizerPin: "2468",
        }),
      /repartidor por vez/i,
    );
    assert.deepEqual(
      repository
        .bootstrap()
        .deliveryLedger.filter((ledger) =>
          [first.id, second.id].includes(ledger.id),
        )
        .map((ledger) => ledger.status),
      ["PENDING", "PENDING"],
    );
    repository.closeCashSession({
      countedAmountMinor: 0,
      force: true,
      reason: "Prueba de caja cerrada",
      authorizerPin: "2468",
    });
    assert.throws(
      () =>
        repository.settleDelivery({
          ledgerIds: [first.id],
          reason: "Sin caja",
          authorizerPin: "2468",
        }),
      /Abrí una caja|caja abierta/i,
    );
  });
});

test("búsqueda textual de clientes no se degrada a teléfono vacío", () => {
  withRepository((repository) => {
    for (let index = 0; index < 55; index += 1) {
      repository.createCustomer({
        name: `Cliente alfabético ${String(index).padStart(2, "0")}`,
        phone: `11 5000-${String(index).padStart(4, "0")}`,
      });
    }
    const target = repository.createCustomer({
      name: "Zulu coincidencia textual",
      phone: "11 9999-9999",
    });
    assert.deepEqual(
      repository.searchCustomers("Zulu").map((customer) => customer.id),
      [target.id],
    );
    assert.ok(repository.searchCustomers("").length >= 56);
  });
});

test("pagina clientes en SQLite con total real y orden estable", () => {
  withRepository((repository) => {
    for (let index = 0; index < 53; index += 1) {
      repository.createCustomer({
        name: `Escala paginada ${String(index).padStart(2, "0")}`,
        phone: `26 2500-${String(index).padStart(4, "0")}`,
      });
    }

    const first = repository.searchCustomersPage({
      query: "Escala paginada",
      page: 1,
      pageSize: 20,
    });
    const second = repository.searchCustomersPage({
      query: "Escala paginada",
      page: 2,
      pageSize: 20,
    });
    const last = repository.searchCustomersPage({
      query: "Escala paginada",
      page: 99,
      pageSize: 20,
    });

    assert.equal(first.total, 53);
    assert.equal(first.pageCount, 3);
    assert.equal(first.items.length, 20);
    assert.equal(second.items.length, 20);
    assert.equal(last.page, 3);
    assert.equal(last.items.length, 13);
    assert.equal(
      new Set([...first.items, ...second.items].map((item) => item.id)).size,
      40,
    );
    assert.equal(first.items[0]?.name, "Escala paginada 00");
    assert.equal(second.items[0]?.name, "Escala paginada 20");
  });
});

test("perfil completo, archivo y fusión de clientes conservan historial y auditoría", () => {
  withRepository((repository) => {
    repository.openCashSession({ openingAmountMinor: 100_000 });
    const source = repository.createCustomer({
      name: "Cliente duplicado origen",
      phone: "26 2555-1000",
      tags: ["Frecuente"],
      preferences: "Sin cebolla",
      preferredPaymentMethodCode: "CASH",
      addresses: [
        {
          label: "Casa",
          address: "Ruta 40 100",
          deliveryFeeMinor: 300_000,
        },
      ],
    });
    const target = repository.createCustomer({
      name: "Cliente receptor",
      phone: "26 2555-2000",
      tags: ["Empresa"],
      addresses: [
        {
          label: "Trabajo",
          address: "San Martín 200",
          deliveryFeeMinor: 250_000,
        },
      ],
    });
    let order = repository.createOrder({
      ...takeawayOrder({
        customerId: source.id,
        customerName: source.name,
        customerPhone: source.phone,
        deliveryAddress: "Ruta 40 100",
      }),
    });
    order = repository.addOrderItem({
      orderId: order.id,
      productId: "starter-muzza-grande",
      quantity: 2,
    });
    repository.confirmOrder({ orderId: order.id });

    const sourceProfile = repository.getCustomerProfile({
      customerId: source.id,
      page: 1,
      pageSize: 10,
    });
    assert.equal(sourceProfile.metrics.orderCount, 1);
    assert.equal(sourceProfile.metrics.averageTicketMinor, order.totalMinor);
    assert.equal(sourceProfile.topProducts[0]?.quantity, 2);
    assert.equal(sourceProfile.topAddresses[0]?.address, "Ruta 40 100");

    const merged = repository.mergeCustomers({
      sourceCustomerId: source.id,
      targetCustomerId: target.id,
      reason: "Unificar fichas duplicadas",
      authorizerPin: "2468",
    });
    assert.deepEqual(new Set(merged.tags), new Set(["Empresa", "Frecuente"]));
    assert.equal(merged.addresses.length, 2);
    assert.equal(
      repository.getCustomerProfile({
        customerId: target.id,
        page: 1,
        pageSize: 10,
      }).history.total,
      1,
    );
    assert.equal(
      repository.searchCustomersPage({
        query: "duplicado origen",
        page: 1,
        pageSize: 10,
        status: "ACTIVE",
      }).total,
      0,
    );
    assert.equal(
      repository.searchCustomersPage({
        query: "duplicado origen",
        page: 1,
        pageSize: 10,
        status: "ARCHIVED",
      }).items[0]?.mergedIntoCustomerId,
      target.id,
    );
    assert.throws(
      () =>
        repository.setCustomerActive({
          customerId: source.id,
          active: true,
          reason: "Intento inválido",
          authorizerPin: "2468",
        }),
      /fusionada no se puede reactivar/i,
    );
    assert.throws(
      () =>
        repository.setCustomerActive({
          customerId: target.id,
          active: false,
          reason: "Archivar receptor",
          authorizerPin: "2468",
        }),
      /pedido #|pendiente/i,
    );
    repository.completeOrder({
      orderId: order.id,
      finalStatus: "DELIVERED",
      payments: [{ methodCode: "CASH", amountMinor: order.totalMinor }],
    });
    assert.equal(
      repository.setCustomerActive({
        customerId: target.id,
        active: false,
        reason: "Cliente sin actividad vigente",
        authorizerPin: "2468",
      }).active,
      false,
    );
    assert.equal(
      repository.getAuditLog({ action: "CUSTOMER_MERGED" })[0]?.permissionUsed,
      "customers.manage",
    );
  });
});

test("delivery por transferencia registra que el negocio debe el fee al repartidor", () => {
  withRepository((repository) => {
    repository.saveSettings({
      ...repository.bootstrap().settings,
      deliverySettlementEnabled: true,
    });
    const driver = repository.createUser({
      fullName: "Ana Repartidora",
      roleCode: "DELIVERY_DRIVER",
      pin: "3579",
      authorizerPin: "2468",
    });
    repository.openCashSession({ openingAmountMinor: 0 });
    const order = repository.createOrder({
      type: "DELIVERY",
      deliveryAddress: "San Martín 200",
      customerName: "Cliente transferencia",
      customerPhone: "11 4000-2000",
      deliveryFeeMinor: 250_000,
      driverUserId: driver.id,
    });
    const populated = repository.addOrderItem({
      orderId: order.id,
      productId: "starter-muzza-grande",
    });
    repository.confirmOrder({ orderId: order.id });
    repository.payOrder({
      orderId: order.id,
      payments: [
        {
          methodCode: "TRANSFER",
          amountMinor: populated.totalMinor,
          reference: "TX-1",
        },
      ],
    });
    repository.updateOrderStatus(order.id, "DELIVERED");
    const ledger = repository.bootstrap().deliveryLedger[0]!;
    assert.equal(ledger.direction, "BUSINESS_OWES_DRIVER");
    assert.equal(ledger.amountDueMinor, 250_000);
    assert.throws(
      () =>
        repository.cancelOrder({
          orderId: order.id,
          reason: "Intento inválido",
          authorizerPin: "2468",
        }),
      /pagos|devolución|finalizado/i,
    );
  });
});

test("delivery exige repartidor activo para crearlo o entregarlo", () => {
  withRepository((repository) => {
    repository.openCashSession({ openingAmountMinor: 0 });
    assert.throws(
      () =>
        repository.createOrder({
          ...takeawayOrder({ type: "DELIVERY" }),
          driverUserId: "user-admin",
        }),
      /rol de repartidor/i,
    );
    const draft = repository.createOrder({
      ...takeawayOrder({ type: "DELIVERY" }),
      deliveryFeeMinor: 0,
    });
    const populated = repository.addOrderItem({
      orderId: draft.id,
      productId: "starter-muzza-grande",
    });
    repository.confirmOrder({ orderId: draft.id });
    repository.payOrder({
      orderId: draft.id,
      payments: [{ methodCode: "TRANSFER", amountMinor: populated.totalMinor }],
    });
    assert.throws(
      () => repository.updateOrderStatus(draft.id, "DELIVERED"),
      /repartidor/i,
    );
  });
});

test("no desactiva un repartidor con envíos activos hasta reasignarlos", () => {
  withRepository((repository) => {
    repository.openCashSession({ openingAmountMinor: 0 });
    const firstDriver = repository.createDriver({
      fullName: "Repartidor a reemplazar",
      authorizerPin: "2468",
    });
    const replacement = repository.createDriver({
      fullName: "Repartidor reemplazo",
      authorizerPin: "2468",
    });
    const order = repository.createOrder({
      ...takeawayOrder({ type: "DELIVERY" }),
      driverUserId: firstDriver.id,
      deliveryFeeMinor: 200_000,
    });

    assert.throws(
      () =>
        repository.updateUser({
          userId: firstDriver.id,
          roleCode: "DELIVERY_DRIVER",
          active: false,
          reason: "Fin de relación laboral",
          authorizerPin: "2468",
        }),
      new RegExp(`#${order.number}.*Reasignalos`, "i"),
    );

    repository.assignDeliveryDriver({
      orderId: order.id,
      driverUserId: replacement.id,
    });
    const deactivated = repository.updateUser({
      userId: firstDriver.id,
      roleCode: "DELIVERY_DRIVER",
      active: false,
      reason: "Pedido reasignado",
      authorizerPin: "2468",
    });
    assert.equal(deactivated.active, false);
  });
});

test("delivery sin saldo de rendición no crea un pendiente artificial", () => {
  withRepository((repository) => {
    repository.saveSettings({
      ...repository.bootstrap().settings,
      deliverySettlementEnabled: true,
    });
    const driver = repository.createDriver({
      fullName: "Repartidor sin fee",
      authorizerPin: "2468",
    });
    repository.openCashSession({ openingAmountMinor: 0 });
    const draft = repository.createOrder({
      ...takeawayOrder({ type: "DELIVERY" }),
      driverUserId: driver.id,
      deliveryFeeMinor: 0,
    });
    const populated = repository.addOrderItem({
      orderId: draft.id,
      productId: "starter-muzza-grande",
    });
    repository.confirmOrder({ orderId: draft.id });
    repository.payOrder({
      orderId: draft.id,
      payments: [{ methodCode: "TRANSFER", amountMinor: populated.totalMinor }],
    });
    repository.updateOrderStatus(draft.id, "DELIVERED");
    assert.equal(repository.bootstrap().deliveryLedger.length, 0);
    assert.equal(
      repository.closeCashSession({ countedAmountMinor: 0 }).status,
      "CLOSED",
    );
  });
});

test("rendición que paga al repartidor no puede dejar efectivo negativo", () => {
  withRepository((repository) => {
    repository.saveSettings({
      ...repository.bootstrap().settings,
      deliverySettlementEnabled: true,
    });
    const driver = repository.createDriver({
      fullName: "Repartidor a pagar",
      authorizerPin: "2468",
    });
    repository.openCashSession({ openingAmountMinor: 0 });
    const draft = repository.createOrder({
      ...takeawayOrder({ type: "DELIVERY" }),
      driverUserId: driver.id,
      deliveryFeeMinor: 250_000,
    });
    const populated = repository.addOrderItem({
      orderId: draft.id,
      productId: "starter-muzza-grande",
    });
    repository.confirmOrder({ orderId: draft.id });
    repository.payOrder({
      orderId: draft.id,
      payments: [{ methodCode: "TRANSFER", amountMinor: populated.totalMinor }],
    });
    repository.updateOrderStatus(draft.id, "DELIVERED");
    const ledger = repository.bootstrap().deliveryLedger[0]!;
    assert.throws(
      () =>
        repository.settleDelivery({
          ledgerIds: [ledger.id],
          reason: "Pago sin fondos",
          authorizerPin: "2468",
        }),
      /efectivo suficiente/i,
    );
    assert.equal(repository.bootstrap().deliveryLedger[0]?.status, "PENDING");
    assert.equal(repository.bootstrap().cashSession?.expectedAmountMinor, 0);
  });
});

test("envío confirmado permite asignar y corregir repartidor antes de salir", () => {
  withRepository((repository) => {
    repository.openCashSession({ openingAmountMinor: 0 });
    const driver = repository.createUser({
      fullName: "Repartidora asignada",
      roleCode: "DELIVERY_DRIVER",
      pin: "3579",
      authorizerPin: "2468",
    });
    const order = repository.createOrder({
      type: "DELIVERY",
      customerName: "Cliente asignación",
      customerPhone: "11 4444-8888",
      deliveryAddress: "Calle Reparto 123",
    });
    repository.addOrderItem({
      orderId: order.id,
      productId: "starter-napo-grande",
    });
    repository.confirmOrder({ orderId: order.id });
    assert.throws(
      () => repository.updateOrderStatus(order.id, "OUT_FOR_DELIVERY"),
      /Asigná un repartidor/i,
    );
    const assigned = repository.assignDeliveryDriver({
      orderId: order.id,
      driverUserId: driver.id,
    });
    assert.equal(assigned.driverUserId, driver.id);
    const dispatched = repository.updateOrderStatus(
      order.id,
      "OUT_FOR_DELIVERY",
    );
    assert.equal(dispatched.operationalStatus, "OUT_FOR_DELIVERY");
    assert.throws(
      () =>
        repository.assignDeliveryDriver({
          orderId: order.id,
          driverUserId: null,
        }),
      /debe conservar/i,
    );
    assert.equal(
      repository.getAuditLog({ action: "DELIVERY_DRIVER_ASSIGNED" }).length,
      0,
    );
  });
});

test("pedido programado conserva fecha y marca operativa", () => {
  withRepository((repository) => {
    repository.openCashSession({ openingAmountMinor: 0 });
    const promisedAt = "2026-09-01T22:30:00.000Z";
    const order = repository.createOrder({
      type: "TAKEAWAY",
      promisedAt,
      scheduled: true,
    });
    const persisted = repository
      .bootstrap()
      .orders.find((candidate) => candidate.id === order.id);
    assert.equal(persisted?.promisedAt, promisedAt);
    assert.equal(persisted?.scheduled, true);
  });
});

test("mesa conserva el mozo elegido explícitamente", () => {
  withRepository((repository) => {
    const waiter = repository.createUser({
      fullName: "Moza Turno Noche",
      roleCode: "WAITER",
      pin: "4680",
      authorizerPin: "2468",
    });
    repository.openCashSession({ openingAmountMinor: 0 });
    const order = repository.createOrder({
      type: "DINE_IN",
      tableId: "table-1",
      waiterUserId: waiter.id,
    });
    assert.equal(order.waiterUserId, waiter.id);
    assert.equal(order.waiterName, "Moza Turno Noche");
    assert.equal(
      repository.bootstrap().tables.find((table) => table.id === "table-1")
        ?.waiterName,
      "Moza Turno Noche",
    );
  });
});

test("carga rápida crea mesa idempotente, resuelve número de mozo y agrega cantidad", () => {
  withRepository((repository) => {
    repository.openCashSession({ openingAmountMinor: 500_000 });
    const waiter = repository.createUser({
      fullName: "Mozo rápido",
      roleCode: "WAITER",
      pin: "1357",
      authorizerPin: "2468",
    });
    assert.ok(waiter.staffNumber > 1);
    const createdTable = repository.ensureTable(37);
    const sameTable = repository.ensureTable(37);
    assert.equal(createdTable.id, sameTable.id);
    assert.equal(createdTable.number, 37);
    const order = repository.createOrder({
      type: "DINE_IN",
      tableId: createdTable.id,
      waiterUserId: waiter.id,
    });
    const updated = repository.addOrderItem({
      orderId: order.id,
      productId: "starter-muzza-grande",
      quantity: 3,
    });
    assert.equal(updated.waiterUserId, waiter.id);
    assert.equal(updated.items[0]?.quantity, 3);
    assert.equal(repository.getAuditLog({ action: "TABLE_CREATED" }).length, 0);
  });
});

test("migración asigna número de personal a usuarios existentes", () => {
  const path = join(tmpdir(), `gastronomy-legacy-${randomUUID()}.sqlite`);
  const legacy = new Database(path);
  try {
    legacy.exec(
      `CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)`,
    );
    for (const migration of migrations.filter(
      (candidate) => candidate.version <= 3,
    )) {
      legacy.exec(migration.sql);
      legacy
        .prepare(
          "INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)",
        )
        .run(migration.version, migration.name, new Date().toISOString());
    }
    legacy
      .prepare(
        "INSERT INTO roles(id, code, name) VALUES ('role-admin', 'ADMIN', 'Administrador')",
      )
      .run();
    legacy
      .prepare(
        `INSERT INTO users(id, full_name, role_id, pin_hash, must_change_pin, active, created_at, updated_at)
      VALUES ('user-admin', 'Administrador legado', 'role-admin', 'legacy', 0, 1, ?, ?)`,
      )
      .run(new Date().toISOString(), new Date().toISOString());
  } finally {
    legacy.close();
  }
  const repository = new SqliteGastronomyRepository(path, {
    seedStarterCatalog: true,
  });
  try {
    assert.equal(repository.bootstrap().currentUser.staffNumber, 1);
    assert.equal(repository.bootstrap().users[0]?.staffNumber, 1);
  } finally {
    repository.close();
    for (const suffix of ["", "-wal", "-shm"])
      rmSync(`${path}${suffix}`, { force: true });
  }
});

test("migración elimina eventos de auditoría no sensibles", () => {
  const path = join(tmpdir(), `gastronomy-audit-${randomUUID()}.sqlite`);
  const first = new SqliteGastronomyRepository(path, {
    seedStarterCatalog: true,
  });
  try {
    const insert = first.db.prepare(
      `INSERT INTO audit_log(id, timestamp, entity_type, entity_id, action)
       VALUES (?, ?, ?, ?, ?)`,
    );
    const timestamp = new Date().toISOString();
    insert.run(
      "audit-sensitive",
      timestamp,
      "ORDER",
      "order-1",
      "ORDER_ITEM_REMOVED",
    );
    insert.run(
      "audit-common",
      timestamp,
      "RESTAURANT_TABLE",
      "table-1",
      "TABLE_CREATED",
    );
    first.db.prepare("DELETE FROM schema_migrations WHERE version = 16").run();
  } finally {
    first.close();
  }

  const migrated = new SqliteGastronomyRepository(path, {
    seedStarterCatalog: true,
  });
  try {
    const actions = (
      migrated.db.prepare("SELECT action FROM audit_log").all() as Array<{
        action: string;
      }>
    ).map((entry) => entry.action);
    assert.deepEqual(actions, ["ORDER_ITEM_REMOVED"]);
  } finally {
    migrated.close();
    for (const suffix of ["", "-wal", "-shm"])
      rmSync(`${path}${suffix}`, { force: true });
  }
});

test("migración unifica precios existentes de delivery y para retirar", () => {
  const path = join(tmpdir(), `gastronomy-prices-${randomUUID()}.sqlite`);
  const first = new SqliteGastronomyRepository(path, {
    seedStarterCatalog: true,
  });
  try {
    first.db
      .prepare(
        `UPDATE product_prices SET amount_minor = 1_990_000
         WHERE product_id = 'starter-muzza-grande' AND price_list_id = 'price-delivery'`,
      )
      .run();
    first.db.prepare("DELETE FROM schema_migrations WHERE version = 7").run();
  } finally {
    first.close();
  }
  const migrated = new SqliteGastronomyRepository(path, {
    seedStarterCatalog: true,
  });
  try {
    const product = migrated
      .bootstrap()
      .products.find((candidate) => candidate.id === "starter-muzza-grande");
    const takeaway = product?.prices.find(
      (price) => price.priceListCode === "TAKEAWAY",
    )?.amountMinor;
    const delivery = product?.prices.find(
      (price) => price.priceListCode === "DELIVERY",
    )?.amountMinor;
    assert.equal(delivery, takeaway);
  } finally {
    migrated.close();
    for (const suffix of ["", "-wal", "-shm"])
      rmSync(`${path}${suffix}`, { force: true });
  }
});

test("migración repara contadores de impresión desde resultados físicos", () => {
  const path = join(
    tmpdir(),
    `gastronomy-print-outcomes-${randomUUID()}.sqlite`,
  );
  const first = new SqliteGastronomyRepository(path, {
    seedStarterCatalog: true,
  });
  let orderId = "";
  let successfulPrintedAt = "";
  try {
    first.openCashSession({ openingAmountMinor: 0 });
    const order = first.createOrder(takeawayOrder());
    orderId = order.id;
    first.addOrderItem({
      orderId,
      productId: "starter-muzza-grande",
    });
    first.confirmOrder({ orderId: orderId });

    const successful = first.queuePrint(orderId, "KITCHEN_ORDER");
    first.markPrintJob(successful.jobId, "PRINTED");
    successfulPrintedAt = first.getOrder(orderId).printedAt ?? "";
    const failed = first.queuePrint(orderId, "CUSTOMER_BILL");
    first.markPrintJob(failed.jobId, "FAILED", "Impresora desconectada");

    first.db
      .prepare(
        "UPDATE orders SET print_count = 99, printed_at = '1999-01-01T00:00:00.000Z' WHERE id = ?",
      )
      .run(orderId);
    first.db.prepare("DELETE FROM schema_migrations WHERE version = 10").run();
    first.db.exec("ALTER TABLE orders DROP COLUMN print_attempt_count");
  } finally {
    first.close();
  }

  const migrated = new SqliteGastronomyRepository(path, {
    seedStarterCatalog: true,
  });
  try {
    const repaired = migrated.getOrder(orderId);
    assert.equal(repaired.printAttemptCount, 2);
    assert.equal(repaired.printCount, 1);
    assert.equal(repaired.printedAt, successfulPrintedAt);
  } finally {
    migrated.close();
    for (const suffix of ["", "-wal", "-shm"])
      rmSync(`${path}${suffix}`, { force: true });
  }
});

test("edición de producto actualiza listas y conserva historial en auditoría", () => {
  withRepository((repository) => {
    const updated = repository.updateProduct({
      productId: "starter-muzza-grande",
      categoryId: "category-1",
      name: "Muzzarella XL",
      code: "MUZ-XL",
      active: true,
      prices: [
        { priceListCode: "SALON", amountMinor: 1_710_000 },
        { priceListCode: "TAKEAWAY", amountMinor: 1_720_000 },
        { priceListCode: "DELIVERY", amountMinor: 1_730_000 },
      ],
      reason: "Actualización de carta",
      authorizerPin: "2468",
    });
    assert.equal(updated.name, "Muzzarella XL");
    assert.equal(
      updated.prices.find((price) => price.priceListCode === "DELIVERY")
        ?.amountMinor,
      1_730_000,
    );
    const audit = repository.getAuditLog({ action: "PRODUCT_UPDATED" })[0];
    assert.equal(audit?.reason, "Actualización de carta");
    assert.equal(audit?.authorizerName, "Administrador");
    assert.match(audit?.beforeJson ?? "", /Muzzarella grande/);
  });
});

test("reinicio conserva caja y pedido pendiente", () => {
  const path = join(tmpdir(), `gastronomy-restart-${randomUUID()}.sqlite`);
  let orderId = "";
  try {
    const first = new SqliteGastronomyRepository(path, {
      adminPin: "2468",
      seedStarterCatalog: true,
    });
    try {
      first.openCashSession({ openingAmountMinor: 321_000 });
      const order = first.createOrder({ type: "TAKEAWAY" });
      orderId = order.id;
      first.addOrderItem({ orderId, productId: "starter-muzza-grande" });
    } finally {
      first.close();
    }
    const reopened = new SqliteGastronomyRepository(path, { adminPin: "2468" });
    try {
      const state = reopened.bootstrap();
      assert.equal(state.cashSession?.openingAmountMinor, 321_000);
      assert.equal(
        state.orders.find((order) => order.id === orderId)?.operationalStatus,
        "PENDING",
      );
      assert.equal(
        state.orders.find((order) => order.id === orderId)?.lifecycleStatus,
        "DRAFT",
      );
      assert.equal(
        state.orders.find((order) => order.id === orderId)?.items.length,
        1,
      );
    } finally {
      reopened.close();
    }
  } finally {
    for (const suffix of ["", "-wal", "-shm"])
      rmSync(`${path}${suffix}`, { force: true });
  }
});

test("alta y cambios de usuario requieren users.manage y quedan auditados", () => {
  withRepository((repository) => {
    assert.throws(
      () =>
        repository.createUser({
          fullName: "Mozo",
          roleCode: "WAITER",
          pin: "4567",
          authorizerPin: "0000",
        }),
      /PIN|permiso/i,
    );
    const user = repository.createUser({
      fullName: "Mozo",
      roleCode: "WAITER",
      pin: "4567",
      authorizerPin: "2468",
    });
    const updated = repository.updateUser({
      userId: user.id,
      roleCode: "CASHIER",
      active: true,
      reason: "Cambio de puesto",
      authorizerPin: "2468",
    });
    assert.equal(updated.roleCode, "CASHIER");
    const audit = repository.getAuditLog({ action: "USER_UPDATED" });
    assert.equal(audit[0]?.authorizerName, "Administrador");
    assert.equal(audit[0]?.reason, "Cambio de puesto");
  });
});

test("usuario usa el primer número libre, permite editarlo y elimina sólo sin historial", () => {
  withRepository((repository) => {
    const third = repository.createUser({
      staffNumber: 3,
      fullName: "Mozo tres",
      roleCode: "WAITER",
      pin: "3456",
      authorizerPin: "2468",
    });
    const second = repository.createUser({
      fullName: "Mozo dos",
      roleCode: "WAITER",
      pin: "2345",
      authorizerPin: "2468",
    });
    assert.equal(third.staffNumber, 3);
    assert.equal(second.staffNumber, 2);
    assert.throws(
      () =>
        repository.createUser({
          staffNumber: 3,
          fullName: "Número repetido",
          roleCode: "WAITER",
          pin: "4567",
          authorizerPin: "2468",
        }),
      /número.*ocupado/i,
    );
    const updated = repository.updateUser({
      userId: second.id,
      staffNumber: 4,
      roleCode: "WAITER",
      active: true,
      reason: "Reordenar números",
      authorizerPin: "2468",
    });
    assert.equal(updated.staffNumber, 4);
    assert.throws(
      () =>
        repository.updateUser({
          userId: updated.id,
          staffNumber: 3,
          roleCode: "WAITER",
          active: true,
          reason: "Número duplicado",
          authorizerPin: "2468",
        }),
      /número.*ocupado/i,
    );
    assert.deepEqual(
      repository.deleteUser({
        userId: updated.id,
        reason: "Alta incorrecta",
        authorizerPin: "2468",
      }),
      { deleted: true },
    );
    assert.equal(
      repository.bootstrap().users.some((user) => user.id === updated.id),
      false,
    );
    repository.db
      .prepare(
        `INSERT INTO audit_log(id, timestamp, operator_user_id, entity_type, entity_id, action)
         VALUES (?, ?, ?, 'USER', ?, 'USED')`,
      )
      .run(randomUUID(), new Date().toISOString(), third.id, third.id);
    assert.throws(
      () =>
        repository.deleteUser({
          userId: third.id,
          reason: "Tiene historial",
          authorizerPin: "2468",
        }),
      /historial/i,
    );
    assert.throws(
      () =>
        repository.deleteUser({
          userId: "user-admin",
          reason: "No permitido",
          authorizerPin: "2468",
        }),
      /administrador.*no puede eliminarse/i,
    );
  });
});

test("alta de repartidor crea una identidad operativa sin PIN administrado", () => {
  withRepository((repository) => {
    assert.throws(
      () =>
        repository.createDriver({
          fullName: "Repartidor",
          authorizerPin: "0000",
        }),
      /PIN|permiso/i,
    );
    const driver = repository.createDriver({
      fullName: "Repartidor sin acceso",
      authorizerPin: "2468",
    });
    assert.equal(driver.roleCode, "DELIVERY_DRIVER");
    assert.equal(driver.active, true);
    const audit = repository.getAuditLog({ action: "DRIVER_CREATED" });
    assert.equal(audit[0]?.authorizerName, "Administrador");
    assert.equal(JSON.parse(audit[0]?.afterJson ?? "{}").loginEnabled, false);
  });
});

test("cliente conserva dirección principal y alternativas al editarse", () => {
  withRepository((repository) => {
    const created = repository.createCustomer({
      name: "Laura Cliente",
      phone: "11 5555-0101",
      notes: "Prefiere mensajes",
      addresses: [
        {
          label: "Principal",
          address: "Calle Uno 100",
          deliveryFeeMinor: 250_000,
        },
        {
          label: "Trabajo",
          address: "Avenida Dos 200",
          notes: "Piso 3",
          deliveryFeeMinor: 350_000,
        },
      ],
    });
    assert.equal(created.addresses[0]?.address, "Calle Uno 100");
    assert.equal(created.addresses[1]?.label, "Trabajo");
    assert.equal(created.addresses[1]?.deliveryFeeMinor, 350_000);
    assert.equal(created.notes, "Prefiere mensajes");
    assert.throws(
      () =>
        repository.createCustomer({
          name: "Laura Cliente",
          phone: "11-5555-0101",
        }),
      /duplicado exacto/i,
    );
    assert.doesNotThrow(() =>
      repository.createCustomer({
        name: "Familiar de Laura",
        phone: "11-5555-0101",
      }),
    );
    assert.ok(
      repository
        .searchCustomers("")
        .some((customer) => customer.id === created.id),
    );
    assert.equal(repository.searchCustomers("Piso 3")[0]?.id, created.id);
    assert.equal(repository.searchCustomers("Avenida Dos")[0]?.id, created.id);

    const updated = repository.updateCustomer({
      customerId: created.id,
      expectedUpdatedAt: created.updatedAt,
      name: "Laura Actualizada",
      phone: "11 5555-0202",
      notes: "Prefiere WhatsApp",
      addresses: [
        {
          id: created.addresses[1]!.id,
          label: "Principal",
          address: "Avenida Dos 200",
          notes: "Piso 3",
          deliveryFeeMinor: 375_000,
        },
        {
          id: created.addresses[0]!.id,
          label: "Casa",
          address: "Calle Uno 100",
          deliveryFeeMinor: 275_000,
        },
      ],
    });
    assert.equal(updated.name, "Laura Actualizada");
    assert.equal(updated.addresses[0]?.address, "Avenida Dos 200");
    assert.equal(updated.addresses[1]?.label, "Casa");
    assert.equal(updated.addresses[0]?.deliveryFeeMinor, 375_000);
    assert.equal(updated.addresses[0]?.id, created.addresses[1]?.id);
    assert.equal(updated.addresses[1]?.id, created.addresses[0]?.id);
    assert.throws(
      () =>
        repository.updateCustomer({
          customerId: created.id,
          expectedUpdatedAt: created.updatedAt,
          name: "Edición obsoleta",
          phone: created.phone,
          addresses: updated.addresses,
        }),
      /otra ventana/i,
    );
    assert.equal(
      repository.getAuditLog({ action: "CUSTOMER_UPDATED" }).length,
      0,
    );
  });
});

test("borrador de delivery vuelve a datos y actualiza el valor de la dirección", () => {
  withRepository((repository) => {
    repository.openCashSession({ openingAmountMinor: 0 });
    const customer = repository.createCustomer({
      name: "Cliente con zonas",
      phone: "11 5555-3030",
      addresses: [
        {
          label: "Principal",
          address: "Centro 100",
          deliveryFeeMinor: 200_000,
        },
        {
          label: "Quinta",
          address: "Ruta 5 km 20",
          deliveryFeeMinor: 500_000,
        },
      ],
    });
    const draft = repository.createOrder({
      type: "DELIVERY",
      customerId: customer.id,
      customerAddressId: customer.addresses[0]!.id,
      customerName: customer.name,
      customerPhone: customer.phone,
      deliveryAddress: customer.addresses[0]!.address,
      deliveryFeeMinor: 225_000,
    });
    const withItem = repository.addOrderItem({
      orderId: draft.id,
      productId: "starter-muzza-grande",
    });
    const updated = repository.updateDraftOrder({
      orderId: draft.id,
      type: "DELIVERY",
      customerId: customer.id,
      customerName: customer.name,
      customerPhone: customer.phone,
      deliveryAddress: customer.addresses[1]!.address,
      deliveryFeeMinor: 575_000,
      promisedAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      notes: "Entregar por portón lateral",
    });

    assert.equal(updated.id, draft.id);
    assert.equal(updated.items.length, withItem.items.length);
    assert.equal(updated.deliveryAddressSnapshot, "Ruta 5 km 20");
    assert.equal(updated.deliveryFeeMinor, 575_000);
    assert.equal(
      updated.totalMinor,
      updated.subtotalMinor + updated.deliveryFeeMinor,
    );
    assert.equal(
      repository.searchCustomers("Ruta 5")[0]?.addresses[1]?.deliveryFeeMinor,
      575_000,
    );
    assert.equal(
      repository.getAuditLog({ action: "ORDER_DRAFT_UPDATED" }).length,
      0,
    );
  });
});

test("informe por rango usa snapshots de producto y categoría", () => {
  withRepository((repository) => {
    const cash = repository.openCashSession({ openingAmountMinor: 0 });
    const order = repository.createOrder(takeawayOrder());
    const populated = repository.addOrderItem({
      orderId: order.id,
      productId: "starter-muzza-grande",
    });
    repository.confirmOrder({ orderId: order.id });
    repository.payOrder({
      orderId: order.id,
      payments: [{ methodCode: "CASH", amountMinor: populated.totalMinor }],
    });
    repository.db
      .prepare(
        "UPDATE products SET name = 'Nombre nuevo' WHERE id = 'starter-muzza-grande'",
      )
      .run();
    repository.db
      .prepare(
        "UPDATE categories SET name = 'Categoría nueva' WHERE id = 'category-1'",
      )
      .run();
    const report = repository.getDetailedReport({
      dateFrom: cash.businessDate,
      dateTo: cash.businessDate,
    });
    assert.equal(report.salesTotalMinor, populated.totalMinor);
    assert.equal(report.byProduct[0]?.name, "Muzzarella grande");
    assert.equal(report.byCategory[0]?.name, "Pizzas");
  });
});

test("informe netea devoluciones de forma coherente por medio, producto y categoría", () => {
  withRepository((repository) => {
    const cash = repository.openCashSession({ openingAmountMinor: 0 });
    const order = repository.createOrder(takeawayOrder());
    const populated = repository.addOrderItem({
      orderId: order.id,
      productId: "starter-muzza-grande",
    });
    repository.confirmOrder({ orderId: order.id });
    const cashPart = 500_000;
    const paid = repository.payOrder({
      orderId: order.id,
      payments: [
        { methodCode: "CASH", amountMinor: cashPart },
        {
          methodCode: "TRANSFER",
          amountMinor: populated.totalMinor - cashPart,
          reference: "MIXTA-1",
        },
      ],
    });
    const transfer = paid.payments.find(
      (payment) => payment.methodCode === "TRANSFER",
    )!;
    repository.refundPayment({
      orderId: order.id,
      paymentId: transfer.id,
      reason: "Transferencia duplicada",
      authorizerPin: "2468",
    });

    const report = repository.getDetailedReport({
      dateFrom: cash.businessDate,
      dateTo: cash.businessDate,
    });
    assert.equal(report.salesTotalMinor, cashPart);
    assert.equal(
      report.byPaymentMethod.find((method) => method.code === "CASH")
        ?.amountMinor,
      cashPart,
    );
    assert.equal(
      report.byPaymentMethod.find((method) => method.code === "TRANSFER")
        ?.amountMinor,
      0,
    );
    assert.equal(report.byProduct[0]?.amountMinor, cashPart);
    assert.equal(report.byCategory[0]?.amountMinor, cashPart);
    assert.equal(report.cash.refundMinor, 0);
    assert.equal(
      repository
        .getDashboard(cash.businessDate)
        .byPaymentMethod.find((method) => method.code === "CASH")?.amountMinor,
      cashPart,
    );

    repository.closeCashSession({
      countedAmountMinor: cashPart,
      closingFloatAmountMinor: 0,
      force: true,
      reason: "Devolución pendiente al siguiente turno",
      authorizerPin: "2468",
    });
    const nextCash = repository.openCashSession({
      openingAmountMinor: cashPart,
    });
    const nextBusinessDate = "2099-01-02";
    repository.db
      .prepare("UPDATE cash_sessions SET business_date = ? WHERE id = ?")
      .run(nextBusinessDate, nextCash.id);
    const cashPayment = paid.payments.find(
      (payment) => payment.methodCode === "CASH",
    )!;
    repository.refundPayment({
      orderId: order.id,
      paymentId: cashPayment.id,
      reason: "Devolución en turno posterior",
      authorizerPin: "2468",
    });
    const originalDay = repository.getDetailedReport({
      dateFrom: cash.businessDate,
      dateTo: cash.businessDate,
    });
    const refundDay = repository.getDetailedReport({
      dateFrom: nextBusinessDate,
      dateTo: nextBusinessDate,
    });
    assert.equal(originalDay.salesTotalMinor, 0);
    assert.equal(
      repository
        .getDashboard(cash.businessDate)
        .byPaymentMethod.find((method) => method.code === "CASH")?.amountMinor,
      0,
    );
    assert.equal(refundDay.salesTotalMinor, 0);
    assert.equal(refundDay.cash.refundMinor, cashPart);
  });
});

test("backup SQLite es consistente y validable", async () => {
  const source = join(tmpdir(), `gastronomy-${randomUUID()}.sqlite`);
  const backup = join(tmpdir(), `gastronomy-backup-${randomUUID()}.sqlite`);
  const repository = new SqliteGastronomyRepository(source, {
    adminPin: "2468",
    seedStarterCatalog: true,
  });
  try {
    repository.openCashSession({ openingAmountMinor: 123_000 });
    await repository.backupTo(backup);
    SqliteGastronomyRepository.validateDatabase(backup);
    const restored = new SqliteGastronomyRepository(backup, {
      adminPin: "2468",
    });
    try {
      assert.equal(
        restored.bootstrap().cashSession?.openingAmountMinor,
        123_000,
      );
    } finally {
      restored.close();
    }
  } finally {
    repository.close();
    for (const path of [source, backup])
      for (const suffix of ["", "-wal", "-shm"])
        rmSync(`${path}${suffix}`, { force: true });
  }
});

test("borrador vacío puede descartarse sin crear una cancelación", () => {
  withRepository((repository) => {
    repository.openCashSession({ openingAmountMinor: 0 });
    const draft = repository.createOrder(takeawayOrder());
    assert.equal(draft.lifecycleStatus, "DRAFT");
    assert.deepEqual(repository.discardDraftOrder(draft.id), {
      discarded: true,
    });
    assert.equal(
      repository.bootstrap().orders.some((order) => order.id === draft.id),
      false,
    );
    assert.equal(
      repository.getAuditLog({ action: "ORDER_CANCELLED" }).length,
      0,
    );
  });
});

test("pedido vacío no puede confirmarse, imprimirse, cobrarse ni entregarse", () => {
  withRepository((repository) => {
    repository.openCashSession({ openingAmountMinor: 0 });
    const draft = repository.createOrder(takeawayOrder());
    assert.throws(
      () => repository.confirmOrder({ orderId: draft.id }),
      /producto/i,
    );
    assert.throws(
      () => repository.queuePrint(draft.id, "KITCHEN_ORDER"),
      /confirm|producto/i,
    );
    assert.throws(
      () =>
        repository.payOrder({
          orderId: draft.id,
          payments: [{ methodCode: "CASH", amountMinor: 0 }],
        }),
      /confirm|producto/i,
    );
    assert.throws(
      () => repository.updateOrderStatus(draft.id, "DELIVERED"),
      /confirm|producto/i,
    );
  });
});

test("para retirar impago exige cobrar antes de entregar", () => {
  withRepository((repository) => {
    repository.openCashSession({ openingAmountMinor: 0 });
    const draft = repository.createOrder(takeawayOrder());
    repository.addOrderItem({
      orderId: draft.id,
      productId: "starter-muzza-grande",
    });
    repository.confirmOrder({ orderId: draft.id });
    assert.throws(
      () => repository.updateOrderStatus(draft.id, "DELIVERED"),
      /cobr/i,
    );
  });
});

test("cobrar y entregar delivery en puerta es atómico e idempotente", () => {
  withRepository((repository) => {
    repository.saveSettings({
      ...repository.bootstrap().settings,
      deliverySettlementEnabled: true,
    });
    const driver = repository.createUser({
      fullName: "Repartidor",
      roleCode: "DELIVERY_DRIVER",
      pin: "3579",
      authorizerPin: "2468",
    });
    repository.openCashSession({ openingAmountMinor: 0 });
    const draft = repository.createOrder({
      type: "DELIVERY",
      customerName: "Cliente",
      customerPhone: "11 4000-3000",
      deliveryAddress: "Calle 123",
      deliveryFeeMinor: 200_000,
      driverUserId: driver.id,
    });
    const populated = repository.addOrderItem({
      orderId: draft.id,
      productId: "starter-muzza-grande",
    });
    const completed = repository.completeOrder({
      orderId: draft.id,
      finalStatus: "DELIVERED",
      collectedByDriver: true,
      payments: [{ methodCode: "CASH", amountMinor: populated.totalMinor }],
    });
    assert.equal(completed.lifecycleStatus, "CONFIRMED");
    assert.equal(completed.operationalStatus, "DELIVERED");
    assert.equal(completed.paymentStatus, "PAID");
    assert.equal(completed.collectedByDriver, true);
    assert.equal(repository.bootstrap().deliveryLedger[0]?.status, "PENDING");
    assert.throws(
      () =>
        repository.completeOrder({
          orderId: draft.id,
          finalStatus: "DELIVERED",
          collectedByDriver: true,
          payments: [{ methodCode: "CASH", amountMinor: populated.totalMinor }],
        }),
      /entregado|pagado/i,
    );
    assert.equal(
      repository.bootstrap().orders.find((order) => order.id === draft.id)
        ?.payments.length,
      1,
    );
  });
});

test("cobrar y entregar un envío rechaza mezclar efectivo en puerta con pago anticipado", () => {
  withRepository((repository) => {
    repository.openCashSession({ openingAmountMinor: 0 });
    const draft = repository.createOrder({
      type: "DELIVERY",
      customerName: "Cliente",
      customerPhone: "11 4000-4000",
      deliveryAddress: "Calle 456",
    });
    const populated = repository.addOrderItem({
      orderId: draft.id,
      productId: "starter-muzza-grande",
    });
    const cashMinor = Math.floor(populated.totalMinor / 2);
    assert.throws(
      () =>
        repository.completeOrder({
          orderId: draft.id,
          finalStatus: "DELIVERED",
          payments: [
            {
              methodCode: "CASH",
              amountMinor: cashMinor,
              receivedMinor: cashMinor,
            },
            {
              methodCode: "TRANSFER",
              amountMinor: populated.totalMinor - cashMinor,
              reference: "MIXTO",
            },
          ],
        }),
      /sin combinarlos/i,
    );
    const unchanged = repository
      .bootstrap()
      .orders.find((order) => order.id === draft.id)!;
    assert.equal(unchanged.lifecycleStatus, "DRAFT");
    assert.equal(unchanged.paymentStatus, "UNPAID");
    assert.equal(unchanged.payments.length, 0);
  });
});

test("imprimir cuenta no cobra ni cierra la mesa", () => {
  withRepository((repository) => {
    repository.openCashSession({ openingAmountMinor: 0 });
    const table = repository.ensureTable(40);
    const draft = repository.createOrder({
      type: "DINE_IN",
      tableId: table.id,
    });
    repository.addOrderItem({
      orderId: draft.id,
      productId: "starter-muzza-grande",
    });
    repository.confirmOrder({ orderId: draft.id });
    repository.queuePrint(draft.id, "CUSTOMER_BILL");
    const after = repository
      .bootstrap()
      .orders.find((order) => order.id === draft.id)!;
    assert.equal(after.paymentStatus, "UNPAID");
    assert.equal(after.operationalStatus, "IN_PREPARATION");
    assert.equal(
      repository.bootstrap().tables.find((item) => item.id === table.id)
        ?.currentOrderId,
      draft.id,
    );
  });
});

test("cobrar y cerrar mesa libera la mesa en una sola transacción", () => {
  withRepository((repository) => {
    repository.openCashSession({ openingAmountMinor: 0 });
    const table = repository.ensureTable(41);
    const draft = repository.createOrder({
      type: "DINE_IN",
      tableId: table.id,
    });
    const populated = repository.addOrderItem({
      orderId: draft.id,
      productId: "starter-muzza-grande",
    });
    const completed = repository.completeOrder({
      orderId: draft.id,
      finalStatus: "DELIVERED",
      payments: [{ methodCode: "CASH", amountMinor: populated.totalMinor }],
    });
    assert.equal(completed.paymentStatus, "PAID");
    assert.equal(completed.operationalStatus, "DELIVERED");
    assert.equal(
      repository.bootstrap().tables.find((item) => item.id === table.id)
        ?.currentOrderId,
      null,
    );
  });
});

test("reducir mesas conserva ocupadas e historial y desactiva sólo las libres", () => {
  withRepository((repository) => {
    repository.openCashSession({ openingAmountMinor: 0 });
    repository.configureTables(20);
    const table20 = repository
      .bootstrap()
      .tables.find((table) => table.number === 20)!;
    const draft = repository.createOrder({
      type: "DINE_IN",
      tableId: table20.id,
    });
    repository.configureTables(15);
    assert.equal(
      repository.bootstrap().tables.find((table) => table.id === table20.id)
        ?.active,
      true,
    );
    repository.discardDraftOrder(draft.id);
    repository.configureTables(15);
    const preserved = repository
      .bootstrap()
      .tables.find((table) => table.id === table20.id);
    assert.ok(preserved);
    assert.equal(preserved.active, false);
  });
});

test("persiste sectores, forma, tamaño y posición de las mesas", () => {
  withRepository((repository) => {
    const mainSector = repository.bootstrap().tableSectors[0]!;
    assert.equal(mainSector.name, "Salón");
    const terrace = repository.createTableSector({ name: "Terraza" });
    const table = repository.ensureTable(81);
    const updated = repository.updateTable({
      tableId: table.id,
      number: table.number,
      name: "Junto a la ventana",
      active: true,
      sortOrder: table.sortOrder,
      sectorId: terrace.id,
      layoutX: 21.5,
      layoutY: 33,
      layoutWidth: 24,
      layoutHeight: 12,
      shape: "RECTANGLE",
    });
    assert.deepEqual(
      {
        name: updated.name,
        sectorId: updated.sectorId,
        layoutX: updated.layoutX,
        layoutY: updated.layoutY,
        layoutWidth: updated.layoutWidth,
        layoutHeight: updated.layoutHeight,
        shape: updated.shape,
      },
      {
        name: "Junto a la ventana",
        sectorId: terrace.id,
        layoutX: 21.5,
        layoutY: 33,
        layoutWidth: 24,
        layoutHeight: 12,
        shape: "RECTANGLE",
      },
    );
    assert.equal(
      repository.updateTableSector({
        sectorId: terrace.id,
        name: "Patio",
      }).name,
      "Patio",
    );
    const deleted = repository.deleteTableSector({ sectorId: terrace.id });
    assert.equal(deleted.fallbackSectorId, mainSector.id);
    assert.equal(
      repository.bootstrap().tables.find((item) => item.id === table.id)
        ?.sectorId,
      mainSector.id,
    );
    assert.equal(
      repository.getAuditLog({ action: "TABLE_SECTOR_DELETED" }).length,
      1,
    );
  });
});

test("persiste figuras decorativas del plano y las elimina con su sector", () => {
  withRepository((repository) => {
    const sector = repository.createTableSector({ name: "Patio con barra" });
    const created = repository.createFloorPlanShape({
      sectorId: sector.id,
      kind: "RECTANGLE",
      label: "Barra",
      color: "#F59E0B",
      layoutX: 8,
      layoutY: 12,
      layoutWidth: 38,
      layoutHeight: 9,
    });
    const updated = repository.updateFloorPlanShape({
      shapeId: created.id,
      sectorId: sector.id,
      kind: "ELLIPSE",
      label: "Macetero",
      color: "#16A34A",
      layoutX: 52,
      layoutY: 18,
      layoutWidth: 16,
      layoutHeight: 20,
    });
    assert.deepEqual(updated, {
      ...created,
      kind: "ELLIPSE",
      label: "Macetero",
      color: "#16A34A",
      layoutX: 52,
      layoutY: 18,
      layoutWidth: 16,
      layoutHeight: 20,
    });
    assert.equal(
      repository
        .bootstrap()
        .floorPlanShapes.find((shape) => shape.id === created.id)?.label,
      "Macetero",
    );

    repository.deleteTableSector({ sectorId: sector.id });
    assert.equal(
      repository
        .bootstrap()
        .floorPlanShapes.some((shape) => shape.id === created.id),
      false,
    );
  });
});

test("devolución total revierte el pago, corrige caja y habilita cancelar", () => {
  withRepository((repository) => {
    repository.openCashSession({ openingAmountMinor: 5_000_000 });
    const draft = repository.createOrder(takeawayOrder());
    const populated = repository.addOrderItem({
      orderId: draft.id,
      productId: "starter-muzza-grande",
    });
    repository.confirmOrder({ orderId: draft.id });
    const paid = repository.payOrder({
      orderId: draft.id,
      payments: [
        {
          methodCode: "CASH",
          amountMinor: populated.totalMinor,
          receivedMinor: populated.totalMinor,
        },
      ],
    });
    assert.equal(
      repository.bootstrap().cashSession?.expectedAmountMinor,
      5_000_000 + populated.totalMinor,
    );
    const refunded = repository.refundPayment({
      orderId: draft.id,
      paymentId: paid.payments[0]!.id,
      reason: "Cobro duplicado",
      authorizerPin: "2468",
    });
    assert.equal(refunded.paidMinor, 0);
    assert.equal(refunded.paymentStatus, "UNPAID");
    assert.equal(refunded.payments[0]?.refundableMinor, 0);
    assert.equal(refunded.payments[0]?.refundedMinor, populated.totalMinor);
    assert.equal(refunded.payments[0]?.status, "REFUNDED");
    const cashAfterRefund = repository.bootstrap().cashSession!;
    assert.equal(cashAfterRefund.expectedAmountMinor, 5_000_000);
    assert.equal(cashAfterRefund.salesTotalMinor, 0);
    assert.equal(cashAfterRefund.salesByType?.TAKEAWAY, 0);
    assert.equal(
      cashAfterRefund.salesByPaymentMethod?.find(
        (method) => method.code === "CASH",
      )?.amountMinor ?? 0,
      0,
    );
    assert.throws(
      () =>
        repository.refundPayment({
          orderId: draft.id,
          paymentId: paid.payments[0]!.id,
          reason: "Duplicado",
          authorizerPin: "2468",
        }),
      /ya fue devuelto/i,
    );
    const cancelled = repository.cancelOrder({
      orderId: draft.id,
      reason: "Venta anulada después de devolver",
      authorizerPin: "2468",
    });
    assert.equal(cancelled.operationalStatus, "CANCELLED");
    assert.equal(
      repository.getAuditLog({ action: "PAYMENT_REFUNDED" }).length,
      1,
    );
  });
});

test("devolución en efectivo se rechaza si el turno actual no tiene fondos", () => {
  withRepository((repository) => {
    repository.openCashSession({ openingAmountMinor: 0 });
    const order = repository.createOrder(takeawayOrder());
    const populated = repository.addOrderItem({
      orderId: order.id,
      productId: "starter-muzza-grande",
    });
    repository.confirmOrder({ orderId: order.id });
    const paid = repository.payOrder({
      orderId: order.id,
      payments: [
        {
          methodCode: "CASH",
          amountMinor: populated.totalMinor,
          receivedMinor: populated.totalMinor,
        },
      ],
    });
    repository.updateOrderStatus(order.id, "DELIVERED");
    repository.closeCashSession({
      countedAmountMinor: populated.totalMinor,
      closingFloatAmountMinor: 0,
    });
    repository.openCashSession({ openingAmountMinor: 0 });

    assert.throws(
      () =>
        repository.refundPayment({
          orderId: order.id,
          paymentId: paid.payments[0]!.id,
          reason: "Sin fondos en turno nuevo",
          authorizerPin: "2468",
        }),
      /efectivo suficiente/i,
    );
    const unchanged = repository.getOrder(order.id);
    assert.equal(unchanged.paymentStatus, "PAID");
    assert.equal(unchanged.payments[0]?.refundableMinor, populated.totalMinor);
  });
});

test("operación masiva actualiza categoría, estado y precios en una transacción", () => {
  withRepository((repository) => {
    const before = repository.bootstrap().products;
    const muzza = before.find(
      (product) => product.id === "starter-muzza-grande",
    )!;
    const napo = before.find(
      (product) => product.id === "starter-napo-grande",
    )!;
    const updated = repository.bulkUpdateProducts({
      productIds: [muzza.id, napo.id],
      categoryId: "category-4",
      active: false,
      priceAdjustment: {
        mode: "PERCENTAGE",
        value: 10,
        priceListCodes: ["SALON", "TAKEAWAY"],
      },
      reason: "Cambio de temporada",
      authorizerPin: "2468",
    });
    assert.equal(updated.length, 2);
    assert.ok(
      updated.every(
        (product) =>
          product.categoryId === "category-4" && product.active === false,
      ),
    );
    assert.equal(
      updated
        .find((product) => product.id === muzza.id)
        ?.prices.find((price) => price.priceListCode === "SALON")?.amountMinor,
      1_650_000,
    );
    const stablePrice = updated
      .find((product) => product.id === napo.id)!
      .prices.find((price) => price.priceListCode === "SALON")!.amountMinor;
    assert.throws(
      () =>
        repository.bulkUpdateProducts({
          productIds: [muzza.id, napo.id],
          priceAdjustment: {
            mode: "FIXED",
            value: -99_000_000,
            priceListCodes: ["SALON"],
          },
          reason: "Debe revertirse",
          authorizerPin: "2468",
        }),
      /precio negativo/i,
    );
    assert.equal(
      repository
        .bootstrap()
        .products.find((product) => product.id === napo.id)
        ?.prices.find((price) => price.priceListCode === "SALON")?.amountMinor,
      stablePrice,
    );
    assert.equal(
      repository.getAuditLog({ action: "PRODUCTS_BULK_UPDATED" }).length,
      1,
    );
  });
});

test("trabajo de impresión conserva impresora y copias del perfil", () => {
  withRepository((repository) => {
    repository.openCashSession({ openingAmountMinor: 0 });
    const settings = repository.bootstrap().settings;
    repository.saveSettings({
      ...settings,
      printing: {
        ...settings.printing,
        kitchen: {
          ...settings.printing.kitchen,
          deviceName: "Cocina térmica",
          copies: 2,
          paperWidth: "58mm",
          charsPerLine: 32,
        },
        receiptTemplate: {
          ...settings.printing.receiptTemplate,
          kitchenHeader: "COCINA CENTRAL",
          kitchenFooter: "Controlar observaciones",
          title: "Mi restaurante",
          footer: "Gracias por elegirnos",
        },
      },
    });
    const savedTemplate =
      repository.bootstrap().settings.printing.receiptTemplate;
    assert.equal(savedTemplate.kitchenHeader, "COCINA CENTRAL");
    assert.equal(savedTemplate.kitchenFooter, "Controlar observaciones");
    assert.equal(savedTemplate.title, "Mi restaurante");
    assert.equal(savedTemplate.footer, "Gracias por elegirnos");
    const order = repository.createOrder(takeawayOrder());
    repository.addOrderItem({
      orderId: order.id,
      productId: "starter-muzza-grande",
    });
    repository.confirmOrder({ orderId: order.id });
    repository.queuePrint(order.id, "KITCHEN_ORDER");
    const job = repository.bootstrap().printJobs[0];
    assert.equal(job?.printerName, "Cocina térmica");
    assert.equal(job?.copies, 2);
  });
});

test("informe separa dos turnos con la misma fecha comercial", () => {
  withRepository((repository) => {
    repository.openCashSession({ openingAmountMinor: 0 });
    const first = repository.createOrder(takeawayOrder());
    const firstPopulated = repository.addOrderItem({
      orderId: first.id,
      productId: "starter-muzza-grande",
    });
    repository.confirmOrder({ orderId: first.id });
    repository.payOrder({
      orderId: first.id,
      payments: [
        { methodCode: "CASH", amountMinor: firstPopulated.totalMinor },
      ],
    });
    repository.updateOrderStatus(first.id, "DELIVERED");
    const firstSession = repository.bootstrap().cashSession!;
    repository.closeCashSession({
      countedAmountMinor: firstSession.expectedAmountMinor,
    });
    repository.openCashSession({ openingAmountMinor: 0 });
    const second = repository.createOrder(
      takeawayOrder({ customerName: "Segundo" }),
    );
    const secondPopulated = repository.addOrderItem({
      orderId: second.id,
      productId: "starter-muzza-grande",
    });
    repository.confirmOrder({ orderId: second.id });
    repository.payOrder({
      orderId: second.id,
      payments: [
        { methodCode: "CASH", amountMinor: secondPopulated.totalMinor },
      ],
    });
    const secondSession = repository.bootstrap().cashSession!;
    const firstReport = repository.getCashSessionReport({
      cashSessionId: firstSession.id,
    });
    const secondReport = repository.getCashSessionReport({
      cashSessionId: secondSession.id,
    });
    assert.equal(firstReport.totals.orderCount, 1);
    assert.deepEqual(
      firstReport.orders.map((order) => order.id),
      [first.id],
    );
    assert.equal(secondReport.totals.orderCount, 1);
    assert.deepEqual(
      secondReport.orders.map((order) => order.id),
      [second.id],
    );
  });
});

test("informe de caja aplica filtros combinables de mesa, mozo y producto", () => {
  withRepository((repository) => {
    repository.openCashSession({ openingAmountMinor: 0 });
    const table = repository.ensureTable(81);
    const waiter = repository.createUser({
      fullName: "Mozo informe",
      roleCode: "WAITER",
      pin: "9753",
      authorizerPin: "2468",
    });
    const order = repository.createOrder({
      type: "DINE_IN",
      tableId: table.id,
      waiterUserId: waiter.id,
    });
    const populated = repository.addOrderItem({
      orderId: order.id,
      productId: "starter-muzza-grande",
    });
    repository.confirmOrder({ orderId: order.id });
    repository.payOrder({
      orderId: order.id,
      payments: [{ methodCode: "CASH", amountMinor: populated.totalMinor }],
    });
    const session = repository.bootstrap().cashSession!;
    const report = repository.getCashSessionReport({
      cashSessionId: session.id,
      tableId: table.id,
      waiterUserId: waiter.id,
      productId: "starter-muzza-grande",
    });
    assert.equal(report.totals.orderCount, 1);
    assert.equal(report.byTable[0]?.tableId, table.id);
    assert.equal(report.byWaiter[0]?.waiterUserId, waiter.id);
    assert.equal(report.byProduct[0]?.productId, "starter-muzza-grande");
    const empty = repository.getCashSessionReport({
      cashSessionId: session.id,
      tableId: "missing-table",
      productId: "starter-muzza-grande",
    });
    assert.equal(empty.totals.orderCount, 0);
  });
});

test("historial lista cajas cerradas y sesión antigua queda sólo en resumen", () => {
  withRepository((repository) => {
    repository.openCashSession({ openingAmountMinor: 0 });
    const session = repository.bootstrap().cashSession!;
    repository.closeCashSession({
      countedAmountMinor: session.expectedAmountMinor,
    });
    repository.db
      .prepare(
        "UPDATE cash_sessions SET business_date = ?, closed_at = ? WHERE id = ?",
      )
      .run("2020-01-01", "2020-01-01T12:00:00.000Z", session.id);
    const history = repository.listCashSessionHistory();
    const item = history.find((entry) => entry.session.id === session.id)!;
    assert.equal(item.detailAvailable, false);
    const report = repository.getCashSessionReport({
      cashSessionId: session.id,
      tableId: "ignored",
      paymentMethodCode: "CASH",
    });
    assert.equal(report.detailAvailable, false);
    assert.equal(report.orders.length, 0);
    assert.equal(report.movements.length, 0);
    assert.equal(report.byProduct.length, 0);
    assert.equal(report.filters.tableId, undefined);
    assert.equal(report.filters.paymentMethodCode, undefined);
    const cutoff = new Date();
    cutoff.setDate(1);
    cutoff.setMonth(cutoff.getMonth() - 2);
    assert.equal(report.retentionCutoff, cutoff.toISOString().slice(0, 10));
  });
});
