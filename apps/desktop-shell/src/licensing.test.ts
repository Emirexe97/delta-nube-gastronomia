import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { signLease, devicePublicKeyFingerprint, verifyDeviceProof } from "@gastronomy/licensing";
// @ts-expect-error Node 24 runs TypeScript test files directly.
import { DesktopLicensing } from "./licensing.ts";

const DAY = 86_400_000;
const future = (days: number, now: number) =>
  new Date(now + days * DAY).toISOString();
function keys() {
  const pair = generateKeyPairSync("ed25519");
  return {
    publicKey: pair.publicKey
      .export({ type: "spki", format: "pem" })
      .toString(),
    privateKey: pair.privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString(),
  };
}
function responseToken(
  installationId: string,
  now: number,
  privateKey: string,
  fields: Partial<{
    revision: number;
    paidThrough: string;
    businessName: string;
    status: "ACTIVE" | "SUSPENDED";
  }> = {},
) {
  return signLease(
    {
      schema: 1,
      product: "delta-nube-gastronomia",
      licenseId: "license_123",
      installationId,
      businessName: fields.businessName ?? "Demo",
      issuedAt: new Date(now).toISOString(),
      paidThrough: fields.paidThrough ?? future(20, now),
      graceUntil: new Date(
        Date.parse(fields.paidThrough ?? future(20, now)) + 3 * DAY,
      ).toISOString(),
      revision: fields.revision ?? 1,
      status: fields.status ?? "ACTIVE",
    },
    privateKey,
  );
}
async function setup(
  dir: string,
  getNow: () => number,
  publicKey: string,
  fetcher: typeof fetch,
) {
  const license = new DesktopLicensing({
    userDataPath: dir,
    isPackaged: true,
    now: getNow,
    config: { serverUrl: "https://example.test", publicKey },
    fetch: fetcher,
  });
  await license.initialize();
  return license;
}

test("development bypasses license; packaged invalid or absent config fails closed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gastronomy-license-"));
  try {
    const dev = new DesktopLicensing({ userDataPath: dir, isPackaged: false });
    await dev.initialize();
    assert.equal((await dev.getStatus()).state, "DEVELOPMENT");
    const packaged = new DesktopLicensing({
      userDataPath: dir,
      isPackaged: true,
      config: { serverUrl: "https://example.test", publicKey: "" },
    });
    await packaged.initialize();
    assert.equal((await packaged.getStatus()).state, "NOT_CONFIGURED");
    assert.equal((await packaged.getStatus()).canOperate, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("paid time wins over seven days offline, and persisted lease survives restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gastronomy-license-"));
  try {
    let now = Date.parse("2026-01-01T12:00:00.000Z");
    const { publicKey, privateKey } = keys();
    const license = await setup(
      dir,
      () => now,
      publicKey,
      async (_url, init) => {
        const id = (
          JSON.parse(String(init?.body)) as { installationId: string }
        ).installationId;
        return new Response(
          JSON.stringify({ token: responseToken(id, now, privateKey) }),
          { status: 200 },
        );
      },
    );
    assert.equal((await license.activate("VALID-CODE")).state, "ACTIVE");
    now += 7 * DAY;
    const restarted = await setup(
      dir,
      () => now,
      publicKey,
      async () => {
        throw new Error("offline");
      },
    );
    assert.equal((await restarted.getStatus()).state, "ACTIVE");
    assert.equal((await restarted.getStatus()).canOperate, true);
    now = Date.parse("2026-01-21T12:00:00.000Z");
    assert.equal((await restarted.getStatus()).state, "GRACE");
    now = Date.parse("2026-01-24T12:00:00.000Z");
    assert.equal((await restarted.getStatus()).state, "EXPIRED");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("exact paidThrough starts grace and exact graceUntil is expired", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gastronomy-license-"));
  try {
    let now = Date.parse("2026-01-01T12:00:00.000Z");
    const { publicKey, privateKey } = keys();
    const license = await setup(
      dir,
      () => now,
      publicKey,
      async (_url, init) =>
        new Response(
          JSON.stringify({
            token: responseToken(
              (JSON.parse(String(init?.body)) as { installationId: string })
                .installationId,
              now,
              privateKey,
            ),
          }),
          { status: 200 },
        ),
    );
    await license.activate("VALID-CODE");
    now += 20 * DAY;
    assert.equal((await license.getStatus()).state, "GRACE");
    now += 3 * DAY;
    assert.equal((await license.getStatus()).state, "EXPIRED");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("tampered token fails closed and backward clock remains blocked despite online verification", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gastronomy-license-"));
  try {
    let now = Date.parse("2026-01-01T12:00:00.000Z");
    let mono = 1000;
    const { publicKey, privateKey } = keys();
    const license = new DesktopLicensing({
      userDataPath: dir,
      isPackaged: true,
      now: () => now,
      monotonicNow: () => mono,
      config: { serverUrl: "https://example.test", publicKey },
      fetch: async (_url, init) =>
        new Response(
          JSON.stringify({
            token: responseToken(
              (JSON.parse(String(init?.body)) as { installationId: string })
                .installationId,
              now,
              privateKey,
            ),
          }),
          { status: 200 },
        ),
    });
    await license.initialize();
    await license.activate("VALID-CODE");
    const statePath = join(dir, "license-state.json");
    const state = JSON.parse(await readFile(statePath, "utf8")) as {
      token: string;
    };
    state.token = `${state.token}tampered`;
    await writeFile(statePath, JSON.stringify(state));
    const tampered = await setup(
      dir,
      () => now,
      publicKey,
      async () => {
        throw new Error("offline");
      },
    );
    assert.equal((await tampered.getStatus()).state, "INVALID");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  const dirClock = await mkdtemp(join(tmpdir(), "gastronomy-license-clock-"));
  try {
    let now = Date.parse("2026-01-01T12:00:00.000Z");
    let mono = 1000;
    const { publicKey, privateKey } = keys();
    const license = new DesktopLicensing({
      userDataPath: dirClock,
      isPackaged: true,
      now: () => now,
      monotonicNow: () => mono,
      config: { serverUrl: "https://example.test", publicKey },
      fetch: async (_url, init) =>
        new Response(
          JSON.stringify({
            token: responseToken(
              (JSON.parse(String(init?.body)) as { installationId: string })
                .installationId,
              now,
              privateKey,
            ),
          }),
          { status: 200 },
        ),
    });
    await license.initialize();
    await license.activate("VALID-CODE");
    now -= 6 * 60_000;
    mono += 1000;
    assert.equal((await license.getStatus()).state, "CLOCK_ROLLBACK");
    await license.refresh();
    assert.equal((await license.getStatus()).state, "CLOCK_ROLLBACK");
  } finally {
    await rm(dirClock, { recursive: true, force: true });
  }
});

test("manual renewal accepts a newer revision without changing the current wall time", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gastronomy-license-renew-"));
  try {
    let now = Date.parse("2026-01-01T12:00:00.000Z");
    const { publicKey, privateKey } = keys();
    let revision = 1;
    let paidThrough = future(20, now);
    let issuedAt = now;
    const license = await setup(
      dir,
      () => now,
      publicKey,
      async (_url, init) =>
        new Response(
          JSON.stringify({
            token: responseToken(
              (JSON.parse(String(init?.body)) as { installationId: string })
                .installationId,
              issuedAt,
              privateKey,
              { revision, paidThrough },
            ),
          }),
          { status: 200 },
        ),
    );
    await license.activate("VALID-CODE");
    now += 10 * DAY;
    issuedAt = now;
    revision = 2;
    paidThrough = future(30, now);
    assert.equal((await license.refresh()).state, "ACTIVE");
    assert.equal((await license.getStatus()).paidThrough, paidThrough);
    now += DAY;
    issuedAt = now;
    revision = 1;
    paidThrough = future(60, now);
    assert.equal(
      (await license.refresh()).paidThrough,
      future(30, Date.parse("2026-01-11T12:00:00.000Z")),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("bad code and installation mismatch return clear generic messages; redirect is rejected", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gastronomy-license-fail-"));
  try {
    const { publicKey, privateKey } = keys();
    const license = await setup(
      dir,
      () => Date.now(),
      publicKey,
      async (_url, init) => {
        assert.equal((init as RequestInit).redirect, "error");
        return new Response(JSON.stringify({ error: "invalid_activation" }), {
          status: 401,
        });
      },
    );
    const status = await license.activate("WRONG");
    assert.equal(status.state, "UNACTIVATED");
    assert.match(status.message, /código no es válido/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  const dir2 = await mkdtemp(join(tmpdir(), "gastronomy-license-mismatch-"));
  try {
    const { publicKey, privateKey } = keys();
    const license = await setup(
      dir2,
      () => Date.now(),
      publicKey,
      async () =>
        new Response(JSON.stringify({ error: "installation_mismatch" }), {
          status: 409,
        }),
    );
    const status = await license.activate("CODE");
    assert.match(status.message, /otra instalación/i);
  } finally {
    await rm(dir2, { recursive: true, force: true });
  }
});

test("online refresh never discards elapsed monotonic time at the expiry boundary", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gastronomy-license-anchor-"));
  try {
    const start = Date.parse("2026-01-01T12:00:00.000Z");
    let mono = 0;
    let issuedAt = start;
    const { publicKey, privateKey } = keys();
    const license = new DesktopLicensing({
      userDataPath: dir,
      isPackaged: true,
      now: () => start,
      monotonicNow: () => mono,
      config: { serverUrl: "https://example.test", publicKey },
      fetch: async (_url, init) =>
        new Response(
          JSON.stringify({
            token: responseToken(
              JSON.parse(String(init?.body)).installationId,
              issuedAt,
              privateKey,
              { paidThrough: new Date(start - 3 * DAY + 30_000).toISOString() },
            ),
          }),
        ),
    });
    await license.initialize();
    assert.equal((await license.activate("VALID")).state, "GRACE");
    mono = 25_000;
    issuedAt += 1;
    assert.equal((await license.refresh()).state, "GRACE");
    mono = 30_000;
    assert.equal((await license.getStatus()).state, "EXPIRED");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("no-code request persists only encrypted device key and leaves pending device unable to operate", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gastronomy-enrollment-"));
  try {
    const { publicKey, privateKey } = keys();
    const calls: string[] = [];
    const license = new DesktopLicensing({
      userDataPath: dir, isPackaged: true, now: Date.now,
      config: { serverUrl: "https://example.test", publicKey },
      safeStorage: { encryptString: (value) => Buffer.from(`encrypted:${value}`), decryptString: (value) => value.toString().replace(/^encrypted:/, "") },
      fetch: async (url, init) => {
        const path = new URL(String(url)).pathname; calls.push(path);
        if (path.endsWith("challenge")) return new Response(JSON.stringify({ challengeId: "challenge-1", nonce: "n".repeat(43), expiresAt: new Date(Date.now() + 60_000).toISOString() }));
        const body = JSON.parse(String(init?.body));
        assert.equal(typeof body.signature, "string");
        assert.equal("webSite" in body, false, "signup URL and phone must never be sent to licensing");
        return new Response(JSON.stringify({ request: { id: "request-123", installationId: body.installationId, businessName: "Cafe Norte", keyFingerprint: devicePublicKeyFingerprint(body.publicKey), status: "PENDING", licenseId: null, createdAt: new Date().toISOString() }, token: responseToken(body.installationId, Date.now(), privateKey) }));
      },
    });
    await license.initialize();
    const status = await license.requestLicenseAccess({ businessName: "Cafe Norte", webSite: { slug: "cafe-norte", whatsappNumber: "+54 (11) 1234-5678" } });
    assert.equal(status.state, "UNACTIVATED");
    assert.equal(status.canOperate, false);
    assert.equal(status.enrollment?.status, "PENDING");
    assert.deepEqual(calls, ["/v2/devices/challenge", "/v2/devices/request"]);
    const identity = await readFile(join(dir, "device-identity.json"), "utf8");
    assert.match(identity, /encryptedPrivateKey/);
    assert.doesNotMatch(identity, /BEGIN PRIVATE KEY/);
    assert.doesNotMatch(identity, /541112345678|cafe-norte|webSiteTicket/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("approved signed enrollment persists across restart, stays active offline, then follows suspension and reactivation revisions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gastronomy-approved-device-"));
  try {
    let now = Date.parse("2026-02-01T12:00:00.000Z");
    const { publicKey, privateKey } = keys();
    let leaseStatus: "ACTIVE" | "SUSPENDED" = "ACTIVE"; let revision = 1; let issue = now; let goOffline = false;
    const server = async (url: RequestInfo | URL, init?: RequestInit) => {
      if (goOffline) throw new Error("offline");
      const path = new URL(String(url)).pathname; const body = JSON.parse(String(init?.body));
      if (path.endsWith("challenge")) return new Response(JSON.stringify({ challengeId: "challenge-123", nonce: "x".repeat(43), expiresAt: new Date(now + 60_000).toISOString() }));
      if (path.endsWith("request") || path.endsWith("lease")) {
        const purpose = path.endsWith("request") ? "request" as const : "lease" as const;
        assert.equal("webSite" in body, false, "site signup data must not be included in licensing requests");
        const proof = { purpose, challengeId: body.challengeId, nonce: "x".repeat(43), installationId: body.installationId, keyFingerprint: devicePublicKeyFingerprint(body.publicKey), ...(purpose === "request" ? { businessName: body.businessName } : {}) };
        assert.equal(verifyDeviceProof(proof, body.signature, body.publicKey), true);
        const token = responseToken(body.installationId, issue, privateKey, { revision, status: leaseStatus, businessName: "Cafe Norte", paidThrough: future(20, now) });
        return new Response(JSON.stringify({ request: { id: "request-123", installationId: body.installationId, businessName: "Cafe Norte", keyFingerprint: proof.keyFingerprint, status: "APPROVED", licenseId: "license_123", createdAt: new Date(now).toISOString() }, token, ...(purpose === "lease" ? { webSiteTicket: "fresh-ticket-1234567890123456789" } : {}) }));
      }
      throw new Error(`unexpected ${path}`);
    };
    const make = async () => {
      const value = new DesktopLicensing({ userDataPath: dir, isPackaged: true, now: () => now, config: { serverUrl: "https://example.test", publicKey }, safeStorage: { encryptString: (s) => Buffer.from(`vault:${s}`), decryptString: (b) => b.toString().replace(/^vault:/, "") }, fetch: server });
      await value.initialize(); return value;
    };
    const first = await make();
    let selected: { slug: string; whatsappNumber: string } | null = null;
    let provisions = 0;
    let websiteActive = false;
    first.setWebSiteProvisioner({ getChoice: () => selected, getStatus: () => ({ state: websiteActive ? "ACTIVE" : selected ? "PENDING" : "NOT_REGISTERED" }), selectChoice: async (choice) => { selected = choice; }, provision: async (ticket, choice) => { provisions++; assert.equal(ticket, "fresh-ticket-1234567890123456789"); assert.deepEqual(choice, { slug: "cafe-norte", whatsappNumber: "541112345678" }); selected = null; websiteActive = true; return { state: "ACTIVE" }; } });
    const active = await first.requestLicenseAccess({ businessName: "Cafe Norte" });
    assert.equal(active.state, "ACTIVE"); assert.equal(active.canOperate, true);
    issue = now + 1;
    assert.equal((await first.registerWebSite({ slug: "cafe-norte", whatsappNumber: "+54 11 1234-5678" })).state, "ACTIVE");
    assert.equal(provisions, 1, "approved existing identity receives a fresh lease ticket on later signup");
    goOffline = true; now += 8 * 86_400_000;
    const restarted = await make();
    assert.equal((await restarted.getStatus()).canOperate, true);
    assert.equal((await restarted.refresh()).canOperate, true);
    goOffline = false; leaseStatus = "SUSPENDED"; revision = 2; issue = now;
    assert.equal((await restarted.refresh()).state, "SUSPENDED");
    leaseStatus = "ACTIVE"; revision = 3; issue = now + 1;
    assert.equal((await restarted.refresh()).state, "ACTIVE");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("invalid challenge/response and unavailable secure storage fail closed without creating plaintext identity", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gastronomy-enroll-fail-"));
  try {
    const { publicKey } = keys();
    const unavailable = new DesktopLicensing({ userDataPath: dir, isPackaged: true, config: { serverUrl: "https://example.test", publicKey }, safeStorage: { isAvailable: () => false, encryptString: (s) => Buffer.from(s), decryptString: (b) => b.toString() } });
    await unavailable.initialize();
    const unavailableStatus = await unavailable.requestLicenseAccess({ businessName: "Cafe Norte" });
    assert.equal(unavailableStatus.canOperate, false); assert.match(unavailableStatus.message, /almacenamiento seguro/i);
    assert.equal(await readFile(join(dir, "device-identity.json")).then(() => true, () => false), false);
    const bad = new DesktopLicensing({ userDataPath: dir, isPackaged: true, config: { serverUrl: "https://example.test", publicKey }, safeStorage: { encryptString: (s) => Buffer.from(s), decryptString: (b) => b.toString() }, fetch: async () => new Response(JSON.stringify({ challengeId: "bad", nonce: "short", expiresAt: new Date(Date.now() + 60_000).toISOString() })) });
    await bad.initialize();
    const badStatus = await bad.requestLicenseAccess({ businessName: "Cafe Norte" });
    assert.equal(badStatus.canOperate, false); assert.equal(badStatus.enrollment?.status, null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("enrollment and lease polling serialize instead of consuming each other's responses", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gastronomy-queue-"));
  try {
    const { publicKey } = keys(); const paths: string[] = []; let release!: () => void;
    let waitFirst = new Promise<void>((resolve) => { release = resolve; });
    const license = new DesktopLicensing({ userDataPath: dir, isPackaged: true, config: { serverUrl: "https://example.test", publicKey }, safeStorage: { encryptString: (s) => Buffer.from(s), decryptString: (b) => b.toString() }, fetch: async (url, init) => {
      const path = new URL(String(url)).pathname; paths.push(path);
      if (path.endsWith("challenge") && paths.length === 1) await waitFirst;
      if (path.endsWith("challenge")) return new Response(JSON.stringify({ challengeId: "challenge-123", nonce: "z".repeat(43), expiresAt: new Date(Date.now() + 60_000).toISOString() }));
      const body = JSON.parse(String(init?.body ?? "{}"));
      return new Response(JSON.stringify({ request: { id: "request-123", installationId: body.installationId, businessName: "Cafe Norte", keyFingerprint: devicePublicKeyFingerprint(body.publicKey), status: "PENDING", licenseId: null, createdAt: new Date().toISOString() } }));
    } });
    await license.initialize();
    const request = license.requestLicenseAccess({ businessName: "Cafe Norte" });
    const poll = license.refresh();
    release(); await Promise.all([request, poll]);
    assert.deepEqual(paths, ["/v2/devices/challenge", "/v2/devices/request", "/v2/devices/challenge", "/v2/devices/lease"]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("account activation signs a device lease challenge, persists only email and encrypted identity, and resumes offline", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gastronomy-account-"));
  try {
    let now = Date.parse("2026-03-01T12:00:00.000Z");
    const { publicKey, privateKey } = keys();
    const calls: string[] = [];
    const safeStorage = { encryptString: (s: string) => Buffer.from(`vault:${s}`), decryptString: (b: Buffer) => b.toString().replace(/^vault:/, "") };
    const fetcher: typeof fetch = async (url, init) => {
      const path = new URL(String(url)).pathname; calls.push(path);
      const body = JSON.parse(String(init?.body));
      if (path.endsWith("challenge")) return new Response(JSON.stringify({ challengeId: "challenge-account", nonce: "q".repeat(43), expiresAt: new Date(now + 60_000).toISOString() }));
      assert.equal(path, "/v2/accounts/activate");
      assert.equal(body.email, "owner@example.com"); assert.equal(body.password, "secret-not-on-disk");
      return new Response(JSON.stringify({
        request: { id: "request-account", installationId: body.installationId, businessName: "Cafe Norte", keyFingerprint: devicePublicKeyFingerprint(body.publicKey), status: "APPROVED", licenseId: "license_123", createdAt: new Date(now).toISOString() },
        token: responseToken(body.installationId, now, privateKey), account: { email: "owner@example.com" },
      }));
    };
    const make = async (fetch: typeof globalThis.fetch) => { const value = new DesktopLicensing({ userDataPath: dir, isPackaged: true, now: () => now, config: { serverUrl: "https://example.test", publicKey }, safeStorage, fetch }); await value.initialize(); return value; };
    const license = await make(fetcher);
    const input = { email: " Owner@Example.com ", password: "secret-not-on-disk" };
    const status = await license.signInAccount(input);
    assert.equal(status.state, "ACTIVE"); assert.deepEqual(status.account, { email: "owner@example.com" });
    assert.deepEqual(calls, ["/v2/devices/challenge", "/v2/accounts/activate"]);
    const disk = await readFile(join(dir, "license-state.json"), "utf8") + await readFile(join(dir, "device-identity.json"), "utf8");
    assert.doesNotMatch(disk, /secret-not-on-disk/); assert.match(disk, /owner@example.com/); assert.doesNotMatch(disk, /BEGIN PRIVATE KEY/);
    now += DAY;
    const restarted = await make(async () => { throw new Error("offline"); });
    assert.deepEqual((await restarted.getStatus()).account, { email: "owner@example.com" });
    assert.equal((await restarted.getStatus()).canOperate, true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("account failures are actionable and preserve the existing lease; identity alone never changes legacy refresh", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gastronomy-account-fail-"));
  try {
    const { publicKey, privateKey } = keys(); let now = Date.now();
    const license = new DesktopLicensing({ userDataPath: dir, isPackaged: true, now: () => now, config: { serverUrl: "https://example.test", publicKey }, safeStorage: { encryptString: s => Buffer.from(s), decryptString: b => b.toString() }, fetch: async (url, init) => {
      const path = new URL(String(url)).pathname; const body = JSON.parse(String(init?.body));
      if (path.endsWith("challenge")) return new Response(JSON.stringify({ challengeId: "challenge-account", nonce: "q".repeat(43), expiresAt: new Date(now + 60_000).toISOString() }));
      if (path.endsWith("accounts/activate")) return new Response(JSON.stringify({ error: "invalid_credentials" }), { status: 401 });
      if (path.endsWith("activate")) return new Response(JSON.stringify({ token: responseToken(body.installationId, now, privateKey) }));
      assert.equal(path, "/v1/verify", "unacknowledged account identity must not switch legacy refresh to v2");
      return new Response(JSON.stringify({ token: responseToken(body.installationId, now, privateKey) }));
    } });
    await license.initialize();
    await license.activate("VALID-CODE");
    const before = await readFile(join(dir, "license-state.json"), "utf8");
    await assert.rejects(license.signInAccount({ email: "owner@example.com", password: "wrong" }), /Email o contraseña incorrectos/);
    assert.equal(await readFile(join(dir, "license-state.json"), "utf8"), before);
    await license.refresh();
    assert.equal((await license.getStatus()).state, "ACTIVE");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("rejects credential-bearing server URLs and supports enforced local licensing tests", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gastronomy-account-config-"));
  try {
    const { publicKey } = keys();
    const insecure = new DesktopLicensing({ userDataPath: dir, isPackaged: true, config: { serverUrl: "https://user:pass@example.test", publicKey } });
    await insecure.initialize(); assert.equal((await insecure.getStatus()).state, "NOT_CONFIGURED");
    const enforced = new DesktopLicensing({ userDataPath: dir, isPackaged: false, enforceLicense: true, config: { serverUrl: "https://example.test", publicKey } });
    await enforced.initialize(); assert.equal((await enforced.getStatus()).state, "UNACTIVATED");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("account activation times out stalled response bodies and rejects oversized bodies without replacing a valid lease", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gastronomy-account-body-"));
  try {
    const { publicKey, privateKey } = keys(); const now = Date.now();
    let mode: "stall" | "oversize" = "stall";
    const fetcher: typeof fetch = async (url, init) => {
      const path = new URL(String(url)).pathname; const body = JSON.parse(String(init?.body));
      if (path.endsWith("challenge")) return new Response(JSON.stringify({ challengeId: "challenge-body", nonce: "q".repeat(43), expiresAt: new Date(now + 60_000).toISOString() }));
      if (path.endsWith("/v1/activate")) return new Response(JSON.stringify({ token: responseToken(body.installationId, now, privateKey) }));
      if (mode === "stall") return new Response(new ReadableStream<Uint8Array>({ start() { /* intentionally never completes */ } }));
      return new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(16 * 1024 + 1)); controller.close(); } }));
    };
    const license = new DesktopLicensing({ userDataPath: dir, isPackaged: true, now: () => now, config: { serverUrl: "https://example.test", publicKey }, safeStorage: { encryptString: s => Buffer.from(s), decryptString: b => b.toString() }, fetch: fetcher });
    await license.initialize(); await license.activate("VALID");
    const tokenBefore = JSON.parse(await readFile(join(dir, "license-state.json"), "utf8")).token;
    await assert.rejects(license.signInAccount({ email: "owner@example.com", password: "secret" }), /No se pudo conectar/);
    assert.equal(JSON.parse(await readFile(join(dir, "license-state.json"), "utf8")).token, tokenBefore);
    mode = "oversize";
    await assert.rejects(license.signInAccount({ email: "owner@example.com", password: "secret" }), /respuesta de licencia inválida/);
    assert.equal(JSON.parse(await readFile(join(dir, "license-state.json"), "utf8")).token, tokenBefore);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
