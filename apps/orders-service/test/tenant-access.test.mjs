import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { OrdersStore } from "../dist/store.js";
import { createOrdersServer } from "../dist/server.js";
import { createTenantStorefront } from "../dist/tenant-storefront.js";
import { issueWebSiteTicket } from "@gastronomy/web-orders/provision";

const secret = "0123456789abcdef0123456789abcdef";
const access = (days) => new Date(Date.now() + days * 86400000).toISOString();
const token = () => randomBytes(32).toString("base64url");
const digest = (x) => createHash("sha256").update(x).digest("hex");

test("tenant access persists across restart, only extends, legacy claims do not clear it, and identity cannot change", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "tenant-access-store-")),
    dbPath = resolve(dir, "orders.sqlite");
  t.after(() => rm(dir, { recursive: true, force: true }));
  let db = new OrdersStore(dbPath, []);
  const exp1 = access(2),
    receive = token();
  const created = db.provisionTenant({
    licenseId: "lic",
    installationId: "pos",
    businessName: "Cafe",
    slug: "cafe",
    whatsappNumber: "5491112345678",
    receiveToken: receive,
    accessUntil: exp1,
  });
  assert.equal(db.getTenantBySlug("cafe").access_until, exp1);
  db.close();
  db = new OrdersStore(dbPath, []);
  assert.equal(
    db.getTenantBySlug("cafe").access_until,
    exp1,
    "expiry survives database reopen",
  );
  db.provisionTenant({
    licenseId: "lic",
    installationId: "pos",
    businessName: "Changed",
    slug: "renamed",
    whatsappNumber: "5491112345678",
    receiveToken: receive,
  });
  assert.equal(
    db.getTenantBySlug("cafe").access_until,
    exp1,
    "legacy replay cannot clear expiry",
  );
  assert.equal(
    db.getTenantBySlug("renamed"),
    undefined,
    "retry cannot change slug or tenant owner",
  );
  const exp2 = access(4);
  db.provisionTenant({
    licenseId: "lic",
    installationId: "pos",
    businessName: "Changed",
    slug: "renamed",
    whatsappNumber: "5491112345678",
    receiveToken: receive,
    accessUntil: exp2,
  });
  assert.equal(
    db.getTenantBySlug("cafe").access_until,
    exp2,
    "valid reprovision extends expiry",
  );
  db.provisionTenant({
    licenseId: "lic",
    installationId: "pos",
    businessName: "Old",
    slug: "renamed",
    whatsappNumber: "5491112345678",
    receiveToken: receive,
    accessUntil: exp1,
  });
  assert.equal(
    db.getTenantBySlug("cafe").access_until,
    exp2,
    "old ticket replay cannot shorten expiry",
  );
  assert.equal(db.getTenantBySlug("cafe").slug, "cafe");
  assert.equal(db.getTenantBySlug("cafe").store_id, created.storeId);
  assert.equal(db.tenantAccessExpired(created.storeId), false);
  assert.throws(
    () =>
      db.provisionTenant({
        licenseId: "other",
        installationId: "pos",
        businessName: "Hijack",
        slug: "other",
        whatsappNumber: "5491112345678",
        receiveToken: receive,
        accessUntil: access(10),
      }),
    /conflict/,
  );
  db.close();
});

test("access refresh endpoint verifies signed ticket, updates existing tenant only, and no site is created for missing tenant", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "tenant-access-api-")),
    dbPath = resolve(dir, "orders.sqlite");
  const service = createOrdersServer({
    dbPath,
    stores: [],
    provisioning: { secret, baseDomain: "example.com" },
  });
  await new Promise((r) => service.server.listen(0, "127.0.0.1", r));
  t.after(async () => {
    await service.close();
    await rm(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${service.server.address().port}`;
  const request = (ticket) =>
    fetch(base + "/v1/web-sites/access", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticket }),
    });
  const future = access(2),
    expired = new Date(Date.now() - 86400000).toISOString();
  const registerTicket = issueWebSiteTicket(
    {
      licenseId: "lic",
      installationId: "pos",
      businessName: "Cafe",
      accessUntil: expired,
    },
    secret,
  );
  let res = await fetch(base + "/v1/web-sites", {
    method: "POST",
    headers: {
      authorization: `Bearer ${registerTicket}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ slug: "cafe", whatsappNumber: "5491112345678" }),
  });
  assert.equal(res.status, 201);
  const first = await res.json();
  res = await request(
    issueWebSiteTicket(
      {
        licenseId: "lic",
        installationId: "pos",
        businessName: "Cafe",
        accessUntil: future,
      },
      secret,
    ),
  );
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  const db = new DatabaseSync(dbPath);
  assert.equal(
    db
      .prepare("SELECT access_until FROM tenant_sites WHERE license_id='lic'")
      .get().access_until,
    future,
  );
  res = await request(
    issueWebSiteTicket(
      {
        licenseId: "nobody",
        installationId: "no-pos",
        businessName: "No site",
        accessUntil: access(3),
      },
      secret,
    ),
  );
  assert.equal(res.status, 200);
  assert.equal(
    db.prepare("SELECT count(*) AS n FROM tenant_sites").get().n,
    1,
    "refresh must never create a site",
  );
  res = await request(
    issueWebSiteTicket(
      { licenseId: "lic", installationId: "pos", businessName: "Cafe" },
      secret,
    ),
  );
  assert.equal(
    res.status,
    200,
    "legacy active ticket refresh is a successful no-op",
  );
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(
    db
      .prepare("SELECT access_until FROM tenant_sites WHERE license_id='lic'")
      .get().access_until,
    future,
    "legacy refresh must not clear expiry",
  );
  res = await request(registerTicket + "tampered");
  assert.equal(res.status, 401);
  db.close();
  assert.ok(first.storeId);
});

test("expired storefront HTML, catalog APIs and checkout are gated while legacy sites stay public", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "tenant-access-storefront-")),
    dbPath = resolve(dir, "orders.sqlite");
  const db = new OrdersStore(dbPath, []),
    future = access(2),
    receive = token();
  const expiredSite = db.provisionTenant({
    licenseId: "trial",
    installationId: "trial-pos",
    businessName: "Trial",
    slug: "trial",
    whatsappNumber: "5491112345678",
    receiveToken: receive,
    accessUntil: new Date(Date.now() - 1000).toISOString(),
  });
  const legacy = db.provisionTenant({
    licenseId: "legacy",
    installationId: "legacy-pos",
    businessName: "Legacy",
    slug: "legacy",
    whatsappNumber: "5491112345679",
    receiveToken: token(),
  });
  assert.equal(
    db.getTenantBySlug("legacy").access_until,
    null,
    "legacy has no expiry",
  );
  db.publishCatalog(expiredSite.storeId, {
    products: [
      {
        productRef: "p",
        name: "Tea",
        category: "Drinks",
        takeawayPriceMinor: 100,
        deliveryPriceMinor: 100,
      },
    ],
  });
  db.close();
  const handler = createTenantStorefront({
    dbPath,
    hostSuffix: "food.example",
    protocol: "http",
  });
  const http = await import("node:http");
  const server = http.createServer(
    (req, res) =>
      void handler
        .handle(req, res, req.headers["x-test-host"])
        .then((handled) => {
          if (!handled) {
            res.writeHead(404);
            res.end();
          }
        }),
  );
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(async () => {
    await new Promise((r) => server.close(r));
    handler.close();
    await rm(dir, { recursive: true, force: true });
  });
  const port = server.address().port,
    host = `trial.food.example:${port}`;
  const get = (path) =>
    fetch(`http://127.0.0.1:${port}${path}`, {
      headers: { "x-test-host": host },
    });
  const page = await get("/");
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Sitio pausado/);
  let res = await get("/api/catalog");
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { error: "site_expired" });
  res = await fetch(`http://127.0.0.1:${port}/api/checkout`, {
    method: "POST",
    headers: {
      "x-test-host": host,
      origin: `http://trial.food.example:${port}`,
      "content-type": "application/json",
      "idempotency-key": "expired-site-order-1234",
    },
    body: "{}",
  });
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { error: "site_expired" });
  const check = new DatabaseSync(dbPath);
  assert.equal(
    check.prepare("SELECT count(*) AS n FROM orders").get().n,
    0,
    "expired checkout creates no order",
  );
  check.close();
  res = await fetch(`http://127.0.0.1:${port}/api/catalog`, {
    headers: { "x-test-host": `legacy.food.example:${port}` },
  });
  assert.equal(res.status, 200);
  assert.equal(future > new Date().toISOString(), true);
});

test("authenticated v1 catalog and checkout cannot bypass tenant expiry", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "tenant-access-v1-")),
    dbPath = resolve(dir, "orders.sqlite");
  const seed = new OrdersStore(dbPath, []),
    receive = token(),
    submit = token();
  const site = seed.provisionTenant({
    licenseId: "trial",
    installationId: "trial-pos",
    businessName: "Trial",
    slug: "trial",
    whatsappNumber: "5491112345678",
    receiveToken: receive,
    accessUntil: new Date(Date.now() - 1000).toISOString(),
  });
  seed.publishCatalog(site.storeId, { products: [] });
  seed.close();
  const service = createOrdersServer({
    dbPath,
    stores: [
      {
        id: site.storeId,
        whatsappNumber: "5491112345678",
        receiveTokenHash: digest(receive),
        receiveInstallationId: "trial-pos",
        sites: [{ id: "web", submitTokenHash: digest(submit) }],
      },
    ],
  });
  await new Promise((r) => service.server.listen(0, "127.0.0.1", r));
  t.after(async () => {
    await service.close();
    await rm(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${service.server.address().port}`;
  let res = await fetch(base + "/v1/web-catalog", {
    headers: { authorization: `Bearer ${submit}` },
  });
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { error: "site_expired" });
  res = await fetch(base + "/v1/web-orders", {
    method: "POST",
    headers: {
      authorization: `Bearer ${submit}`,
      "idempotency-key": "expired-api-order-1234",
      "content-type": "application/json",
    },
    body: "{}",
  });
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { error: "site_expired" });
  const check = new DatabaseSync(dbPath);
  assert.equal(check.prepare("SELECT count(*) AS n FROM orders").get().n, 0);
  check.close();
});

test("OrdersStore.submit enforces expiry inside the insert transaction", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "tenant-access-submit-")),
    dbPath = resolve(dir, "orders.sqlite");
  t.after(() => rm(dir, { recursive: true, force: true }));
  const db = new OrdersStore(dbPath, []);
  const tenant = db.provisionTenant({
    licenseId: "expired",
    installationId: "expired-pos",
    businessName: "Expired",
    slug: "expired",
    whatsappNumber: "5491112345678",
    receiveToken: token(),
    accessUntil: new Date(Date.now() + 60_000).toISOString(),
  });
  const submission = {
    schemaVersion: 1,
    currency: "ARS",
    customer: { name: "Ana", phone: "1112345678" },
    fulfillment: { type: "TAKEAWAY" },
    deliveryFeeMinor: 0,
    paymentMethod: "OTHER",
    items: [
      { productRef: "tea", name: "Tea", quantity: 1, unitPriceMinor: 100 },
    ],
  };
  // Simulate the HTTP body read crossing the deadline; the DB transaction must be authoritative.
  const past = new Date(Date.now() - 1000).toISOString();
  const raw = new DatabaseSync(dbPath);
  raw
    .prepare(
      "UPDATE tenant_sites SET access_until=? WHERE license_id='expired'",
    )
    .run(past);
  raw.close();
  assert.throws(
    () =>
      db.submit(tenant.storeId, "web", "expired-store-submit-1234", submission),
    (e) => e.code === "site_expired" && e.status === 403,
  );
  const check = new DatabaseSync(dbPath);
  assert.equal(
    check.prepare("SELECT count(*) AS n FROM orders").get().n,
    0,
    "direct store submission inserts no expired order",
  );
  check.close();
  db.close();
});
