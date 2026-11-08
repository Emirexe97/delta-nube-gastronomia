import assert from "node:assert/strict";
import test from "node:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { configuredTestRepository } from "./configured-test-repository";
import { SqliteGastronomyRepository } from "./sqlite-repository";

function withRepository(run: (repository: SqliteGastronomyRepository) => void) {
  const path = join(tmpdir(), `waiter-table-printing-${randomUUID()}.sqlite`);
  const repository = configuredTestRepository(path, { adminPin: "2468", seedStarterCatalog: true });
  try { run(repository); } finally {
    repository.close();
    for (const suffix of ["", "-wal", "-shm"]) rmSync(`${path}${suffix}`, { force: true });
  }
}

function setup(repository: SqliteGastronomyRepository, name = "Moza impresión") {
  repository.openCashSession({ openingAmountMinor: 0 });
  const waiter = repository.createUser({ fullName: name, roleCode: "WAITER", pin: name === "Moza impresión" ? "1357" : "1358", authorizerPin: "2468" });
  const token = repository.pairWaiterSession({ challengeId: repository.createWaiterChallenge(waiter.id).challengeId, pin: name === "Moza impresión" ? "1357" : "1358" }).sessionToken;
  const settings = repository.getSettings();
  settings.printing.kitchen.deviceName = "Kitchen Test";
  settings.printing.kitchen.mode = "SYSTEM_DIRECT";
  repository.saveSettings(settings);
  return { waiter, token };
}

function batch(repository: SqliteGastronomyRepository, token: string, tableId: string, quantity: number, printMode: "FULL" | "ADDED" | "NONE" = "FULL", expectedOrderId?: string) {
  return repository.submitWaiterBatch(token, {
    requestId: `batch-${randomUUID()}`, tableId, submittedAt: new Date().toISOString(), printMode, expectedOrderId,
    lines: [{ lineId: `line-${randomUUID()}`, productId: "starter-muzza-grande", quantity }],
  });
}

function printOrder(repository: SqliteGastronomyRepository, jobId: string) {
  return repository.getPrintOrder(jobId);
}

test("getWaiterTable reports NONE/no open order and receipts; FULL then ADDED print only new additions", () => {
  withRepository((repository) => {
    const { token } = setup(repository);
    const table = repository.ensureTable(101);
    const empty = repository.getWaiterTable(token, { tableId: table.id });
    assert.deepEqual(empty.items, []);
    assert.equal(empty.orderId, null);
    assert.equal(empty.canReprint, false);

    const none = batch(repository, token, table.id, 2, "NONE");
    assert.equal(none.printJobId, null);
    assert.deepEqual(repository.getWaiterBatch(token, none.requestId)?.acceptedLineIds, none.acceptedLineIds);
    assert.equal(repository.getWaiterTable(token, { tableId: table.id }).orderId, none.orderId);

    const first = batch(repository, token, table.id, 3, "FULL", none.orderId!);
    assert.ok(first.printJobId);
    const fullTicket = printOrder(repository, first.printJobId!);
    assert.equal(fullTicket.items.length, 1);
    assert.equal(fullTicket.items[0]!.quantity, 5, "FULL includes the pre-existing two units plus this batch");
    repository.markPrintJob(first.printJobId!, "PRINTED");
    const copy = repository.reprintWaiterTable(token, { tableId: table.id, orderId: first.orderId!, requestId: randomUUID(), scope: "ADDED" });
    assert.equal(repository.getPrintOrder(copy.printJobId!).items[0]!.quantity, 3, "the latest additions remain distinct even after choosing FULL");
    repository.markPrintJob(copy.printJobId!, "PRINTED");
    assert.equal(repository.getOrder(first.orderId!).kitchenPrintedQuantities?.[fullTicket.items[0]!.id], 5);

    const added = batch(repository, token, table.id, 4, "ADDED", first.orderId!);
    assert.ok(added.printJobId);
    const addedTicket = printOrder(repository, added.printJobId!);
    assert.equal(addedTicket.items.length, 1);
    assert.equal(addedTicket.items[0]!.quantity, 4, "ADDED contains only the new delta, not the prior five units");
    assert.equal(repository.getWaiterTable(token, { tableId: table.id }).canReprint, true);
  });
});

test("delayed Confirmar preserves NONE through cashier review and detects changes to print intent", () => {
  withRepository((repository) => {
    const { token } = setup(repository);
    const table = repository.ensureTable(105);
    const input = { tableId:table.id, requestId:randomUUID(), printMode:"NONE" as const,
      submittedAt:new Date(Date.now()-65_000).toISOString(),
      lines:[{lineId:randomUUID(),productId:"starter-muzza-grande",quantity:2,note:"Sin aceitunas"}] };
    assert.equal(repository.submitWaiterBatch(token, input).status, "PENDING_REVIEW");
    assert.throws(() => repository.submitWaiterBatch(token, {...input, printMode:"FULL"}), /otro contenido/);
    const applied = repository.confirmDelayedWaiterBatch({requestId:input.requestId});
    assert.equal(applied.status, "RECORDED");
    assert.equal(applied.printJobId, null);
    assert.equal(repository.getWaiterTable(token,{tableId:table.id}).items[0]!.note,"Sin aceitunas");
    assert.equal(repository.submitWaiterBatch(token,input).created,false);
    const copy = repository.reprintWaiterTable(token,{tableId:table.id,orderId:applied.orderId!,requestId:randomUUID(),scope:"ADDED"});
    repository.markPrintJob(copy.printJobId!, "PRINTED");
    const order = repository.getOrder(applied.orderId!);
    assert.equal(order.kitchenPrintedQuantities?.[order.items[0]!.id],2);
  });
});

test("FULL and ADDED reprints are idempotent and preserve exact last-tanda snapshots and receipts", () => {
  withRepository((repository) => {
    const { token } = setup(repository);
    const table = repository.ensureTable(102);
    const initial = batch(repository, token, table.id, 2, "FULL");
    repository.markPrintJob(initial.printJobId!, "PRINTED");
    const latest = batch(repository, token, table.id, 7, "ADDED", initial.orderId!);
    repository.markPrintJob(latest.printJobId!, "PRINTED");

    const fullRequest = `reprint-full-${randomUUID()}`;
    const full = repository.reprintWaiterTable(token, { tableId: table.id, orderId: initial.orderId!, requestId: fullRequest, scope: "FULL" });
    assert.equal(printOrder(repository, full.printJobId!).items[0]!.quantity, 9);
    assert.equal(repository.reprintWaiterTable(token, { tableId: table.id, orderId: initial.orderId!, requestId: fullRequest, scope: "FULL" }).created, false);
    assert.equal(repository.reprintWaiterTable(token, { tableId: table.id, orderId: initial.orderId!, requestId: fullRequest, scope: "FULL" }).printJobId, full.printJobId);
    repository.markPrintJob(full.printJobId!, "PRINTED");

    const addedRequest = `reprint-added-${randomUUID()}`;
    const added = repository.reprintWaiterTable(token, { tableId: table.id, orderId: initial.orderId!, requestId: addedRequest, scope: "ADDED" });
    assert.equal(printOrder(repository, added.printJobId!).items[0]!.quantity, 7, "ADDED reprint snapshots exactly the latest mobile batch, excluding earlier orders/tandas");
    assert.equal(repository.reprintWaiterTable(token, { tableId: table.id, orderId: initial.orderId!, requestId: addedRequest, scope: "ADDED" }).created, false);

    const receipt = repository.getWaiterBatch(token, latest.requestId);
    assert.equal(receipt?.orderId, initial.orderId);
    assert.deepEqual(receipt?.acceptedLineIds, latest.acceptedLineIds);
    assert.equal(repository.submitWaiterBatch(token, { requestId: latest.requestId, tableId: table.id, submittedAt: new Date().toISOString(), printMode: "ADDED", expectedOrderId: initial.orderId!, lines: [{ lineId: latest.acceptedLineIds[0]!, productId: "starter-muzza-grande", quantity: 7 }] }).created, false);
    assert.equal(repository.getWaiterBatch(token, latest.requestId)?.orderId, initial.orderId);
  });
});

test("waiter cannot read or print another waiter's table, nor target another table's order", () => {
  withRepository((repository) => {
    const firstWaiter = setup(repository);
    const table = repository.ensureTable(103);
    const order = batch(repository, firstWaiter.token, table.id, 1, "FULL");
    repository.markPrintJob(order.printJobId!, "PRINTED");
    const secondWaiter = repository.createUser({ fullName: "Mozo ajeno", roleCode: "WAITER", pin: "2469", authorizerPin: "2468" });
    const otherToken = repository.pairWaiterSession({ challengeId: repository.createWaiterChallenge(secondWaiter.id).challengeId, pin: "2469" }).sessionToken;
    assert.throws(() => repository.getWaiterTable(otherToken, { tableId: table.id }), /asignada a otro mozo/i);
    assert.throws(() => repository.reprintWaiterTable(otherToken, { tableId: table.id, orderId: order.orderId!, requestId: `unauthorized-${randomUUID()}`, scope: "FULL" }), /otro mozo/i);
    const otherTable = repository.ensureTable(104);
    assert.throws(() => repository.reprintWaiterTable(firstWaiter.token, { tableId: otherTable.id, orderId: order.orderId!, requestId: `wrong-table-${randomUUID()}`, scope: "FULL" }), /ya no está abierto en esa mesa/i);
  });
});
