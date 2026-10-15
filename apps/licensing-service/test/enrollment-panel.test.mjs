import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { createLicenseServer } from "../dist/server.js";
import {
  devicePublicKeyFingerprint,
  signDeviceProof,
  verifyLease,
} from "@gastronomy/licensing";
import { hashPanelPassword } from "../dist/panel-auth.js";

const origin = "https://owner.example.test";
const password = "private-owner-password-2026";
const installationId = "install-pending-0001";
const deviceKeyPair = () => generateKeyPairSync("ed25519");
const pem = (key) => key.export({ type: "spki", format: "pem" }).toString();
const privatePem = (key) =>
  key.export({ type: "pkcs8", format: "pem" }).toString();
const iso = (value) => value.toISOString();
const dayFromNow = (days) => iso(new Date(Date.now() + days * 86400000));

let dir;
let app;
let base;
let admin;
let privateKey;
let publicKey;
let ownerCookie;
let csrfToken;
let passwordHash;

function api(
  path,
  {
    method = "GET",
    data,
    auth = false,
    cookie,
    csrf,
    requestOrigin = origin,
  } = {},
) {
  return fetch(`${base}${path}`, {
    method,
    headers: {
      ...(data !== undefined ? { "content-type": "application/json" } : {}),
      ...(auth ? { authorization: `Bearer ${admin}` } : {}),
      ...(cookie ? { cookie } : {}),
      ...(csrf ? { "x-panel-csrf": csrf } : {}),
      ...(requestOrigin ? { origin: requestOrigin } : {}),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
}

async function login() {
  const response = await api("/manage/api/login", {
    method: "POST",
    data: { username: "owner", password },
  });
  assert.equal(response.status, 200);
  const setCookie = response.headers.get("set-cookie");
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  assert.match(setCookie, /Secure/);
  ownerCookie = setCookie.match(/dng_owner=([^;]+)/)[1];
  csrfToken = (await response.json()).csrfToken;
  return response;
}

async function makeDeviceRequest(
  keyPair = deviceKeyPair(),
  name = "Café Uno",
  install = installationId,
) {
  const publicKeyPem = pem(keyPair.publicKey);
  const keyFingerprint = devicePublicKeyFingerprint(publicKeyPem);
  const challengeResponse = await api("/v2/devices/challenge", {
    method: "POST",
    data: {
      installationId: install,
      publicKey: publicKeyPem,
      purpose: "request",
    },
  });
  assert.equal(challengeResponse.status, 200);
  const challenge = await challengeResponse.json();
  const proof = {
    purpose: "request",
    challengeId: challenge.challengeId,
    nonce: challenge.nonce,
    installationId: install,
    keyFingerprint,
    businessName: name.trim(),
  };
  const signed = {
    installationId: install,
    publicKey: publicKeyPem,
    businessName: name,
    challengeId: challenge.challengeId,
    signature: signDeviceProof(proof, privatePem(keyPair.privateKey)),
  };
  const response = await api("/v2/devices/request", {
    method: "POST",
    data: signed,
  });
  return { response, signed, challenge, keyPair, keyFingerprint };
}

async function deviceLeaseProof(keyPair, install = installationId) {
  const publicKeyPem = pem(keyPair.publicKey);
  const keyFingerprint = devicePublicKeyFingerprint(publicKeyPem);
  const challengeResponse = await api("/v2/devices/challenge", {
    method: "POST",
    data: {
      installationId: install,
      publicKey: publicKeyPem,
      purpose: "lease",
    },
  });
  assert.equal(challengeResponse.status, 200);
  const challenge = await challengeResponse.json();
  const proof = {
    purpose: "lease",
    challengeId: challenge.challengeId,
    nonce: challenge.nonce,
    installationId: install,
    keyFingerprint,
  };
  return {
    installationId: install,
    publicKey: publicKeyPem,
    challengeId: challenge.challengeId,
    signature: signDeviceProof(proof, privatePem(keyPair.privateKey)),
  };
}

async function createLegacyLicense(name = "Legacy owner license") {
  const response = await api("/admin/licenses", {
    auth: true,
    method: "POST",
    data: { businessName: name, paidThrough: dayFromNow(30) },
  });
  assert.equal(response.status, 201);
  return (await response.json()).license;
}

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "license-owner-panel-"));
  const pair = generateKeyPairSync("ed25519");
  privateKey = privatePem(pair.privateKey);
  publicKey = pem(pair.publicKey);
  admin = randomBytes(40).toString("base64url");
  passwordHash = await hashPanelPassword(password);
  app = createLicenseServer({
    dbPath: join(dir, "licenses.sqlite"),
    adminToken: admin,
    privateKey,
    rateLimit: 500,
    panelAuth: { username: "owner", passwordHash, origin, secureCookies: true },
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${app.server.address().port}`;
  await login();
});

after(() => {
  app?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

test("panel pages/assets and cookie session are private, session is revocable, and CSRF/origin are enforced", async () => {
  const page = await api("/manage/");
  assert.equal(page.status, 200);
  assert.match(
    page.headers.get("content-security-policy"),
    /script-src 'self'/,
  );
  assert.match(await page.text(), /Ingresar al panel/);
  assert.equal((await api("/manage/panel.js")).status, 200);
  assert.equal((await api("/manage/api/session")).status, 401);
  assert.equal(
    (
      await api("/manage/api/login", {
        method: "POST",
        data: { username: "owner", password },
        requestOrigin: "https://evil.example",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await api("/manage/api/login", {
        method: "POST",
        data: { username: "owner", password: "wrong-password" },
      })
    ).status,
    401,
  );
  const session = await api("/manage/api/session", {
    cookie: `dng_owner=${ownerCookie}`,
  });
  assert.equal(session.status, 200);
  assert.equal((await session.json()).csrfToken, csrfToken);
  assert.equal(
    (
      await api("/manage/api/logout", {
        method: "POST",
        data: {},
        cookie: `dng_owner=${ownerCookie}`,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await api("/manage/api/logout", {
        method: "POST",
        data: {},
        cookie: `dng_owner=${ownerCookie}`,
        csrf: csrfToken,
        requestOrigin: "https://evil.example",
      })
    ).status,
    403,
  );
  const logout = await api("/manage/api/logout", {
    method: "POST",
    data: {},
    cookie: `dng_owner=${ownerCookie}`,
    csrf: csrfToken,
  });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get("set-cookie"), /Max-Age=0/);
  assert.equal(
    (await api("/manage/api/session", { cookie: `dng_owner=${ownerCookie}` }))
      .status,
    401,
  );
  await login();
});

test("v2 challenge is purpose/key/id bound, one-use, and pending requests never receive a lease", async () => {
  const pair = deviceKeyPair();
  const { response, signed, challenge } = await makeDeviceRequest(pair);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.request.status, "PENDING");
  assert.equal(
    data.request.keyFingerprint,
    devicePublicKeyFingerprint(pem(pair.publicKey)),
  );
  assert.equal("token" in data, false);

  const replay = await api("/v2/devices/request", {
    method: "POST",
    data: signed,
  });
  assert.equal(replay.status, 409);
  assert.equal((await replay.json()).error, "challenge_replayed");

  const unapprovedLease = await api("/v2/devices/lease", {
    method: "POST",
    data: await deviceLeaseProof(pair, "install-existing-001"),
  });
  assert.equal(unapprovedLease.status, 401);
  assert.equal((await unapprovedLease.json()).error, "device_not_approved");

  const wrongPurpose = await api("/v2/devices/challenge", {
    method: "POST",
    data: { installationId, publicKey: pem(pair.publicKey), purpose: "lease" },
  });
  const leaseChallenge = await wrongPurpose.json();
  const wrongProof = {
    purpose: "lease",
    challengeId: leaseChallenge.challengeId,
    nonce: leaseChallenge.nonce,
    installationId,
    keyFingerprint: devicePublicKeyFingerprint(pem(pair.publicKey)),
  };
  const mismatch = await api("/v2/devices/request", {
    method: "POST",
    data: {
      installationId,
      publicKey: pem(pair.publicKey),
      businessName: "Café Uno",
      challengeId: leaseChallenge.challengeId,
      signature: signDeviceProof(wrongProof, privatePem(pair.privateKey)),
    },
  });
  assert.equal(mismatch.status, 409);
  assert.equal((await mismatch.json()).error, "challenge_binding_mismatch");
  assert.ok(challenge.expiresAt);
});

test("owner explicitly approves a matching existing license; signed lease works and no activation code is returned", async () => {
  const pair = deviceKeyPair();
  const { response, keyFingerprint } = await makeDeviceRequest(
    pair,
    "Cafe Sur",
    "install-existing-001",
  );
  const pending = await response.json();
  const existingLicense = await createLegacyLicense("Existing paid business");
  const approved = await api(
    `/manage/api/requests/${pending.request.id}/approve`,
    {
      method: "POST",
      data: {
        licenseId: existingLicense.id,
        reason: "Verifiqué huella y licencia",
      },
      cookie: `dng_owner=${ownerCookie}`,
      csrf: csrfToken,
    },
  );
  assert.equal(approved.status, 200);
  const approval = await approved.json();
  assert.equal(approval.request.status, "APPROVED");
  assert.equal(approval.request.keyFingerprint, keyFingerprint);
  assert.equal(approval.license.installationId, "install-existing-001");
  assert.equal("activationCode" in approval, false);

  const leaseResponse = await api("/v2/devices/lease", {
    method: "POST",
    data: await deviceLeaseProof(pair, "install-existing-001"),
  });
  assert.equal(leaseResponse.status, 200);
  const lease = await leaseResponse.json();
  assert.equal(lease.request.id, pending.request.id);
  assert.equal(lease.request.status, "APPROVED");
  assert.equal(lease.request.keyFingerprint, keyFingerprint);
  assert.equal(
    verifyLease(lease.token, publicKey, "install-existing-001").licenseId,
    existingLicense.id,
  );

  const overview = await api("/manage/api/overview", {
    cookie: `dng_owner=${ownerCookie}`,
  });
  const data = await overview.json();
  assert.equal(data.requests[0].status, "APPROVED");
  assert.equal(
    data.licenses.find((row) => row.id === existingLicense.id).keyFingerprint,
    keyFingerprint,
  );
  assert.equal("activation_hash" in data.licenses[0], false);
  assert.equal("public_key" in data.requests[0], false);
  assert.ok(
    data.audit.some(
      (row) =>
        row.action === "REQUEST_APPROVED" &&
        row.reason === "Verifiqué huella y licencia",
    ),
  );

  // Idempotent approval of the same selected device/license does not create another audit row.
  const repeated = await api(
    `/manage/api/requests/${pending.request.id}/approve`,
    {
      method: "POST",
      data: { licenseId: existingLicense.id, reason: "same approval" },
      cookie: `dng_owner=${ownerCookie}`,
      csrf: csrfToken,
    },
  );
  assert.equal(repeated.status, 200);
  assert.equal((await repeated.json()).idempotent, true);
});

test("owner rejects pending device; requests cannot transfer a key or bypass one-approved-device policy", async () => {
  const rejected = await makeDeviceRequest(
    deviceKeyPair(),
    "Reject Me",
    "install-reject-01",
  );
  const rejectedData = await rejected.response.json();
  const rejectedResponse = await api(
    `/manage/api/requests/${rejectedData.request.id}/reject`,
    {
      method: "POST",
      data: { reason: "No se reconoce este equipo" },
      cookie: `dng_owner=${ownerCookie}`,
      csrf: csrfToken,
    },
  );
  assert.equal(rejectedResponse.status, 200);
  assert.equal((await rejectedResponse.json()).request.status, "REJECTED");
  const recoveryLicense = await createLegacyLicense(
    "Recovered after false rejection",
  );
  const recoveredApproval = await api(
    `/manage/api/requests/${rejectedData.request.id}/approve`,
    {
      method: "POST",
      data: {
        licenseId: recoveryLicense.id,
        reason: "Owner verified rejection was mistaken",
      },
      cookie: `dng_owner=${ownerCookie}`,
      csrf: csrfToken,
    },
  );
  assert.equal(recoveredApproval.status, 200);
  assert.equal((await recoveredApproval.json()).request.status, "APPROVED");

  const firstPair = deviceKeyPair();
  const first = await makeDeviceRequest(
    firstPair,
    "New business",
    "install-newowner-001",
  );
  const firstData = await first.response.json();
  const newApproval = await api(
    `/manage/api/requests/${firstData.request.id}/approve`,
    {
      method: "POST",
      data: {
        businessName: "New business",
        paidThrough: "9999-01-01T00:00:00.000Z",
        reason: "Owner checked fingerprint",
      },
      cookie: `dng_owner=${ownerCookie}`,
      csrf: csrfToken,
    },
  );
  assert.equal(newApproval.status, 200);
  assert.equal("activationCode" in (await newApproval.json()), false);

  const sameKeyDifferentInstall = await makeDeviceRequest(
    firstPair,
    "Transfer",
    "install-transfer-123",
  );
  assert.equal(sameKeyDifferentInstall.response.status, 409);
  assert.equal(
    (await sameKeyDifferentInstall.response.json()).error,
    "device_key_already_registered",
  );

  const secondPair = deviceKeyPair();
  const second = await makeDeviceRequest(
    secondPair,
    "Second key",
    "install-newowner-001",
  );
  const secondData = await second.response.json();
  assert.equal(secondData.request.status, "PENDING");
  const secondApproval = await api(
    `/manage/api/requests/${secondData.request.id}/approve`,
    {
      method: "POST",
      data: {
        businessName: "Should Not Create",
        paidThrough: "9999-01-01T00:00:00.000Z",
        reason: "Must not duplicate",
      },
      cookie: `dng_owner=${ownerCookie}`,
      csrf: csrfToken,
    },
  );
  assert.equal(secondApproval.status, 409);
});

test("license status and renewal enforce expected revision and audited race-safe transitions", async () => {
  const license = await createLegacyLicense("Revision controlled");
  const payload = (status) => ({
    status,
    expectedRevision: 1,
    reason: `Set ${status}`,
  });
  const competing = await Promise.all([
    api(`/manage/api/licenses/${license.id}/status`, {
      method: "POST",
      data: payload("SUSPENDED"),
      cookie: `dng_owner=${ownerCookie}`,
      csrf: csrfToken,
    }),
    api(`/manage/api/licenses/${license.id}/status`, {
      method: "POST",
      data: payload("SUSPENDED"),
      cookie: `dng_owner=${ownerCookie}`,
      csrf: csrfToken,
    }),
  ]);
  assert.deepEqual(
    competing.map((response) => response.status).sort(),
    [200, 409],
  );
  const statusData = await (
    await api("/manage/api/overview", { cookie: `dng_owner=${ownerCookie}` })
  ).json();
  const suspended = statusData.licenses.find((row) => row.id === license.id);
  assert.equal(suspended.status, "SUSPENDED");
  assert.equal(suspended.revision, 2);

  const shortened = await api(`/manage/api/licenses/${license.id}/renew`, {
    method: "POST",
    data: {
      paidThrough: dayFromNow(1),
      expectedRevision: 2,
      reason: "Must not shorten",
    },
    cookie: `dng_owner=${ownerCookie}`,
    csrf: csrfToken,
  });
  assert.equal(shortened.status, 422);
  const renewal = await api(`/manage/api/licenses/${license.id}/renew`, {
    method: "POST",
    data: {
      paidThrough: dayFromNow(60),
      expectedRevision: 2,
      reason: "Payment received",
    },
    cookie: `dng_owner=${ownerCookie}`,
    csrf: csrfToken,
  });
  assert.equal(renewal.status, 200);
  const renewed = (await renewal.json()).license;
  assert.equal(renewed.revision, 3);
  assert.equal(renewed.status, "SUSPENDED");
  assert.equal(
    (
      await api(`/manage/api/licenses/${license.id}/status`, {
        method: "POST",
        data: { status: "ACTIVE", expectedRevision: 2, reason: "Stale" },
        cookie: `dng_owner=${ownerCookie}`,
        csrf: csrfToken,
      })
    ).status,
    409,
  );
  const reactivated = await api(`/manage/api/licenses/${license.id}/status`, {
    method: "POST",
    data: { status: "ACTIVE", expectedRevision: 3, reason: "Verified payment" },
    cookie: `dng_owner=${ownerCookie}`,
    csrf: csrfToken,
  });
  assert.equal((await reactivated.json()).license.revision, 4);
  const final = await (
    await api("/manage/api/overview", { cookie: `dng_owner=${ownerCookie}` })
  ).json();
  assert.ok(final.audit.some((row) => row.action === "LICENSE_SUSPENDED"));
  assert.ok(final.audit.some((row) => row.action === "LICENSE_RENEWED"));
  assert.ok(final.audit.some((row) => row.action === "LICENSE_REACTIVATED"));
});

test("legacy v1 activation/admin remain intact and owner routes are disabled without full panel config", async () => {
  const legacy = await createLegacyLicense("Legacy endpoint remains");
  const adminListing = await api("/admin/licenses", { auth: true });
  assert.equal(adminListing.status, 200);
  const legacyActivation = await api("/v1/activate", {
    method: "POST",
    data: { code: "unused", installationId: "old-client-123456" },
  });
  assert.equal(legacyActivation.status, 401);
  assert.ok(legacy.id);

  const disabled = createLicenseServer({
    dbPath: join(dir, "disabled.sqlite"),
    adminToken: admin,
    privateKey,
  });
  await new Promise((resolve) =>
    disabled.server.listen(0, "127.0.0.1", resolve),
  );
  try {
    const noPanelBase = `http://127.0.0.1:${disabled.server.address().port}`;
    assert.equal((await fetch(`${noPanelBase}/manage/`)).status, 404);
    assert.equal(
      (await fetch(`${noPanelBase}/manage/api/login`, { method: "POST" }))
        .status,
      404,
    );
  } finally {
    disabled.close();
  }
});
