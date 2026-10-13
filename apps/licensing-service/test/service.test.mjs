import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request as httpRequest } from "node:http";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { createLicenseServer } from "../dist/server.js";
import { leaseAccess, GRACE_MS } from "@gastronomy/licensing";

let dir, app, base, admin, code, licenseId, token, dbPath;
const installation = "install-123456789";
const otherInstall = "install-987654321";
const iso = (d) => d.toISOString();
const request = (
  path,
  { method = "GET", body: data, auth = true, headers = {} } = {},
) =>
  fetch(base + path, {
    method,
    headers: {
      ...(data !== undefined ? { "content-type": "application/json" } : {}),
      ...(auth ? { authorization: `Bearer ${admin}` } : {}),
      ...headers,
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "licensing-"));
  dbPath = join(dir, "licenses.sqlite");
  const pair = generateKeyPairSync("ed25519");
  const privateFile = join(dir, "private.pem");
  writeFileSync(
    privateFile,
    pair.privateKey.export({ type: "pkcs8", format: "pem" }),
  );
  admin = randomBytes(40).toString("base64url");
  app = createLicenseServer({
    dbPath,
    adminToken: admin,
    privateKey: pair.privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString(),
    rateLimit: 500,
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${app.server.address().port}`;
});
after(() => {
  app.close();
  rmSync(dir, { recursive: true, force: true });
});

test("health and manual create, activate idempotently with one bound installation", async () => {
  assert.equal((await request("/health", { auth: false })).status, 200);
  const paidThrough = iso(new Date(Date.now() + 86400000));
  let res = await request("/admin/licenses", {
    method: "POST",
    body: { businessName: "Café Uno", paidThrough },
  });
  assert.equal(res.status, 201);
  const created = await res.json();
  code = created.activationCode;
  licenseId = created.license.id;
  assert.equal(created.license.installationId, null);
  res = await request("/v1/activate", {
    method: "POST",
    auth: false,
    body: { code, installationId: installation },
  });
  assert.equal(res.status, 200);
  token = (await res.json()).token;
  res = await request("/v1/activate", {
    method: "POST",
    auth: false,
    body: { code, installationId: installation },
  });
  assert.equal(res.status, 200);
  assert.ok((await res.json()).token);
  res = await request("/v1/activate", {
    method: "POST",
    auth: false,
    body: { code, installationId: otherInstall },
  });
  assert.equal(res.status, 409);
});

test("verify signature/binding and refreshes current revision after idempotent absolute renewal", async () => {
  let res = await request("/v1/verify", {
    method: "POST",
    auth: false,
    body: { token, installationId: installation },
  });
  assert.equal(res.status, 200);
  const key = "renew-12345678";
  const paidThrough = iso(new Date(Date.now() + 30 * 86400000));
  res = await request(`/admin/licenses/${licenseId}/renew`, {
    method: "POST",
    body: { paidThrough, reason: "Manual payment", idempotencyKey: key },
  });
  assert.equal(res.status, 200);
  const renewed = await res.json();
  assert.equal(renewed.license.revision, 2);
  res = await request(`/admin/licenses/${licenseId}/renew`, {
    method: "POST",
    body: { paidThrough, reason: "Manual payment", idempotencyKey: key },
  });
  assert.equal((await res.json()).license.revision, 2);
  res = await request(`/admin/licenses/${licenseId}/renew`, {
    method: "POST",
    body: {
      paidThrough,
      reason: "Different audit reason",
      idempotencyKey: key,
    },
  });
  assert.equal(res.status, 409);
  res = await request(`/admin/licenses/${licenseId}/renew`, {
    method: "POST",
    body: {
      paidThrough: iso(new Date(Date.now() + 86400000)),
      reason: "Shorten",
      idempotencyKey: "renew-short-1234",
    },
  });
  assert.equal(res.status, 409);
  res = await request("/v1/verify", {
    method: "POST",
    auth: false,
    body: { token, installationId: installation },
  });
  assert.equal(res.status, 200);
  const next = (await res.json()).token;
  assert.notEqual(next, token);
  res = await request("/v1/verify", {
    method: "POST",
    auth: false,
    body: { token, installationId: otherInstall },
  });
  assert.equal(res.status, 401);
  res = await request("/admin/licenses");
  assert.equal((await res.json()).licenses[0].paidThrough, paidThrough);
});

test("rejects malformed dates/body and missing admin auth without leaking data", async () => {
  let res = await request("/admin/licenses", {
    method: "POST",
    body: { businessName: "Bad", paidThrough: "tomorrow" },
  });
  assert.equal(res.status, 400);
  res = await request("/admin/licenses", {
    method: "POST",
    body: {
      businessName: "Overflow",
      paidThrough: "+275760-09-13T00:00:00.000Z",
    },
  });
  assert.equal(res.status, 400);
  res = await request("/admin/licenses", {
    method: "POST",
    auth: false,
    body: { businessName: "No", paidThrough: iso(new Date()) },
  });
  assert.equal(res.status, 401);
  res = await request("/admin/licenses", {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: { businessName: "Wrong type", paidThrough: iso(new Date()) },
  });
  assert.equal(res.status, 415);
  res = await fetch(base + "/v1/activate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{",
  });
  assert.equal(res.status, 400);
  res = await fetch(base + "/v1/activate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: '{"x":"' + "x".repeat(17000) + '"}',
  });
  assert.equal(res.status, 413);
  const raw = await new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port: app.server.address().port,
        path: "//evil/path",
        method: "GET",
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode));
      },
    );
    req.on("error", reject);
    req.end();
  });
  assert.equal(raw, 400);
});

test("rate limit counts failed admin authentication and rejects overflow safely", async () => {
  const pair = generateKeyPairSync("ed25519");
  const limited = createLicenseServer({
    dbPath: join(dir, "rate.sqlite"),
    adminToken: admin,
    privateKey: pair.privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString(),
    rateLimit: 5,
  });
  await new Promise((resolve) =>
    limited.server.listen(0, "127.0.0.1", resolve),
  );
  const target = `http://127.0.0.1:${limited.server.address().port}/admin/licenses`;
  try {
    for (let i = 0; i < 5; i++)
      assert.equal(
        (await fetch(target, { headers: { authorization: "Bearer wrong" } }))
          .status,
        401,
      );
    assert.equal(
      (await fetch(target, { headers: { authorization: "Bearer wrong" } }))
        .status,
      429,
    );
  } finally {
    limited.close();
  }
});

test("persisted license survives a service reopen", async () => {
  app.close();
  const { generateKeyPairSync } = await import("node:crypto");
  const pair = generateKeyPairSync("ed25519");
  app = createLicenseServer({
    dbPath,
    adminToken: admin,
    privateKey: pair.privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString(),
    rateLimit: 500,
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${app.server.address().port}`;
  const res = await request("/admin/licenses");
  const data = await res.json();
  assert.ok(data.licenses.some((x) => x.id === licenseId));
});

test("lease access honors paid-through, three-day grace, and suspended status", () => {
  const paidThrough = new Date("2027-01-01T00:00:00.000Z");
  const lease = {
    schema: 1,
    product: "delta-nube-gastronomia",
    licenseId: "license-123456",
    installationId: installation,
    businessName: "Test",
    issuedAt: "2026-12-01T00:00:00.000Z",
    paidThrough: paidThrough.toISOString(),
    graceUntil: new Date(paidThrough.getTime() + GRACE_MS).toISOString(),
    revision: 1,
    status: "ACTIVE",
  };
  assert.equal(leaseAccess(lease, paidThrough.getTime() - 1), "ACTIVE");
  assert.equal(leaseAccess(lease, paidThrough.getTime()), "GRACE");
  assert.equal(leaseAccess(lease, paidThrough.getTime() + GRACE_MS), "EXPIRED");
  assert.equal(
    leaseAccess({ ...lease, status: "SUSPENDED" }, paidThrough.getTime() - 1),
    "SUSPENDED",
  );
});
