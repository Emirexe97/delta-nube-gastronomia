import assert from "node:assert/strict";
import test from "node:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { SqliteGastronomyRepository } from "./sqlite-repository";

function withRepo(run: (repo: SqliteGastronomyRepository, path: string) => void) {
  const path = join(tmpdir(), `gastronomy-initial-pin-${randomUUID()}.sqlite`);
  const repo = new SqliteGastronomyRepository(path, { adminPin: "2468", seedStarterCatalog: false });
  try { run(repo, path); }
  finally {
    repo.close();
    for (const suffix of ["", "-wal", "-shm"]) rmSync(`${path}${suffix}`, { force: true });
  }
}

test("initial PIN setup blocks pending admin and atomically rejects invalid/current/duplicate PINs", () => {
  withRepo((repo) => {
    assert.equal(repo.isInitialAdminPinSetupRequired(), true);
    assert.equal(repo.verifyPosAiOperator(1, "2468"), null);
    assert.throws(() => repo.setInitialAdminPin({ currentPin: "0000", newPin: "5739" }), /actual es incorrecto/);
    assert.throws(() => repo.setInitialAdminPin({ currentPin: "2468", newPin: "1234" }), /fácil de adivinar/);
    assert.throws(() => repo.setInitialAdminPin({ currentPin: "2468", newPin: "2468" }), /distinto/);
    const now = new Date().toISOString();
    repo.db.prepare(`INSERT INTO users(id,staff_number,full_name,role_id,pin_hash,must_change_pin,active,created_at,updated_at)
      VALUES('other-user',99,'Otro usuario','role-cashier',?,0,1,?,?)`).run(bcrypt.hashSync("5739", 4), now, now);
    assert.throws(() => repo.setInitialAdminPin({ currentPin: "2468", newPin: "5739" }), /ya está asignado/);
    assert.equal(repo.isInitialAdminPinSetupRequired(), true);
    assert.deepEqual(repo.setInitialAdminPin({ currentPin: "2468", newPin: "8642" }), { configured: true });
    assert.equal(repo.isInitialAdminPinSetupRequired(), false);
    assert.throws(() => repo.setInitialAdminPin({ currentPin: "8642", newPin: "5739" }), /ya fue completada/);
    assert.throws(() => repo.updateUser({ userId: "user-admin", roleCode: "ADMIN", active: true, newPin: "1234", reason: "test", authorizerPin: "8642" }), /PIN inicial/);
  });
});

test("reopening configured database preserves confirmed PIN and does not re-enter setup", () => {
  withRepo((_first, path) => {
    _first.setInitialAdminPin({ currentPin: "2468", newPin: "5739" });
    const reopened = new SqliteGastronomyRepository(path, { adminPin: "1111", seedStarterCatalog: false });
    try {
      assert.equal(reopened.isInitialAdminPinSetupRequired(), false);
      assert.ok(reopened.verifyPosAiOperator(1, "5739"));
      assert.equal(reopened.verifyPosAiOperator(1, "1111"), null);
      assert.throws(() => reopened.setInitialAdminPin({ currentPin: "5739", newPin: "8642" }), /ya fue completada/);
    } finally { reopened.close(); }
  });
});
