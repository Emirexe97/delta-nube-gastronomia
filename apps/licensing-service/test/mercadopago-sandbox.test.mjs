import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  MercadoPagoSandboxError,
  createPendingSubscription,
  createMpGateway,
  getAuthorizedPaymentAndPayment,
  readSandboxConfig,
  verifyWebhookSignature,
} from "../dist/mercadopago-sandbox.js";

const env = {
  MP_SANDBOX_ENABLED: "true",
  MP_SANDBOX_ACCESS_TOKEN: "TEST-fake-token",
  MP_SANDBOX_BUYER_EMAIL: "buyer_test@testuser.com",
  MP_SANDBOX_BACK_URL: "https://pos.example.com/billing/return",
};
const config = readSandboxConfig(env);
const response = (value, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });

test("sandbox configuration fails closed unless opted in with TEST token and test buyer", () => {
  assert.throws(
    () => readSandboxConfig({ ...env, MP_SANDBOX_ENABLED: "false" }),
    MercadoPagoSandboxError,
  );
  assert.throws(
    () =>
      readSandboxConfig({ ...env, MP_SANDBOX_ACCESS_TOKEN: "APP_USR-real" }),
    /IDs/,
  );
  assert.throws(
    () =>
      readSandboxConfig({ ...env, MP_SANDBOX_BUYER_EMAIL: "real@example.com" }),
    /test-buyer/,
  );
  assert.throws(
    () =>
      readSandboxConfig({
        ...env,
        MP_SANDBOX_BACK_URL: "http://pos.example.com",
      }),
    /HTTPS/,
  );
  assert.throws(
    () =>
      readSandboxConfig({ ...env, MP_SANDBOX_ACCESS_TOKEN: "APP_USR-modern" }),
    /IDs/,
  );
  assert.throws(
    () =>
      readSandboxConfig({
        ...env,
        MP_SANDBOX_ACCESS_TOKEN: "APP_USR-modern",
        MP_SANDBOX_SELLER_ID: "101",
        MP_SANDBOX_BUYER_ID: "101",
      }),
    /IDs/,
  );
});

test("APP_USR is enabled only after read-only seller and buyer test-account attestations", async () => {
  const modern = readSandboxConfig({
    ...env,
    MP_SANDBOX_ACCESS_TOKEN: "APP_USR-modern",
    MP_SANDBOX_SELLER_ID: "101",
    MP_SANDBOX_BUYER_ID: "202",
  });
  let writes = 0;
  const makeFetcher =
    ({
      sellerTags = ["test_user"],
      buyerTags = ["test_user"],
      sellerSite = "MLA",
      buyerEmail = modern.buyerEmail,
    } = {}) =>
    async (url, options) => {
      if (options.method === "POST" || options.method === "PUT") writes++;
      if (url === "https://api.mercadolibre.com/users/me")
        return response({ id: 101, site_id: sellerSite, tags: sellerTags });
      if (url === "https://api.mercadolibre.com/users/202")
        return response({
          id: 202,
          site_id: "MLA",
          tags: buyerTags,
          email: buyerEmail,
        });
      if (
        url === "https://api.mercadopago.com/preapproval" &&
        options.method === "POST"
      )
        return response({
          id: "modern-sub",
          status: "pending",
          live_mode: false,
          collector_id: 101,
          payer_id: 202,
          external_reference: "acct-modern",
          payer_email: modern.buyerEmail,
          auto_recurring: {
            frequency: 1,
            frequency_type: "months",
            transaction_amount: 5,
            currency_id: "ARS",
          },
          init_point:
            "https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_id=modern-sub",
        });
      if (url === "https://api.mercadopago.com/preapproval/modern-sub")
        return response({
          id: "modern-sub",
          status: "pending",
          live_mode: false,
          collector_id: 101,
          payer_id: 202,
          external_reference: "acct-modern",
          payer_email: modern.buyerEmail,
          auto_recurring: {
            frequency: 1,
            frequency_type: "months",
            transaction_amount: 5,
            currency_id: "ARS",
          },
        });
      throw new Error(`unexpected URL/method ${url} ${options.method}`);
    };
  const result = await createMpGateway(modern, makeFetcher()).create({
    reference: "acct-modern",
    payerEmail: modern.buyerEmail,
    amountCents: 500,
  });
  assert.equal(result.status, "PENDING");
  assert.equal(writes, 1);
  for (const invalid of [
    { sellerTags: ["normal"] },
    { buyerTags: ["normal"] },
    { sellerSite: "MLB" },
    { buyerEmail: "someone@real.com" },
  ]) {
    writes = 0;
    await assert.rejects(
      createMpGateway(modern, makeFetcher(invalid)).create({
        reference: "acct-modern",
        payerEmail: modern.buyerEmail,
        amountCents: 500,
      }),
      /attested/,
    );
    assert.equal(
      writes,
      0,
      "failed identity attestation must block all provider mutations",
    );
  }
});

test("modern APP_USR direct helper rejects missing opt-in and invalid seller identity", async () => {
  const unenabled = {
    ...config,
    enabled: false,
    accessToken: "APP_USR-modern",
    sellerId: "101",
    buyerId: "202",
  };
  assert.throws(
    () =>
      createMpGateway(unenabled, async () => {
        throw new Error("must not fetch");
      }),
    /opt-in/,
  );
  const enabled = { ...unenabled, enabled: true };
  await assert.rejects(
    createMpGateway(enabled, async () =>
      response({ id: 999, site_id: "MLA", tags: ["test_user"] }),
    ).getSubscription("sub"),
    /attested/,
  );
});

test("pending subscription is constrained to test buyer and fixed provider checkout", async () => {
  let request;
  const fetcher = async (url, options) => {
    request = { url, options };
    return response({
      id: "sub_1",
      status: "pending",
      external_reference: "acct_1",
      payer_email: config.buyerEmail,
      auto_recurring: {
        frequency: 1,
        frequency_type: "months",
        transaction_amount: 1234.5,
        currency_id: "ARS",
      },
      init_point:
        "https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_id=sub_1",
    });
  };
  const created = await createPendingSubscription(
    config,
    {
      externalReference: "acct_1",
      reason: "Test",
      amountArs: 1234.5,
      buyerEmail: config.buyerEmail,
      backUrl: config.backUrl,
    },
    fetcher,
  );
  assert.equal(created.status, "pending");
  assert.equal(
    created.checkoutUrl.startsWith("https://www.mercadopago.com.ar/"),
    true,
  );
  assert.equal(request.url, "https://api.mercadopago.com/preapproval");
  assert.equal(request.options.redirect, "error");
  assert.equal(request.options.headers["X-scope"], "stage");
  assert.equal(JSON.parse(request.options.body).status, "pending");
  await assert.rejects(
    createPendingSubscription(
      config,
      {
        externalReference: "acct_1",
        reason: "Test",
        amountArs: 1,
        buyerEmail: "other@testuser.com",
        backUrl: config.backUrl,
      },
      fetcher,
    ),
    /Only the configured test buyer/,
  );
  await assert.rejects(
    createPendingSubscription(
      config,
      {
        externalReference: "acct_1",
        reason: "Test",
        amountArs: 1,
        buyerEmail: config.buyerEmail,
        backUrl: config.backUrl,
      },
      async () =>
        response({
          status: "pending",
          external_reference: "acct_1",
          payer_email: config.buyerEmail,
          auto_recurring: {
            frequency: 1,
            frequency_type: "months",
            transaction_amount: 1,
            currency_id: "ARS",
          },
          init_point: "https://evil.example/checkout",
        }),
    ),
    /unsupported checkout/,
  );
});

test("gateway retrieves canonical authorized payment and payment; grants no status from invoice alone", async () => {
  const paths = [];
  const gateway = createMpGateway(config, async (url, options) => {
    paths.push(url);
    if (url.endsWith("/authorized_payments/inv1"))
      return response({
        id: "inv1",
        preapproval_id: "sub1",
        external_reference: "acct1",
        currency_id: "ARS",
        transaction_amount: "12.34",
        debit_date: "2026-11-07T00:00:00Z",
        status: "scheduled",
        payment: { id: "pay1", status: "approved" },
      });
    if (url.endsWith("/v1/payments/pay1"))
      return response({
        id: "pay1",
        status: "approved",
        live_mode: false,
        date_approved: "2026-11-08T00:00:00Z",
        external_reference: "acct1",
        currency_id: "ARS",
        transaction_amount: 12.34,
        payer: { email: config.buyerEmail },
      });
    if (url.endsWith("/preapproval/sub1"))
      return response({
        id: "sub1",
        status: "authorized",
        external_reference: "acct1",
        payer_email: config.buyerEmail,
        live_mode: false,
        auto_recurring: {
          frequency: 1,
          frequency_type: "months",
          transaction_amount: 12.34,
          currency_id: "ARS",
        },
      });
    throw new Error("unexpected URL");
  });
  const charge = await gateway.getCharge("inv1");
  assert.deepEqual(charge, {
    id: "inv1",
    subscriptionId: "sub1",
    reference: "acct1",
    payerEmail: config.buyerEmail,
    amountCents: 1234,
    currency: "ARS",
    paymentId: "pay1",
    status: "APPROVED",
    debitDate: "2026-11-07T00:00:00Z",
  });
  assert.equal(paths.length, 3);
  await assert.rejects(
    getAuthorizedPaymentAndPayment(config, "inv1", async (url) =>
      url.endsWith("/authorized_payments/inv1")
        ? response({ id: "inv1", status: "scheduled" })
        : response({}),
    ),
    /Unsupported authorized-payment/,
  );
});

test("gateway rejects live subscription and canonical payment mismatches; handles refunds as reversed", async () => {
  assert.throws(
    () =>
      createMpGateway({ ...config, accessToken: "APP_USR-real" }, async () =>
        response({}),
      ),
    /IDs/,
  );
  const invoice = {
    id: "inv1",
    preapproval_id: "sub1",
    external_reference: "acct1",
    currency_id: "ARS",
    transaction_amount: "12.34",
    debit_date: "2026-11-07T00:00:00Z",
    status: "scheduled",
    payment: { id: "pay1", status: "approved" },
  };
  const sub = {
    id: "sub1",
    status: "authorized",
    external_reference: "acct1",
    payer_email: config.buyerEmail,
    auto_recurring: {
      frequency: 1,
      frequency_type: "months",
      transaction_amount: 12.34,
      currency_id: "ARS",
    },
  };
  const basePayment = {
    id: "pay1",
    status: "approved",
    live_mode: false,
    date_approved: "2026-11-08T00:00:00Z",
    external_reference: "acct1",
    currency_id: "ARS",
    transaction_amount: 12.34,
    payer: { email: config.buyerEmail },
  };
  const makeGateway = (payment) =>
    createMpGateway(config, async (url) =>
      url.endsWith("/authorized_payments/inv1")
        ? response(invoice)
        : url.endsWith("/v1/payments/pay1")
          ? response(payment)
          : response(sub),
    );
  for (const bad of [
    { ...basePayment, live_mode: true },
    { ...basePayment, transaction_amount: 2 },
    { ...basePayment, currency_id: "USD" },
    { ...basePayment, external_reference: "other" },
    { ...basePayment, id: "other" },
  ])
    await assert.rejects(
      makeGateway(bad).getCharge("inv1"),
      /sandbox|does not match/,
    );
  const refunded = await makeGateway({
    ...basePayment,
    status: "refunded",
  }).getCharge("inv1");
  assert.equal(refunded.status, "REVERSED");
  await assert.rejects(
    makeGateway({
      ...basePayment,
      date_approved: "2027-01-08T00:00:00Z",
    }).getCharge("inv1"),
    /outside billing period/,
  );
});

test("webhook HMAC binds URL data id, request id and fresh timestamp", () => {
  const secret = "webhook-test-secret";
  const ts = String(Math.floor(Date.now() / 1000));
  const dataId = "ABC-123";
  const xRequestId = "request-456";
  const manifest = `id:${dataId.toLowerCase()};request-id:${xRequestId};ts:${ts};`;
  const v1 = createHmac("sha256", secret).update(manifest).digest("hex");
  assert.equal(
    verifyWebhookSignature(
      { xSignature: `ts=${ts},v1=${v1}`, xRequestId, dataId },
      secret,
    ),
    true,
  );
  assert.equal(
    verifyWebhookSignature(
      { xSignature: `ts=${ts},v1=${v1}`, xRequestId: "other", dataId },
      secret,
    ),
    false,
  );
  assert.equal(
    verifyWebhookSignature(
      { xSignature: `ts=${ts},v1=${"0".repeat(64)}`, xRequestId, dataId },
      secret,
    ),
    false,
  );
  assert.equal(
    verifyWebhookSignature(
      { xSignature: `ts=1,v1=${v1}`, xRequestId, dataId },
      secret,
    ),
    false,
  );
});
