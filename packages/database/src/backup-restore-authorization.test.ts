import assert from "node:assert/strict";
import test from "node:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { SqliteGastronomyRepository } from "./sqlite-repository";

function withRepository(run: (repo: SqliteGastronomyRepository) => void) {
  const path = join(tmpdir(), `restore-auth-${randomUUID()}.sqlite`);
  const repo = new SqliteGastronomyRepository(path, { adminPin: "2468", seedStarterCatalog: true });
  try { run(repo); } finally {
    repo.close();
    for (const suffix of ["", "-wal", "-shm"]) rmSync(`${path}${suffix}`, { force: true });
  }
}

test("restore authorization requires a confirmed active ADMIN and closed cash", () => {
  withRepository((repo) => {
    assert.throws(() => repo.authorizeBackupRestore("2468"), /ADMIN sin PIN activo/i);
    repo.db.prepare("UPDATE users SET must_change_pin=0 WHERE id='user-admin'").run();
    repo.db.prepare("UPDATE users SET active=0 WHERE id='user-admin'").run();
    assert.throws(() => repo.authorizeBackupRestore("2468"), /administrador activo/i);
    repo.db.prepare("UPDATE users SET active=1 WHERE id='user-admin'").run();
    assert.equal(repo.authorizeBackupRestore("2468"), true);
    assert.throws(() => repo.authorizeBackupRestore("0000"), /PIN incorrecto/i);
    assert.throws(() => repo.authorizeBackupRestore("123"), /PIN de un ADMIN/i);
    repo.openCashSession({ openingAmountMinor: 0 });
    assert.throws(() => repo.authorizeBackupRestore("2468"), /Cerrá la caja/i);
  });
});

test("restore authorization accepts an active confirmed ADMIN regardless of settings.manage", () => {
  withRepository((repo) => {
    repo.db.prepare("UPDATE users SET must_change_pin=0 WHERE id='user-admin'").run();
    repo.db.prepare("DELETE FROM role_permissions WHERE role_id='role-admin' AND permission_code='settings.manage'").run();
    assert.equal(repo.authorizeBackupRestore("2468"), true);
  });
});
