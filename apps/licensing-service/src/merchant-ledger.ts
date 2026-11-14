import { randomBytes, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { GRACE_MS } from "@gastronomy/licensing";

type LicenseRow = {
  id: string;
  business_name: string;
  paid_through: string;
  revision: number;
  status: "ACTIVE" | "SUSPENDED";
  activation_hash: string;
  installation_id: string | null;
  created_at: string;
};
type Options = { now?: () => string; idFactory?: () => string };
export class MerchantLedgerError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(code);
  }
}
function fail(code: string, status = 400): never {
  throw new MerchantLedgerError(code, status);
}
function validIso(value: unknown): value is string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)))
    return false;
  const millis = Date.parse(value);
  return (
    new Date(millis).toISOString() === value &&
    Number.isFinite(millis + GRACE_MS) &&
    millis + GRACE_MS <= 8.64e15
  );
}
function validReason(value: unknown): value is string {
  return (
    typeof value === "string" && value.trim().length > 0 && value.length <= 500
  );
}
function licenseId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(value);
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function tx<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {}
    throw error;
  }
}

/** Backend domain API for the authenticated merchant-management surface. */
export function createMerchantLedger(db: DatabaseSync, options: Options = {}) {
  const now = options.now ?? (() => new Date().toISOString());
  const idFactory =
    options.idFactory ?? (() => randomUUID().replaceAll("-", ""));
  db.exec(`
    CREATE TABLE IF NOT EXISTS license_trials (
      license_id TEXT PRIMARY KEY REFERENCES licenses(id), started_at INTEGER, ends_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS merchant_payments (
      idempotency_key TEXT PRIMARY KEY, license_id TEXT NOT NULL REFERENCES licenses(id),
      kind TEXT NOT NULL CHECK(kind IN ('PAYMENT','COURTESY')),
      amount_cents INTEGER, paid_through TEXT NOT NULL, reason TEXT NOT NULL, actor TEXT NOT NULL,
      created_at TEXT NOT NULL, CHECK((kind='PAYMENT' AND amount_cents > 0) OR (kind='COURTESY' AND amount_cents IS NULL))
    );
    CREATE INDEX IF NOT EXISTS merchant_payments_license ON merchant_payments(license_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS merchant_creation_keys (
      idempotency_key TEXT PRIMARY KEY, license_id TEXT NOT NULL UNIQUE REFERENCES licenses(id),
      business_name TEXT NOT NULL, paid_through TEXT NOT NULL, reason TEXT NOT NULL, actor TEXT NOT NULL
    );
  `);
  const auditColumns = db
    .prepare("PRAGMA table_info(owner_audit)")
    .all() as Array<{ name: string }>;
  if (!auditColumns.some((column) => column.name === "actor")) {
    db.exec("ALTER TABLE owner_audit ADD COLUMN actor TEXT");
  }
  db.exec(
    "CREATE INDEX IF NOT EXISTS owner_audit_license_history ON owner_audit(license_id,id DESC)",
  );

  function getRow(id: string): LicenseRow | undefined {
    return db.prepare("SELECT * FROM licenses WHERE id = ?").get(id) as
      LicenseRow | undefined;
  }
  function effective(row: LicenseRow, at = now()) {
    if (row.status === "SUSPENDED") return "SUSPENDED";
    const paid = Date.parse(row.paid_through),
      t = Date.parse(at);
    const trial = db.prepare("SELECT started_at,ends_at FROM license_trials WHERE license_id=?").get(row.id) as {started_at:number|null;ends_at:number|null}|undefined;
    if (trial && trial.started_at === null) return "PENDING_ACTIVATION";
    if (trial && trial.started_at !== null && trial.ends_at !== null && paid === trial.ends_at)
      return t < trial.ends_at ? "ACTIVE" : "EXPIRED";
    return t < paid ? "ACTIVE" : t < paid + GRACE_MS ? "GRACE" : "EXPIRED";
  }
  function trialShape(id:string) {
    const trial=db.prepare("SELECT t.started_at,t.ends_at,l.paid_through FROM license_trials t JOIN licenses l ON l.id=t.license_id WHERE t.license_id=?").get(id) as {started_at:number|null;ends_at:number|null;paid_through:string}|undefined;
    if (!trial || (trial.started_at !== null && (trial.ends_at === null || Date.parse(trial.paid_through) !== trial.ends_at))) return null;
    return {startedAt:trial.started_at===null?null:new Date(trial.started_at).toISOString(),endsAt:trial.ends_at===null?null:new Date(trial.ends_at).toISOString()};
  }
  function paymentSummary(id: string) {
    return db
      .prepare(
        "SELECT kind, amount_cents, paid_through, reason, actor, created_at FROM merchant_payments WHERE license_id=? AND kind='PAYMENT' ORDER BY created_at DESC,rowid DESC LIMIT 1",
      )
      .get(id) as
      | {
          kind: "PAYMENT";
          amount_cents: number;
          paid_through: string;
          reason: string;
          actor: string;
          created_at: string;
        }
      | undefined;
  }
  type MerchantRow = LicenseRow & {
    account_email?: string | null;
    pay_kind?: "PAYMENT" | null;
    pay_amount_cents?: number | null;
    pay_paid_through?: string | null;
    pay_reason?: string | null;
    pay_actor?: string | null;
    pay_created_at?: string | null;
  };
  function shape(row: MerchantRow) {
    const acct =
      row.account_email === undefined
        ? (db
            .prepare(
              "SELECT email FROM accounts WHERE license_id=? AND status='ACTIVE'",
            )
            .get(row.id) as { email: string } | undefined)
        : undefined;
    const lastPayment =
      row.pay_kind !== undefined
        ? row.pay_kind
          ? {
              kind: row.pay_kind,
              amount_cents: row.pay_amount_cents!,
              paid_through: row.pay_paid_through!,
              reason: row.pay_reason!,
              actor: row.pay_actor!,
              created_at: row.pay_created_at!,
            }
          : undefined
        : paymentSummary(row.id);
    return {
      id: row.id,
      businessName: row.business_name,
      accountEmail: row.account_email ?? acct?.email ?? null,
      paidThrough: row.paid_through,
      revision: row.revision,
      status: row.status,
      accessStatus: effective(row),
      trial: trialShape(row.id),
      installationId: row.installation_id,
      lastPayment: lastPayment
        ? {
            kind: lastPayment.kind,
            amountCents: lastPayment.amount_cents,
            paidThrough: lastPayment.paid_through,
            reason: lastPayment.reason,
            actor: lastPayment.actor,
            createdAt: lastPayment.created_at,
          }
        : null,
      createdAt: row.created_at,
    };
  }
  function listMerchants(input: unknown = {}) {
    if (!object(input)) fail("invalid_query");
    const opts = input as {
      query?: string;
      status?: string;
      limit?: number;
      offset?: number;
    };
    const limit = opts.limit ?? 50,
      offset = opts.offset ?? 0;
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 200 ||
      !Number.isInteger(offset) ||
      offset < 0
    )
      fail("invalid_pagination");
    if (
      (opts.query !== undefined && typeof opts.query !== "string") ||
      (opts.status !== undefined && typeof opts.status !== "string")
    )
      fail("invalid_query");
    const q = opts.query?.trim();
    const atIso = now();
    const graceBoundary = new Date(Date.parse(atIso) - GRACE_MS).toISOString();
    const effectiveSql = `CASE WHEN l.status='SUSPENDED' THEN 'SUSPENDED' WHEN lt.license_id IS NOT NULL AND lt.started_at IS NULL THEN 'PENDING_ACTIVATION' WHEN lt.started_at IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ',lt.ends_at/1000.0,'unixepoch')=l.paid_through AND ? < l.paid_through THEN 'ACTIVE' WHEN lt.started_at IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ',lt.ends_at/1000.0,'unixepoch')=l.paid_through THEN 'EXPIRED' WHEN ? < l.paid_through THEN 'ACTIVE' WHEN ? < l.paid_through THEN 'GRACE' ELSE 'EXPIRED' END`;
    const clauses: string[] = [],
      args: unknown[] = [];
    if (q) {
      clauses.push(
        "(instr(lower(l.business_name),?) > 0 OR instr(lower(l.id),?) > 0 OR instr(lower(a.email),?) > 0 OR instr(lower(l.installation_id),?) > 0)",
      );
      const needle = q.toLowerCase();
      args.push(needle, needle, needle, needle);
    }
    if (opts.status) {
      clauses.push(`${effectiveSql} = ?`);
      args.push(atIso, atIso, graceBoundary, opts.status);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const sqlArgs = args as (string | number | null)[];
    const total = (
      db
        .prepare(
          `SELECT count(*) AS n FROM licenses l LEFT JOIN license_trials lt ON lt.license_id=l.id LEFT JOIN accounts a ON a.license_id=l.id AND a.status='ACTIVE' ${where}`,
        )
        .get(...sqlArgs) as { n: number }
    ).n;
    const rows = db
      .prepare(
        `SELECT l.*, a.email AS account_email, mp.kind AS pay_kind, mp.amount_cents AS pay_amount_cents, mp.paid_through AS pay_paid_through, mp.reason AS pay_reason, mp.actor AS pay_actor, mp.created_at AS pay_created_at FROM licenses l LEFT JOIN license_trials lt ON lt.license_id=l.id LEFT JOIN accounts a ON a.license_id=l.id AND a.status='ACTIVE' LEFT JOIN merchant_payments mp ON mp.rowid=(SELECT p.rowid FROM merchant_payments p WHERE p.license_id=l.id AND p.kind='PAYMENT' ORDER BY p.created_at DESC,p.rowid DESC LIMIT 1) ${where} ORDER BY l.created_at DESC,l.id ASC LIMIT ? OFFSET ?`,
      )
      .all(...sqlArgs, limit, offset) as MerchantRow[];
    return { items: rows.map(shape), total, limit, offset };
  }
  function getMerchant(id: string) {
    if (!licenseId(id)) fail("invalid_license_id");
    const row = getRow(id);
    if (!row) fail("not_found", 404);
    const requests = db
      .prepare(
        "SELECT id,installation_id,key_fingerprint,status,created_at,updated_at FROM device_requests WHERE license_id=? ORDER BY created_at DESC",
      )
      .all(id);
    const events = db
      .prepare(
        "SELECT id,action,request_id,reason,created_at,actor FROM owner_audit WHERE license_id=? ORDER BY id DESC LIMIT 500",
      )
      .all(id);
    const payments = db
      .prepare(
        "SELECT kind,amount_cents,paid_through,reason,actor,created_at FROM merchant_payments WHERE license_id=? ORDER BY created_at DESC,rowid DESC LIMIT 500",
      )
      .all(id);
    const mutationActions = new Set([
      "MANUAL_PAYMENT_RECORDED",
      "COURTESY_RECORDED",
    ]);
    const history = [
      ...(
        events as Array<{
          action: string;
          reason: string;
          created_at: string;
          actor: string | null;
        }>
      )
        .filter((e) => !mutationActions.has(e.action))
        .map((e) => ({
          action: e.action,
          reason: e.reason,
          createdAt: e.created_at,
          actor: e.actor,
          amountCents: null,
        })),
      ...(
        payments as Array<{
          kind: string;
          amount_cents: number | null;
          paid_through: string;
          reason: string;
          actor: string;
          created_at: string;
        }>
      ).map((p) => ({
        action:
          p.kind === "PAYMENT"
            ? "MANUAL_PAYMENT_RECORDED"
            : "COURTESY_RECORDED",
        reason: p.reason,
        createdAt: p.created_at,
        actor: p.actor,
        amountCents: p.amount_cents,
        paidThrough: p.paid_through,
      })),
    ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { merchant: shape(row), team: requests, history };
  }
  function record(
    id: string,
    raw: unknown,
    kind: "PAYMENT" | "COURTESY",
    actor: string,
  ) {
    if (!object(raw)) fail("invalid_payment");
    const input = raw as {
      idempotencyKey: string;
      expectedRevision: number;
      amountCents: number | null;
      paidThrough: string;
      reason: string;
    };
    if (
      !licenseId(id) ||
      typeof input.idempotencyKey !== "string" ||
      !/^[A-Za-z0-9_-]{8,128}$/.test(input.idempotencyKey) ||
      !Number.isInteger(input.expectedRevision) ||
      !validIso(input.paidThrough) ||
      !validReason(input.reason)
    )
      fail("invalid_payment");
    if (
      kind === "PAYMENT" &&
      (!Number.isSafeInteger(input.amountCents) || input.amountCents! <= 0)
    )
      fail("invalid_amount");
    if (kind === "COURTESY" && input.amountCents !== null)
      fail("invalid_amount");
    if (typeof actor !== "string" || !actor.trim()) fail("invalid_actor");
    const createdAt = now();
    return tx(db, () => {
      const prior = db
        .prepare(
          "SELECT license_id,kind,amount_cents,paid_through,reason FROM merchant_payments WHERE idempotency_key=?",
        )
        .get(input.idempotencyKey) as
        | {
            license_id: string;
            kind: string;
            amount_cents: number | null;
            paid_through: string;
            reason: string;
          }
        | undefined;
      if (prior) {
        if (
          prior.license_id !== id ||
          prior.kind !== kind ||
          prior.amount_cents !== input.amountCents ||
          prior.paid_through !== input.paidThrough ||
          prior.reason !== input.reason.trim()
        )
          fail("idempotency_conflict", 409);
        const existing = getRow(id)!;
        return { merchant: shape(existing), idempotent: true };
      }
      const row = getRow(id);
      if (!row) fail("not_found", 404);
      if (row.revision !== input.expectedRevision)
        fail("revision_conflict", 409);
      if (Date.parse(input.paidThrough) < Date.parse(row.paid_through))
        fail("renewal_cannot_shorten", 422);
      if (kind === "COURTESY" && input.paidThrough === row.paid_through)
        fail("courtesy_must_extend", 422);
      db.prepare(
        "UPDATE licenses SET paid_through=?,revision=revision+1 WHERE id=? AND revision=?",
      ).run(input.paidThrough, id, input.expectedRevision);
      db.prepare(
        "INSERT INTO merchant_payments(idempotency_key,license_id,kind,amount_cents,paid_through,reason,actor,created_at) VALUES(?,?,?,?,?,?,?,?)",
      ).run(
        input.idempotencyKey,
        id,
        kind,
        input.amountCents,
        input.paidThrough,
        input.reason.trim(),
        actor.trim(),
        createdAt,
      );
      db.prepare(
        "INSERT INTO owner_audit(action,license_id,request_id,reason,created_at,actor) VALUES(?,?,NULL,?,?,?)",
      ).run(
        kind === "PAYMENT" ? "MANUAL_PAYMENT_RECORDED" : "COURTESY_RECORDED",
        id,
        input.reason.trim(),
        createdAt,
        actor.trim(),
      );
      return { merchant: shape(getRow(id)!), idempotent: false };
    });
  }
  function recordManualPayment(id: string, input: unknown, actor: string) {
    return record(id, input, "PAYMENT", actor);
  }
  function recordCourtesy(id: string, input: unknown, actor: string) {
    return record(
      id,
      object(input) ? { ...input, amountCents: null } : input,
      "COURTESY",
      actor,
    );
  }
  function createMerchant(raw: unknown, actor: string) {
    if (!object(raw)) fail("invalid_merchant");
    const input = raw as {
      businessName: string;
      paidThrough: string;
      reason: string;
      idempotencyKey: string;
    };
    if (
      !input ||
      typeof input.businessName !== "string" ||
      !input.businessName.trim() ||
      input.businessName.length > 160 ||
      !validIso(input.paidThrough) ||
      !validReason(input.reason)
    )
      fail("invalid_merchant");
    if (
      typeof input.idempotencyKey !== "string" ||
      !/^[A-Za-z0-9_-]{8,128}$/.test(input.idempotencyKey) ||
      typeof actor !== "string" ||
      !actor.trim()
    )
      fail("invalid_merchant");
    const activationHash = randomBytes(32).toString("hex");
    const createdAt = now();
    return tx(db, () => {
      const prior = db
        .prepare(
          "SELECT license_id,business_name,paid_through,reason FROM merchant_creation_keys WHERE idempotency_key=?",
        )
        .get(input.idempotencyKey) as
        | {
            license_id: string;
            business_name: string;
            paid_through: string;
            reason: string;
          }
        | undefined;
      if (prior) {
        if (
          prior.business_name !== input.businessName.trim() ||
          prior.paid_through !== input.paidThrough ||
          prior.reason !== input.reason.trim()
        )
          fail("idempotency_conflict", 409);
        const existing = getRow(prior.license_id);
        if (!existing) fail("not_found", 404);
        return shape(existing);
      }
      const id = idFactory();
      if (!licenseId(id)) fail("invalid_license_id");
      if (getRow(id)) fail("license_exists", 409);
      db.prepare(
        "INSERT INTO licenses(id,business_name,paid_through,revision,status,activation_hash,installation_id,created_at) VALUES(?,?,?,1,'ACTIVE',?,NULL,?)",
      ).run(
        id,
        input.businessName.trim(),
        input.paidThrough,
        activationHash,
        createdAt,
      );
      db.prepare(
        "INSERT INTO merchant_creation_keys(idempotency_key,license_id,business_name,paid_through,reason,actor) VALUES(?,?,?,?,?,?)",
      ).run(
        input.idempotencyKey,
        id,
        input.businessName.trim(),
        input.paidThrough,
        input.reason.trim(),
        actor.trim(),
      );
      db.prepare(
        "INSERT INTO owner_audit(action,license_id,request_id,reason,created_at,actor) VALUES('MERCHANT_CREATED',?,NULL,?,?,?)",
      ).run(id, input.reason.trim(), createdAt, actor.trim());
      return shape(getRow(id)!);
    });
  }
  return {
    listMerchants,
    getMerchant,
    recordManualPayment,
    recordCourtesy,
    createMerchant,
  };
}
