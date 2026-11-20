import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { OrdersStore } from "../dist/store.js";
import { createTenantStorefront } from "../dist/tenant-storefront.js";
import { parseBannerDataUrl } from "../dist/banner-image.js";
import { createOrdersServer } from "../dist/server.js";
import { issueWebSiteTicket } from "@gastronomy/web-orders/provision";
import { DatabaseSync } from "node:sqlite";

const fixture1 = await readFile(
  fileURLToPath(new URL("./banner-fixture.jpg", import.meta.url)),
);
const fixture2 = await readFile(
  fileURLToPath(new URL("./banner-fixture-2.jpg", import.meta.url)),
);
const jpeg = (n = 1) => (n === 2 ? fixture2 : fixture1);
const data = (n) => `data:image/jpeg;base64,${jpeg(n).toString("base64")}`;

test("tenant banners persist per site, replace/delete atomically, and serve by Host only while active", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "tenant-banner-")),
    dbPath = resolve(dir, "orders.sqlite");
  const db = new OrdersStore(dbPath, []);
  t.after(async () => {
    db.close();
    await rm(dir, { recursive: true, force: true });
  });
  const a = db.provisionTenant({
    licenseId: "la",
    installationId: "ia",
    businessName: "A",
    slug: "a",
    whatsappNumber: "",
    receiveToken: "a",
  });
  const b = db.provisionTenant({
    licenseId: "lb",
    installationId: "ib",
    businessName: "B",
    slug: "b",
    whatsappNumber: "",
    receiveToken: "b",
  });
  assert.equal(db.getTenantBySlug("a").has_banner, 0);
  assert.equal(
    db.getTenantBranding(a.storeId).bannerDataUrl,
    undefined,
    "legacy payload shape remains unchanged",
  );
  assert.equal(
    db.updateTenantBranding(a.storeId, {
      displayName: "A1",
      tagline: "tag",
      accent: "#123456",
      banner: parseBannerDataUrl(data(1)),
    }),
    true,
  );
  assert.equal(db.getTenantBySlug("a").has_banner, 1);
  assert.deepEqual(db.getTenantBanner(a.storeId), jpeg(1));
  assert.equal(db.getTenantBranding(a.storeId, true).bannerDataUrl, data(1));
  assert.equal(
    db.updateTenantBranding(a.storeId, {
      displayName: "A2",
      tagline: "tag2",
      accent: "#654321",
      banner: parseBannerDataUrl(data(2)),
    }),
    true,
  );
  assert.deepEqual(db.getTenantBanner(a.storeId), jpeg(2));
  assert.equal(db.getTenantBranding(a.storeId, true).displayName, "A2");
  assert.equal(db.getTenantBanner(b.storeId), null, "tenant isolation");
  assert.equal(
    db.updateTenantBranding(a.storeId, {
      displayName: "A3",
      tagline: "",
      accent: "#123456",
      banner: null,
    }),
    true,
  );
  assert.equal(db.getTenantBySlug("a").has_banner, 0);
  assert.equal(db.getTenantBanner(a.storeId), null);
  db.db
    .prepare("UPDATE tenant_sites SET design_mode='CUSTOM' WHERE store_id=?")
    .run(b.storeId);
  assert.equal(
    db.updateTenantBranding(b.storeId, {
      displayName: "B2",
      tagline: "",
      accent: "#123456",
      banner: parseBannerDataUrl(data(3)),
    }),
    false,
  );
  db.db
    .prepare("UPDATE tenant_sites SET access_until=? WHERE store_id=?")
    .run(new Date(Date.now() - 1000).toISOString(), a.storeId);
  assert.equal(
    db.updateTenantBranding(a.storeId, {
      displayName: "blocked",
      tagline: "",
      accent: "#123456",
    }),
    false,
    "expired site denied",
  );
});

test("opening a pre-cover tenant database preserves the existing shop and catalog", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "tenant-banner-upgrade-"));
  const dbPath = join(dir, "orders.sqlite");
  let store = new OrdersStore(dbPath, []);
  t.after(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  const { storeId } = store.provisionTenant({
    licenseId: "legacy-license",
    installationId: "legacy-pos",
    businessName: "Café original",
    slug: "cafe-original",
    whatsappNumber: "",
    receiveToken: "legacy",
  });
  store.publishCatalog(storeId, { products: [] });
  store.db.exec(
    "ALTER TABLE tenant_sites DROP COLUMN has_banner; ALTER TABLE tenant_sites DROP COLUMN banner_data",
  );
  store.close();
  store = new OrdersStore(dbPath, []);
  assert.equal(store.getTenantBySlug("cafe-original").has_banner, 0);
  assert.equal(
    store.getTenantBranding(storeId, true).displayName,
    "Café original",
  );
  assert.equal(store.getTenantBranding(storeId, true).bannerDataUrl, null);
  assert.deepEqual(store.getCatalog(storeId).snapshot.products, []);
});

test("banner parser rejects non-JPEG data, corrupt structure, and oversized dimensions", () => {
  for (const bad of [
    "https://example.com/x.jpg",
    "data:image/svg+xml;base64,AAAA",
    "data:image/jpeg;base64,Zm9v",
    `data:image/jpeg;base64,${Buffer.concat([fixture1.subarray(0, 20), Buffer.from([0xff, 0xd9])]).toString("base64")}`,
    `data:image/jpeg;base64,${"A".repeat(437000)}`,
  ])
    assert.throws(() => parseBannerDataUrl(bad));
});

test("public banner media is host-scoped and no-store", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "tenant-banner-media-")),
    dbPath = resolve(dir, "orders.sqlite");
  const db = new OrdersStore(dbPath, []);
  const site = db.provisionTenant({
    licenseId: "lm",
    installationId: "im",
    businessName: "Media",
    slug: "media",
    whatsappNumber: "",
    receiveToken: "m",
  });
  db.updateTenantBranding(site.storeId, {
    displayName: "Media",
    tagline: "",
    accent: "#123456",
    banner: jpeg(),
  });
  db.close();
  const runtimeDb = new OrdersStore(dbPath, []);
  const handler = createTenantStorefront({
    dbPath,
    store: runtimeDb,
    hostSuffix: "food.example",
    protocol: "http",
  });
  const server = (await import("node:http")).createServer(
    (req, res) =>
      void handler
        .handle(req, res, req.headers["x-site-host"])
        .then((handled) => {
          if (!handled) {
            res.writeHead(404);
            res.end();
          }
        }),
  );
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    handler.close();
    runtimeDb.close();
    await rm(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = (host) =>
    fetch(base + "/media/banner.jpg", { headers: { "x-site-host": host } });
  const good = await get("media.food.example");
  assert.equal(
    good.status,
    200,
    `public banner response: ${await good.clone().text()}`,
  );
  assert.equal(good.headers.get("content-type"), "image/jpeg");
  assert.match(good.headers.get("cache-control"), /no-store/);
  assert.deepEqual(Buffer.from(await good.arrayBuffer()), jpeg());
  assert.equal((await get("other.food.example")).status, 404);
  runtimeDb.db
    .prepare("UPDATE tenant_sites SET access_until=? WHERE store_id=?")
    .run(new Date(0).toISOString(), site.storeId);
  assert.equal((await get("media.food.example")).status, 404);
});

test("authenticated branding PATCH publishes, preserves, replaces, deletes and rejects atomically", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "tenant-banner-api-")),
    dbPath = resolve(dir, "orders.sqlite");
  const secret = "0123456789abcdef0123456789abcdef";
  const service = createOrdersServer({
    dbPath,
    stores: [],
    provisioning: { secret, baseDomain: "food.example" },
  });
  await new Promise((r) => service.server.listen(0, "127.0.0.1", r));
  t.after(async () => {
    service.server.closeAllConnections();
    await service.close();
    await rm(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${service.server.address().port}`;
  const ticket = issueWebSiteTicket(
    { licenseId: "lapi", installationId: "ipos", businessName: "API Cafe" },
    secret,
  );
  const created = await fetch(base + "/v1/web-sites", {
    method: "POST",
    headers: {
      authorization: `Bearer ${ticket}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ slug: "api-cafe", whatsappNumber: "5491112345678" }),
  });
  assert.equal(created.status, 201);
  const site = await created.json();
  const headers = {
    authorization: `Bearer ${site.receiveToken}`,
    "x-pos-installation": "ipos",
    "content-type": "application/json",
  };
  const legacyGet = await fetch(base + "/v1/web-sites/branding", { headers });
  assert.equal(legacyGet.status, 200);
  assert.equal(Object.hasOwn(await legacyGet.json(), "bannerDataUrl"), false);
  const patch = async (body, withBanner = true) =>
    fetch(base + "/v1/web-sites/branding", {
      method: "PATCH",
      headers: {
        ...headers,
        ...(withBanner ? { "x-web-site-banner": "1" } : {}),
      },
      body: JSON.stringify(body),
    });
  const baseFields = {
    displayName: "API Cafe",
    tagline: "",
    accent: "#123456",
  };
  assert.equal(
    (await patch({ ...baseFields, bannerDataUrl: data(1) })).status,
    200,
  );
  assert.equal(
    (
      await patch(
        { displayName: "API Updated", tagline: "", accent: "#123456" },
        false,
      )
    ).status,
    200,
    "old client updates text without mentioning banner",
  );
  let response = await fetch(base + "/v1/web-sites/branding", {
    headers: { ...headers, "x-web-site-banner": "1" },
  });
  let branding = await response.json();
  assert.equal(branding.displayName, "API Updated");
  assert.equal(branding.bannerDataUrl, data(1));
  assert.equal(
    (
      await patch({
        ...baseFields,
        displayName: "API Updated",
        bannerDataUrl: data(2),
      })
    ).status,
    200,
  );
  response = await fetch(base + "/v1/web-sites/branding", {
    headers: { ...headers, "x-web-site-banner": "1" },
  });
  branding = await response.json();
  assert.equal(branding.bannerDataUrl, data(2));
  assert.equal(
    (
      await patch({
        ...baseFields,
        displayName: "API Updated",
        bannerDataUrl: "https://host/banner.jpg",
      })
    ).status,
    400,
  );
  response = await fetch(base + "/v1/web-sites/branding", {
    headers: { ...headers, "x-web-site-banner": "1" },
  });
  branding = await response.json();
  assert.equal(branding.displayName, "API Updated");
  assert.equal(
    branding.bannerDataUrl,
    data(2),
    "invalid image leaves text and prior image unchanged",
  );
  assert.equal(
    (
      await patch({
        ...baseFields,
        displayName: "API Updated",
        bannerDataUrl: null,
      })
    ).status,
    200,
  );
  response = await fetch(base + "/v1/web-sites/branding", {
    headers: { ...headers, "x-web-site-banner": "1" },
  });
  branding = await response.json();
  assert.equal(branding.bannerDataUrl, null);
  const { "content-type": _contentType, ...wrongContentHeaders } = headers;
  const bad = await fetch(base + "/v1/web-sites/branding", {
    headers: wrongContentHeaders,
    method: "PATCH",
    body: JSON.stringify({
      ...baseFields,
      displayName: "API Updated",
      bannerDataUrl: data(1),
    }),
  });
  assert.equal(bad.status, 415);
  const sql = new DatabaseSync(dbPath);
  sql
    .prepare("UPDATE tenant_sites SET access_until=? WHERE license_id=?")
    .run(new Date(Date.now() - 1000).toISOString(), "lapi");
  sql.close();
  assert.equal(
    (await fetch(base + "/v1/web-sites/branding", { headers })).status,
    200,
    "authenticated POS can reconcile access expiry",
  );
  assert.equal(
    (
      await patch({
        ...baseFields,
        displayName: "API Updated",
        bannerDataUrl: data(1),
      })
    ).status,
    403,
  );
});
