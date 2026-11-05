import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createOrdersServer } from "../dist/server.js";
import { createStorefrontServer } from "../dist/storefront.js";

test("same-origin storefront consumes a fixed submit-token catalog and submits a pending checkout without exposing secrets", async (t) => {
  const token = randomBytes(32).toString("base64url"),
    hash = createHash("sha256").update(token).digest("hex"),
    dir = await mkdtemp(join(tmpdir(), "storefront-"));
  const orders = createOrdersServer({
    dbPath: resolve(dir, "orders.sqlite"),
    stores: [
      {
        id: "pilot",
        whatsappNumber: "5491112345678",
        receiveTokenHash: createHash("sha256")
          .update(randomBytes(32))
          .digest("hex"),
        sites: [{ id: "main", submitTokenHash: hash }],
      },
    ],
  });
  await new Promise((r) => orders.server.listen(0, "127.0.0.1", r));
  const ordersUrl = `http://127.0.0.1:${orders.server.address().port}`;
  const put = await fetch(ordersUrl + "/v1/web-catalog", {
    method: "PUT",
    headers: {
      authorization: `Bearer ${randomBytes(32).toString("base64url")}`,
      "x-expected-store-id": "pilot",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      products: [
        {
          productRef: "tea",
          name: "Té",
          category: "Bebidas",
          takeawayPriceMinor: 100,
          deliveryPriceMinor: 100,
        },
      ],
    }),
  });
  // Wrong token cannot publish; seed the pilot snapshot through its authorized receive scope.
  assert.equal(put.status, 401);
  const receive = randomBytes(32).toString("base64url");
  await orders.close();
  const service = createOrdersServer({
    dbPath: resolve(dir, "orders.sqlite"),
    stores: [
      {
        id: "pilot",
        whatsappNumber: "5491112345678",
        receiveTokenHash: createHash("sha256").update(receive).digest("hex"),
        sites: [{ id: "main", submitTokenHash: hash }],
      },
    ],
  });
  await new Promise((r) => service.server.listen(0, "127.0.0.1", r));
  const api = `http://127.0.0.1:${service.server.address().port}`;
  const published = await fetch(api + "/v1/web-catalog", {
    method: "PUT",
    headers: {
      authorization: `Bearer ${receive}`,
      "x-expected-store-id": "pilot",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      products: [
        {
          productRef: "tea",
          name: "Té",
          category: "Bebidas",
          takeawayPriceMinor: 100,
          deliveryPriceMinor: 100,
        },
      ],
    }),
  });
  assert.equal(published.status, 200);
  const origin = "http://127.0.0.1:8099",
    shop = createStorefrontServer({
      ordersUrl: api,
      submitToken: token,
      siteId: "main",
      storeId: "pilot",
      origin,
    });
  await new Promise((r) => shop.server.listen(0, "127.0.0.1", r));
  t.after(async () => {
    await shop.close();
    await service.close();
    await rm(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${shop.server.address().port}`,
    page = await fetch(base + "/");
  assert.equal(page.status, 200);
  const markup = await page.text();
  assert.match(markup, /Menú online/);
  assert.ok(!markup.includes(token));
  const catalog = await fetch(base + "/api/catalog");
  assert.equal((await catalog.json()).snapshot.products[0].name, "Té");
  const wrongStore = createStorefrontServer({
    ordersUrl: api,
    submitToken: token,
    siteId: "main",
    storeId: "other-store",
    origin,
  });
  await new Promise((r) => wrongStore.server.listen(0, "127.0.0.1", r));
  t.after(() => wrongStore.close());
  const wrongStoreResponse = await fetch(
    `http://127.0.0.1:${wrongStore.server.address().port}/api/catalog`,
  );
  assert.equal(wrongStoreResponse.status, 403);
  const wrongSite = createStorefrontServer({
    ordersUrl: api,
    submitToken: token,
    siteId: "site-b",
    storeId: "pilot",
    origin,
  });
  await new Promise((r) => wrongSite.server.listen(0, "127.0.0.1", r));
  t.after(() => wrongSite.close());
  const wrongSiteResponse = await fetch(
    `http://127.0.0.1:${wrongSite.server.address().port}/api/catalog`,
  );
  assert.equal(wrongSiteResponse.status, 403);
  const order = {
    schemaVersion: 1,
    currency: "ARS",
    customer: { name: "Ana", phone: "+5491112345678" },
    fulfillment: { type: "TAKEAWAY" },
    items: [
      { productRef: "tea", name: "Té", quantity: 1, unitPriceMinor: 100 },
    ],
    deliveryFeeMinor: 0,
    paymentMethod: "OTHER",
  };
  const checkout = await fetch(base + "/api/checkout", {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/json",
      "idempotency-key": "pilot-checkout-key-001",
    },
    body: JSON.stringify(order),
  });
  assert.equal(checkout.status, 201);
  assert.equal((await checkout.json()).order.status, "PENDING_CONFIRMATION");
  const forbidden = await fetch(base + "/api/checkout", {
    method: "POST",
    headers: {
      origin: "https://evil.test",
      "content-type": "application/json",
      "idempotency-key": "pilot-checkout-key-002",
    },
    body: JSON.stringify(order),
  });
  assert.equal(forbidden.status, 403);
});
