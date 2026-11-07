import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

// A rehearsal has its own subscription, receipts and projected expiry. This module
// may read the merchant identity but never writes licenses, accounts or renewals.
export interface SandboxSubscription {
  id: string;
  reference: string;
  payerEmail: string;
  amountCents: number;
  status: "PENDING" | "AUTHORIZED" | "PAUSED" | "CANCELLED";
  checkoutUrl: string | null;
}
export interface SandboxCharge {
  id: string;
  subscriptionId: string;
  reference: string;
  payerEmail: string;
  amountCents: number;
  currency: "ARS";
  paymentId: string | null;
  status: "APPROVED" | "PENDING" | "REJECTED" | "REVERSED";
  debitDate: string;
}
export interface SandboxGateway {
  readonly buyerEmail: string;
  create(input: {
    reference: string;
    payerEmail: string;
    amountCents: number;
  }): Promise<SandboxSubscription>;
  getSubscription(id: string): Promise<SandboxSubscription>;
  cancel(id: string): Promise<SandboxSubscription>;
  getCharge(id: string): Promise<SandboxCharge>;
}
export class BillingError extends Error {
  constructor(
    readonly code: string,
    readonly status = 400,
  ) {
    super(code);
  }
}
/** No remote subscription was created. Safe to let the operator correct settings and retry. */
export class SandboxCreationRejected extends Error {}
export function arsToCents(value: unknown): number {
  if (typeof value !== "string" && typeof value !== "number")
    throw new BillingError("invalid_amount");
  const match = /^(\d{1,10})(?:[.,](\d{1,2}))?$/.exec(String(value).trim());
  if (!match) throw new BillingError("invalid_amount");
  const cents =
    Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  if (!cents) throw new BillingError("invalid_amount");
  return cents;
}
type Sub = {
  ref: string;
  license_id: string;
  provider_id: string | null;
  email: string;
  cents: number;
  state: SandboxSubscription["status"] | "CREATING" | "REVIEW";
  checkout: string | null;
};
function resourceId(id: string) {
  return /^[a-zA-Z0-9_-]{1,128}$/.test(id);
}
function matching(
  row: Sub,
  s: { reference: string; payerEmail: string; amountCents: number },
) {
  return (
    s.reference === row.ref &&
    s.amountCents === row.cents &&
    s.payerEmail.toLowerCase() === row.email
  );
}
// End of a single monthly period, clamped (Jan 31 -> Feb 28/29), not "now + 30 days".
function period(date: string) {
  const start = new Date(date);
  if (
    !Number.isFinite(start.getTime()) ||
    start.getUTCFullYear() < 2000 ||
    start.getUTCFullYear() > 2200
  )
    throw new BillingError("invalid_provider_period", 422);
  const end = new Date(start);
  end.setUTCDate(1);
  end.setUTCMonth(end.getUTCMonth() + 2, 0);
  end.setUTCDate(Math.min(start.getUTCDate(), end.getUTCDate()));
  return { key: start.toISOString().slice(0, 7), until: end.toISOString() };
}
export function createSandboxBilling(
  db: DatabaseSync,
  gateway?: SandboxGateway,
) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS mp_test_subscriptions (
      ref TEXT PRIMARY KEY, license_id TEXT NOT NULL REFERENCES licenses(id), provider_id TEXT UNIQUE,
      email TEXT NOT NULL, cents INTEGER NOT NULL CHECK(cents>0), state TEXT NOT NULL,
      checkout TEXT, actor TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS mp_test_one_open ON mp_test_subscriptions(license_id) WHERE state!='CANCELLED';
    CREATE INDEX IF NOT EXISTS mp_test_by_merchant ON mp_test_subscriptions(license_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS mp_test_receipts (
      installment_id TEXT PRIMARY KEY, ref TEXT NOT NULL REFERENCES mp_test_subscriptions(ref),
      payment_id TEXT UNIQUE, cycle TEXT NOT NULL, until_date TEXT NOT NULL, state TEXT NOT NULL, debit_date TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS mp_test_receipts_by_sub ON mp_test_receipts(ref, debit_date DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS mp_test_one_paid_cycle ON mp_test_receipts(ref,cycle) WHERE state='APPROVED';
  `);
  const byRef = (ref: string) =>
    db.prepare("SELECT * FROM mp_test_subscriptions WHERE ref=?").get(ref) as
      Sub | undefined;
  const latest = (id: string) =>
    db
      .prepare(
        "SELECT * FROM mp_test_subscriptions WHERE license_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1",
      )
      .get(id) as Sub | undefined;
  const enabled = () => {
    if (!gateway) throw new BillingError("sandbox_disabled", 409);
    return gateway;
  };
  const summary = (id: string) => {
    const row = latest(id);
    if (!row) return null;
    const last = db
      .prepare(
        "SELECT state FROM mp_test_receipts WHERE ref=? ORDER BY debit_date DESC,rowid DESC LIMIT 1",
      )
      .get(row.ref);
    const paid = db
      .prepare(
        "SELECT MAX(until_date) AS until FROM mp_test_receipts WHERE ref=? AND state='APPROVED'",
      )
      .get(row.ref);
    return {
      status: row.state,
      reference: row.ref,
      providerId: row.provider_id,
      payerEmail: row.email,
      amountCents: row.cents,
      checkoutUrl: row.state === "PENDING" ? row.checkout : null,
      lastPaymentStatus: last?.state ?? null,
      paidThrough: paid?.until ?? null,
    };
  };
  function acceptSubscription(row: Sub, s: SandboxSubscription) {
    if (
      !resourceId(s.id) ||
      !matching(row, s) ||
      (row.provider_id && row.provider_id !== s.id)
    )
      throw new BillingError("sandbox_identity_mismatch", 422);
    // A concurrent notification or late fetch cannot undo a definitive cancellation.
    db.prepare(
      "UPDATE mp_test_subscriptions SET provider_id=?,state=?,checkout=? WHERE ref=? AND state!='CANCELLED' AND (provider_id IS NULL OR provider_id=?)",
    ).run(
      s.id,
      s.status,
      s.status === "PENDING" ? s.checkoutUrl : null,
      row.ref,
      s.id,
    );
  }
  async function create(
    id: string,
    input: Record<string, unknown>,
    actor: string,
  ) {
    const mp = enabled(),
      cents = arsToCents(input.amountArs);
    const email =
      typeof input.payerEmail === "string"
        ? input.payerEmail.trim().toLowerCase()
        : "";
    if (!email || email !== mp.buyerEmail)
      throw new BillingError("sandbox_buyer_only");
    if (!db.prepare("SELECT 1 FROM licenses WHERE id=?").get(id))
      throw new BillingError("not_found", 404);
    const current = latest(id);
    if (current && current.state !== "CANCELLED") {
      if (current.email === email && current.cents === cents)
        return summary(id);
      throw new BillingError("sandbox_subscription_exists", 409);
    }
    const ref = "dng-test-" + randomUUID();
    db.prepare(
      "INSERT INTO mp_test_subscriptions(ref,license_id,email,cents,state,actor,created_at) VALUES(?,?,?,?,'CREATING',?,?)",
    ).run(ref, id, email, cents, actor, new Date().toISOString());
    try {
      const remote = await mp.create({
        reference: ref,
        payerEmail: email,
        amountCents: cents,
      });
      acceptSubscription(byRef(ref)!, remote);
    } catch (error) {
      if (error instanceof SandboxCreationRejected) {
        db.prepare(
          "DELETE FROM mp_test_subscriptions WHERE ref=? AND state='CREATING' AND provider_id IS NULL",
        ).run(ref);
        throw new BillingError("sandbox_creation_rejected", 422);
      }
      // The remote may have accepted the request before a timeout. Retain our
      // unique reference; its signed notification can recover it. Never POST twice.
      db.prepare(
        "UPDATE mp_test_subscriptions SET state='REVIEW' WHERE ref=? AND state='CREATING'",
      ).run(ref);
      throw new BillingError("sandbox_creation_unconfirmed", 502);
    }
    return summary(id);
  }
  async function cancel(id: string) {
    const mp = enabled(),
      row = latest(id);
    if (!row) throw new BillingError("not_found", 404);
    if (row.state === "CANCELLED") return summary(id);
    if (!row.provider_id)
      throw new BillingError("sandbox_reconcile_first", 409);
    // Check canonical identity before mutating anything on the provider side.
    const verified = await mp.getSubscription(row.provider_id);
    if (!matching(row, verified) || verified.id !== row.provider_id)
      throw new BillingError("sandbox_identity_mismatch", 422);
    const result =
      verified.status === "CANCELLED"
        ? verified
        : await mp.cancel(row.provider_id);
    if (result.status !== "CANCELLED")
      throw new BillingError("sandbox_cancel_unconfirmed", 502);
    acceptSubscription(row, result);
    return summary(id);
  }
  async function notify(
    topic: string,
    id: string,
    expectedRef?: string,
  ): Promise<void> {
    const mp = enabled();
    if (!resourceId(id)) throw new BillingError("invalid_resource");
    if (topic === "subscription_preapproval") {
      const remote = await mp.getSubscription(id);
      if (remote.id !== id)
        throw new BillingError("sandbox_identity_mismatch", 422);
      if (expectedRef && remote.reference !== expectedRef)
        throw new BillingError("sandbox_identity_mismatch", 422);
      const row = byRef(remote.reference);
      if (row) acceptSubscription(row, remote);
      return;
    }
    if (topic === "payment") {
      // Changes (e.g. a refund) can arrive on the payment topic alone. A new
      // payment is never associated by guesswork: wait for the canonical invoice.
      const receipt = db
        .prepare(
          "SELECT installment_id FROM mp_test_receipts WHERE payment_id=?",
        )
        .get(id);
      if (receipt)
        await notify(
          "subscription_authorized_payment",
          String(receipt.installment_id),
        );
      return;
    }
    if (topic !== "subscription_authorized_payment") return;
    const charge = await mp.getCharge(id);
    if (expectedRef && charge.reference !== expectedRef)
      throw new BillingError("sandbox_charge_mismatch", 422);
    const row = byRef(charge.reference);
    if (!row) return;
    if (
      charge.id !== id ||
      !resourceId(charge.subscriptionId) ||
      !matching(row, charge) ||
      charge.currency !== "ARS" ||
      (row.provider_id && charge.subscriptionId !== row.provider_id) ||
      (charge.status === "APPROVED" && !charge.paymentId)
    )
      throw new BillingError("sandbox_charge_mismatch", 422);
    if (!row.provider_id) {
      const remote = await mp.getSubscription(charge.subscriptionId);
      if (remote.id !== charge.subscriptionId)
        throw new BillingError("sandbox_identity_mismatch", 422);
      acceptSubscription(row, remote);
    }
    const cycle = period(charge.debitDate);
    const existing = db
      .prepare(
        "SELECT ref,payment_id,cycle,state FROM mp_test_receipts WHERE installment_id=?",
      )
      .get(id);
    if (existing && (existing.ref !== row.ref || existing.cycle !== cycle.key))
      throw new BillingError("sandbox_charge_mismatch", 422);
    if (
      charge.paymentId &&
      db
        .prepare(
          "SELECT 1 FROM mp_test_receipts WHERE payment_id=? AND installment_id!=?",
        )
        .get(charge.paymentId, id)
    )
      throw new BillingError("sandbox_payment_conflict", 409);
    // Provider retries can change the payment id of a rejected installment.
    // Never downgrade a settled receipt on a stale pending/rejected delivery.
    if (
      existing &&
      (existing.state === "REVERSED" ||
        (existing.state === "APPROVED" && charge.status !== "REVERSED"))
    )
      return;
    if (
      existing?.state === "APPROVED" &&
      existing.payment_id !== charge.paymentId
    )
      throw new BillingError("sandbox_payment_conflict", 409);
    if (
      charge.status === "APPROVED" &&
      db
        .prepare(
          "SELECT 1 FROM mp_test_receipts WHERE ref=? AND cycle=? AND state='APPROVED' AND installment_id!=?",
        )
        .get(row.ref, cycle.key, id)
    )
      throw new BillingError("sandbox_period_already_paid", 409);
    db.prepare(
      `INSERT INTO mp_test_receipts(installment_id,ref,payment_id,cycle,until_date,state,debit_date) VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(installment_id) DO UPDATE SET state=excluded.state,payment_id=excluded.payment_id`,
    ).run(
      id,
      row.ref,
      charge.paymentId,
      cycle.key,
      cycle.until,
      charge.status,
      new Date(charge.debitDate).toISOString(),
    );
  }
  async function reconcile(id: string, input: Record<string, unknown>) {
    enabled();
    const row = latest(id);
    if (!row) throw new BillingError("not_found", 404);
    const subscription = input.subscriptionId || row.provider_id;
    if (typeof subscription !== "string" || !resourceId(subscription))
      throw new BillingError("sandbox_subscription_id_required");
    await notify("subscription_preapproval", subscription, row.ref);
    if (input.installmentId) {
      if (typeof input.installmentId !== "string")
        throw new BillingError("invalid_resource");
      await notify(
        "subscription_authorized_payment",
        input.installmentId,
        row.ref,
      );
    }
    return summary(id);
  }
  return { enabled: !!gateway, summary, create, cancel, notify, reconcile };
}
