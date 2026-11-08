import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error Node test runner loads .ts directly
import { handleWaiterRequest } from "./waiter-rpc.ts";
// @ts-expect-error Node test runner loads .ts directly
import { WaiterRequestError } from "./waiter-relay.ts";

const request = (lines: unknown[]) => ({
  requestId: "r".repeat(16),
  kind: "rpc" as const,
  method: "waiter.submitBatch",
  sessionId: "s".repeat(32),
  expiresAt: Date.now() + 10_000,
  params: { requestId: "b".repeat(16), tableId: "table-1", expectedOrderId: null, lines },
});
const line = (extra: Record<string, unknown> = {}) => ({ lineId: "line-1234", productId: "pizza-a", quantity: 1, ...extra });

test("waiter RPC preserves optional second half and classifies pizza validation as rejected", () => {
  let submitted: any;
  const repo = {
    submitWaiterBatch: (_token: string, batch: unknown) => { submitted = batch; return { created: false }; },
  } as any;
  handleWaiterRequest(repo, request([line({ secondProductId: "pizza-b", note: "sin aceitunas" })]), () => {});
  assert.equal(submitted.lines[0].secondProductId, "pizza-b");
  assert.equal(submitted.lines[0].note, "sin aceitunas");
  assert.equal("secondProductId" in submitted.lines[0], true);

  const invalid = request([line({ secondProductId: "bad id" })]);
  assert.throws(() => handleWaiterRequest(repo, invalid, () => {}), (e: unknown) => e instanceof WaiterRequestError && e.code === "invalid_batch");

  const rejectingRepo = { submitWaiterBatch: () => { throw new Error("La pizza no es elegible para mitad y mitad."); } } as any;
  assert.throws(() => handleWaiterRequest(rejectingRepo, request([line()]), () => {}), (e: unknown) => e instanceof WaiterRequestError && e.code === "rejected");
});

test("waiter RPC forwards print mode, table reads, and dispatches successful reprints", () => {
  let batch: any;
  let tableInput: any;
  let reprintInput: any;
  const dispatched: string[] = [];
  const repo = {
    submitWaiterBatch: (_token: string, input: unknown) => { batch = input; return { created: false }; },
    getWaiterTable: (_token: string, input: unknown) => { tableInput = input; return { tableId: "table-1" }; },
    reprintWaiterTable: (_token: string, input: unknown) => { reprintInput = input; return { created: true, printJobId: "job-1" }; },
  } as any;
  const req = request([line()]);
  (req.params as Record<string, unknown>).printMode = "ADDED";
  handleWaiterRequest(repo, req, (jobId) => dispatched.push(jobId));
  assert.equal(batch.printMode, "ADDED");
  assert.deepEqual(handleWaiterRequest(repo, { ...req, method: "waiter.getTable", params: { tableId: "table-1" } }, () => {}), { tableId: "table-1" });
  assert.deepEqual(tableInput, { tableId: "table-1" });
  const reprint = { ...req, method: "waiter.reprintTable", params: { tableId: "table-1", orderId: "order-1", requestId: "x".repeat(16), scope: "FULL" } };
  assert.deepEqual(handleWaiterRequest(repo, reprint, (jobId) => dispatched.push(jobId)), { created: true, printJobId: "job-1" });
  assert.deepEqual(reprintInput, { tableId: "table-1", orderId: "order-1", requestId: "x".repeat(16), scope: "FULL" });
  assert.deepEqual(dispatched, ["job-1"]);
});

test("waiter RPC rejects invalid print modes and reprint scopes", () => {
  const repo = { submitWaiterBatch: () => ({ created: false }), reprintWaiterTable: () => ({ created: false }) } as any;
  const invalidBatch = request([line()]);
  (invalidBatch.params as Record<string, unknown>).printMode = "UNKNOWN";
  assert.throws(() => handleWaiterRequest(repo, invalidBatch, () => {}), (e: unknown) => e instanceof WaiterRequestError && e.code === "invalid_batch");
  const invalidReprint = { ...invalidBatch, method: "waiter.reprintTable", params: { tableId: "table-1", orderId: "order-1", requestId: "x".repeat(16), scope: "ALL" } };
  assert.throws(() => handleWaiterRequest(repo, invalidReprint, () => {}), (e: unknown) => e instanceof WaiterRequestError && e.code === "invalid_request");
});
