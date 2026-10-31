import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { request as httpRequest } from "node:http";
import { createOrdersServer } from "../dist/server.js";
import { WebOrdersClient } from "@gastronomy/web-orders";

const token = () => randomBytes(32).toString("base64url");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const makePayload = (overrides = {}) => ({
  schemaVersion: 1,
  currency: "ARS",
  customer: { name: "Ana", phone: "+5491112345678" },
  fulfillment: { type: "DELIVERY", address: "Calle 1" },
  items: [
    {
      productRef: "burger:1",
      name: "Hamburguesa",
      quantity: 2,
      unitPriceMinor: 12500,
    },
  ],
  deliveryFeeMinor: 500,
  paymentMethod: "CASH",
  ...overrides,
});
const key = () => randomBytes(18).toString("base64url");

async function fixture(options = {}) {
  const dir = await mkdtemp(join(tmpdir(), "orders-service-"));
  const credentials = {
    merchant: { receive: token(), siteA: token(), siteB: token() },
    other: { receive: token(), siteA: token() },
  };
  const stores = [
    {
      id: "merchant",
      whatsappNumber: "5491111111111",
      receiveTokenHash: hash(credentials.merchant.receive),
      sites: [
        { id: "site-a", submitTokenHash: hash(credentials.merchant.siteA) },
        { id: "site-b", submitTokenHash: hash(credentials.merchant.siteB) },
      ],
    },
    {
      id: "other",
      whatsappNumber: "5491222222222",
      receiveTokenHash: hash(credentials.other.receive),
      sites: [{ id: "site-a", submitTokenHash: hash(credentials.other.siteA) }],
    },
  ];
  const dbPath = resolve(dir, "orders.sqlite");
  let service = createOrdersServer({ dbPath, stores, ...options });
  await new Promise((resolve) =>
    service.server.listen(0, "127.0.0.1", resolve),
  );
  let base = `http://127.0.0.1:${service.server.address().port}`;
  const api = async (method, path, { bearer, body, headers = {} } = {}) => {
    const response = await fetch(base + path, {
      method,
      headers: {
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...headers,
      },
      ...(body !== undefined
        ? { body: typeof body === "string" ? body : JSON.stringify(body) }
        : {}),
    });
    const text = await response.text();
    return {
      status: response.status,
      headers: response.headers,
      body: text ? JSON.parse(text) : null,
    };
  };
  const close = async () => {
    if (service) await service.close();
    await rm(dir, { recursive: true, force: true });
  };
  return {
    api,
    credentials,
    dbPath,
    stores,
    get base() {
      return base;
    },
    get server() {
      return service.server;
    },
    close,
    stop: () => service.close(),
    reopen: async () => {
      await service.close();
      service = createOrdersServer({ dbPath, stores, ...options });
      await new Promise((resolve) =>
        service.server.listen(0, "127.0.0.1", resolve),
      );
      base = `http://127.0.0.1:${service.server.address().port}`;
    },
  };
}

test("close drains an in-flight submission before closing SQLite", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const body = JSON.stringify(makePayload());
  let request;
  const started = new Promise((resolve) => f.server.once("request", resolve));
  const response = new Promise((resolveResponse, reject) => {
    request = httpRequest(
      f.base + "/v1/web-orders",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${f.credentials.merchant.siteA}`,
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
          "idempotency-key": key(),
        },
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          text += chunk;
        });
        res.on("end", () =>
          resolveResponse({ status: res.statusCode, body: JSON.parse(text) }),
        );
      },
    );
    request.on("error", reject);
    request.write(body.slice(0, 10));
  });
  await started;
  const closing = f.stop();
  request.end(body.slice(10));
  const result = await response;
  assert.equal(result.status, 201);
  await closing;
  await f.reopen();
  const recovered = await f.api("GET", "/v1/web-orders", {
    bearer: f.credentials.merchant.receive,
  });
  assert.equal(recovered.body.orders[0].id, result.body.order.id);
});

test("health and submit create pending unverified quote with merchant WhatsApp", async (t) => {
  const f = await fixture();
  t.after(f.close);
  assert.deepEqual((await f.api("GET", "/health")).body, { ok: true });
  const result = await f.api("POST", "/v1/web-orders", {
    bearer: f.credentials.merchant.siteA,
    headers: { "idempotency-key": key() },
    body: makePayload(),
  });
  assert.equal(result.status, 201);
  assert.equal(result.body.order.status, "PENDING_CONFIRMATION");
  assert.equal(result.body.order.paymentStatus, "UNVERIFIED");
  assert.equal(result.body.order.quotedTotalMinor, 25500);
  assert.equal(new URL(result.body.whatsappUrl).hostname, "wa.me");
  assert.equal(new URL(result.body.whatsappUrl).pathname, "/5491111111111");
  assert.match(
    new URL(result.body.whatsappUrl).searchParams.get("text"),
    /Total cotizado/,
  );
});

test("idempotency canonicalizes JSON key order and rejects changed payload", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const k = key();
  const payload = makePayload();
  const a = await f.api("POST", "/v1/web-orders", {
    bearer: f.credentials.merchant.siteA,
    headers: { "idempotency-key": k },
    body: payload,
  });
  const reordered = Object.fromEntries(Object.entries(payload).reverse());
  const b = await f.api("POST", "/v1/web-orders", {
    bearer: f.credentials.merchant.siteA,
    headers: { "idempotency-key": k },
    body: reordered,
  });
  assert.equal(a.status, 201);
  assert.equal(b.status, 200);
  assert.equal(a.body.order.id, b.body.order.id);
  const c = await f.api("POST", "/v1/web-orders", {
    bearer: f.credentials.merchant.siteA,
    headers: { "idempotency-key": k },
    body: makePayload({ notes: "otro" }),
  });
  assert.equal(c.status, 409);
});

test("same-key concurrent submissions serialize to one order; keys are scoped by tenant and site", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const shared = key();
  const submit = (bearer, k, body = makePayload()) =>
    f.api("POST", "/v1/web-orders", {
      bearer,
      headers: { "idempotency-key": k },
      body,
    });
  const [a, b] = await Promise.all([
    submit(f.credentials.merchant.siteA, shared),
    submit(f.credentials.merchant.siteA, shared),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 201]);
  assert.equal(a.body.order.id, b.body.order.id);
  const otherTenant = await submit(f.credentials.other.siteA, shared);
  const otherSite = await submit(f.credentials.merchant.siteB, shared);
  assert.equal(otherTenant.status, 201);
  assert.equal(otherSite.status, 201);
  assert.notEqual(a.body.order.id, otherTenant.body.order.id);
  assert.notEqual(a.body.order.id, otherSite.body.order.id);
});

test("roles and tenant boundaries isolate read access; receive acknowledgement is idempotent, not a drain", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const submit = (bearer, k) =>
    f.api("POST", "/v1/web-orders", {
      bearer,
      headers: { "idempotency-key": k },
      body: makePayload(),
    });
  const own = await submit(f.credentials.merchant.siteA, key());
  const foreign = await submit(f.credentials.other.siteA, key());
  assert.equal(
    (
      await f.api("GET", "/v1/web-orders", {
        bearer: f.credentials.other.receive,
      })
    ).body.orders.length,
    1,
  );
  const page = await f.api("GET", "/v1/web-orders?limit=1", {
    bearer: f.credentials.merchant.receive,
  });
  assert.equal(page.body.orders.length, 1);
  assert.equal(page.body.orders[0].id, own.body.order.id);
  assert.equal(
    (
      await f.api("GET", "/v1/web-orders", {
        bearer: f.credentials.merchant.siteA,
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await f.api("POST", "/v1/web-orders", {
        bearer: f.credentials.merchant.receive,
        headers: { "idempotency-key": key() },
        body: makePayload(),
      })
    ).status,
    401,
  );
  assert.equal((await f.api("GET", "/v1/web-orders")).status, 401);
  assert.equal(
    (
      await f.api(
        "POST",
        "/v1/web-orders/00000000-0000-0000-0000-000000000000/received",
        { bearer: f.credentials.merchant.receive },
      )
    ).status,
    404,
  );
  const ackPath = `/v1/web-orders/${own.body.order.id}/received`;
  const ack = await f.api("POST", ackPath, {
    bearer: f.credentials.merchant.receive,
  });
  assert.ok(ack.body.order.receivedAt);
  assert.equal(ack.body.order.status, "PENDING_CONFIRMATION");
  assert.equal(ack.body.order.paymentStatus, "UNVERIFIED");
  const again = await f.api("POST", ackPath, {
    bearer: f.credentials.merchant.receive,
  });
  assert.equal(again.body.order.receivedAt, ack.body.order.receivedAt);
  assert.equal(
    (
      await f.api("POST", `/v1/web-orders/${foreign.body.order.id}/received`, {
        bearer: f.credentials.merchant.receive,
      })
    ).status,
    404,
  );
  const reread = await f.api("GET", "/v1/web-orders", {
    bearer: f.credentials.merchant.receive,
  });
  assert.equal(reread.body.orders.length, 1);
  assert.equal(reread.body.orders[0].id, own.body.order.id);
});

test("request validation rejects origin, unsafe fields, bad JSON/MIME, oversized bodies and invalid fields", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const auth = f.credentials.merchant.siteA;
  const post = (body, headers = {}) =>
    f.api("POST", "/v1/web-orders", {
      bearer: auth,
      headers: { "idempotency-key": key(), ...headers },
      body,
    });
  assert.equal(
    (await post(makePayload(), { origin: "https://evil.example" })).status,
    403,
  );
  assert.equal(
    (await post({ ...makePayload(), storeId: "other" })).status,
    400,
  );
  assert.equal(
    (
      await post({
        ...makePayload(),
        status: "PAID",
        paymentStatus: "VERIFIED",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await post(
        JSON.parse(
          '{"__proto__":{"status":"PAID"},"schemaVersion":1,"currency":"ARS","customer":{"name":"Ana","phone":"+5491112345678"},"fulfillment":{"type":"DELIVERY","address":"Calle 1"},"items":[{"productRef":"x","name":"Item","quantity":1,"unitPriceMinor":1}],"deliveryFeeMinor":0,"paymentMethod":"CASH"}',
        ),
      )
    ).status,
    400,
  );
  assert.equal((await post("{")).status, 400);
  assert.equal(
    (
      await f.api("POST", "/v1/web-orders", {
        bearer: auth,
        headers: { "idempotency-key": key(), "content-type": "text/plain" },
        body: "x",
      })
    ).status,
    415,
  );
  const large = await post("x".repeat(66 * 1024));
  assert.equal(large.status, 413);
  const chunked = await new Promise((resolve, reject) => {
    const request = httpRequest(
      new URL("/v1/web-orders", f.base),
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${auth}`,
          "content-type": "application/json",
          "idempotency-key": key(),
          "transfer-encoding": "chunked",
        },
      },
      (response) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          text += chunk;
        });
        response.on("end", () =>
          resolve({ status: response.statusCode, body: text }),
        );
      },
    );
    request.on("error", reject);
    for (let i = 0; i < 70; i++) request.write("x".repeat(1024));
    request.end();
  });
  assert.equal(chunked.status, 413);
  assert.equal((await post(makePayload({ items: [] }))).status, 400);
  assert.equal(
    (
      await f.api("POST", "/v1/web-orders", {
        bearer: auth,
        headers: { "idempotency-key": "short" },
        body: makePayload(),
      })
    ).status,
    400,
  );
  const privateRead = await f.api("GET", "/v1/web-orders", {
    bearer: f.credentials.merchant.receive,
    headers: { origin: "https://site.example" },
  });
  assert.equal(privateRead.status, 403);
  assert.equal(privateRead.headers.has("access-control-allow-origin"), false);
});

test("empty page and invalid cursor/limit are explicit and deterministic", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const auth = f.credentials.merchant.receive;
  const empty = await f.api("GET", "/v1/web-orders?after=0&limit=2", {
    bearer: auth,
  });
  assert.deepEqual(empty.body, { orders: [], nextCursor: 0, hasMore: false });
  assert.equal(
    (await f.api("GET", "/v1/web-orders?after=-1", { bearer: auth })).status,
    400,
  );
  assert.equal(
    (await f.api("GET", "/v1/web-orders?limit=101", { bearer: auth })).status,
    400,
  );
});

test("cursor pagination advances without draining and preserves global sequence gaps between tenants", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const submit = async (bearer, k) =>
    f.api("POST", "/v1/web-orders", {
      bearer,
      headers: { "idempotency-key": k },
      body: makePayload(),
    });
  const first = await submit(f.credentials.merchant.siteA, key());
  await submit(f.credentials.other.siteA, key());
  const second = await submit(f.credentials.merchant.siteB, key());
  const p1 = await f.api("GET", "/v1/web-orders?limit=1", {
    bearer: f.credentials.merchant.receive,
  });
  assert.equal(p1.body.orders[0].id, first.body.order.id);
  assert.equal(p1.body.hasMore, true);
  assert.ok(p1.body.nextCursor < second.body.order.sequence);
  const p2 = await f.api(
    "GET",
    `/v1/web-orders?limit=1&after=${p1.body.nextCursor}`,
    { bearer: f.credentials.merchant.receive },
  );
  assert.equal(p2.body.orders[0].id, second.body.order.id);
  assert.equal(p2.body.hasMore, false);
  const again = await f.api("GET", "/v1/web-orders?limit=1", {
    bearer: f.credentials.merchant.receive,
  });
  assert.equal(again.body.orders[0].id, first.body.order.id);
});

test("orders survive server/database reopen with same credentials", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const k = key();
  const created = await f.api("POST", "/v1/web-orders", {
    bearer: f.credentials.merchant.siteA,
    headers: { "idempotency-key": k },
    body: makePayload(),
  });
  await f.reopen();
  const retry = await f.api("POST", "/v1/web-orders", {
    bearer: f.credentials.merchant.siteA,
    headers: { "idempotency-key": k },
    body: makePayload(),
  });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.order.id, created.body.order.id);
  assert.equal(
    (
      await f.api("GET", "/v1/web-orders", {
        bearer: f.credentials.merchant.receive,
      })
    ).body.orders[0].id,
    created.body.order.id,
  );
});

test("rate limit is configurable and fails closed for malformed configuration or untrusted quote prices", async (t) => {
  assert.throws(() =>
    createOrdersServer({ dbPath: "relative.sqlite", stores: [] }),
  );
  const f = await fixture({ rateLimit: 10 });
  t.after(f.close);
  const body = makePayload({
    items: [{ productRef: "x", name: "item", quantity: 1, unitPriceMinor: 1 }],
  });
  let last;
  for (let i = 0; i < 12; i++)
    last = await f.api("POST", "/v1/web-orders", {
      bearer: f.credentials.merchant.siteA,
      headers: { "idempotency-key": key() },
      body,
    });
  assert.equal(last.status, 429);
  assert.equal(last.headers.get("retry-after"), "60");
  const badStores = [
    [
      {
        id: "a",
        whatsappNumber: "5491111111111",
        receiveTokenHash: hash("same"),
        sites: [{ id: "s", submitTokenHash: hash("same") }],
      },
    ],
    [
      {
        id: "a",
        whatsappNumber: "5491111111111",
        receiveTokenHash: hash("r"),
        sites: [{ id: "s", submitTokenHash: "nope" }],
      },
    ],
  ];
  for (const stores of badStores)
    assert.throws(() =>
      createOrdersServer({
        dbPath: resolve(tmpdir(), `${randomBytes(6).toString("hex")}.sqlite`),
        stores,
      }),
    );
});

test("client-submitted prices remain explicitly unverified quotes", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const client = new WebOrdersClient(f.base, f.credentials.merchant.siteA);
  const quote = await client.submit(
    makePayload({
      items: [
        { productRef: "x", name: "Item", quantity: 1, unitPriceMinor: 1 },
      ],
    }),
    key(),
  );
  assert.equal(quote.order.quotedTotalMinor, 501);
  assert.equal(quote.order.paymentStatus, "UNVERIFIED");
  assert.equal(quote.order.status, "PENDING_CONFIRMATION");
  const receiver = new WebOrdersClient(f.base, f.credentials.merchant.receive);
  const page = await receiver.list();
  assert.equal(page.orders[0].id, quote.order.id);
  const ack = await receiver.acknowledgeReceived(quote.order.id);
  assert.ok(ack.receivedAt);
  assert.equal(ack.paymentStatus, "UNVERIFIED");
});
