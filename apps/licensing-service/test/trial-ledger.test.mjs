import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createMerchantLedger } from "../dist/merchant-ledger.js";

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE licenses(id TEXT PRIMARY KEY,business_name TEXT NOT NULL,paid_through TEXT NOT NULL,revision INTEGER NOT NULL,status TEXT NOT NULL,activation_hash TEXT NOT NULL,installation_id TEXT,created_at TEXT NOT NULL);
    CREATE TABLE accounts(email TEXT PRIMARY KEY,password_hash TEXT NOT NULL,license_id TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE owner_audit(id INTEGER PRIMARY KEY AUTOINCREMENT,action TEXT,license_id TEXT,request_id TEXT,reason TEXT,created_at TEXT);`);
  let now = "2026-01-01T00:00:00.000Z";
  const ledger = createMerchantLedger(db, { now: () => now });
  const add = (id, paid, trial = null) => {
    db.prepare("INSERT INTO licenses VALUES(?,?,?,1,'ACTIVE',?,NULL,?)").run(
      id,
      id,
      paid,
      id,
      "2026-01-01T00:00:00.000Z",
    );
    if (trial)
      db.prepare("INSERT INTO license_trials VALUES(?,?,?)").run(
        id,
        trial.started,
        trial.ends,
      );
  };
  return { db, ledger, add, setNow: (v) => (now = v), close: () => db.close() };
}
test("pending trial is explicit, pending filter includes it, and suspensions retain priority", () => {
  const { db, ledger, add, close } = fixture();
  add("pending_01", "1970-01-01T00:00:00.000Z", { started: null, ends: null });
  const item = ledger.listMerchants({ status: "PENDING_ACTIVATION" });
  assert.equal(item.total, 1);
  assert.equal(item.items[0].accessStatus, "PENDING_ACTIVATION");
  assert.deepEqual(item.items[0].trial, { startedAt: null, endsAt: null });
  db.prepare("UPDATE licenses SET status='SUSPENDED' WHERE id=?").run(
    "pending_01",
  );
  assert.equal(ledger.listMerchants({ status: "SUSPENDED" }).total, 1);
  close();
});
test("trial expiration has no grace; later paid-through renewal restores legacy grace", () => {
  const { db, ledger, add, setNow, close } = fixture();
  const end = Date.parse("2026-01-31T00:00:00.000Z");
  add("trial_0001", new Date(end).toISOString(), {
    started: Date.parse("2026-01-01T00:00:00.000Z"),
    ends: end,
  });
  const state = () =>
    ledger.listMerchants().items.find((x) => x.id === "trial_0001")
      .accessStatus;
  setNow("2026-01-30T23:59:59.999Z");
  assert.equal(state(), "ACTIVE");
  setNow("2026-01-31T00:00:00.000Z");
  assert.equal(state(), "EXPIRED");
  db.prepare("UPDATE licenses SET paid_through=? WHERE id=?").run(
    "2026-02-10T00:00:00.000Z",
    "trial_0001",
  );
  setNow("2026-02-12T00:00:00.000Z");
  assert.equal(state(), "GRACE");
  close();
});
test("trial and ordinary status filters keep count, page, and item classification consistent", () => {
  const { ledger, add, setNow, close } = fixture();
  add("pending_01", "1970-01-01T00:00:00.000Z", { started: null, ends: null });
  add("trial_0001", "2026-01-31T00:00:00.000Z", {
    started: Date.parse("2026-01-01T00:00:00.000Z"),
    ends: Date.parse("2026-01-31T00:00:00.000Z"),
  });
  add("paid_0001", "2026-12-31T00:00:00.000Z");
  setNow("2026-02-01T00:00:00.000Z");
  const expired = ledger.listMerchants({ status: "EXPIRED", limit: 1 });
  assert.equal(expired.total, 1);
  assert.equal(expired.items.length, 1);
  assert.equal(expired.items[0].id, "trial_0001");
  const pending = ledger.listMerchants({ status: "PENDING_ACTIVATION" });
  assert.equal(pending.total, 1);
  assert.equal(pending.items[0].id, "pending_01");
  close();
});
