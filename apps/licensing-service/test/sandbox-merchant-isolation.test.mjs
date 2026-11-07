import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createSandboxBilling } from "../dist/sandbox-billing.js";

test("sandbox billing aísla comercios y conserva créditos/reversas tras reabrir SQLite", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sandbox-merchant-isolation-"));
  const path = join(dir, "sandbox.sqlite");
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE licenses(id TEXT PRIMARY KEY, business_name TEXT NOT NULL, paid_through TEXT NOT NULL, status TEXT NOT NULL);
    CREATE TABLE accounts(email TEXT PRIMARY KEY, license_id TEXT NOT NULL);
    CREATE TABLE renewals(id TEXT PRIMARY KEY, license_id TEXT NOT NULL);
    INSERT INTO licenses VALUES ('merchant-a','Control A','2027-01-15T00:00:00.000Z','ACTIVE'),('merchant-b','Control B','2027-03-01T00:00:00.000Z','SUSPENDED');
    INSERT INTO accounts VALUES ('a@example.test','merchant-a'),('b@example.test','merchant-b');
    INSERT INTO renewals VALUES ('fixture-renewal','merchant-a');`);
  const baseline = Object.fromEntries(
    ["licenses", "accounts", "renewals"].map((table) => [
      table,
      db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all(),
    ]),
  );
  const buyerEmail = "qa_aislamiento@testuser.com";
  const subscriptions = new Map();
  const charges = new Map();
  const gateway = {
    buyerEmail,
    async create(input) {
      const id = `psp-${subscriptions.size + 1}`;
      const subscription = {
        ...input,
        id,
        status: "AUTHORIZED",
        checkoutUrl: null,
      };
      subscriptions.set(id, subscription);
      return subscription;
    },
    async getSubscription(id) {
      return subscriptions.get(id);
    },
    async cancel(id) {
      const sub = { ...subscriptions.get(id), status: "CANCELLED" };
      subscriptions.set(id, sub);
      return sub;
    },
    async getCharge(id) {
      return charges.get(id);
    },
  };
  const input = { payerEmail: buyerEmail, amountArs: "125.00" };
  const charge = (id, sub, reference, paymentId, status, debitDate) => ({
    id,
    subscriptionId: sub.id,
    reference,
    payerEmail: buyerEmail,
    amountCents: 12500,
    currency: "ARS",
    paymentId,
    status,
    debitDate,
  });
  try {
    let billing = createSandboxBilling(db, gateway);
    const a = await billing.create("merchant-a", input, "operator");
    const b = await billing.create("merchant-b", input, "operator");
    assert.notEqual(a.reference, b.reference);
    assert.equal(
      (await billing.create("merchant-a", input, "operator")).reference,
      a.reference,
    );
    const subA = subscriptions.get(a.providerId),
      subB = subscriptions.get(b.providerId);

    charges.set(
      "a-jan",
      charge(
        "a-jan",
        subA,
        a.reference,
        "payment-a-jan",
        "APPROVED",
        "2027-01-31T12:00:00Z",
      ),
    );
    await billing.notify("subscription_authorized_payment", "a-jan");
    assert.equal(
      billing.summary("merchant-a").paidThrough,
      "2027-02-28T12:00:00.000Z",
    );
    // A rejected next cycle is recorded but cannot erase the paid January cycle.
    charges.set(
      "a-feb",
      charge(
        "a-feb",
        subA,
        a.reference,
        "payment-a-feb",
        "REJECTED",
        "2027-02-28T12:00:00Z",
      ),
    );
    await billing.notify("subscription_authorized_payment", "a-feb");
    assert.equal(
      billing.summary("merchant-a").paidThrough,
      "2027-02-28T12:00:00.000Z",
    );
    // A new approved cycle, with exact duplicate delivery, advances once.
    charges.set(
      "a-mar",
      charge(
        "a-mar",
        subA,
        a.reference,
        "payment-a-mar",
        "APPROVED",
        "2027-03-31T12:00:00Z",
      ),
    );
    await billing.notify("subscription_authorized_payment", "a-mar");
    await billing.notify("subscription_authorized_payment", "a-mar");
    assert.equal(
      billing.summary("merchant-a").paidThrough,
      "2027-04-30T12:00:00.000Z",
    );
    // Reversing only the newest approved cycle restores the preceding coverage.
    charges.set("a-mar", { ...charges.get("a-mar"), status: "REVERSED" });
    await billing.notify("subscription_authorized_payment", "a-mar");
    await billing.notify("payment", "payment-a-mar");
    assert.equal(
      billing.summary("merchant-a").paidThrough,
      "2027-02-28T12:00:00.000Z",
    );
    assert.equal(billing.summary("merchant-a").lastPaymentStatus, "REVERSED");

    charges.set(
      "b-apr",
      charge(
        "b-apr",
        subB,
        b.reference,
        "payment-b-apr",
        "APPROVED",
        "2027-04-30T12:00:00Z",
      ),
    );
    await billing.notify("subscription_authorized_payment", "b-apr");
    assert.equal(
      billing.summary("merchant-b").paidThrough,
      "2027-05-30T12:00:00.000Z",
    );
    assert.equal(
      billing.summary("merchant-a").paidThrough,
      "2027-02-28T12:00:00.000Z",
    );
    // A mistaken reconciliation in A must not import B's paid cycle.
    await assert.rejects(
      () => billing.reconcile("merchant-a", { subscriptionId: b.providerId }),
      (e) => e.code === "sandbox_identity_mismatch",
    );
    await assert.rejects(
      () =>
        billing.reconcile("merchant-a", {
          subscriptionId: a.providerId,
          installmentId: "b-apr",
        }),
      (e) => e.code === "sandbox_charge_mismatch",
    );
    // Cancellation affects subscription state, not already-earned coverage.
    await billing.cancel("merchant-a");
    await billing.cancel("merchant-a");
    assert.equal(billing.summary("merchant-a").status, "CANCELLED");
    assert.equal(
      billing.summary("merchant-a").paidThrough,
      "2027-02-28T12:00:00.000Z",
    );

    db.close();
    const reopened = new DatabaseSync(path);
    try {
      billing = createSandboxBilling(reopened, gateway);
      assert.equal(
        billing.summary("merchant-a").paidThrough,
        "2027-02-28T12:00:00.000Z",
      );
      assert.equal(billing.summary("merchant-a").status, "CANCELLED");
      assert.equal(
        billing.summary("merchant-b").paidThrough,
        "2027-05-30T12:00:00.000Z",
      );
      assert.equal(billing.summary("merchant-b").status, "AUTHORIZED");
      assert.equal(
        reopened.prepare("SELECT COUNT(*) AS n FROM mp_test_receipts").get().n,
        4,
      );
      assert.deepEqual(
        Object.fromEntries(
          ["licenses", "accounts", "renewals"].map((table) => [
            table,
            reopened.prepare(`SELECT * FROM ${table} ORDER BY 1`).all(),
          ]),
        ),
        baseline,
      );
    } finally {
      reopened.close();
    }
  } finally {
    try {
      db.close();
    } catch {}
    rmSync(dir, { recursive: true, force: true });
  }
});
