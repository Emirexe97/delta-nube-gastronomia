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
    `gastronomy-delivery-settlement-${randomUUID()}.sqlite`,
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

function createLedger(
  repository: SqliteGastronomyRepository,
  suffix: string,
  collectedByDriver: boolean,
) {
  repository.saveSettings({
    ...repository.bootstrap().settings,
    deliverySettlementEnabled: true,
    deliveryFeeBelongsToDriver: true,
  });
  const driver = repository.createUser({
    fullName: `Repartidor ${suffix}`,
    roleCode: "DELIVERY_DRIVER",
    pin: suffix === "A" ? "3579" : suffix === "B" ? "4680" : "5791",
    authorizerPin: "2468",
  });
  const order = repository.createOrder({
    type: "DELIVERY",
    deliveryAddress: `Calle ${suffix} 100`,
    customerName: `Cliente ${suffix}`,
    customerPhone: `11 4000-100${suffix === "A" ? "1" : suffix === "B" ? "2" : "3"}`,
    deliveryFeeMinor: 300_000,
    driverUserId: driver.id,
  });
  repository.addOrderItem({
    orderId: order.id,
    productId: "starter-muzza-grande",
  });
  const confirmed = repository.confirmOrder({ orderId: order.id });
  repository.payOrder({
    orderId: order.id,
    collectedByDriver,
    payments: [
      {
        methodCode: collectedByDriver ? "CASH" : "TRANSFER",
        amountMinor: confirmed.totalMinor,
      },
    ],
  });
  repository.updateOrderStatus(order.id, "DELIVERED");
  return repository
    .bootstrap()
    .deliveryLedger.find((row) => row.orderId === order.id)!;
}

function settle(
  repository: SqliteGastronomyRepository,
  ledgerIds: string[],
  paymentMethodCode?: string,
  key: string = randomUUID(),
) {
  return repository.settleDelivery({
    ledgerIds,
    reason: "Rendición de prueba",
    authorizerPin: "2468",
    idempotencyKey: key,
    terminalId: "TEST",
    ...(paymentMethodCode !== undefined ? { paymentMethodCode } : {}),
  } as Parameters<typeof repository.settleDelivery>[0]);
}

function movementFor(
  repository: SqliteGastronomyRepository,
  orderId: string,
  type: string,
) {
  return repository
    .bootstrap()
    .cashSession!.movements!.find(
      (movement) =>
        movement.orderId === orderId &&
        movement.type === type &&
        !movement.reversedById &&
        movement.reason?.startsWith("Liquidación de reparto"),
    )!;
}

test("liquidar efectivo por defecto y transferencia conserva medio, efectivo y reversa exacta", () => {
  withRepository((repository) => {
    repository.openCashSession({ openingAmountMinor: 0 });
    const ledger = createLedger(repository, "A", true);
    const before = repository.bootstrap().cashSession!.expectedAmountMinor;
    assert.equal(before, 0);

    settle(repository, [ledger.id]);
    const cashIncome = movementFor(repository, ledger.orderId, "INCOME");
    assert.equal(cashIncome.paymentMethodCode, "CASH");
    assert.equal(cashIncome.affectsCash, true);
    assert.equal(
      repository.bootstrap().cashSession!.expectedAmountMinor,
      ledger.amountDueMinor,
    );
    const audit = (repository as any).db
      .prepare(
        "SELECT after_json FROM audit_log WHERE entity_id = ? AND action = 'DELIVERY_SETTLED'",
      )
      .get(ledger.id);
    assert.deepEqual(JSON.parse(audit.after_json), {
      amountMinor: ledger.amountDueMinor,
      paymentMethodCode: "CASH",
      paymentMethodName: "Efectivo",
      affectsCash: true,
    });

    repository.reverseDeliverySettlement({
      ledgerId: ledger.id,
      reason: "Revertir efectivo",
      authorizerPin: "2468",
      idempotencyKey: "reverse-settle-cash",
      terminalId: "TEST",
    });
    const cashReversal = repository
      .bootstrap()
      .cashSession!.movements!.find(
        (movement) => movement.referenceId === cashIncome.id,
      )!;
    assert.equal(cashReversal.type, "EXPENSE");
    assert.equal(cashReversal.paymentMethodCode, "CASH");
    assert.equal(cashReversal.affectsCash, true);
    assert.equal(repository.bootstrap().cashSession!.expectedAmountMinor, 0);

    settle(repository, [ledger.id], "TRANSFER", "resettle-transfer");
    const transferIncome = movementFor(repository, ledger.orderId, "INCOME");
    assert.equal(transferIncome.paymentMethodCode, "TRANSFER");
    assert.equal(transferIncome.affectsCash, false);
    assert.equal(repository.bootstrap().cashSession!.expectedAmountMinor, 0);
    repository.reverseDeliverySettlement({
      ledgerId: ledger.id,
      reason: "Revertir transferencia",
      authorizerPin: "2468",
      idempotencyKey: "reverse-settle-transfer",
      terminalId: "TEST",
    });
    const transferReversal = repository
      .bootstrap()
      .cashSession!.movements!.find(
        (movement) => movement.referenceId === transferIncome.id,
      )!;
    assert.equal(transferReversal.type, "EXPENSE");
    assert.equal(transferReversal.paymentMethodCode, "TRANSFER");
    assert.equal(transferReversal.affectsCash, false);
    assert.equal(repository.bootstrap().cashSession!.expectedAmountMinor, 0);
  });
});

test("el lote mixto con transferencia no afecta efectivo y admite rendir con caja en cero", () => {
  withRepository((repository) => {
    repository.openCashSession({ openingAmountMinor: 0 });
    const incoming = createLedger(repository, "A", true);
    const outgoing = createLedger(repository, "B", false);
    assert.equal(incoming.direction, "DRIVER_OWES_BUSINESS");
    assert.equal(outgoing.direction, "BUSINESS_OWES_DRIVER");
    assert.equal(repository.bootstrap().cashSession!.expectedAmountMinor, 0);

    settle(
      repository,
      [incoming.id, outgoing.id],
      "TRANSFER",
      "mixed-transfer-lot",
    );
    const incomingMovement = movementFor(
      repository,
      incoming.orderId,
      "INCOME",
    );
    const outgoingMovement = movementFor(
      repository,
      outgoing.orderId,
      "EXPENSE",
    );
    for (const movement of [incomingMovement, outgoingMovement]) {
      assert.equal(movement.paymentMethodCode, "TRANSFER");
      assert.equal(movement.affectsCash, false);
    }
    assert.equal(repository.bootstrap().cashSession!.expectedAmountMinor, 0);
    assert.equal(
      repository
        .bootstrap()
        .deliveryLedger.find((row) => row.id === incoming.id)?.status,
      "SETTLED",
    );
    assert.equal(
      repository
        .bootstrap()
        .deliveryLedger.find((row) => row.id === outgoing.id)?.status,
      "SETTLED",
    );
  });
});

test("medio inválido, inactivo o reservado no cambia liquidación ni caja", () => {
  withRepository((repository) => {
    repository.openCashSession({ openingAmountMinor: 0 });
    const ledger = createLedger(repository, "A", true);
    (repository as any).db
      .prepare("UPDATE payment_methods SET active = 0 WHERE code = 'DEBIT'")
      .run();
    const movementsBefore =
      repository.bootstrap().cashSession!.movements!.length;
    for (const [code, error] of [
      ["NO_EXISTE", /no está disponible/],
      ["", /no está disponible/],
      ["DEBIT", /no está disponible/],
      ["ACCOUNT", /Cuenta corriente/],
    ] as const) {
      assert.throws(() => settle(repository, [ledger.id], code), error);
      assert.equal(
        repository
          .bootstrap()
          .deliveryLedger.find((row) => row.id === ledger.id)?.status,
        "PENDING",
      );
      assert.equal(
        repository.bootstrap().cashSession!.movements!.length,
        movementsBefore,
      );
      assert.equal(repository.bootstrap().cashSession!.expectedAmountMinor, 0);
    }
  });
});

test("reverseCashMovement no anula una liquidación activa por separado", () => {
  withRepository((repository) => {
    repository.openCashSession({ openingAmountMinor: 0 });
    const ledger = createLedger(repository, "A", true);
    settle(repository, [ledger.id], "TRANSFER", "guard-transfer-settlement");
    const original = movementFor(repository, ledger.orderId, "INCOME");
    const movementsBefore =
      repository.bootstrap().cashSession!.movements!.length;
    assert.throws(
      () =>
        repository.reverseCashMovement({
          movementId: original.id,
          reason: "Reversión directa",
          authorizerPin: "2468",
          idempotencyKey: "disallow-direct-settlement-reversal",
          terminalId: "TEST",
        }),
      /Este movimiento corresponde a una liquidación de reparto\. Revertí la liquidación desde Repartidores\./,
    );
    assert.equal(
      repository.bootstrap().deliveryLedger.find((row) => row.id === ledger.id)
        ?.status,
      "SETTLED",
    );
    assert.equal(
      repository.bootstrap().cashSession!.movements!.length,
      movementsBefore,
    );
    assert.equal(repository.bootstrap().cashSession!.expectedAmountMinor, 0);
  });
});
