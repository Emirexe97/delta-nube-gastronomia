import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { createLicenseServer } from "../dist/server.js";
import {
  devicePublicKeyFingerprint,
  signDeviceProof,
  verifyLease,
  leaseAccess,
  GRACE_MS,
} from "@gastronomy/licensing";
import { verifyWebSiteTicket } from "@gastronomy/web-orders/provision";

const password = "Una frase de prueba extensa 2026!";
const origin = "https://accounts.example.test";
const DAY = 86_400_000;
async function fixture(t, enabled = true) {
  const pair = generateKeyPairSync("ed25519");
  const publicKey = pair.publicKey
    .export({ type: "spki", format: "pem" })
    .toString();
  const db = new DatabaseSync(":memory:");
  const mails = [],
    adminToken = randomBytes(40).toString("hex"),
    secret = randomBytes(32).toString("hex");
  const app = createLicenseServer(
    {
      dbPath: "/unused.sqlite",
      adminToken,
      privateKey: pair.privateKey
        .export({ type: "pkcs8", format: "pem" })
        .toString(),
      webSiteProvisionSecret: secret,
      rateLimit: 1000,
      ...(enabled
        ? {
            publicRegistration: {
              origin,
              sendMail: async (message) => {
                mails.push(message);
              },
            },
          }
        : {}),
    },
    db,
  );
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const request = (path, data, headers = {}) =>
    fetch(base + path, {
      method: data === undefined ? "GET" : "POST",
      headers: {
        origin,
        ...(data === undefined ? {} : { "content-type": "application/json" }),
        ...headers,
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
  const token = () =>
    new URL(mails.at(-1).text.match(/https:\/\/\S+/)[0]).hash.slice(7);
  async function register(email = "trial@example.test") {
    let res = await request("/public/api/registration/start", { email });
    assert.equal(res.status, 202);
    res = await request("/public/api/registration/complete", {
      token: token(),
      password,
      businessName: "Café prueba",
    });
    assert.equal(res.status, 200);
    return email;
  }
  async function proof(
    device = generateKeyPairSync("ed25519"),
    installationId = "trial-installation-0001",
  ) {
    const pk = device.publicKey
      .export({ type: "spki", format: "pem" })
      .toString();
    const res = await request("/v2/devices/challenge", {
      installationId,
      publicKey: pk,
      purpose: "lease",
    });
    assert.equal(res.status, 200);
    const challenge = await res.json();
    return {
      installationId,
      publicKey: pk,
      challengeId: challenge.challengeId,
      signature: signDeviceProof(
        {
          purpose: "lease",
          challengeId: challenge.challengeId,
          nonce: challenge.nonce,
          installationId,
          keyFingerprint: devicePublicKeyFingerprint(pk),
        },
        device.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      ),
    };
  }
  const activate = async (email, device, installationId, extra = {}) =>
    request("/v2/accounts/activate", {
      ...(await proof(device, installationId)),
      email,
      password,
      trialProtocol: 1,
      ...extra,
    });
  return {
    db,
    mails,
    app,
    request,
    register,
    activate,
    proof,
    token,
    publicKey,
    secret,
    adminToken,
  };
}

test("public email-first registration starts exactly 30 days only on first authenticated desktop activation", async (t) => {
  const f = await fixture(t);
  const email = await f.register();
  const before = f.db.prepare("SELECT * FROM licenses").get();
  assert.equal(before.installation_id, null);
  assert.equal(before.paid_through, "1970-01-01T00:00:00.000Z");
  assert.equal(
    f.db.prepare("SELECT started_at FROM license_trials").get().started_at,
    null,
  );
  const device = generateKeyPairSync("ed25519");
  let res = await f.activate(email, device, undefined, {
    password: "incorrect",
  });
  assert.equal(res.status, 401);
  res = await f.activate(email, device, undefined, {
    trialProtocol: undefined,
  });
  assert.equal(res.status, 409);
  assert.equal((await res.json()).error, "trial_client_update_required");
  assert.equal(
    f.db.prepare("SELECT started_at FROM license_trials").get().started_at,
    null,
  );
  const startedBefore = Date.now();
  res = await f.activate(email, device);
  assert.equal(res.status, 200);
  const activated = await res.json(),
    lease = verifyLease(
      activated.token,
      f.publicKey,
      "trial-installation-0001",
    );
  assert.ok(Date.parse(lease.trial.startedAt) >= startedBefore);
  assert.equal(
    Date.parse(lease.trial.endsAt) - Date.parse(lease.trial.startedAt),
    30 * DAY,
  );
  assert.equal(lease.graceUntil, lease.trial.endsAt);
  assert.equal(
    leaseAccess(lease, Date.parse(lease.trial.endsAt) - 1),
    "ACTIVE",
  );
  assert.equal(leaseAccess(lease, Date.parse(lease.trial.endsAt)), "EXPIRED");
  assert.equal(
    verifyWebSiteTicket(activated.webSiteTicket, f.secret).accessUntil,
    lease.trial.endsAt,
  );
  res = await f.activate(email, device);
  assert.equal(res.status, 200);
  const repeated = verifyLease(
    (await res.json()).token,
    f.publicKey,
    "trial-installation-0001",
  );
  assert.deepEqual(repeated.trial, lease.trial);
  assert.equal(repeated.revision, lease.revision);
  res = await f.activate(
    email,
    generateKeyPairSync("ed25519"),
    "second-installation-002",
  );
  assert.equal(res.status, 409);
  assert.equal(
    f.db.prepare("SELECT count(*) n FROM license_trials").get().n,
    1,
  );
  // An independently registered second email cannot re-use the same bound identity.
  const otherEmail = await f.register("other@example.test");
  res = await f.activate(otherEmail, device);
  assert.equal(res.status, 409);
  const other = f.db
    .prepare(
      "SELECT t.* FROM license_trials t JOIN accounts a ON a.license_id=t.license_id WHERE a.email=?",
    )
    .get(otherEmail);
  assert.equal(
    other.started_at,
    null,
    "failed binding must roll back trial activation",
  );
});

test("concurrent first logins bind one PC and cannot grant multiple trials", async (t) => {
  const f = await fixture(t),
    email = await f.register();
  const results = await Promise.all(
    ["trial-race-install-1", "trial-race-install-2"].map((id) =>
      f.activate(email, generateKeyPairSync("ed25519"), id),
    ),
  );
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  assert.equal(
    f.db
      .prepare("SELECT count(*) n FROM device_requests WHERE status='APPROVED'")
      .get().n,
    1,
  );
  assert.equal(
    f.db
      .prepare(
        "SELECT count(*) n FROM license_trials WHERE started_at IS NOT NULL",
      )
      .get().n,
    1,
  );
});

test("expired trial does not reset on login or password reset; manual renewal keeps identity and extends site access", async (t) => {
  const f = await fixture(t),
    email = await f.register(),
    device = generateKeyPairSync("ed25519");
  assert.equal((await f.activate(email, device)).status, 200);
  const row = f.db.prepare("SELECT * FROM licenses").get();
  const ends = Date.now() - 1000,
    starts = ends - 30 * DAY;
  f.db
    .prepare("UPDATE license_trials SET started_at=?,ends_at=?")
    .run(starts, ends);
  f.db
    .prepare("UPDATE licenses SET paid_through=?")
    .run(new Date(ends).toISOString());
  assert.equal((await f.activate(email, device)).status, 403);
  // Lease refresh is available for the bound device even after expiration, signed as expired.
  let res = await f.request("/v2/devices/lease", await f.proof(device));
  assert.equal(res.status, 200);
  let body = await res.json();
  assert.equal(body.webSiteTicket, undefined);
  assert.equal(
    leaseAccess(
      verifyLease(body.token, f.publicKey, row.installation_id),
      Date.now(),
    ),
    "EXPIRED",
  );
  f.db.prepare("DELETE FROM public_email_cooldowns").run();
  res = await f.request("/public/api/password-reset/start", { email });
  assert.equal(res.status, 202);
  res = await f.request("/public/api/password-reset/complete", {
    token: f.token(),
    password,
  });
  assert.equal(res.status, 200);
  assert.equal(
    f.db.prepare("SELECT ends_at FROM license_trials").get().ends_at,
    ends,
  );
  const paidThrough = new Date(Date.now() + 45 * DAY).toISOString();
  res = await f.request(
    `/admin/licenses/${row.id}/renew`,
    {
      paidThrough,
      reason: "Pago manual ficticio",
      idempotencyKey: "trial-renewal-001",
    },
    { authorization: `Bearer ${f.adminToken}` },
  );
  assert.equal(res.status, 200);
  res = await f.activate(email, device);
  assert.equal(res.status, 200);
  body = await res.json();
  const paid = verifyLease(body.token, f.publicKey, row.installation_id);
  assert.equal(paid.trial, undefined);
  assert.equal(
    Date.parse(paid.graceUntil) - Date.parse(paid.paidThrough),
    GRACE_MS,
  );
  assert.equal(paid.licenseId, row.id);
  assert.equal(
    verifyWebSiteTicket(body.webSiteTicket, f.secret).accessUntil,
    paidThrough,
  );
});

test("public pages are isolated, signup fails closed without mail configuration and origins/content types are checked", async (t) => {
  const disabled = await fixture(t, false);
  let res = await disabled.request("/public/api/config");
  assert.equal((await res.json()).registrationEnabled, false);
  assert.equal(
    (
      await disabled.request("/public/api/registration/start", {
        email: "a@b.test",
      })
    ).status,
    503,
  );
  for (const path of [
    "/registro/",
    "/recuperar/",
    "/descargas/",
    "/public-assets/account.js",
  ]) {
    res = await disabled.request(path);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.match(
      res.headers.get("content-security-policy"),
      /frame-ancestors 'none'/,
    );
  }
  const enabled = await fixture(t);
  assert.equal(
    (
      await enabled.request(
        "/public/api/registration/start",
        { email: "a@b.test" },
        { origin: "https://attacker.example" },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await enabled.request(
        "/public/api/registration/start",
        { email: "a@b.test" },
        { "content-type": "text/plain" },
      )
    ).status,
    415,
  );
  assert.equal(
    (
      await enabled.request("/public/api/registration/complete", {
        token: "x",
        password,
        businessName: "Cafe",
      })
    ).status,
    400,
  );
  assert.equal(enabled.mails.length, 0);
  assert.deepEqual(
    (await (await enabled.request("/public/api/config")).json()).downloads,
    {},
  );
});
