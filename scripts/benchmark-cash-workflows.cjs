// Run under the workspace Electron with ELECTRON_RUN_AS_NODE=1 (native SQLite ABI).
// Optional: GASTRONOMY_CASH_BASELINE = absolute path to a trusted pre-change repository module.
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const root = path.resolve(__dirname, "..");
require(require.resolve("tsx/cjs", { paths: [path.join(root, "packages/database")] }));
const Current = require(path.join(root, "packages/database/src/sqlite-repository.ts")).SqliteGastronomyRepository;
const Old = process.env.GASTRONOMY_CASH_BASELINE && require(process.env.GASTRONOMY_CASH_BASELINE).SqliteGastronomyRepository;
const folder = fs.mkdtempSync(path.join(os.tmpdir(), "qa-cash-flows-"));
const options = { adminPin: "2468", seedStarterCatalog: true };

function insert(db, table, row) {
  const keys = Object.keys(row);
  const statement = db.prepare(`INSERT INTO ${table}(${keys.join(",")}) VALUES(${keys.map(() => "?").join(",")})`);
  return values => statement.run(...keys.map(k => values[k]));
}
function addHistory(repo, cashId, from, to) {
  const db = repo.db;
  const source = db.prepare("SELECT * FROM cash_sessions WHERE id=?").get(cashId);
  const movement = db.prepare("SELECT * FROM cash_movements WHERE cash_session_id=? AND type='OPENING'").get(cashId);
  const addSession = insert(db, "cash_sessions", source), addMovement = insert(db, "cash_movements", movement);
  db.transaction(() => {
    for (let n = from; n <= to; n++) {
      const id = "past-" + n, stamp = new Date(Date.parse(source.opened_at) - n * 86400000).toISOString();
      addSession({ ...source, id, number: source.number + n, business_date: stamp.slice(0,10), opened_at: stamp, closed_at: stamp,
        status: "CLOSED", expected_amount_minor: source.opening_amount_minor + 200, counted_amount_minor: source.opening_amount_minor + 200 });
      for (let j = 0; j < 200; j++) addMovement({ ...movement, id: id + "-" + j, cash_session_id: id,
        type: "INCOME", amount_minor: 1, reason: "QA", order_id: null, created_at: stamp, reference_id: null });
    }
  })();
}
function seed(repo) {
  const cash = repo.openCashSession({ openingAmountMinor: 10000 });
  let order;
  for (let n = 0; n <= 160; n++) {
    const draft = repo.createOrder({ type: "TAKEAWAY", customerName: "QA", customerPhone: "1100000000" });
    repo.addOrderItem({ orderId: draft.id, productId: "starter-gaseosa" });
    order = repo.confirmOrder({ orderId: draft.id });
    if (n < 160) repo.payOrder({ orderId: draft.id, payments: [{ methodCode: "CASH", amountMinor: order.totalMinor }] });
  }
  addHistory(repo, cash.id, 1, 25);
  return { cashId: cash.id, orderId: order.id, due: order.totalMinor };
}
function timing(fn, n) {
  fn();
  const t = [];
  for (let i = 0; i < n; i++) {
    const start = performance.now(); fn(); t.push(performance.now() - start);
  }
  t.sort((a, b) => a-b);
  return +t[Math.floor(n / 2)].toFixed(2);
}
function profile(repo, ids, usePage) {
  const read = () => repo.getCashSessionReport({ cashSessionId: ids.cashId });
  const history = () => usePage ? repo.listCashSessionHistoryPage({ page: 1, pageSize: 20 }) : repo.listCashSessionHistory();
  const listing = history();
  const measurements = { historyMs: timing(history, 5), historyJsonBytes: Buffer.byteLength(JSON.stringify(listing)) };
  addHistory(repo, ids.cashId, 26, 100); // 20,000 historical movements for report and payOrder.
  const stop = new Error("rollback synthetic payment");
  const probe = repo.db.transaction(() => {
    repo.payOrder({ orderId: ids.orderId, payments: [{ methodCode: "CASH", amountMinor: ids.due }] });
    throw stop;
  });
  measurements.exactPayMs = timing(() => { try { probe(); } catch (e) { if (e !== stop) throw e; } }, 11);
  measurements.reportMs = timing(read, 5);
  const prepare = repo.db.prepare;
  let count = 0;
  repo.db.prepare = function (...args) { count++; return prepare.apply(this, args); };
  let report;
  try { report = read(); } finally { repo.db.prepare = prepare; }
  measurements.reportStatementsPrepared = count;
  assert.equal(report.totals.orderCount, 160);
  assert.equal(report.totals.salesMinor, 160 * ids.due);
  assert.equal(report.orders.length, 161);
  return { measurements, report, listing };
}

try {
  const original = path.join(folder, "seed.sqlite");
  const seedRepo = new (Old || Current)(original, options);
  let ids;
  try { ids = seed(seedRepo); } finally { seedRepo.close(); }
  function run(Repo, label, usePage) {
    const file = path.join(folder, label + ".sqlite");
    fs.copyFileSync(original, file);
    const repo = new Repo(file, options);
    try { return profile(repo, ids, usePage); } finally { repo.close(); }
  }
  const before = Old && run(Old, "before", false), after = run(Current, "after", true);
  if (before) {
    assert.deepEqual(after.report, before.report);
    const { items } = after.listing;
    assert.deepEqual(items.map(x => [x.id, x.salesTotalMinor, x.detailAvailable]),
      before.listing.slice(0, items.length).map(x => [x.session.id, x.session.salesTotalMinor, x.detailAvailable]));
  }
  console.log(JSON.stringify({ hardware: os.cpus()[0].model, electron: process.versions.electron,
    units: "medians in milliseconds; serialized JSON in bytes", before: before?.measurements, after: after.measurements }, null, 2));
} finally { fs.rmSync(folder, { recursive: true, force: true }); }
