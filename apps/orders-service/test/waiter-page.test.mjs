import { test } from "node:test";
import assert from "node:assert/strict";
import { waiterHtml } from "../dist/waiter-page.js";
const scriptTokens = waiterHtml.replace(/\s+/g, "");

test("waiter page is mobile-first and consumes only the invitation fragment", () => {
  assert.match(waiterHtml, /name="viewport"/);
  assert.match(waiterHtml, /location\.hash/);
  assert.match(waiterHtml, /fragment\.get\('challenge'\)/);
  assert.doesNotMatch(waiterHtml, /location\.search/);
  assert.match(waiterHtml, /inputmode="numeric"/);
});

test("waiter page persists draft and stable uncertain batch id, not credentials in local storage", () => {
  assert.match(scriptTokens, /localStorage\.setItem\(DRAFT_KEY/);
  assert.match(scriptTokens, /localStorage\.setItem\(PENDING_KEY/);
  assert.match(scriptTokens, /safeSet\(sessionStorage,TOKEN_KEY,token\)/);
  assert.doesNotMatch(scriptTokens, /localStorage\.setItem\(TOKEN_KEY/);
  assert.match(waiterHtml, /No se volverá a enviar automáticamente/);
  assert.match(waiterHtml, /el mismo identificador/);
  assert.match(scriptTokens, /expectedOrderId:draft\.expectedOrderId\?\?null/);
  assert.match(scriptTokens, /waiter:draft:v1:'\+scope/);
  assert.match(scriptTokens, /submittedAt:newDate\(\)\.toISOString\(\)/);
  assert.match(scriptTokens, /submittedAt:record\.submittedAt/);
  assert.match(scriptTokens, /waiter:pending:v1:'\+encodeURIComponent\(tenantId\)/);
  assert.match(waiterHtml, /Reintentar misma tanda/);
  assert.match(
    scriptTokens,
    /expectedCashSessionId:state\.cashSessionId\?\?null/,
  );
  assert.match(waiterHtml, /waiter\.submitBatch/);
  assert.match(waiterHtml, /waiter\.getBatch/);
  assert.match(waiterHtml, /Pendiente de revisión en caja; aún no enviada a cocina/);
  assert.match(waiterHtml, /Tanda demorada o con hora no verificable/);
  assert.match(waiterHtml, /El vínculo expiró o fue revocado/);
  assert.match(scriptTokens, /constcurrent=awaitrpc\('waiter\.getBatch'/);
});

test("waiter page exposes table, menu, batch and print status workflows", () => {
  for (const fragment of [
    'id="table"',
    'id="categories"',
    'id="products"',
    "waiter.submitBatch",
    "waiter.getBatch",
    "Impresión",
  ]) {
    assert.ok(waiterHtml.includes(fragment), `missing ${fragment}`);
  }
  assert.match(waiterHtml, /type="password"/);
  assert.match(waiterHtml, /Nota para cocina/);
  assert.match(waiterHtml, /waiter:watch:v1/);
  assert.match(waiterHtml, /La mesa del borrador ya no está disponible/);
  assert.match(
    scriptTokens,
    /history\.replaceState\(null,'',location\.pathname\)/,
  );
});

function runUpdateBatch(d, { cashSessionId = "cash-a" } = {}) {
  const match = waiterHtml.match(
    /function updateBatch\(d\) \{([\s\S]*?)\n        \}\n        function closeOldPending/,
  );
  assert.ok(match, "updateBatch implementation is present");
  const nodes = new Map();
  for (const id of ["pendingCard", "pendingText", "retryPending", "closeOldPending"])
    nodes.set(id, { hidden: true, textContent: "" });
  const calls = { accepted: 0, removed: 0, messages: [] };
  const record = {
    requestId: "stable-request-123",
    expectedCashSessionId: "cash-a",
    lines: [{ lineId: "line-1" }],
  };
  const execute = new Function(
    "d", "pending", "el", "state", "applyAccepted", "safeRemove", "setMsg", "render", "localStorage", "PENDING_KEY",
    `let oldShiftNotFoundId = ''; let oldShiftNotFoundSessionId = ''; ${match[1]} return { id: oldShiftNotFoundId, sessionId: oldShiftNotFoundSessionId };`,
  );
  const oldShiftState = execute(
    d,
    () => record,
    (id) => nodes.get(id),
    { cashSessionId },
    () => calls.accepted++,
    () => calls.removed++,
    (...args) => calls.messages.push(args),
    () => {},
    {},
    "pending-key",
  );
  return { nodes, calls, oldShiftState };
}

test("FAILED print status with accepted lines remains accepted, not rejected", () => {
  const { calls } = runUpdateBatch({
    requestId: "stable-request-123",
    status: "FAILED",
    acceptedLineIds: ["line-1"],
    error: "printer offline",
  });
  assert.equal(calls.accepted, 1);
  assert.equal(calls.removed, 0);
});

test("cross-shift NOT_FOUND is inspect-only and does not offer retry", () => {
  const { nodes, calls } = runUpdateBatch(
    { requestId: "stable-request-123", status: "NOT_FOUND" },
    { cashSessionId: "cash-b" },
  );
  assert.equal(nodes.get("retryPending").hidden, true);
  assert.equal(nodes.get("closeOldPending").hidden, false);
  assert.deepEqual(calls.removed, 0);
  assert.equal(calls.removed, 0);
  assert.match(nodes.get("pendingText").textContent, /consultá en caja/);
  assert.equal(calls.removed, 0);
  const sameShift = runUpdateBatch(
    { requestId: "stable-request-123", status: "NOT_FOUND" },
    { cashSessionId: "cash-a" },
  );
  assert.equal(sameShift.nodes.get("closeOldPending").hidden, true);
  const review = runUpdateBatch(
    { requestId: "stable-request-123", status: "PENDING_REVIEW" },
    { cashSessionId: "cash-b" },
  );
  assert.equal(review.nodes.get("closeOldPending").hidden, true);
});

test("old-shift close requires authoritative NOT_FOUND, explicit confirmation and matching pending id", () => {
  const match = waiterHtml.match(
    /function closeOldPending\(\) \{([\s\S]*?)\n        \}\n        async function checkPrint/,
  );
  assert.ok(match, "closeOldPending implementation is present");
  const record = {
    requestId: "old-request",
    expectedCashSessionId: "cash-old",
    tableId: "old-table",
    lines: [{ lineId: "old-line" }],
  };
  function close({ id = "old-request", confirmed = true, active = "cash-new" } = {}) {
    const removedKeys = [];
    const nodes = new Map([
      ["pendingCard", { hidden: false }],
      ["closeOldPending", { hidden: false }],
    ]);
    const execute = new Function(
      "pending", "state", "oldShiftNotFoundId", "oldShiftNotFoundSessionId", "confirm", "safeRemove", "localStorage", "PENDING_KEY", "el", "setMsg", "render",
      match[1],
    );
    execute(
      () => ({ ...record, requestId: id }),
      { cashSessionId: active },
      "old-request",
      active === "cash-new" ? "cash-new" : "cash-new",
      () => confirmed,
      (_storage, key) => removedKeys.push(key),
      {},
      "waiter-pending-key",
      (key) => nodes.get(key),
      () => {},
      () => {},
    );
    return { removedKeys, nodes };
  }
  assert.deepEqual(close({ confirmed: false }).removedKeys, []);
  assert.deepEqual(close({ id: "new-request" }).removedKeys, []);
  assert.deepEqual(close({ active: "cash-third" }).removedKeys, []);
  const result = close();
  assert.deepEqual(result.removedKeys, ["waiter-pending-key"]);
  assert.equal(result.nodes.get("pendingCard").hidden, true);
});

test("explicit REJECTED status clears pending while generic error does not", () => {
  const rejected = runUpdateBatch({ requestId: "stable-request-123", status: "REJECTED" });
  assert.equal(rejected.calls.removed, 1);
  const uncertain = runUpdateBatch({ requestId: "stable-request-123", status: "UNKNOWN", error: "temporary" });
  assert.equal(uncertain.calls.removed, 0);
  assert.equal(uncertain.calls.accepted, 0);
});

test("accepted receipt from an older cash session clears only accepted lines and preserves current table state", () => {
  const match = waiterHtml.match(
    /function applyAccepted\(record, d\) \{([\s\S]*?)\n        \}\n        function updateBatch/,
  );
  assert.ok(match, "applyAccepted implementation is present");
  const draft = {
    tableId: "table-1",
    expectedOrderId: "current-order",
    lines: [{ lineId: "line-accepted" }, { lineId: "line-unaccepted" }],
  };
  const state = {
    cashSessionId: "new-shift",
    tables: [{ id: "table-1", openOrderId: "current-order" }],
  };
  const calls = { removed: 0, messages: [] };
  const nodes = new Map([
    ["pendingCard", { hidden: false }],
    ["retryPending", { hidden: false }],
  ]);
  const execute = new Function(
    "record", "d", "state", "draft", "saveDraft", "safeRemove", "el", "PENDING_KEY",
    "setMsg", "saveWatch", "schedulePrintCheck", "render", "localStorage",
    match[1],
  );
  execute(
    {
      requestId: "older-request",
      tableId: "table-1",
      expectedCashSessionId: "old-shift",
      lines: [{ lineId: "line-accepted" }, { lineId: "line-unaccepted" }],
    },
    { acceptedLineIds: ["line-accepted"], orderId: "old-order", status: "printed" },
    state,
    draft,
    () => {},
    () => calls.removed++,
    (id) => nodes.get(id),
    "pending-key",
    (...args) => calls.messages.push(args),
    () => {},
    () => {},
    () => {},
    {},
  );
  assert.equal(state.tables[0].openOrderId, "current-order");
  assert.equal(draft.expectedOrderId, "current-order");
  assert.deepEqual(draft.lines.map((line) => line.lineId), ["line-unaccepted"]);
  assert.equal(calls.removed, 1);
  assert.match(calls.messages[0][1], /turno anterior/);
});
