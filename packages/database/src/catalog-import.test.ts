import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rmSync } from "node:fs";
import { normalizeImportProductsInput } from "@gastronomy/contracts";
import type { ImportProductsInput } from "@gastronomy/contracts";
import { SqliteGastronomyRepository } from "./sqlite-repository";

const valid = (categoryId: string, key = randomUUID()): ImportProductsInput => ({
  idempotencyKey: key,
  rows: [{ code: "Café-1", name: " Café ", categoryId, basePriceMinor: 12500 }],
});

test("catalog import contract rejects malformed values and unknown fields", () => {
  const categoryId = randomUUID();
  const row = valid(categoryId).rows[0]!;
  for (const input of [null, [], {}, { ...valid(categoryId), extra: true }, { ...valid(categoryId), idempotencyKey: "bad" }, { ...valid(categoryId), rows: [{ ...row, extra: true }] }, { ...valid(categoryId), rows: Array(501).fill(row) }]) {
    assert.throws(() => normalizeImportProductsInput(input));
  }
  assert.equal(normalizeImportProductsInput(valid(categoryId)).rows[0]!.name, "Café");
});

test("catalog import atomically validates category and normalized codes, then replays persisted IDs", () => {
  const path = join(tmpdir(), `gastronomy-catalog-import-${randomUUID()}.sqlite`);
  let repo = new SqliteGastronomyRepository(path, { seedStarterCatalog: false });
  try {
    const stockCategory = repo.createCategory({ name: "Con stock", stockControlEnabled: true });
    const noStockCategory = repo.createCategory({ name: "Sin stock", stockControlEnabled: false });
    const key = randomUUID();
    const input = { idempotencyKey: key, rows: [
      { code: "A-1", name: "A", categoryId: stockCategory.id, basePriceMinor: 12500 },
      { code: "B-1", name: "B", categoryId: noStockCategory.id, basePriceMinor: 8000 },
    ] };
    const created = repo.importProducts(input);
    assert.equal(created[0]!.stockMinor, 0);
    assert.equal(created[0]!.stockTargetMinor, null);
    assert.equal(created[0]!.stockMinMinor, null);
    assert.equal(created[0]!.stockCriticalMinor, null);
    assert.equal(created[1]!.stockMinor, null);
    assert.deepEqual(repo.importProducts(input).map((p) => p.id), created.map((p) => p.id));
    assert.equal(created[0]!.priceBook?.baseMinor, 12500);
    assert.deepEqual(created[0]!.prices.map(({ priceListCode, amountMinor }) => ({ priceListCode, amountMinor })), [
      { priceListCode: "SALON", amountMinor: 12500 },
      { priceListCode: "TAKEAWAY", amountMinor: 12500 },
      { priceListCode: "DELIVERY", amountMinor: 12500 },
    ]);
    // Permission is checked before looking up a receipt, including successful replays.
    const adminRoleId = String((repo.db.prepare("SELECT role_id FROM users WHERE id='user-admin'").get() as { role_id: string }).role_id);
    const permissionRow = repo.db.prepare("SELECT 1 FROM role_permissions WHERE role_id=? AND permission_code='prices.bulk_update'").get(adminRoleId);
    assert.ok(permissionRow);
    repo.db.prepare("DELETE FROM role_permissions WHERE role_id=? AND permission_code='prices.bulk_update'").run(adminRoleId);
    assert.throws(() => repo.importProducts(input), /permiso/i);
    repo.db.prepare("INSERT INTO role_permissions(role_id,permission_code) VALUES(?, 'prices.bulk_update')").run(adminRoleId);
    assert.throws(() => repo.importProducts({ ...input, rows: [{ ...input.rows[0]!, name: "different" }] }), /datos diferentes/);
    const count = () => Number((repo.db.prepare("SELECT COUNT(*) AS n FROM products").get() as { n: number }).n);
    const before = count();
    assert.throws(() => repo.importProducts({ idempotencyKey: randomUUID(), rows: [
      { ...input.rows[0]!, code: "C-1" },
      { ...input.rows[1]!, code: "c-1" },
    ] }), /repetido/);
    assert.throws(() => repo.importProducts({ idempotencyKey: randomUUID(), rows: [
      { ...input.rows[0]!, code: "C-1" },
      { ...input.rows[1]!, categoryId: randomUUID() },
    ] }), /categoría/);
    repo.db.prepare("UPDATE categories SET active=0 WHERE id=?").run(noStockCategory.id);
    assert.throws(() => repo.importProducts({ idempotencyKey: randomUUID(), rows: [
      { ...input.rows[0]!, code: "C-1", categoryId: noStockCategory.id },
    ] }), /inactiva/);
    repo.db.prepare("UPDATE categories SET active=1 WHERE id=?").run(noStockCategory.id);
    assert.equal(count(), before);
    assert.throws(() => repo.importProducts({ idempotencyKey: randomUUID(), rows: [
      { ...input.rows[0]!, code: "a-1" },
    ] }), /ya existe/);
    repo.close();
    repo = new SqliteGastronomyRepository(path, { seedStarterCatalog: false });
    assert.deepEqual(repo.importProducts(input).map((p) => p.id), created.map((p) => p.id));
  } finally {
    try { repo.close(); } catch { /* already closed */ }
    rmSync(path, { force: true });
    rmSync(`${path}-wal`, { force: true });
    rmSync(`${path}-shm`, { force: true });
  }
});

test("catalog import rolls back rows, audits and receipts after a mid-create failure", () => {
  const path = join(tmpdir(), `gastronomy-catalog-import-rollback-${randomUUID()}.sqlite`);
  const repo = new SqliteGastronomyRepository(path, { seedStarterCatalog: false });
  try {
    const category = repo.createCategory({ name: "Rollback" });
    const input = { idempotencyKey: randomUUID(), rows: Array.from({ length: 3 }, (_, index) => ({
      code: `ROLL-${index}`, name: `Producto ${index}`, categoryId: category.id, basePriceMinor: 1200 + index,
    })) };
    const before = {
      products: Number((repo.db.prepare("SELECT COUNT(*) n FROM products").get() as { n: number }).n),
      audits: Number((repo.db.prepare("SELECT COUNT(*) n FROM audit_log").get() as { n: number }).n),
      receipts: Number((repo.db.prepare("SELECT COUNT(*) n FROM command_receipts").get() as { n: number }).n),
    };
    const repositoryInternals = repo as unknown as {
      insertProductRecord(input: Parameters<typeof repo.createProduct>[0], deferMaterialization?: boolean): string;
    };
    const original = repositoryInternals.insertProductRecord.bind(repo);
    let calls = 0;
    repositoryInternals.insertProductRecord = (productInput, deferMaterialization) => {
      calls += 1;
      if (calls === 2) throw new Error("injected create failure");
      return original(productInput, deferMaterialization);
    };
    assert.throws(() => repo.importProducts(input), /injected create failure/);
    repositoryInternals.insertProductRecord = original;
    assert.equal(calls, 2);
    assert.equal(Number((repo.db.prepare("SELECT COUNT(*) n FROM products").get() as { n: number }).n), before.products);
    assert.equal(Number((repo.db.prepare("SELECT COUNT(*) n FROM audit_log").get() as { n: number }).n), before.audits);
    assert.equal(Number((repo.db.prepare("SELECT COUNT(*) n FROM command_receipts").get() as { n: number }).n), before.receipts);
    assert.equal(repo.importProducts(input).length, 3, "a rolled-back request can be retried with the same key");
  } finally {
    repo.close();
    for (const suffix of ["", "-wal", "-shm"]) rmSync(`${path}${suffix}`, { force: true });
  }
});

test("catalog import accepts the 500-row limit and receipt replay does not duplicate records", () => {
  const path = join(tmpdir(), `gastronomy-catalog-import-500-${randomUUID()}.sqlite`);
  const repo = new SqliteGastronomyRepository(path, { seedStarterCatalog: false });
  try {
    const category = repo.createCategory({ name: "500 productos" });
    const input = { idempotencyKey: randomUUID(), rows: Array.from({ length: 500 }, (_, index) => ({
      code: `BULK-${String(index).padStart(3, "0")}`, name: `Producto ${index}`, categoryId: category.id, basePriceMinor: index,
    })) };
    let listProductsCalls = 0;
    const repositoryReaders = repo as unknown as { listProducts(ids?: string[]): any[] };
    const originalListProducts = repositoryReaders.listProducts.bind(repo);
    repositoryReaders.listProducts = (ids) => {
      listProductsCalls += 1;
      assert.equal(ids?.length, 500, "only materialize the imported IDs");
      return originalListProducts(ids);
    };
    const created = repo.importProducts(input);
    assert.equal(created.length, 500);
    assert.equal(listProductsCalls, 1, "one batched product read materializes results rather than 500 full catalog reads");
    const replay = repo.importProducts(input);
    assert.deepEqual(replay.map(({ id }) => id), created.map(({ id }) => id));
    assert.equal(Number((repo.db.prepare("SELECT COUNT(*) n FROM products").get() as { n: number }).n), 500);
    assert.equal(Number((repo.db.prepare("SELECT COUNT(*) n FROM command_receipts WHERE operation='importProducts'").get() as { n: number }).n), 1);
  } finally {
    repo.close();
    for (const suffix of ["", "-wal", "-shm"]) rmSync(`${path}${suffix}`, { force: true });
  }
});
