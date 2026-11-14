import assert from "node:assert/strict";
import test from "node:test";
import { configuredTestRepository } from "./configured-test-repository";

test("búsqueda de clientes ignora tildes antes de contar y paginar sin modificar nombres", () => {
  const repo = configuredTestRepository(":memory:", { adminPin: "2468" });
  try {
    const accented = repo.createCustomer({ name: "HÉCTOR Pérez", phone: "11 5555-1001",
      addresses: [{ label: "Casa", address: "Avenida Córdoba 123", notes: "Portón marrón" }] });
    const plain = repo.createCustomer({ name: "Hector Gomez", phone: "11 5555-1002" });
    const decomposed = repo.createCustomer({ name: "He\u0301ctor López", phone: "11 5555-1003" });
    for (const query of ["Hector", "Héctor", "HÉCTOR", "He\u0301ctor", "héCtOr"]) {
      const ids = repo.searchCustomers(query).map(c => c.id).sort();
      assert.deepEqual(ids, [accented.id, plain.id, decomposed.id].sort(), query);
      const first = repo.searchCustomersPage({ query, page: 1, pageSize: 2 });
      const second = repo.searchCustomersPage({ query, page: 2, pageSize: 2 });
      assert.equal(first.total, 3);
      assert.equal(first.pageCount, 2);
      assert.equal(second.items.length, 1);
      assert.equal(new Set([...first.items, ...second.items].map(c => c.id)).size, 3);
    }
    for (const query of ["Cordoba", "CÓRDOBA", "porton marron"]) {
      assert.deepEqual(repo.searchCustomers(query).map(c => c.id), [accented.id]);
    }
    assert.equal(repo.searchCustomers("55551002")[0]?.id, plain.id);
    assert.equal(repo.searchCustomers("Hectra").length, 0);
    assert.equal(repo.searchCustomers("Hector").find(c => c.id === accented.id)?.name, accented.name);
  } finally {
    repo.close();
  }
});
