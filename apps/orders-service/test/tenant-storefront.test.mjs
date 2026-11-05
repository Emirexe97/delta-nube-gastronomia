import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { OrdersStore } from "../dist/store.js";
import {
  createTenantStorefront,
  resolveTenantHost,
} from "../dist/tenant-storefront.js";
import { renderTenantStorefront } from "../dist/storefront-page.js";

test("tenant Host resolution is exact-label and ignores spoofed forwarding conventions", () => {
  assert.equal(
    resolveTenantHost("bistro.food.example:8443", "food.example", ["api"]),
    "bistro",
  );
  assert.equal(
    resolveTenantHost("bistro.food.example.evil", "food.example"),
    undefined,
  );
  assert.equal(resolveTenantHost("food.example", "food.example"), undefined);
  assert.equal(
    resolveTenantHost("api.food.example", "food.example", ["api"]),
    undefined,
  );
  assert.equal(
    resolveTenantHost("a.b.food.example", "food.example"),
    undefined,
  );
  assert.equal(
    resolveTenantHost("bistro.food.example,evil", "food.example"),
    undefined,
  );
});

test("tenant storefront scopes catalog and checkout to the trusted Host's tenant", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "tenant-shop-")),
    dbPath = resolve(dir, "orders.sqlite");
  const db = new OrdersStore(dbPath, []);
  const a = db.provisionTenant({
    licenseId: "l1",
    installationId: "i1",
    businessName: "A Café",
    slug: "a-cafe",
    whatsappNumber: "5491112345678",
    receiveToken: randomBytes(32).toString("base64url"),
  });
  const b = db.provisionTenant({
    licenseId: "l2",
    installationId: "i2",
    businessName: "B Café",
    slug: "b-cafe",
    whatsappNumber: "5491112345679",
    receiveToken: randomBytes(32).toString("base64url"),
  });
  db.publishCatalog(a.storeId, {
    products: [
      {
        productRef: "a-tea",
        name: "Té A",
        category: "Bebidas",
        takeawayPriceMinor: 100,
        deliveryPriceMinor: 100,
      },
    ],
  });
  db.publishCatalog(b.storeId, {
    products: [
      {
        productRef: "b-tea",
        name: "Té B",
        category: "Bebidas",
        takeawayPriceMinor: 200,
        deliveryPriceMinor: 200,
      },
    ],
  });
  db.close();
  const handler = createTenantStorefront({
    dbPath,
    hostSuffix: "food.example",
    reservedHosts: ["api"],
    protocol: "http",
  });
  const server = (await import("node:http")).createServer(
    (req, res) =>
      void handler
        .handle(req, res, req.headers["x-test-host"])
        .then((handled) => {
          if (!handled) {
            res.writeHead(404);
            res.end();
          }
        })
        .catch((e) => {
          res.writeHead(500);
          res.end(String(e));
        }),
  );
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(async () => {
    await new Promise((r) => server.close(r));
    handler.close();
    await rm(dir, { recursive: true, force: true });
  });
  const port = server.address().port,
    get = (slug, path) =>
      fetch(`http://127.0.0.1:${port}${path}`, {
        headers: { "x-test-host": `${slug}.food.example:${port}` },
      });
  const storefront = await get("a-cafe", "/");
  assert.equal(storefront.status, 200);
  assert.match(
    storefront.headers.get("content-security-policy"),
    /script-src 'sha256-/,
  );
  assert.doesNotMatch(
    storefront.headers.get("content-security-policy"),
    /script-src 'unsafe-inline'/,
  );
  const [catalogA, catalogB] = await Promise.all([
    get("a-cafe", "/api/catalog"),
    get("b-cafe", "/api/catalog"),
  ]);
  assert.equal((await catalogA.json()).snapshot.products[0].name, "Té A");
  assert.equal((await catalogB.json()).snapshot.products[0].name, "Té B");
  assert.equal((await get("missing", "/api/catalog")).status, 404);
  const body = {
    schemaVersion: 1,
    currency: "ARS",
    customer: { name: "Ana", phone: "1112345678" },
    fulfillment: { type: "TAKEAWAY" },
    deliveryFeeMinor: 0,
    paymentMethod: "OTHER",
    items: [
      { productRef: "a-tea", name: "Té A", quantity: 1, unitPriceMinor: 100 },
    ],
  };
  const checkout = await fetch(`http://127.0.0.1:${port}/api/checkout`, {
    method: "POST",
    headers: {
      "x-test-host": `a-cafe.food.example:${port}`,
      origin: `http://a-cafe.food.example:${port}`,
      "content-type": "application/json",
      "idempotency-key": "tenant-test-key-1234",
    },
    body: JSON.stringify(body),
  });
  assert.equal(checkout.status, 201);
  const alien = await fetch(`http://127.0.0.1:${port}/api/checkout`, {
    method: "POST",
    headers: {
      "x-test-host": `b-cafe.food.example:${port}`,
      origin: `http://b-cafe.food.example:${port}`,
      "content-type": "application/json",
      "idempotency-key": "tenant-test-key-1235",
    },
    body: JSON.stringify(body),
  });
  assert.equal(alien.status, 409);
});

test("merchant branding is escaped and developer templates are fixed allowlist choices", () => {
  const site = {
    display_name: "<img src=x onerror=alert(1)> $& $' $`",
    tagline: "<script>x</script> $& $' $`",
    accent: "red;}</style><script>",
    design_mode: "CUSTOM",
    template_key: "midnight-market-v1",
  };
  const html = renderTenantStorefront(site, true);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;script&gt;x&lt;\/script&gt;/); // merchant markup is escaped
  assert.match(html, /\$&amp; \$&#39; \$`/); // replacement tokens remain inert literal text
  assert.match(html, /--accent: #1f6f50/);
  assert.match(html, /background:#172321/);
  assert.doesNotMatch(html, /red;\}/);
  const unknown = renderTenantStorefront(
    { ...site, template_key: "<script>" },
    true,
  );
  assert.doesNotMatch(unknown, /background:#172321/);
});
