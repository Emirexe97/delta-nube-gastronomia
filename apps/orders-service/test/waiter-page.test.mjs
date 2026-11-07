import { test } from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { waiterHtml } from "../src/waiter-page.ts";
const scriptTokens = waiterHtml.replace(/\s+/g, "");

test("mobile UUID fallback uses cryptographic randomness and preserves UUID v4 shape", () => {
  const match = waiterHtml.match(/function newRequestId\(\) \{([\s\S]*?)\n        \}/);
  assert.ok(match);
  const generate = new Function("crypto", match[1]);
  const crypto = { getRandomValues: (bytes) => webcrypto.getRandomValues(bytes) };
  const ids = new Set(Array.from({ length: 100 }, () => generate(crypto)));
  assert.equal(ids.size, 100);
  for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.doesNotMatch(match[1], /Math\.random\s*\(/);
});

test("waiter page is mobile-first and consumes only the invitation fragment", () => {
  assert.match(waiterHtml, /name="viewport"/);
  assert.match(waiterHtml, /location\.hash/);
  assert.match(waiterHtml, /fragment\.get\('challenge'\)/);
  assert.doesNotMatch(waiterHtml, /location\.search/);
  assert.match(waiterHtml, /inputmode="numeric"/);
});

test("waiter page uses the shared orange theme and compact accessible help", () => {
  assert.match(waiterHtml, /--dn-color-background: #f5f7fa/);
  assert.match(waiterHtml, /--dn-color-primary: #c2410c/);
  assert.match(waiterHtml, /--dn-color-primary/);
  assert.match(waiterHtml, /max-width: 380px/);
  assert.match(waiterHtml, /min-height: 44px/);
  assert.match(waiterHtml, /\.help-trigger/);
  assert.match(waiterHtml, /aria-controls="help-table"/);
  assert.match(waiterHtml, /event\.key === 'Escape'/);
  assert.match(waiterHtml, /window\.innerWidth - width - margin/);
  assert.match(waiterHtml, /document\.addEventListener\('click'/);
  assert.doesNotMatch(waiterHtml, /var\(--green\)|Tanda pendiente|misma tanda/i);
});

test("waiter page avoids rewriting an unchanged empty draft during rerenders", () => {
  assert.match(waiterHtml, /const previousDraftTableId = draft\.tableId/);
  assert.match(waiterHtml, /if \(draft\.tableId !== previousDraftTableId \|\| draft\.expectedOrderId !== expectedOrderId\)/);
  assert.doesNotMatch(waiterHtml.match(/\.sticky \{[\s\S]*?\}/)?.[0] || '', /backdrop-filter/);
  assert.match(waiterHtml, /box-shadow: 0 1px 2px/);
  assert.match(waiterHtml, /#table \{ font-weight: 650; \}/);
});

test("catalog and table rendering skips DOM rebuilds for quantity-only rerenders", () => {
  const match = waiterHtml.match(/function renderIfChanged\(node, signature, build\) \{([\s\S]*?)\n        \}/);
  assert.ok(match, "cached renderer helper exists");
  const renderIfChanged = new Function("renderedSignatures", `return function renderIfChanged(node, signature, build) {${match[1]}\n}`)(new WeakMap());
  const node = {};
  let rebuilds = 0;
  const build = () => { rebuilds++; };
  renderIfChanged(node, '["table-1"]', build); // first state render
  renderIfChanged(node, '["table-1"]', build); // quantity-only rerender
  assert.equal(rebuilds, 1, "unchanged input keeps the same rendered children");
  renderIfChanged(node, '["table-1","table-2"]', build); // table/catalog input changed
  assert.equal(rebuilds, 2);
  assert.match(waiterHtml, /const productSignature = JSON\.stringify\(\[selectedCategory, visibleProducts\]\)/);
  assert.match(waiterHtml, /const categorySignature = JSON\.stringify\(cats\.map/);
  assert.match(waiterHtml, /const tableSignature = JSON\.stringify\(\[ts, missingTable \? draft\.tableId : null\]\)/);
});

test("waiter page labels cash-close sessions without an artificial expiry", () => {
  assert.match(waiterHtml, /Hasta el cierre de caja/);
  assert.match(waiterHtml, /state\.validUntil === 'CASH_CLOSE'/);
  assert.match(waiterHtml, /Sesión hasta/);
});

test("waiter page persists draft and stable uncertain batch id, not credentials in local storage", () => {
  assert.match(scriptTokens, /localStorage\.setItem\(DRAFT_KEY/);
  assert.match(scriptTokens, /localStorage\.setItem\(PENDING_KEY/);
  assert.match(scriptTokens, /safeSet\(sessionStorage,TOKEN_KEY,token\)/);
  assert.doesNotMatch(scriptTokens, /localStorage\.setItem\(TOKEN_KEY/);
  assert.match(scriptTokens, /requestId:record.requestId/);
  assert.match(scriptTokens, /lines:record.lines/);
  assert.match(scriptTokens, /expectedOrderId:draft\.expectedOrderId\?\?null/);
  assert.match(scriptTokens, /waiter:draft:v1:'\+scope/);
  assert.match(scriptTokens, /submittedAt:estimateServerTimestamp\(serverClockAnchor,performance\.now\(\),Date\.now\(\)\)/);
  assert.match(scriptTokens, /submittedAt:record\.submittedAt/);
  assert.match(scriptTokens, /waiter:pending:v1:'\+encodeURIComponent\(tenantId\)/);
  assert.match(waiterHtml, /Volver a intentar/);
  assert.match(
    scriptTokens,
    /expectedCashSessionId:state\.cashSessionId\?\?null/,
  );
  assert.match(waiterHtml, /waiter\.submitBatch/);
  assert.match(waiterHtml, /waiter\.getBatch/);
  assert.match(waiterHtml, /Pedido pendiente de revisión/);
  assert.match(waiterHtml, /Todavía no se envió a cocina/);
  assert.match(waiterHtml, /El vínculo expiró o fue revocado/);
  assert.match(scriptTokens, /constcurrent=awaitrpc\('waiter\.getBatch'/);
});

test("server-anchored submission time ignores device wall-clock offset and uses conservative elapsed time", () => {
  const anchorMatch = waiterHtml.match(/function createServerClockAnchor\(serverNow, monotonicAtReceipt, wallAtReceipt\) \{([\s\S]*?)\n        \}/);
  const estimateMatch = waiterHtml.match(/function estimateServerTimestamp\(anchor, monotonicNow, wallNow\) \{([\s\S]*?)\n        \}/);
  assert.ok(anchorMatch, "clock anchor helper exists");
  assert.ok(estimateMatch, "timestamp estimate helper exists");
  const createAnchor = new Function("serverNow", "monotonicAtReceipt", "wallAtReceipt", anchorMatch[1]);
  const estimate = new Function("anchor", "monotonicNow", "wallNow", estimateMatch[1]);
  const serverNow = "2026-11-06T15:00:00.000Z";
  const aheadPhone = createAnchor(serverNow, 10_000, Date.parse("2099-01-01T00:00:00.000Z"));
  const behindPhone = createAnchor(serverNow, 10_000, Date.parse("1999-01-01T00:00:00.000Z"));
  assert.equal(estimate(aheadPhone, 10_250, Date.parse("2099-01-01T00:00:00.250Z")), serverNow.slice(0, -5) + ".250Z");
  assert.equal(estimate(behindPhone, 10_250, Date.parse("1999-01-01T00:00:00.250Z")), serverNow.slice(0, -5) + ".250Z");

  const timestamp = estimate(aheadPhone, 71_000, Date.parse("2099-01-01T00:01:01.000Z"));
  assert.equal(timestamp, "2026-11-06T15:01:01.000Z");
  const pendingRecord = { submittedAt: timestamp };
  const immutableTimestamp = pendingRecord.submittedAt;
  // Retry resends the saved record; clock resync after 61s must not rewrite it.
  assert.match(scriptTokens, /submittedAt:record\.submittedAt/);
  assert.equal(pendingRecord.submittedAt, immutableTimestamp);

  const backwardWallAnchor = createAnchor(serverNow, 0, Date.parse("2099-01-01T00:00:00.000Z"));
  assert.equal(estimate(backwardWallAnchor, 61_000, Date.parse("2098-12-31T23:59:00.000Z")), "2026-11-06T15:01:01.000Z");
  assert.equal(createAnchor(undefined, 0, Date.now()), null);
  assert.equal(estimate(null, 1, 1), null);
  assert.match(scriptTokens, /createServerClockAnchor\(state\?\.serverNow,performance\.now\(\),Date\.now\(\)\)/);
});

test("waiter page exposes table, menu, batch and print status workflows", () => {
  for (const fragment of [
    'id="table"',
    'id="categories"',
    'id="products"',
    "waiter.submitBatch",
    "waiter.getBatch",
    "Último envío",
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
  for (const id of ["pendingCard", "pendingTitle", "pendingText", "retryPending", "closeOldPending", "printCard", "appMessage"])
    nodes.set(id, { hidden: true, textContent: "" });
  const calls = { accepted: 0, removed: 0, messages: [] };
  const record = {
    requestId: "stable-request-123",
    expectedCashSessionId: "cash-a",
    lines: [{ lineId: "line-1" }],
  };
  const execute = new Function(
    "d", "pending", "el", "state", "applyAccepted", "safeRemove", "setMsg", "render", "localStorage", "PENDING_KEY", "showPending",
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
    (title, text) => {
      nodes.get("pendingCard").hidden = false;
      nodes.get("pendingTitle").textContent = title;
      nodes.get("pendingText").textContent = text;
    },
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

test("pending action stays available even without draft lines; only sending disables it", () => {
  const match = waiterHtml.match(/function primaryAction\(hasPending, isBusy, hasLines, isChecking = false\) \{([\s\S]*?)\n        \}/);
  assert.ok(match);
  const action = new Function("hasPending", "isBusy", "hasLines", "isChecking = false", match[1]);
  assert.deepEqual(action(true, false, false), { disabled: false, label: "Ver estado del pedido" });
  assert.deepEqual(action(false, true, true), { disabled: true, label: "Enviando…" });
  assert.equal(action(false, false, false).disabled, true);
  assert.equal(action(false, false, true).disabled, false);
  assert.deepEqual(action(true, false, true, true), { disabled: true, label: "Consultando…" });
  assert.match(scriptTokens, /el\('send'\)\.onclick=pending\(\)\?\(\)=>checkPending\(true\):sendBatch/);
});

test("manual status guidance focuses and reveals the visible result with reduced-motion support", () => {
  const match = waiterHtml.match(/function revealOrderStatus\(\) \{([\s\S]*?)\n        \}/);
  assert.ok(match);
  const calls = [];
  const nodes = Object.fromEntries(['app', 'pendingCard', 'printCard', 'appMessage', 'pairMessage'].map(id => [id, {
    hidden: id !== 'app' && id !== 'pendingCard',
    focus: options => calls.push([id, 'focus', options]),
    scrollIntoView: options => calls.push([id, 'scroll', options]),
  }]));
  const reveal = new Function('el', 'window', match[1]);
  reveal(id => nodes[id], { matchMedia: () => ({ matches: false }) });
  assert.deepEqual(calls, [['pendingCard', 'focus', { preventScroll: true }], ['pendingCard', 'scroll', { block: 'center', behavior: 'smooth' }]]);
  calls.length = 0; nodes.pendingCard.hidden = true; nodes.printCard.hidden = false;
  reveal(id => nodes[id], { matchMedia: () => ({ matches: true }) });
  assert.equal(calls[0][0], 'printCard');
  assert.equal(calls[1][2].behavior, 'instant');
  calls.length = 0; nodes.app.hidden = true; nodes.pairMessage.hidden = false;
  reveal(id => nodes[id], { matchMedia: () => ({ matches: false }) });
  assert.equal(calls[0][0], 'pairMessage');
});

test("manual pending lookup guides to result, background lookup does not scroll and concurrent clicks do not requery", async () => {
  const match = waiterHtml.match(/async function checkPending\(reveal = false\) \{([\s\S]*?)\n        \}\n        el\('checkPending'\)/);
  assert.ok(match);
  const create = new Function('pending', 'showPending', 'el', 'render', 'rpc', 'updateBatch', 'revealOrderStatus',
    `let checkingPending = false; let oldShiftNotFoundId = ''; return async function(reveal = false) { ${match[1]} };`);
  let queries = 0, reveals = 0, updates = 0, resolveRpc;
  const response = new Promise(resolve => { resolveRpc = resolve; });
  const check = create(() => ({ requestId: 'same-order' }), () => {}, () => ({}), () => {},
    () => { queries++; return response; }, () => { updates++; }, () => { reveals++; });
  const first = check(true);
  await check(true);
  assert.equal(queries, 1);
  assert.equal(reveals, 1);
  resolveRpc({ status: 'PENDING_REVIEW' }); await first;
  assert.equal(reveals, 2); assert.equal(updates, 1);
  await check();
  assert.equal(queries, 2); assert.equal(reveals, 2);
});

test("failed lookup releases pending controls and still reveals feedback", async () => {
  const match = waiterHtml.match(/async function checkPending\(reveal = false\) \{([\s\S]*?)\n        \}\n        el\('checkPending'\)/);
  const create = new Function('pending', 'showPending', 'el', 'render', 'rpc', 'updateBatch', 'revealOrderStatus',
    `let checkingPending = false; let oldShiftNotFoundId = ''; return async function(reveal = false) { ${match[1]} };`);
  let queries = 0, reveals = 0; const messages = [];
  const check = create(() => ({ requestId: 'same-order' }), title => messages.push(title), () => ({}), () => {},
    async () => { queries++; throw new Error('not_found'); }, () => { throw new Error('must not accept'); }, () => { reveals++; });
  await check(true); await check(true);
  assert.equal(queries, 2); assert.equal(reveals, 4);
  assert.equal(messages.at(-1), 'No pudimos comprobarlo');
});

test("pending review explains the required action without technical details or allowing retry", () => {
  const { nodes, calls } = runUpdateBatch({ requestId: "stable-request-123", status: "PENDING_REVIEW" });
  assert.equal(nodes.get("pendingTitle").textContent, "Pedido pendiente de revisión");
  assert.match(nodes.get("pendingText").textContent, /no se envió a cocina/);
  assert.equal(nodes.get("retryPending").hidden, true);
  assert.equal(calls.removed, 0);
  assert.equal(calls.accepted, 0);
});

test("unknown replies do not expose IDs, server errors or raw statuses", () => {
  const { nodes, calls } = runUpdateBatch({ requestId: "stable-request-123", status: "INTERNAL_STATUS", error: "SQLITE error internal" });
  const visible = [...nodes.values()].map(n => n.textContent).join(" ");
  assert.match(visible, /Ver estado/);
  assert.doesNotMatch(visible, /stable-request|INTERNAL_STATUS|SQLITE/);
  assert.equal(nodes.get("retryPending").hidden, true);
  assert.equal(calls.removed, 0);
});

test("page puts pending recovery before menu and hides empty redundant status cards", () => {
  assert.ok(waiterHtml.indexOf('id="pendingCard"') < waiterHtml.indexOf('id="products"'));
  assert.match(waiterHtml, /id="printCard"[^>]*hidden/);
  assert.match(waiterHtml, /id="appMessage"[^>]*hidden/);
  assert.doesNotMatch(waiterHtml, /Tanda pendiente|mismo ID|identificador original|Estado de impresión:/);
  const script = waiterHtml.match(/<script>([\s\S]*)<\/script>/)[1];
  assert.doesNotThrow(() => new Function(script));
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
