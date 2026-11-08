import { configuredTestRepository } from "./configured-test-repository";
import assert from "node:assert/strict";
import test from "node:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { SqliteGastronomyRepository } from "./sqlite-repository";

function withRepository(run: (repository: SqliteGastronomyRepository) => void) {
  const path = join(tmpdir(), `waiter-mobile-${randomUUID()}.sqlite`);
  const repository = configuredTestRepository(path, { adminPin: "2468", seedStarterCatalog: true });
  try { run(repository); } finally {
    repository.close();
    for (const suffix of ["", "-wal", "-shm"]) rmSync(`${path}${suffix}`, { force: true });
  }
}

test("waiter challenge is short-lived, pairing binds a real waiter to the open shift, and revoke invalidates token", () => {
  withRepository((repository) => {
    repository.openCashSession({ openingAmountMinor: 0 });
    const waiter = repository.createUser({ fullName: "Moza Uno", roleCode: "WAITER", pin: "1357", authorizerPin: "2468" });
    const challenge = repository.createWaiterChallenge(waiter.id);
    assert.notEqual(String((repository.db.prepare("SELECT id FROM waiter_challenges").get() as { id: string }).id), challenge.challengeId, "raw QR challenge must not be stored in SQLite");
    assert.equal(JSON.parse(challenge.qrPayload).challengeId, challenge.challengeId);
    assert.ok(new Date(challenge.expiresAt).getTime() - Date.now() <= 120_000);
    repository.createUser({ fullName: "Mozo Dos", roleCode: "WAITER", pin: "2469", authorizerPin: "2468" });
    assert.throws(() => repository.pairWaiterSession({ challengeId: challenge.challengeId, pin: "2469" }), /PIN de mozo incorrecto/);
    const challengeHash = (repository.db.prepare("SELECT id FROM waiter_challenges").get() as { id: string }).id;
    assert.equal(Number((repository.db.prepare("SELECT attempts FROM waiter_challenges WHERE id=?").get(challengeHash) as { attempts: number }).attempts), 1);
    const paired = repository.pairWaiterSession({ challengeId: challenge.challengeId, pin: "1357" });
    const state = repository.getWaiterSessionState(paired.sessionToken);
    assert.ok(Number.isFinite(Date.parse(state.serverNow)), "waiter state must include an authoritative server clock anchor");
    assert.equal(state.waiter.id, paired.waiter.id);
    assert.ok(state.tables.length > 0);
    assert.ok(state.menu.products.length > 0);
    assert.throws(() => repository.pairWaiterSession({ challengeId: challenge.challengeId, pin: "1357" }), /venció o fue bloqueado/);
    assert.equal(repository.listWaiterDevices().length, 1);
    repository.revokeWaiterDevice(repository.listWaiterDevices()[0]!.id);
    assert.throws(() => repository.getWaiterSessionState(paired.sessionToken), /venció o fue revocada/);
    const renewedChallenge = repository.createWaiterChallenge(waiter.id);
    const renewed = repository.pairWaiterSession({ challengeId: renewedChallenge.challengeId, pin: "1357" });
    repository.resetWaiterAccess();
    assert.throws(() => repository.getWaiterSessionState(renewed.sessionToken), /venció o fue revocada/);
  });
});

test("cash-bound access survives a long shift but close and next shift invalidate reads and writes", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-06T10:00:00Z") });
  withRepository((repository) => {
    const cash = repository.openCashSession({ openingAmountMinor: 0 });
    const waiter = repository.createUser({ fullName: "Mozo turno", roleCode: "WAITER", pin: "1357", authorizerPin: "2468" });
    const paired = repository.pairWaiterSession({ challengeId: repository.createWaiterChallenge(waiter.id).challengeId, pin: "1357" });
    assert.equal(paired.expiresAt, null);
    assert.equal(paired.validUntil, "CASH_CLOSE");
    assert.equal(paired.cashSessionId, cash.id);
    t.mock.timers.tick(13 * 60 * 60_000);
    assert.equal(repository.getWaiterSessionState(paired.sessionToken).cashSessionId, cash.id);
    assert.equal(repository.listWaiterDevices()[0]!.expiresAt, null);
    const unusedQr = repository.createWaiterChallenge(waiter.id);
    repository.closeCashSession({ countedAmountMinor: 0 });
    assert.deepEqual(repository.listWaiterDevices(), []);
    assert.throws(() => repository.getWaiterSessionState(paired.sessionToken));
    repository.openCashSession({ openingAmountMinor: 0 });
    assert.throws(() => repository.pairWaiterSession({ challengeId: unusedQr.challengeId, pin: "1357" }));
    assert.throws(() => repository.getWaiterSessionState(paired.sessionToken));
    assert.throws(() => repository.submitWaiterBatch(paired.sessionToken, { requestId: `closed-${randomUUID()}`, tableId: "none", lines: [] }));
    assert.equal(Number((repository.db.prepare("SELECT COUNT(*) n FROM orders").get() as { n: number }).n), 0);
    assert.equal(Number((repository.db.prepare("SELECT COUNT(*) n FROM print_jobs").get() as { n: number }).n), 0);
  });
});

test("waiter batch requires a live session and persists idempotent receipt", () => {
  withRepository((repository) => {
    repository.openCashSession({ openingAmountMinor: 0 });
    const waiter = repository.createUser({ fullName: "Moza Uno", roleCode: "WAITER", pin: "1357", authorizerPin: "2468" });
    const challenge = repository.createWaiterChallenge(waiter.id);
    const { sessionToken } = repository.pairWaiterSession({ challengeId: challenge.challengeId, pin: "1357" });
    const settings = repository.getSettings();
    settings.printing.kitchen.deviceName = "Kitchen Test";
    settings.printing.kitchen.mode = "SYSTEM_DIRECT";
    repository.saveSettings(settings);
    const table = repository.ensureTable(91);
    const input = { requestId: `batch-${randomUUID()}`, tableId: table.id, submittedAt: new Date().toISOString(),
      lines: [{ lineId: `line-${randomUUID()}`, productId: "starter-muzza-grande", quantity: 1 }] };
    const accepted = repository.submitWaiterBatch(sessionToken, input);
    assert.equal(accepted.status, "QUEUED");
    assert.equal(accepted.created, true);
    assert.deepEqual(repository.getWaiterBatch(sessionToken, input.requestId)?.acceptedLineIds, [input.lines[0]!.lineId]);
    assert.deepEqual(repository.submitWaiterBatch(sessionToken, input).acceptedLineIds, [input.lines[0]!.lineId]);
    assert.equal(repository.submitWaiterBatch(sessionToken, input).created, false);

    repository.markPrintJob(accepted.printJobId!, "FAILED", "offline");
    assert.throws(() => repository.submitWaiterBatch(sessionToken, {
      requestId: `batch-${randomUUID()}`, tableId: table.id, submittedAt: new Date().toISOString(), expectedOrderId: accepted.orderId!,
      lines: [{ lineId: `line-${randomUUID()}`, productId: "starter-muzza-grande", quantity: 1 }],
    }), /comanda móvil fallida/i);
    repository.preparePrintRetry(accepted.printJobId!);
    repository.markPrintJob(accepted.printJobId!, "PRINTED");

    const openOrderId = repository.getWaiterSessionState(sessionToken).tables.find((entry) => entry.id === table.id)?.openOrderId;
    assert.ok(openOrderId);
    const desktopJob = repository.queuePrint(openOrderId!, "KITCHEN_ORDER");
    assert.throws(() => repository.submitWaiterBatch(sessionToken, {
      requestId: `batch-${randomUUID()}`, tableId: table.id, submittedAt: new Date().toISOString(), expectedOrderId: openOrderId,
      lines: [{ lineId: `line-${randomUUID()}`, productId: "starter-muzza-grande", quantity: 1 }],
    }), /comanda anterior/i);
    repository.markPrintJob(desktopJob.jobId, "PRINTED");
    const second = { requestId: `batch-${randomUUID()}`, tableId: table.id, submittedAt: new Date().toISOString(), expectedOrderId: openOrderId,
      lines: [{ lineId: `line-${randomUUID()}`, productId: "starter-muzza-grande", quantity: 2 }] };
    const secondResult = repository.submitWaiterBatch(sessionToken, second);
    assert.equal(secondResult.created, true);
    const secondTicket = repository.getPrintOrder(secondResult.printJobId!);
    assert.equal(secondTicket.items.length, 1);
    assert.equal(secondTicket.items[0]!.quantity, 2, "second job must snapshot only the new quantity delta");
    const snapshot = JSON.parse((repository.db.prepare("SELECT kitchen_snapshot_json FROM print_jobs WHERE id=?").get(secondResult.printJobId!) as { kitchen_snapshot_json: string }).kitchen_snapshot_json);
    assert.deepEqual(snapshot.quantities, { [secondTicket.items[0]!.id]: 3 }, "baseline must include the printed desktop line and this mobile delta");
    const renewalChallenge = repository.createWaiterChallenge(waiter.id);
    const renewed = repository.pairWaiterSession({ challengeId: renewalChallenge.challengeId, pin: "1357" });
    assert.equal(repository.getWaiterBatch(renewed.sessionToken, second.requestId)?.orderId, openOrderId);
    assert.equal(repository.submitWaiterBatch(renewed.sessionToken, second).created, false);
    assert.equal(Number((repository.db.prepare("SELECT COUNT(*) AS n FROM waiter_batch_lines").get() as { n: number }).n), 2);
  });
});

test("waiter pairing and batches work without a kitchen printer and create no phantom print work", () => {
  withRepository((repository) => {
    repository.openCashSession({ openingAmountMinor: 0 });
    const waiter = repository.createUser({ fullName: "Mozo sin comandera", roleCode: "WAITER", pin: "1357", authorizerPin: "2468" });
    const { sessionToken } = repository.pairWaiterSession({ challengeId: repository.createWaiterChallenge(waiter.id).challengeId, pin: "1357" });
    const table = repository.ensureTable(92);
    const input = { requestId: `batch-${randomUUID()}`, tableId: table.id, submittedAt: new Date().toISOString(),
      lines: [{ lineId: `line-${randomUUID()}`, productId: "starter-muzza-grande", quantity: 1 }] };
    const accepted = repository.submitWaiterBatch(sessionToken, input);
    assert.equal(accepted.status, "RECORDED");
    assert.ok(accepted.orderId);
    assert.equal(repository.getOrder(accepted.orderId).lifecycleStatus, "CONFIRMED");
    assert.equal(repository.getWaiterBatch(sessionToken, input.requestId)?.status, "RECORDED");
    assert.equal(accepted.printJobId, null);
    assert.equal(repository.submitWaiterBatch(sessionToken, input).created, false);
    assert.equal(Number((repository.db.prepare("SELECT COUNT(*) AS n FROM print_jobs WHERE kind='KITCHEN_ORDER'").get() as { n: number }).n), 0);
    assert.equal(Number((repository.db.prepare("SELECT COUNT(*) AS n FROM waiter_batches WHERE status='RECORDED'").get() as { n: number }).n), 1);

    // A later cashier approval follows the same path, still without a paper job.
    const next = (quantity: number) => ({ ...input, requestId: randomUUID(), expectedOrderId: accepted.orderId,
      lines: [{ ...input.lines[0]!, lineId: randomUUID(), quantity }] });
    const late = { ...next(2), submittedAt: new Date(Date.now() - 70_000).toISOString() };
    assert.equal(repository.submitWaiterBatch(sessionToken, late).status, "PENDING_REVIEW");
    const approved = repository.confirmDelayedWaiterBatch({ requestId: late.requestId });
    assert.equal(approved.status, "RECORDED");
    assert.equal(approved.printJobId, null);
    assert.equal(repository.confirmDelayedWaiterBatch({ requestId: late.requestId }).created, false);
    assert.equal(repository.getOrder(accepted.orderId).items[0]?.quantity, 3);

    // Adding a printer later must never send old digital batches to the kitchen.
    const settings = repository.getSettings();
    settings.printing.kitchen.mode = "SYSTEM_DIRECT";
    settings.printing.kitchen.deviceName = "Test kitchen";
    repository.saveSettings(settings);
    assert.equal(repository.submitWaiterBatch(sessionToken, input).printJobId, null);
    const printed = repository.submitWaiterBatch(sessionToken, next(1));
    assert.ok(printed.printJobId);
    assert.equal(repository.getPrintOrder(printed.printJobId).items[0]?.quantity, 1);
    assert.equal(repository.getOrder(accepted.orderId).items[0]?.quantity, 4);
  });
});

test("late waiter batches stay pending without side effects until cashier confirms; receipt survives duplicate confirmation", () => {
  withRepository((repository) => {
    repository.openCashSession({ openingAmountMinor: 0 });
    const waiter = repository.createUser({ fullName: "Moza Uno", roleCode: "WAITER", pin: "1357", authorizerPin: "2468" });
    const token = repository.pairWaiterSession({ challengeId: repository.createWaiterChallenge(waiter.id).challengeId, pin: "1357" }).sessionToken;
    const settings = repository.getSettings();
    settings.printing.kitchen.deviceName = "Kitchen Test";
    settings.printing.kitchen.mode = "SYSTEM_DIRECT";
    repository.saveSettings(settings);
    const table = repository.ensureTable(92);
    const input = { requestId: `late-${randomUUID()}`, tableId: table.id, submittedAt: new Date(Date.now()-60_001).toISOString(), lines: [{ lineId: `line-${randomUUID()}`, productId: "starter-muzza-grande", quantity: 1 }] };
    const pending = repository.submitWaiterBatch(token, input);
    assert.equal(pending.status, "PENDING_REVIEW");
    assert.equal(repository.submitWaiterBatch(token, input).created, false);
    const originallyReceived = repository.listDelayedWaiterBatches()[0]!.receivedAt;
    assert.equal(repository.submitWaiterBatch(token, { ...input, submittedAt: new Date().toISOString() }).status, "PENDING_REVIEW", "refreshing a timestamp cannot bypass cashier review");
    assert.equal(repository.listDelayedWaiterBatches()[0]!.receivedAt, originallyReceived);
    assert.equal(repository.listDelayedWaiterBatches().length, 1);
    assert.equal(repository.listDelayedWaiterBatches()[0]!.lines[0]!.name.length > 0, true);
    assert.equal(Number((repository.db.prepare("SELECT COUNT(*) AS n FROM orders").get() as {n:number}).n), 0);
    assert.equal(Number((repository.db.prepare("SELECT COUNT(*) AS n FROM print_jobs").get() as {n:number}).n), 0);
    const confirmed = repository.confirmDelayedWaiterBatch({requestId: input.requestId});
    assert.equal(confirmed.status, "QUEUED");
    assert.equal(repository.confirmDelayedWaiterBatch({requestId: input.requestId}).created, false);
    assert.equal(repository.listDelayedWaiterBatches().length, 0);
    const waiterHash=(repository.db.prepare("SELECT token_hash FROM waiter_sessions WHERE user_id=? ORDER BY created_at LIMIT 1").get(waiter.id) as {token_hash:string}).token_hash;
    repository.revokeWaiterDevice(waiterHash);
    const renewed = repository.pairWaiterSession({ challengeId: repository.createWaiterChallenge(waiter.id).challengeId, pin: "1357" });
    assert.equal(repository.getWaiterBatch(renewed.sessionToken,input.requestId)?.orderId,confirmed.orderId,"renewed same-waiter session can resolve old receipt");
    assert.equal(repository.submitWaiterBatch(renewed.sessionToken,input).created,false,"original delayed request returns accepted receipt after confirmation");
    assert.equal(Number((repository.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action='WAITER_BATCH_CONFIRMED'").get() as {n:number}).n),1);
  });
});

test("future, invalid, and exact-boundary timestamps are handled safely; a failed confirmation keeps the pending review", () => {
  withRepository((repository) => {
    repository.openCashSession({openingAmountMinor:0});
    const waiter=repository.createUser({fullName:"Moza Uno",roleCode:"WAITER",pin:"1357",authorizerPin:"2468"});
    const token=repository.pairWaiterSession({challengeId:repository.createWaiterChallenge(waiter.id).challengeId,pin:"1357"}).sessionToken;
    const table=repository.ensureTable(94);
    const settings=repository.getSettings();
    settings.printing.kitchen.deviceName="Kitchen Test";
    settings.printing.kitchen.mode="SYSTEM_DIRECT";
    repository.saveSettings(settings);
    const item=(requestId:string, submittedAt:string)=>({requestId,tableId:table.id,submittedAt,lines:[{lineId:`line-${randomUUID()}`,productId:"starter-muzza-grande",quantity:1}]});
    const realNow=Date.now;
    const fixedNow=1_800_000_000_000;
    Date.now=()=>fixedNow;
    try { assert.equal(repository.submitWaiterBatch(token,item(`exact-${randomUUID()}`,new Date(fixedNow-60_000).toISOString())).status,"QUEUED"); }
    finally { Date.now=realNow; }
    assert.equal(repository.submitWaiterBatch(token,item(`future-${randomUUID()}`,new Date(Date.now()+30_000).toISOString())).status,"PENDING_REVIEW");
    assert.equal(repository.submitWaiterBatch(token,item(`invalid-${randomUUID()}`,"not-a-timestamp")).status,"PENDING_REVIEW");
    const delayed=item(`rollback-${randomUUID()}`,new Date(Date.now()-61_000).toISOString());
    repository.submitWaiterBatch(token,delayed);
    repository.db.prepare("UPDATE restaurant_tables SET active=0 WHERE id=?").run(table.id);
    assert.throws(()=>repository.confirmDelayedWaiterBatch({requestId:delayed.requestId}),/mesa no existe o está inactiva/i);
    assert.equal((repository.db.prepare("SELECT status FROM waiter_pending_batches WHERE request_id=?").get(delayed.requestId) as {status:string}).status,"PENDING_REVIEW");
    assert.equal(Number((repository.db.prepare("SELECT COUNT(*) AS n FROM orders").get() as {n:number}).n),1,"only the timely boundary order exists");
  });
});

test("missing or future waiter timestamps fail safe into pending review, and rejection reserves request and lines", () => {
  withRepository((repository) => {
    repository.openCashSession({ openingAmountMinor: 0 });
    const waiter = repository.createUser({ fullName: "Moza Uno", roleCode: "WAITER", pin: "1357", authorizerPin: "2468" });
    const token = repository.pairWaiterSession({ challengeId: repository.createWaiterChallenge(waiter.id).challengeId, pin: "1357" }).sessionToken;
    const table = repository.ensureTable(93);
    const settings=repository.getSettings();
    settings.printing.kitchen.deviceName="Kitchen Test";
    settings.printing.kitchen.mode="SYSTEM_DIRECT";
    repository.saveSettings(settings);
    const lineId = `line-${randomUUID()}`;
    const input = { requestId: `missing-${randomUUID()}`, tableId: table.id, lines: [{ lineId, productId: "starter-muzza-grande", quantity: 1 }] };
    assert.equal(repository.submitWaiterBatch(token, input).status, "PENDING_REVIEW");
    assert.throws(() => repository.submitWaiterBatch(token, {requestId:`pending-replay-${randomUUID()}`,tableId:table.id,submittedAt:new Date().toISOString(),lines:input.lines}),/ya fueron recibidas/);
    repository.rejectDelayedWaiterBatch({requestId: input.requestId});
    assert.equal(repository.submitWaiterBatch(token, input).status, "REJECTED");
    assert.throws(() => repository.submitWaiterBatch(token, {requestId: `replacement-${randomUUID()}`, tableId: table.id, submittedAt: new Date().toISOString(), lines: [{...input.lines[0]!, lineId}]}), /ya fueron recibidas/);
    const closedShiftRequest={requestId:`closed-${randomUUID()}`,tableId:table.id,lines:[{lineId:`line-${randomUUID()}`,productId:"starter-muzza-grande",quantity:1}]};
    repository.submitWaiterBatch(token,closedShiftRequest);
    repository.db.prepare("UPDATE cash_sessions SET status='CLOSED',closed_at=? WHERE status='OPEN'").run(new Date().toISOString());
    repository.rejectDelayedWaiterBatch({requestId:closedShiftRequest.requestId});
    assert.equal(Number((repository.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action='WAITER_BATCH_REJECTED'").get() as {n:number}).n),2);
  });
});

test("waiter role cannot review delayed batches",()=>{
  withRepository((repository)=>{
    repository.openCashSession({openingAmountMinor:0});
    repository.db.prepare("UPDATE users SET role_id=(SELECT id FROM roles WHERE code='WAITER') WHERE id='user-admin'").run();
    assert.throws(()=>repository.listDelayedWaiterBatches(),/Sólo administración o caja/);
    assert.throws(()=>repository.confirmDelayedWaiterBatch({requestId:"none"}),/Sólo administración o caja/);
    assert.throws(()=>repository.rejectDelayedWaiterBatch({requestId:"none"}),/Sólo administración o caja/);
  });
});

test("pending review survives repository restart and remains visible after waiter sessions are revoked",()=>{
  const path=join(tmpdir(),`waiter-pending-restart-${randomUUID()}.sqlite`);
  const first=configuredTestRepository(path,{adminPin:"2468",seedStarterCatalog:true});
  let requestId="";
  try {
    first.openCashSession({openingAmountMinor:0});
    const settings = first.getSettings();
    settings.printing.kitchen.deviceName = "Kitchen Test";
    settings.printing.kitchen.mode = "SYSTEM_DIRECT";
    first.saveSettings(settings);
    const waiter=first.createUser({fullName:"Moza Persistente",roleCode:"WAITER",pin:"1357",authorizerPin:"2468"});
    const token=first.pairWaiterSession({challengeId:first.createWaiterChallenge(waiter.id).challengeId,pin:"1357"}).sessionToken;
    requestId=`restart-${randomUUID()}`;
    first.submitWaiterBatch(token,{requestId,tableId:first.ensureTable(95).id,lines:[{lineId:`line-${randomUUID()}`,productId:"starter-muzza-grande",quantity:1}]});
  } finally { first.close(); }
  const restored=configuredTestRepository(path,{adminPin:"2468",seedStarterCatalog:true});
  try {
    assert.ok(restored.listDelayedWaiterBatches().some((batch)=>batch.requestId===requestId));
    const receipt = restored.confirmDelayedWaiterBatch({ requestId });
    assert.equal(receipt.created, true);
    assert.equal(restored.confirmDelayedWaiterBatch({ requestId }).created, false);
    assert.equal(Number((restored.db.prepare("SELECT COUNT(*) AS n FROM print_jobs").get() as { n: number }).n), 1);
  }
  finally { restored.close(); for(const suffix of ["","-wal","-shm"]) rmSync(`${path}${suffix}`,{force:true}); }
});

test("expired challenges, legacy timed sessions, and closed shifts are not reusable or listed as active devices", () => {
  withRepository((repository) => {
    const cash = repository.openCashSession({ openingAmountMinor: 0 });
    const waiter = repository.createUser({ fullName: "Moza Uno", roleCode: "WAITER", pin: "1357", authorizerPin: "2468" });
    const challenge = repository.createWaiterChallenge(waiter.id);
    const hash = (repository.db.prepare("SELECT id FROM waiter_challenges").get() as { id: string }).id;
    repository.db.prepare("UPDATE waiter_challenges SET expires_at=? WHERE id=?").run(new Date(Date.now() - 1000).toISOString(), hash);
    assert.throws(() => repository.pairWaiterSession({ challengeId: challenge.challengeId, pin: "1357" }), /venció o fue bloqueado/);
    const rateLimited = repository.createWaiterChallenge(waiter.id);
    for (let attempt = 0; attempt < 5; attempt++)
      assert.throws(() => repository.pairWaiterSession({ challengeId: rateLimited.challengeId, pin: "9999" }), /PIN de mozo incorrecto/);
    assert.throws(() => repository.pairWaiterSession({ challengeId: rateLimited.challengeId, pin: "1357" }), /venció o fue bloqueado/);
    const renewed = repository.createWaiterChallenge(waiter.id);
    const session = repository.pairWaiterSession({ challengeId: renewed.challengeId, pin: "1357" });
    const deviceId = repository.listWaiterDevices()[0]!.id;
    repository.db.prepare("UPDATE waiter_sessions SET expires_on_cash_close=0,expires_at=? WHERE token_hash=?").run(new Date(Date.now() - 1000).toISOString(), deviceId);
    assert.deepEqual(repository.listWaiterDevices(), []);
    assert.throws(() => repository.getWaiterSessionState(session.sessionToken), /venció o fue revocada/);
    const current = repository.pairWaiterSession({ challengeId: (repository.createWaiterChallenge(waiter.id)).challengeId, pin: "1357" });
    assert.equal(repository.listWaiterDevices().length, 1);
    repository.db.prepare("UPDATE cash_sessions SET status='CLOSED',closed_at=? WHERE id=?").run(new Date().toISOString(), cash.id);
    assert.deepEqual(repository.listWaiterDevices(), []);
    assert.throws(() => repository.getWaiterSessionState(current.sessionToken));
  });
});

test("POS restart preserves cash-bound access only, without reviving legacy credentials", () => {
  const path = join(tmpdir(), `waiter-restart-${randomUUID()}.sqlite`);
  const first = configuredTestRepository(path, { adminPin: "2468", seedStarterCatalog: true });
  let token = "";
  let legacyToken = "";
  try {
    first.openCashSession({ openingAmountMinor: 0 });
    const waiter = first.createUser({ fullName: "Moza Uno", roleCode: "WAITER", pin: "1357", authorizerPin: "2468" });
    token = first.pairWaiterSession({ challengeId: first.createWaiterChallenge(waiter.id).challengeId, pin: "1357" }).sessionToken;
    legacyToken = first.pairWaiterSession({ challengeId: first.createWaiterChallenge(waiter.id).challengeId, pin: "1357" }).sessionToken;
    first.db.prepare("UPDATE waiter_sessions SET expires_on_cash_close=0,expires_at=? WHERE token_hash=?").run(new Date(Date.now()+60_000).toISOString(), createHash("sha256").update(legacyToken).digest("hex"));
  } finally { first.close(); }
  const restored = configuredTestRepository(path, { adminPin: "2468", seedStarterCatalog: true });
  try {
    assert.equal(restored.getWaiterSessionState(token).validUntil, "CASH_CLOSE");
    assert.throws(() => restored.getWaiterSessionState(legacyToken), /venció o fue revocada/);
    assert.equal(restored.listWaiterDevices().length, 1);
  }
  finally {
    restored.close();
    for (const suffix of ["", "-wal", "-shm"]) rmSync(`${path}${suffix}`, { force: true });
  }
});
