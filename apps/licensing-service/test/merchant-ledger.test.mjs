import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  createMerchantLedger,
  MerchantLedgerError,
} from "../dist/merchant-ledger.js";

function setup() {
  const db = new DatabaseSync(":memory:");
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE licenses(id TEXT PRIMARY KEY,business_name TEXT NOT NULL,paid_through TEXT NOT NULL,revision INTEGER NOT NULL,status TEXT NOT NULL,activation_hash TEXT NOT NULL UNIQUE,installation_id TEXT UNIQUE,created_at TEXT NOT NULL);
    CREATE TABLE accounts(email TEXT PRIMARY KEY,password_hash TEXT NOT NULL,license_id TEXT NOT NULL UNIQUE,status TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE device_requests(id TEXT PRIMARY KEY,installation_id TEXT NOT NULL,key_fingerprint TEXT NOT NULL,status TEXT NOT NULL,license_id TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE owner_audit(id INTEGER PRIMARY KEY AUTOINCREMENT,action TEXT NOT NULL,license_id TEXT,request_id TEXT,reason TEXT NOT NULL,created_at TEXT NOT NULL);`);
  const row = (
    id,
    name,
    expiry = "2027-01-01T00:00:00.000Z",
    status = "ACTIVE",
    rev = 0,
  ) =>
    db
      .prepare("INSERT INTO licenses VALUES(?,?,?,?,?,?,?,?)")
      .run(
        id,
        name,
        expiry,
        rev,
        status,
        `hash-${id}`,
        null,
        "2026-11-07T00:00:00.000Z",
      );
  let n = 0;
  const ledger = createMerchantLedger(db, {
    now: () => "2026-11-07T12:00:00.000Z",
    idFactory: () => `merchant-${++n}-id`,
  });
  return { db, row, ledger };
}

test("list includes merchants without email, searchable and paginated", () => {
  const { db, row, ledger } = setup();
  row("merchant-01", "Café Uno");
  row("merchant-02", "Bar Dos");
  db.prepare("INSERT INTO accounts VALUES(?,?,?,?,?,?)").run(
    "uno@example.test",
    "hash",
    "merchant-01",
    "ACTIVE",
    "x",
    "x",
  );
  const all = ledger.listMerchants({ limit: 1 });
  assert.equal(all.total, 2);
  assert.equal(all.items.length, 1);
  assert.equal(
    ledger.listMerchants({ query: "café", limit: 10 }).items[0].accountEmail,
    "uno@example.test",
  );
  assert.equal(
    ledger.listMerchants({ query: "merchant-02" }).items[0].accountEmail,
    null,
  );
  db.close();
});

test("manual payment is idempotent, revision guarded, and cannot shorten access", () => {
  const { db, row, ledger } = setup();
  row("merchant-01", "Café Uno");
  const input = {
    idempotencyKey: "payment-0001",
    expectedRevision: 0,
    amountCents: 125000,
    paidThrough: "2027-02-01T00:00:00.000Z",
    reason: "Transferencia conciliada",
  };
  assert.equal(
    ledger.recordManualPayment("merchant-01", input, "owner").idempotent,
    false,
  );
  assert.equal(
    ledger.recordManualPayment("merchant-01", input, "owner").idempotent,
    true,
  );
  assert.equal(ledger.getMerchant("merchant-01").merchant.revision, 1);
  assert.equal(
    ledger.getMerchant("merchant-01").merchant.lastPayment.amountCents,
    125000,
  );
  assert.equal(ledger.getMerchant("merchant-01").history[0].actor, "owner");
  assert.throws(
    () =>
      ledger.recordManualPayment(
        "merchant-01",
        {
          ...input,
          idempotencyKey: "payment-0002",
          expectedRevision: 1,
          paidThrough: "2027-01-31T00:00:00.000Z",
        },
        "owner",
      ),
    (e) =>
      e instanceof MerchantLedgerError && e.code === "renewal_cannot_shorten",
  );
  assert.throws(
    () =>
      ledger.recordManualPayment(
        "merchant-01",
        { ...input, expectedRevision: 0, idempotencyKey: "payment-0003" },
        "owner",
      ),
    (e) => e.code === "revision_conflict",
  );
  db.close();
});

test("courtesy requires reason and never changes suspension", () => {
  const { db, row, ledger } = setup();
  row("merchant-01", "Café Uno", "2027-01-01T00:00:00.000Z", "SUSPENDED");
  const result = ledger.recordCourtesy(
    "merchant-01",
    {
      idempotencyKey: "courtesy-01",
      expectedRevision: 0,
      paidThrough: "2027-02-01T00:00:00.000Z",
      reason: "Compensación comercial",
    },
    "owner",
  );
  assert.equal(result.merchant.status, "SUSPENDED");
  assert.equal(result.merchant.accessStatus, "SUSPENDED");
  assert.equal(ledger.getMerchant("merchant-01").history.length, 1);
  assert.equal(ledger.getMerchant("merchant-01").history[0].actor, "owner");
  assert.throws(
    () =>
      ledger.recordCourtesy(
        "merchant-01",
        {
          idempotencyKey: "courtesy-02",
          expectedRevision: 1,
          paidThrough: "2027-03-01T00:00:00.000Z",
          reason: " ",
        },
        "owner",
      ),
    (e) => e.code === "invalid_payment",
  );
  db.close();
});

test("owner can create a merchant without a device request", () => {
  const { db, ledger } = setup();
  const merchant = ledger.createMerchant(
    {
      businessName: "Nuevo Local",
      paidThrough: "2027-01-01T00:00:00.000Z",
      reason: "Alta manual",
      idempotencyKey: "create-0001",
    },
    "owner",
  );
  assert.equal(merchant.businessName, "Nuevo Local");
  assert.equal(merchant.status, "ACTIVE");
  assert.equal(merchant.revision, 1);
  assert.equal(
    db.prepare("SELECT count(*) AS n FROM device_requests").get().n,
    0,
  );
  assert.equal(
    ledger.createMerchant(
      {
        businessName: "Nuevo Local",
        paidThrough: "2027-01-01T00:00:00.000Z",
        reason: "Alta manual",
        idempotencyKey: "create-0001",
      },
      "owner",
    ).id,
    merchant.id,
  );
  db.close();
});

test("el filtro de acceso usa los límites exclusivos de la licencia, sin confundir vencida y en gracia", () => {
  const { db, row, ledger } = setup();
  row("merchant-01", "En gracia", "2026-11-07T12:00:00.000Z");
  row("merchant-02", "Vencida", "2026-11-04T12:00:00.000Z");
  row("merchant-03", "Suspendida", "2026-12-01T12:00:00.000Z", "SUSPENDED");
  for (const [state, id] of [
    ["GRACE", "merchant-01"],
    ["EXPIRED", "merchant-02"],
    ["SUSPENDED", "merchant-03"],
  ]) {
    assert.deepEqual(
      ledger
        .listMerchants({ status: state })
        .items.map((m) => [m.id, m.accessStatus]),
      [[id, state]],
    );
  }
  db.close();
});
