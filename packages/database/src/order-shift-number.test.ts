import assert from "node:assert/strict";
import test from "node:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3-multiple-ciphers";
import { SqliteGastronomyRepository } from "./sqlite-repository";

function delivery(repository: SqliteGastronomyRepository, suffix: string) {
  return repository.createOrder({
    type: "DELIVERY",
    customerName: `Cliente ${suffix}`,
    customerPhone: "11 4555-5555",
    deliveryAddress: `Calle ${suffix} 123`,
  });
}

function takeout(repository: SqliteGastronomyRepository, suffix: string) {
  return repository.createOrder({
    type: "TAKEAWAY",
    customerName: `Cliente ${suffix}`,
    customerPhone: "11 4555-5555",
    deliveryAddress: `Calle ${suffix} 123`,
  });
}

function withRepository(run: (repository: SqliteGastronomyRepository) => void) {
  const path = join(tmpdir(), `gastronomy-order-shift-${randomUUID()}.sqlite`);
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

test("pedido salon y takeout comparten contador de turno, que reinicia sin reutilizar borrados", () => {
  withRepository((repository) => {
    const firstSession = repository.openCashSession({ openingAmountMinor: 0 });
    const table = repository.ensureTable(18);
    const dineInput = {
      type: "DINE_IN",
      tableId: table.id,
      waiterUserId: "user-admin",
      idempotencyKey: "order-shift-dine-replay",
    } as const;
    const dineIn = repository.createOrder(dineInput);
    const replayedDineIn = repository.createOrder(dineInput);
    assert.equal(replayedDineIn.id, dineIn.id);
    assert.equal(replayedDineIn.number, dineIn.number);
    const takeAway = takeout(repository, "T1");
    const deliveryOrder = delivery(repository, "D1");
    assert.deepEqual(
      [dineIn.number, takeAway.number, deliveryOrder.number],
      [1, 2, 3],
    );
    assert.deepEqual(
      (repository as any).db
        .prepare("SELECT number, shift_number FROM orders ORDER BY number")
        .all(),
      [
        { number: 1, shift_number: 1 },
        { number: 2, shift_number: 2 },
        { number: 3, shift_number: 3 },
      ],
    );

    repository.discardDraftOrder(deliveryOrder.id);
    const afterDiscard = takeout(repository, "T2");
    assert.equal(afterDiscard.number, 4);
    repository.closeCashSession({
      countedAmountMinor: 0,
      force: true,
      reason: "Cierre de prueba",
      authorizerPin: "2468",
    });
    const secondSession = repository.openCashSession({ openingAmountMinor: 0 });
    assert.equal(secondSession.number, firstSession.number + 1);
    assert.equal(secondSession.businessDate, firstSession.businessDate);
    const nextShiftOrder = delivery(repository, "D2");
    assert.equal(nextShiftOrder.number, 1);
    const raw = (repository as any).db
      .prepare(
        "SELECT number, shift_number, cash_session_created_id FROM orders WHERE id = ?",
      )
      .get(nextShiftOrder.id);
    assert.equal(raw.number, 5);
    assert.equal(raw.shift_number, 1);
    assert.equal(raw.cash_session_created_id, secondSession.id);
  });
});

test("migración v42 conserva pedidos legacy y siembra contador de caja abierta al reabrir", () => {
  const path = join(
    tmpdir(),
    `gastronomy-order-shift-v42-${randomUUID()}.sqlite`,
  );
  let repository = new SqliteGastronomyRepository(path, {
    adminPin: "2468",
    seedStarterCatalog: true,
  });
  const session = repository.openCashSession({ openingAmountMinor: 0 });
  const first = takeout(repository, "Legacy 1");
  const second = delivery(repository, "Legacy 2");
  assert.deepEqual([first.number, second.number], [1, 2]);
  repository.close();

  const legacy = new Database(path);
  try {
    legacy.exec(
      `DROP INDEX orders_cash_session_shift_number_idx;
       ALTER TABLE orders DROP COLUMN shift_number;
       DELETE FROM schema_migrations WHERE version = 43;
       DELETE FROM sequences WHERE name LIKE 'order:%';
       UPDATE orders SET number = number + 900;
       UPDATE sequences SET value = (SELECT COALESCE(MAX(number), 0) FROM orders) WHERE name = 'order';`,
    );
    assert.ok(
      legacy
        .prepare("SELECT 1 FROM schema_migrations WHERE version = 42")
        .get(),
    );
  } finally {
    legacy.close();
  }

  repository = new SqliteGastronomyRepository(path, {
    adminPin: "2468",
    seedStarterCatalog: true,
  });
  try {
    assert.equal(repository.getOrder(first.id).number, 901);
    assert.equal(repository.getOrder(second.id).number, 902);
    assert.equal(
      (repository as any).db
        .prepare("SELECT shift_number FROM orders WHERE id = ?")
        .get(first.id).shift_number,
      null,
    );
    assert.ok(
      (repository as any).db
        .prepare("SELECT 1 FROM schema_migrations WHERE version = 42")
        .get(),
    );
    assert.ok(
      (repository as any).db
        .prepare("SELECT 1 FROM schema_migrations WHERE version = 43")
        .get(),
    );
    const next = takeout(repository, "Legacy 3");
    assert.equal(next.number, 903);
    assert.equal(
      (repository as any).db
        .prepare("SELECT shift_number FROM orders WHERE id = ?")
        .get(next.id).shift_number,
      903,
    );
    assert.equal(repository.bootstrap().cashSession!.id, session.id);
  } finally {
    repository.close();
    for (const suffix of ["", "-wal", "-shm"])
      rmSync(`${path}${suffix}`, { force: true });
  }
});

test("el contador de turno persiste tras reiniciar la aplicación", () => {
  const path = join(
    tmpdir(),
    `gastronomy-order-shift-restart-${randomUUID()}.sqlite`,
  );
  let repository = new SqliteGastronomyRepository(path, {
    adminPin: "2468",
    seedStarterCatalog: true,
  });
  const session = repository.openCashSession({ openingAmountMinor: 0 });
  const first = takeout(repository, "Persistido");
  repository.close();
  repository = new SqliteGastronomyRepository(path, {
    adminPin: "2468",
    seedStarterCatalog: true,
  });
  try {
    const next = delivery(repository, "Persistido 2");
    assert.equal(repository.bootstrap().cashSession!.id, session.id);
    assert.equal(first.number, 1);
    assert.equal(next.number, 2);
    assert.equal(
      (repository as any).db
        .prepare("SELECT number FROM orders WHERE id = ?")
        .get(next.id).number,
      2,
    );
  } finally {
    repository.close();
    for (const suffix of ["", "-wal", "-shm"])
      rmSync(`${path}${suffix}`, { force: true });
  }
});
