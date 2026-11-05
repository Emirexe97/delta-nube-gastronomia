import assert from "node:assert/strict";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SqliteGastronomyRepository } from "@gastronomy/database";
// @ts-expect-error Node 24 / tsx execute this TypeScript source directly in tests.
import { WaiterRelay } from "../../orders-service/src/waiter-relay.ts";
// @ts-expect-error Node 24 / tsx execute this TypeScript source directly in tests.
import { createWaiterRelay, waiterRelayConfig } from "./waiter-relay.ts";
// @ts-expect-error Node 24 / tsx execute this TypeScript source directly in tests.
import { handleWaiterRequest } from "./waiter-rpc.ts";

const STORE = "test-store";
const INSTALLATION = "terminal-test";
const TERMINAL_TOKEN = "terminal-secret-" + "x".repeat(48);

function send(res: ServerResponse, status: number, value: unknown) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

test("mobile waiter request crosses desktop worker + relay HTTP + temporary SQLite and survives a lost ACK", async (t) => {
  const dbPath = join(tmpdir(), `waiter-circuit-${randomUUID()}.sqlite`);
  const repo = new SqliteGastronomyRepository(dbPath, {
    adminPin: "2468",
    seedStarterCatalog: true,
  });
  t.after(() => {
    repo.close();
    for (const suffix of ["", "-wal", "-shm"])
      rmSync(`${dbPath}${suffix}`, { force: true });
  });
  repo.openCashSession({ openingAmountMinor: 0 });
  const waiter = repo.createUser({
    fullName: "Moza Integración",
    roleCode: "WAITER",
    pin: "1357",
    authorizerPin: "2468",
  });
  const settings = repo.getSettings();
  settings.printing.kitchen.deviceName = "FAKE-KITCHEN-SPOOLER";
  settings.printing.kitchen.mode = "SYSTEM_DIRECT";
  repo.saveSettings(settings);
  const table = repo.ensureTable(91);
  const challenge = repo.createWaiterChallenge(waiter.id);

  let service: WaiterRelay | null = null;
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    if (!service) {
      send(res, 503, { error: "starting" });
      return;
    }
    void service
      .handle(req, res, url.pathname, req.method ?? "GET")
      .then((handled) => {
        if (!handled) send(res, 404, { error: "not_found" });
      })
      .catch((error: unknown) => {
        const status = Number((error as { status?: unknown })?.status) || 500;
        send(res, status, {
          error: String(
            (error as { code?: unknown })?.code ?? "internal_error",
          ),
        });
      });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  t.after(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  service = new WaiterRelay(
    (token) =>
      token === TERMINAL_TOKEN
        ? {
            storeId: STORE,
            role: "receive",
            receiveInstallationId: INSTALLATION,
          }
        : undefined,
    origin,
    tmpdir(),
  );
  t.after(() => service?.close());

  const config = waiterRelayConfig(
    {
      GASTRONOMY_WEB_ORDERS_URL: origin,
      GASTRONOMY_WEB_ORDERS_TOKEN: TERMINAL_TOKEN,
      GASTRONOMY_WEB_ORDERS_STORE_ID: STORE,
    } as NodeJS.ProcessEnv,
    INSTALLATION,
  );
  assert.ok(config, "loopback HTTP is accepted only for the local relay");

  let clock = Date.now();
  let offline = false;
  let loseOneAck = false;
  const processed = new Map<string, number>();
  const outcomes = new Map<string, unknown>();
  const spool: Array<{ jobId: string; orderId: string; itemCount: number }> =
    [];
  const worker = createWaiterRelay({
    config: () => config,
    now: () => clock,
    fetch: async (input, init) => {
      if (offline) throw new Error("simulated network offline");
      const url = new URL(String(input));
      if (loseOneAck && url.pathname.endsWith("/response")) {
        loseOneAck = false;
        return new Response("temporary ACK loss", { status: 503 });
      }
      return fetch(input, init);
    },
    process: async (request) => {
      processed.set(
        request.requestId,
        (processed.get(request.requestId) ?? 0) + 1,
      );
      try {
        const result = handleWaiterRequest(repo, request, (jobId) => {
          const order = repo.getPrintOrder(jobId);
          spool.push({
            jobId,
            orderId: order.id,
            itemCount: order.items.length,
          });
          // Fake spooler: record the immutable queued ticket and acknowledge physical output.
          repo.markPrintJob(jobId, "PRINTED");
        });
        outcomes.set(request.requestId, result);
        return result;
      } catch (error) {
        outcomes.set(
          request.requestId,
          error instanceof Error ? error.message : String(error),
        );
        throw error;
      }
    },
  });
  const invite = await worker.invite(challenge.challengeId);
  assert.equal(new URL(invite.url).origin, origin);

  const mobile = async (
    path: string,
    body?: unknown,
    token?: string,
    waiterChallenge?: string,
  ) => {
    const response = await fetch(new URL(path, origin), {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(waiterChallenge ? { "x-waiter-challenge": waiterChallenge } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return {
      status: response.status,
      value: (await response.json()) as Record<string, unknown>,
    };
  };
  const pairing = await mobile("/v1/waiter/pair", {
    tenantId: STORE,
    terminalId: INSTALLATION,
    challengeId: challenge.challengeId,
    pin: "1357",
  });
  assert.equal(pairing.status, 202);
  await worker.tick();
  const pairStatus = await mobile(
    `/v1/waiter/pair/${pairing.value.requestId}`,
    undefined,
    undefined,
    challenge.challengeId,
  );
  assert.equal(pairStatus.value.status, "completed");
  const sessionToken = (pairStatus.value.result as { sessionToken: string })
    .sessionToken;
  assert.ok(sessionToken);

  const stateRequest = randomUUID();
  const stateQueued = await mobile(
    "/v1/waiter/rpc",
    {
      requestId: stateRequest,
      method: "waiter.getState",
      params: {},
    },
    sessionToken,
  );
  assert.equal(stateQueued.status, 202);
  await worker.tick();
  const stateStatus = await mobile(
    `/v1/waiter/requests/${stateQueued.value.requestId}`,
    undefined,
    sessionToken,
  );
  const state = stateStatus.value.result as {
    menu: { products: Array<{ id: string }> };
    tables: Array<{ id: string }>;
  };
  const product = state.menu.products[0];
  assert.ok(product);
  assert.ok(state.tables.some((row) => row.id === table.id));

  const batchId = `batch-${randomUUID()}`;
  const lineId = `line-${randomUUID()}`;
  const batchRequestId = randomUUID();
  const batchPayload = {
    requestId: batchId,
    submittedAt: new Date().toISOString(),
    tableId: table.id,
    expectedOrderId: null,
    lines: [
      { lineId, productId: product.id, quantity: 2, note: "sin cebolla" },
    ],
  };
  const sendBatch = () =>
    mobile(
      "/v1/waiter/rpc",
      {
        requestId: batchRequestId,
        method: "waiter.submitBatch",
        params: batchPayload,
      },
      sessionToken,
    );
  const postBatchAndDiscardMobileReply = async () => {
    const response = await fetch(new URL("/v1/waiter/rpc", origin), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({
        requestId: batchRequestId,
        method: "waiter.submitBatch",
        params: batchPayload,
      }),
    });
    assert.equal(response.status, 202);
    await response.body?.cancel();
  };
  // The relay accepted the request, but the mobile discards the 202 before reading its request ID.
  await postBatchAndDiscardMobileReply();
  // Retrying the same mobile request ID must recover the original queued request.
  const duplicateMobileRequest = await sendBatch();
  const batchQueued = duplicateMobileRequest;
  assert.equal(batchQueued.status, 202);
  assert.equal(
    duplicateMobileRequest.value.requestId,
    batchQueued.value.requestId,
  );

  // The queued mobile call cannot reach the relay while offline, but local cashier operations remain available.
  offline = true;
  await worker.tick();
  const localDraft = repo.createOrder({ type: "TAKEAWAY", customerName: "Mostrador offline", customerPhone: "11 4444-5555" });
  repo.addOrderItem({ orderId: localDraft.id, productId: product.id });
  const localConfirmed = repo.confirmOrder({ orderId: localDraft.id });
  assert.equal(localConfirmed.lifecycleStatus, "CONFIRMED");
  repo.payOrder({ orderId: localDraft.id, payments: [{ methodCode: "CASH", amountMinor: localConfirmed.totalMinor }] });
  assert.equal(repo.getOrder(localDraft.id).paymentStatus, "PAID");
  const localTicket = repo.queuePrint(localDraft.id, "KITCHEN_ORDER");
  assert.equal(repo.getPrintOrder(localTicket.jobId).id, localDraft.id);
  repo.markPrintJob(localTicket.jobId, "PRINTED");
  assert.equal((repo.db.prepare("SELECT status FROM print_jobs WHERE id=?").get(localTicket.jobId) as { status: string }).status, "PRINTED");
  assert.equal(spool.length, 0, "offline local printing does not dispatch the queued remote batch");
  offline = false;
  clock += 3_001;

  loseOneAck = true;
  await worker.tick();
  assert.equal(
    spool.length,
    1,
    `fake spooler did not receive job; worker error: ${worker.connectionError()}, result: ${JSON.stringify(outcomes.get(String(batchQueued.value.requestId)))}`,
  );
  assert.equal(processed.get(String(batchQueued.value.requestId)), 1);
  assert.equal(
    worker.connectionError(),
    "Caja sin comunicación con el servicio de mozos. Revisá Internet.",
  );

  // The first response write was lost before reaching the relay. Worker retries the same cached result.
  clock += 3_001;
  await worker.tick();
  assert.equal(
    processed.get(String(batchQueued.value.requestId)),
    1,
    "response retry must not execute the SQLite transaction or spool twice",
  );
  const batchStatus = await mobile(
    `/v1/waiter/requests/${batchQueued.value.requestId}`,
    undefined,
    sessionToken,
  );
  assert.equal(batchStatus.value.status, "completed");
  assert.equal(
    (batchStatus.value.result as { created: boolean }).created,
    true,
  );
  assert.equal(spool.length, 1);
  assert.equal(spool[0]?.itemCount, 1);
  assert.equal(repo.getWaiterBatch(sessionToken, batchId)?.status, "PRINTED");

  // A durable getBatch status query is read-only and never dispatches another spooler job.
  const batchStatusRequest = await mobile(
    "/v1/waiter/rpc",
    {
      requestId: randomUUID(),
      method: "waiter.getBatch",
      params: { requestId: batchId },
    },
    sessionToken,
  );
  assert.equal(batchStatusRequest.status, 202);
  await worker.tick();
  const durableBatchStatus = await mobile(
    `/v1/waiter/requests/${batchStatusRequest.value.requestId}`,
    undefined,
    sessionToken,
  );
  assert.equal(
    (durableBatchStatus.value.result as { status: string }).status,
    "PRINTED",
  );
  assert.equal(spool.length, 1);

  // The same operator may re-pair through a new single-use QR and get a fresh session.
  const secondChallenge = repo.createWaiterChallenge(waiter.id);
  await worker.invite(secondChallenge.challengeId);
  const secondPair = await mobile("/v1/waiter/pair", {
    tenantId: STORE,
    terminalId: INSTALLATION,
    challengeId: secondChallenge.challengeId,
    pin: "1357",
  });
  assert.equal(secondPair.status, 202);
  await worker.tick();
  const secondPairStatus = await mobile(
    `/v1/waiter/pair/${secondPair.value.requestId}`,
    undefined,
    undefined,
    secondChallenge.challengeId,
  );
  assert.equal(secondPairStatus.value.status, "completed");
  const renewedToken = (
    secondPairStatus.value.result as { sessionToken: string }
  ).sessionToken;
  assert.ok(renewedToken);
  assert.notEqual(renewedToken, sessionToken);
  assert.equal(repo.listWaiterDevices().length, 2);
  assert.equal(spool.length, 1);

  // Reconnect after a >60s delay: the durable batch is held for cashier review with no order/job side effects.
  const countRows = (tableName: "orders" | "print_jobs") =>
    Number((repo.db.prepare(`SELECT COUNT(*) AS n FROM ${tableName}`).get() as { n: number }).n);
  const delayedTable = repo.ensureTable(92);
  const delayedBatchId = `batch-${randomUUID()}`;
  const delayedRpcId = randomUUID();
  const delayedPayload = {
    requestId: delayedBatchId,
    submittedAt: new Date(Date.now() - 61_000).toISOString(),
    tableId: delayedTable.id,
    expectedOrderId: null,
    lines: [{ lineId: `line-${randomUUID()}`, productId: product.id, quantity: 1 }],
  };
  const delayedBeforeOrders = countRows("orders");
  const delayedBeforeJobs = countRows("print_jobs");
  const delayedQueued = await mobile("/v1/waiter/rpc", {
    requestId: delayedRpcId,
    method: "waiter.submitBatch",
    params: delayedPayload,
  }, renewedToken);
  assert.equal(delayedQueued.status, 202);
  await worker.tick();
  const delayedResult = await mobile(`/v1/waiter/requests/${delayedQueued.value.requestId}`, undefined, renewedToken);
  assert.equal((delayedResult.value.result as { status: string }).status, "PENDING_REVIEW");
  assert.equal(repo.listDelayedWaiterBatches().length, 1);
  assert.equal(countRows("orders"), delayedBeforeOrders);
  assert.equal(countRows("print_jobs"), delayedBeforeJobs);
  assert.equal(spool.length, 1);

  // A lost mobile response/retry must recover the same durable result, not create another request/order.
  const delayedRetry = await mobile("/v1/waiter/rpc", {
    requestId: delayedRpcId,
    method: "waiter.submitBatch",
    params: delayedPayload,
  }, renewedToken);
  assert.equal(delayedRetry.value.requestId, delayedQueued.value.requestId);
  await worker.tick();
  assert.equal(countRows("orders"), delayedBeforeOrders);
  assert.equal(countRows("print_jobs"), delayedBeforeJobs);

  const cashierAccepted = repo.confirmDelayedWaiterBatch({ requestId: delayedBatchId });
  assert.equal(cashierAccepted.status, "QUEUED");
  if (cashierAccepted.created && cashierAccepted.printJobId) {
    const jobId = cashierAccepted.printJobId;
    const orderForPrint = repo.getPrintOrder(jobId);
    spool.push({ jobId, orderId: orderForPrint.id, itemCount: orderForPrint.items.length });
    repo.markPrintJob(jobId, "PRINTED");
  }
  const cashierAcceptedAgain = repo.confirmDelayedWaiterBatch({ requestId: delayedBatchId });
  assert.equal(cashierAcceptedAgain.created, false);
  assert.equal(countRows("orders"), delayedBeforeOrders + 1);
  assert.equal(countRows("print_jobs"), delayedBeforeJobs + 1);
  assert.equal(spool.length, 2);

  // Replaying the original >60s payload after acceptance remains idempotent and does not re-enter review.
  const acceptedOldRetry = await mobile("/v1/waiter/rpc", {
    requestId: randomUUID(),
    method: "waiter.submitBatch",
    params: delayedPayload,
  }, renewedToken);
  await worker.tick();
  const acceptedStatus = await mobile(`/v1/waiter/requests/${acceptedOldRetry.value.requestId}`, undefined, renewedToken);
  assert.equal((acceptedStatus.value.result as { status: string }).status, "QUEUED");
  assert.equal(repo.listDelayedWaiterBatches().length, 0);
  assert.equal(countRows("orders"), delayedBeforeOrders + 1);
  assert.equal(countRows("print_jobs"), delayedBeforeJobs + 1);

  const rejectedBatchId = `batch-${randomUUID()}`;
  const rejectedTable = repo.ensureTable(93);
  const rejectedPayload = {
    ...delayedPayload,
    requestId: rejectedBatchId,
    tableId: rejectedTable.id,
    lines: [{ lineId: `line-${randomUUID()}`, productId: product.id, quantity: 1 }],
  };
  await mobile("/v1/waiter/rpc", {
    requestId: randomUUID(),
    method: "waiter.submitBatch",
    params: rejectedPayload,
  }, renewedToken);
  await worker.tick();
  repo.rejectDelayedWaiterBatch({ requestId: rejectedBatchId });
  const rejectedReceipt = repo.submitWaiterBatch(renewedToken, rejectedPayload);
  assert.equal(rejectedReceipt.status, "REJECTED");
  assert.equal(countRows("orders"), delayedBeforeOrders + 1);
  assert.equal(countRows("print_jobs"), delayedBeforeJobs + 1);
  assert.equal(spool.length, 2);

  const order = repo.getOrder(spool[0]!.orderId);
  assert.equal(order.items[0]?.quantity, 2);
  assert.equal(order.items[0]?.notes, "sin cebolla");
  assert.equal(repo.listWaiterDevices().length, 2);
});
