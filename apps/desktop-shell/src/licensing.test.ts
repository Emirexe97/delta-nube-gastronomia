import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { signLease } from "@gastronomy/licensing";
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
    const { publicKey } = keys();
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
    const { publicKey } = keys();
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
