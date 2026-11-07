import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, generateKeyPairSync, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { createLicenseServer } from "../dist/server.js";
import { hashPanelPassword } from "../dist/panel-auth.js";
import { createMpGateway } from "../dist/mercadopago-sandbox.js";
import {
  createSandboxBilling,
  SandboxCreationRejected,
} from "../dist/sandbox-billing.js";

// Real panel/auth/webhook HTTP routes and SQLite, with only the PSP transport replaced.
// No token, network request or card ever leaves the process.
test("el ciclo de cobro de prueba confirma sólo la cuota verificada, nunca cambia el permiso de caja", async () => {
  const origin = "https://owner.example.test",
    secret = randomUUID();
  const config = {
    enabled: true,
    accessToken: "TEST-fixture",
    buyerEmail: "testuser101@testuser.com",
    buyerId: "101",
    backUrl: origin,
  };
  let sub,
    invoice,
    payment,
    posts = 0;
  const psp = createMpGateway(config, async (url, init) => {
    assert.equal(new URL(url).origin, "https://api.mercadopago.com");
    assert.equal(init.headers.Authorization, "Bearer TEST-fixture");
    const path = new URL(url).pathname;
    if (path === "/preapproval" && init.method === "POST") {
      posts++;
      const b = JSON.parse(init.body);
      sub = {
        id: "sub01",
        payer_id: 101,
        status: "pending",
        auto_recurring: b.auto_recurring,
        external_reference: b.external_reference,
        init_point:
          "https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_id=sub01",
      };
      return Response.json(sub);
    }
    if (path === "/preapproval/sub01") {
      if (init.method === "PUT") sub.status = JSON.parse(init.body).status;
      return Response.json(sub);
    }
    if (
      path === "/authorized_payments/inv01" ||
      path === "/authorized_payments/inv02"
    )
      return Response.json(invoice);
    if (path === "/v1/payments/p01" || path === "/v1/payments/p02")
      return Response.json(payment);
    throw new Error("Unexpected provider operation");
  });
  const db = new DatabaseSync(":memory:"),
    password = randomUUID(),
    actor = "owner";
  const app = createLicenseServer(
    {
      dbPath: "/unused.db",
      adminToken: randomUUID(),
      privateKey: generateKeyPairSync("ed25519").privateKey.export({
        type: "pkcs8",
        format: "pem",
      }),
      panelAuth: {
        username: actor,
        passwordHash: await hashPanelPassword(password),
        origin,
      },
      sandboxBilling: { gateway: psp, webhookSecret: secret },
    },
    db,
  );
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + app.server.address().port;
  let auth = {};
  const post = (path, data, headers = auth) =>
    fetch(base + path, {
      method: "POST",
      headers: { origin, "content-type": "application/json", ...headers },
      body: JSON.stringify(data),
    });
  const hook = (type, id, valid = true, body = { type }) => {
    const requestId = randomUUID(),
      ts = String(Math.floor(Date.now() / 1000));
    const sig = createHmac("sha256", valid ? secret : "not the signing key")
      .update(`id:${id};request-id:${requestId};ts:${ts};`)
      .digest("hex");
    return post(
      "/billing/test/mercadopago/webhook?data.id=" + id + "&type=" + type,
      body,
      { "x-request-id": requestId, "x-signature": `ts=${ts},v1=${sig}` },
    );
  };
  try {
    const login = await post("/manage/api/login", {
      username: actor,
      password,
    });
    auth = {
      cookie: login.headers.get("set-cookie").split(";")[0],
      "x-panel-csrf": (await login.json()).csrfToken,
    };
    const business = {
      businessName: "Comercio de prueba",
      paidThrough: "2027-02-02T00:00:00.000Z",
      reason: "alta prueba",
      idempotencyKey: randomUUID(),
    };
    assert.equal(
      (await post("/manage/api/merchants", business, {})).status,
      401,
    );
    assert.equal(
      (await post("/manage/api/merchants", business, { cookie: auth.cookie }))
        .status,
      403,
    );
    const create = await post("/manage/api/merchants", business);
    assert.equal(create.status, 201);
    const { id, revision } = await create.json(),
      path = "/manage/api/merchants/" + id;
    assert.equal(
      (
        await post("/manage/api/licenses/" + id + "/status", {
          expectedRevision: revision,
          status: "SUSPENDED",
          reason: "Prueba de independencia",
        })
      ).status,
      200,
    );
    const license = () =>
      db.prepare("SELECT * FROM licenses WHERE id=?").get(id);
    const original = license();
    const detail = async () =>
      (await fetch(base + path, { headers: auth })).json();
    assert.equal(
      (
        await post(path + "/sandbox", {
          payerEmail: "real@example.test",
          amountArs: "1.10",
        })
      ).status,
      400,
    );
    const input = { payerEmail: config.buyerEmail, amountArs: "1,10" };
    assert.equal((await post(path + "/sandbox", input)).status, 200);
    assert.equal((await post(path + "/sandbox", input)).status, 200);
    assert.equal(posts, 1);
    sub.status = "authorized";
    assert.equal((await hook("subscription_preapproval", "sub01")).status, 200);
    assert.equal((await detail()).sandbox.paidThrough, null);
    invoice = {
      id: "inv01",
      preapproval_id: "sub01",
      external_reference: sub.external_reference,
      currency_id: "ARS",
      transaction_amount: 1.1,
      debit_date: "2027-01-31T12:00:00Z",
      status: "scheduled",
    };
    assert.equal(
      (await hook("subscription_authorized_payment", "inv01")).status,
      200,
    );
    assert.equal((await detail()).sandbox.lastPaymentStatus, "PENDING");
    invoice.payment = { id: "p01" };
    payment = {
      id: "p01",
      live_mode: false,
      status: "rejected",
      payer: { id: 101 },
      currency_id: "ARS",
      transaction_amount: 1.1,
      external_reference: sub.external_reference,
      date_approved: "2027-01-31T13:00:00Z",
    };
    assert.equal(
      (await hook("subscription_authorized_payment", "inv01")).status,
      200,
    );
    assert.equal((await detail()).sandbox.lastPaymentStatus, "REJECTED");
    payment.status = "approved";
    assert.equal(
      (await hook("subscription_authorized_payment", "inv01", false)).status,
      401,
    );
    assert.equal((await detail()).sandbox.paidThrough, null);
    payment.live_mode = true;
    assert.equal(
      (await hook("subscription_authorized_payment", "inv01")).status,
      502,
    );
    payment.live_mode = false;
    for (let i = 0; i < 2; i++)
      assert.equal(
        (
          await hook("subscription_authorized_payment", "inv01", true, {
            type: "subscription_authorized_payment",
            payment_status: "rejected",
          })
        ).status,
        200,
      );
    assert.equal(
      (await detail()).sandbox.paidThrough,
      "2027-02-28T12:00:00.000Z",
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) AS n FROM mp_test_receipts").get().n,
      1,
    );
    // Another resource for the already credited monthly installment must not add a period.
    invoice.id = "inv02";
    invoice.payment.id = payment.id = "p02";
    assert.equal(
      (await hook("subscription_authorized_payment", "inv02")).status,
      409,
    );
    invoice.id = "inv01";
    invoice.payment.id = payment.id = "p01";
    assert.equal((await post(path + "/sandbox/cancel", {})).status, 200);
    assert.equal((await detail()).sandbox.status, "CANCELLED");
    assert.equal(
      (await detail()).sandbox.paidThrough,
      "2027-02-28T12:00:00.000Z",
    );
    payment.status = "refunded";
    assert.equal((await hook("payment", "p01")).status, 200);
    const final = await detail();
    assert.equal(final.sandbox.lastPaymentStatus, "REVERSED");
    assert.equal(final.sandbox.paidThrough, null);
    assert.equal(final.merchant.lastPayment, null);
    assert.equal(final.merchant.accessStatus, "SUSPENDED");
    assert.deepEqual(license(), original);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM renewals").get().n, 0);
  } finally {
    app.close();
  }
});

test("reintento seguro si no hubo alta; una respuesta perdida se concilia sin crear otra adhesión", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE licenses(id TEXT PRIMARY KEY); INSERT INTO licenses VALUES('merchant-A'),('merchant-B')",
  );
  const buyerEmail = "testbuyer@testuser.com",
    input = { payerEmail: buyerEmail, amountArs: "12.35" };
  let stage = "rejected",
    calls = 0,
    remote;
  const gateway = {
    buyerEmail,
    async create(request) {
      calls++;
      if (stage === "rejected")
        throw new SandboxCreationRejected("test account was not verified");
      remote = {
        ...request,
        id: "psp-one",
        status: "PENDING",
        checkoutUrl: null,
      };
      throw new Error("response lost");
    },
    async getSubscription() {
      return remote;
    },
  };
  try {
    const off = createSandboxBilling(db);
    await assert.rejects(off.create("merchant-A", input, "owner"), {
      code: "sandbox_disabled",
    });
    const billing = createSandboxBilling(db, gateway);
    await assert.rejects(billing.create("merchant-A", input, "owner"), {
      code: "sandbox_creation_rejected",
    });
    assert.equal(billing.summary("merchant-A"), null);
    stage = "ambiguous";
    await assert.rejects(billing.create("merchant-A", input, "owner"), {
      code: "sandbox_creation_unconfirmed",
    });
    assert.equal(
      (await billing.create("merchant-A", input, "owner")).status,
      "REVIEW",
    );
    assert.equal(calls, 2);
    const resumed = createSandboxBilling(db, gateway);
    assert.equal(
      (await resumed.reconcile("merchant-A", { subscriptionId: "psp-one" }))
        .status,
      "PENDING",
    );
    assert.equal(await resumed.summary("merchant-B"), null);
    assert.equal(calls, 2);
  } finally {
    db.close();
  }
});
