import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import Database from "better-sqlite3-multiple-ciphers";
import { SqliteGastronomyRepository } from "./sqlite-repository";

test("cierra la conexión SQLite si falla la inicialización para permitir recuperar la base", () => {
  const folder = mkdtempSync(join(tmpdir(), "gastronomy-us24-ctor-"));
  const file = join(folder, "malformed.sqlite");
  const fixture = new Database(file);
  fixture.exec(
    "CREATE TABLE schema_migrations(version TEXT); CREATE TABLE orders(id TEXT); CREATE TABLE users(id TEXT); CREATE TABLE audit_log(id TEXT);",
  );
  fixture.close();
  const original = Database.prototype.pragma;
  let opened: Database.Database | undefined;
  Database.prototype.pragma = function (source, options) {
    if (source === "journal_mode = WAL") opened = this;
    return original.call(this, source, options);
  };
  try {
    // A structurally incomplete file can pass the initial integrity/table check.
    SqliteGastronomyRepository.validateDatabase(file);
    assert.throws(
      () => new SqliteGastronomyRepository(file),
      /column|schema|table/i,
    );
    assert.ok(opened);
    assert.equal(
      opened.open,
      false,
      "failed construction must release its SQLite handle",
    );
    rmSync(`${file}-wal`, { force: true });
    rmSync(`${file}-shm`, { force: true });
  } finally {
    Database.prototype.pragma = original;
    if (opened?.open) opened.close();
    if (
      dirname(resolve(folder)) !== resolve(tmpdir()) ||
      !basename(folder).startsWith("gastronomy-us24-ctor-")
    )
      throw new Error("Unsafe disposable database folder");
    rmSync(folder, { recursive: true, force: true });
  }
});
