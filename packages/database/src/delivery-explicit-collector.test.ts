import assert from "node:assert/strict";
import test from "node:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { SqliteGastronomyRepository } from "./sqlite-repository";

function withRepository(run: (repository: SqliteGastronomyRepository) => void) {
  const path = join(
    tmpdir(),
    `gastronomy-explicit-collector-${randomUUID()}.sqlite`,
  );
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

function driver(
  repository: SqliteGastronomyRepository,
  name: string,
  pin: string,
) {
  return repository.createUser({
    fullName: name,
    roleCode: "DELIVERY_DRIVER",
    pin,
    authorizerPin: "2468",
  });
}

function deliveryDraft(
  repository: SqliteGastronomyRepository,
  name: string,
  driverUserId?: string,
) {
  const order = repository.createOrder({
    type: "DELIVERY",
    customerName: name,
    customerPhone: "11 4555-5000",
    deliveryAddress: `Calle ${name} 10`,
    deliveryFeeMinor: 200_000,
    ...(driverUserId ? { driverUserId } : {}),
  });
  const populated = repository.addOrderItem({
    orderId: order.id,
    productId: "starter-muzza-grande",
  });
  return { order, totalMinor: populated.totalMinor };
}

function complete(
  repository: SqliteGastronomyRepository,
  args: {
    orderId: string;
    totalMinor: number;
    driverUserId?: string;
    collectedByDriver?: boolean;
    payments?: Array<{
      methodCode: string;
      amountMinor: number;
      receivedMinor?: number;
    }>;
  },
) {
  return repository.completeOrder({
    orderId: args.orderId,
    finalStatus: "DELIVERED",
    ...(args.driverUserId !== undefined
      ? { driverUserId: args.driverUserId }
      : {}),
    ...(args.collectedByDriver !== undefined
      ? { collectedByDriver: args.collectedByDriver }
      : {}),
    payments: args.payments ?? [
      { methodCode: "CASH", amountMinor: args.totalMinor },
    ],
  } as Parameters<typeof repository.completeOrder>[0]);
}

function movementCount(repository: SqliteGastronomyRepository) {
  return repository.bootstrap().cashSession!.movements!.length;
}

test("completeOrder ausente o collectedByDriver false cobra efectivo del negocio sin deuda del repartidor", () => {
  withRepository((repository) => {
    repository.openCashSession({ openingAmountMinor: 0 });
    repository.saveSettings({
      ...repository.bootstrap().settings,
      deliverySettlementEnabled: true,
      deliveryFeeBelongsToDriver: false,
    });
    const assigned = driver(repository, "Repartidor negocio", "3579");
    const absent = deliveryDraft(repository, "Collector ausente", assigned.id);
    const explicitFalse = deliveryDraft(
      repository,
      "Collector false",
      assigned.id,
    );

    const first = complete(repository, {
      orderId: absent.order.id,
      totalMinor: absent.totalMinor,
    });
    const second = complete(repository, {
      orderId: explicitFalse.order.id,
      totalMinor: explicitFalse.totalMinor,
      collectedByDriver: false,
    });

    assert.equal(first.collectedByDriver, false);
    assert.equal(second.collectedByDriver, false);
    assert.equal(
      repository.bootstrap().cashSession!.expectedAmountMinor,
      absent.totalMinor + explicitFalse.totalMinor,
    );
    assert.equal(
      repository
        .bootstrap()
        .deliveryLedger.some(
          (entry) =>
            entry.orderId === absent.order.id ||
            entry.orderId === explicitFalse.order.id,
        ),
      false,
    );
  });
});

test("completeOrder sólo trata como cobro del repartidor al true explícito y conserva mixed cash más transfer del negocio", () => {
  withRepository((repository) => {
    repository.openCashSession({ openingAmountMinor: 75_000 });
    repository.saveSettings({
      ...repository.bootstrap().settings,
      deliverySettlementEnabled: true,
      deliveryFeeBelongsToDriver: true,
    });
    const assigned = driver(repository, "Repartidor puerta", "4680");
    const atDoor = deliveryDraft(repository, "Cobro explícito", assigned.id);
    const delivered = complete(repository, {
      orderId: atDoor.order.id,
      totalMinor: atDoor.totalMinor,
      collectedByDriver: true,
    });
    assert.equal(delivered.collectedByDriver, true);
    assert.equal(
      repository.bootstrap().cashSession!.expectedAmountMinor,
      75_000,
    );
    assert.equal(
      repository
        .bootstrap()
        .deliveryLedger.find((entry) => entry.orderId === atDoor.order.id)
        ?.direction,
      "DRIVER_OWES_BUSINESS",
    );

    repository.saveSettings({
      ...repository.bootstrap().settings,
      deliverySettlementEnabled: true,
      deliveryFeeBelongsToDriver: false,
    });
    const mixed = deliveryDraft(repository, "Cobro negocio mixto", assigned.id);
    const cashMinor = Math.floor(mixed.totalMinor / 2);
    const businessPaid = complete(repository, {
      orderId: mixed.order.id,
      totalMinor: mixed.totalMinor,
      collectedByDriver: false,
      payments: [
        { methodCode: "CASH", amountMinor: cashMinor },
        { methodCode: "TRANSFER", amountMinor: mixed.totalMinor - cashMinor },
      ],
    });
    assert.equal(businessPaid.collectedByDriver, false);
    assert.equal(
      repository.bootstrap().cashSession!.expectedAmountMinor,
      75_000 + cashMinor,
    );
    assert.equal(
      repository
        .bootstrap()
        .deliveryLedger.some((entry) => entry.orderId === mixed.order.id),
      false,
    );
  });
});

test("completeOrder selecciona o cambia repartidor antes de cobrar y persiste el responsable correcto", () => {
  withRepository((repository) => {
    repository.openCashSession({ openingAmountMinor: 0 });
    repository.saveSettings({
      ...repository.bootstrap().settings,
      deliverySettlementEnabled: true,
      deliveryFeeBelongsToDriver: true,
    });
    const firstDriver = driver(repository, "Repartidor anterior", "3579");
    const selectedDriver = driver(
      repository,
      "Repartidor seleccionado",
      "4680",
    );
    const unassigned = deliveryDraft(repository, "Asignar al completar");
    const completedUnassigned = complete(repository, {
      orderId: unassigned.order.id,
      totalMinor: unassigned.totalMinor,
      driverUserId: selectedDriver.id,
    });
    assert.equal(completedUnassigned.driverUserId, selectedDriver.id);
    assert.equal(
      repository
        .bootstrap()
        .deliveryLedger.find((entry) => entry.orderId === unassigned.order.id)
        ?.driverUserId,
      selectedDriver.id,
    );

    const reassigned = deliveryDraft(
      repository,
      "Cambiar al completar",
      firstDriver.id,
    );
    const completedReassigned = complete(repository, {
      orderId: reassigned.order.id,
      totalMinor: reassigned.totalMinor,
      driverUserId: selectedDriver.id,
    });
    assert.equal(completedReassigned.driverUserId, selectedDriver.id);
    assert.equal(
      repository
        .bootstrap()
        .deliveryLedger.find((entry) => entry.orderId === reassigned.order.id)
        ?.driverUserId,
      selectedDriver.id,
    );

    const paidOnly = deliveryDraft(repository, "Asignar al cobrar");
    repository.confirmOrder({ orderId: paidOnly.order.id });
    const paid = repository.payOrder({
      orderId: paidOnly.order.id,
      driverUserId: firstDriver.id,
      payments: [{ methodCode: "CASH", amountMinor: paidOnly.totalMinor }],
    });
    assert.equal(paid.driverUserId, firstDriver.id);
  });
});

test("completeOrder sin repartidor final o con repartidor inválido falla sin efectos parciales", () => {
  withRepository((repository) => {
    repository.openCashSession({ openingAmountMinor: 0 });
    const unassigned = deliveryDraft(repository, "Sin repartidor final");
    const beforeMissing = repository.getOrder(unassigned.order.id);
    const movementCountBeforeMissing = movementCount(repository);
    assert.throws(
      () =>
        complete(repository, {
          orderId: unassigned.order.id,
          totalMinor: unassigned.totalMinor,
        }),
      /Asigná un repartidor/,
    );
    const afterMissing = repository.getOrder(unassigned.order.id);
    assert.deepEqual(afterMissing, beforeMissing);
    assert.equal(afterMissing.lifecycleStatus, "DRAFT");
    assert.equal(afterMissing.paymentStatus, "UNPAID");
    assert.equal(movementCount(repository), movementCountBeforeMissing);

    const inactive = driver(repository, "Repartidor inactivo", "5791");
    (repository as any).db
      .prepare("UPDATE users SET active = 0 WHERE id = ?")
      .run(inactive.id);
    const invalidSelection = deliveryDraft(repository, "Repartidor inválido");
    const beforeInvalid = repository.getOrder(invalidSelection.order.id);
    const movementCountBeforeInvalid = movementCount(repository);
    const auditCountBeforeInvalid = Number(
      (repository as any).db
        .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE entity_id = ?")
        .get(invalidSelection.order.id).n,
    );
    assert.throws(
      () =>
        complete(repository, {
          orderId: invalidSelection.order.id,
          totalMinor: invalidSelection.totalMinor,
          driverUserId: inactive.id,
        }),
      /activo/i,
    );
    const afterInvalid = repository.getOrder(invalidSelection.order.id);
    assert.deepEqual(afterInvalid, beforeInvalid);
    assert.equal(afterInvalid.lifecycleStatus, "DRAFT");
    assert.equal(afterInvalid.paymentStatus, "UNPAID");
    assert.equal(movementCount(repository), movementCountBeforeInvalid);
    assert.equal(
      Number(
        (repository as any).db
          .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE entity_id = ?")
          .get(invalidSelection.order.id).n,
      ),
      auditCountBeforeInvalid,
    );
  });
});

test("completeOrder rechaza asignar un repartidor a un pedido que no es delivery", () => {
  withRepository((repository) => {
    repository.openCashSession({ openingAmountMinor: 0 });
    const assigned = driver(repository, "No corresponde", "3579");
    const order = repository.createOrder({
      type: "TAKEAWAY",
      customerName: "Retiro",
    });
    const item = repository.addOrderItem({
      orderId: order.id,
      productId: "starter-muzza-grande",
    });
    const movementCountBefore = movementCount(repository);
    assert.throws(
      () =>
        repository.completeOrder({
          orderId: order.id,
          finalStatus: "DELIVERED",
          driverUserId: assigned.id,
          payments: [{ methodCode: "CASH", amountMinor: item.totalMinor }],
        } as Parameters<typeof repository.completeOrder>[0]),
      /Sólo los envíos admiten repartidor/,
    );
    assert.equal(repository.getOrder(order.id).paymentStatus, "UNPAID");
    assert.equal(movementCount(repository), movementCountBefore);
  });
});
