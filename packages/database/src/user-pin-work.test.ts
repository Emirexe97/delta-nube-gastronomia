import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import bcrypt from "bcryptjs";
import Database from "better-sqlite3-multiple-ciphers";
import { SqliteGastronomyRepository } from "./sqlite-repository";

async function withRepo(run: (repo: SqliteGastronomyRepository, path: string) => Promise<void>, pending = false) {
  const dir = mkdtempSync(join(tmpdir(), "gastronomy-user-pin-work-"));
  const path = join(dir, "test.sqlite");
  const repo = new SqliteGastronomyRepository(path, { adminPin: "2468", seedStarterCatalog: false });
  if (!pending) repo.db.prepare("UPDATE users SET must_change_pin=0 WHERE id='user-admin'").run();
  try { await run(repo, path); }
  finally { repo.close(); rmSync(dir, { recursive: true, force: true }); }
}

function addUser(repo: SqliteGastronomyRepository, id: string, staffNumber: number, pin = "5729") {
  const now = new Date().toISOString();
  repo.db.prepare(`INSERT INTO users(id,staff_number,full_name,role_id,pin_hash,must_change_pin,active,created_at,updated_at)
    VALUES(?,?,?,'role-waiter',?,0,1,?,?)`).run(id, staffNumber, id, bcrypt.hashSync(pin, 4), now, now);
}

const update = { userId: "target", roleCode: "WAITER" as const, active: true, newPin: "8642", reason: "Actualizar acceso", authorizerPin: "2468" };

test("PIN updates yield to the event loop outside SQLite transactions and retain bcrypt cost 12", async () => {
  await withRepo(async repo => {
    for (let i = 0; i < 8; i++) addUser(repo, i ? `other-${i}` : "target", i + 2);
    let heartbeats = 0;
    let transactionDuringPreparation = false;
    const timer = setInterval(() => {
      heartbeats++;
      transactionDuringPreparation ||= repo.db.inTransaction;
      assert.equal(repo.bootstrap().users.length, 9);
    }, 10);
    try {
      await repo.withPreparedUserPins(update, () => {
        assert.ok(heartbeats > 1, "main-process timers must run before committing the PIN");
        assert.equal(repo.db.inTransaction, true);
        return repo.updateUser(update);
      });
    } finally { clearInterval(timer); }
    assert.equal(transactionDuringPreparation, false);
    const saved = repo.db.prepare("SELECT pin_hash FROM users WHERE id='target'").get() as { pin_hash: string };
    assert.equal(bcrypt.getRounds(saved.pin_hash), 12);
    assert.equal(bcrypt.compareSync("8642", saved.pin_hash), true);
    assert.equal(bcrypt.compareSync("5729", saved.pin_hash), false);
    const audit = repo.db.prepare("SELECT after_json FROM audit_log WHERE action='USER_UPDATED'").get() as { after_json: string };
    assert.doesNotMatch(audit.after_json, /authorizerPin|newPin|8642|2468/);
  });
});

test("duplicate and invalid authorizer PINs leave users and audit unchanged", async () => {
  await withRepo(async repo => {
    addUser(repo, "target", 2);
    const before = repo.db.prepare("SELECT * FROM users ORDER BY id").all();
    for (const input of [{ ...update, newPin: "2468" }, { ...update, authorizerPin: "9753" }]) {
      await assert.rejects(repo.withPreparedUserPins(input, () => repo.updateUser(input)), /ya está asignado|PIN incorrecto/);
      assert.deepEqual(repo.db.prepare("SELECT * FROM users ORDER BY id").all(), before);
    }
    assert.equal((repo.db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action='USER_UPDATED'").get() as { n: number }).n, 0);
    await repo.withPreparedUserPins(update, () => repo.updateUser(update));
    // Legacy databases can contain a shared hash, even across different roles.
    repo.db.prepare("UPDATE users SET pin_hash=(SELECT pin_hash FROM users WHERE id='user-admin') WHERE id='target'").run();
    const ambiguous = { ...update, newPin: "6805" };
    await assert.rejects(repo.withPreparedUserPins(ambiguous, () => repo.updateUser(ambiguous)), /PIN ambiguo/);
  });
});

test("credential changes on another connection invalidate prepared work before any write", async () => {
  await withRepo(async (repo, path) => {
    addUser(repo, "target", 2);
    let invoked = false;
    const pending = repo.withPreparedUserPins(update, () => { invoked = true; return repo.updateUser(update); });
    const other = new Database(path);
    try { other.prepare("UPDATE users SET pin_hash=? WHERE id='user-admin'").run(bcrypt.hashSync("9753", 4)); }
    finally { other.close(); }
    await assert.rejects(pending, /usuarios cambiaron/);
    assert.equal(invoked, false);
    const saved = repo.db.prepare("SELECT pin_hash FROM users WHERE id='target'").get() as { pin_hash: string };
    assert.equal(bcrypt.compareSync("5729", saved.pin_hash), true);
  });
});

test("permissions are checked again at commit even when the prepared PIN hash did not change", async () => {
  await withRepo(async repo => {
    addUser(repo, "target", 2);
    const pending = repo.withPreparedUserPins(update, () => repo.updateUser(update));
    repo.db.prepare("UPDATE users SET role_id='role-waiter' WHERE id='user-admin'").run();
    await assert.rejects(pending, /PIN incorrecto o usuario sin permiso/);
  });
});

test("concurrent requests cannot assign the same PIN to two active users", async () => {
  await withRepo(async repo => {
    const requests = ["Primera", "Segunda"].map(fullName => ({ fullName, roleCode: "WAITER" as const, pin: "8642", authorizerPin: "2468" }));
    const outcomes = await Promise.allSettled(requests.map(input => repo.withPreparedUserPins(input, () => repo.createUser(input))));
    assert.equal(outcomes.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(outcomes.filter(result => result.status === "rejected").length, 1);
    assert.equal(repo.bootstrap().users.length, 2);
    assert.equal((repo.db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action='USER_CREATED'").get() as { n: number }).n, 1);
  });
});

test("initial administrator PIN setup uses the same nonblocking path without bypassing the gate", async () => {
  await withRepo(async repo => {
    const input = { currentPin: "2468", newPin: "8642" };
    assert.equal(repo.isInitialAdminPinSetupRequired(), true);
    await repo.withPreparedUserPins(input, () => repo.setInitialAdminPin(input));
    assert.equal(repo.isInitialAdminPinSetupRequired(), false);
    await assert.rejects(repo.withPreparedUserPins(input, () => repo.setInitialAdminPin(input)), /ya fue completada/);
  }, true);
});
