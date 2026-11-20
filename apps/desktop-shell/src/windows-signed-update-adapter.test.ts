import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, realpath, rm, unlink } from "node:fs/promises";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test, { type TestContext } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import {
  requestWindowsUpdate,
  WindowsSignedUpdateAdapter,
  // @ts-expect-error Node runs TypeScript test sources directly.
} from "./windows-signed-update-adapter.ts";
// @ts-expect-error Node runs TypeScript test sources directly.
import { createUpdateRuntime } from "./update-runtime.ts";
// @ts-expect-error Node runs TypeScript test sources directly.
import { UpdateInstallGate } from "./update-install-gate.ts";
// @ts-expect-error Node runs TypeScript test sources directly.
import { createUpdateInstallRequest } from "./update-install-request.ts";

const keys = generateKeyPairSync("ed25519");
const artifact = Buffer.alloc(64 * 1024, 0x42); // inert; never executed
const digest = createHash("sha512").update(artifact).digest("hex");
const clock = Date.parse("2026-11-17T12:00:00Z");
const basePath = "/isolated/windows/x64/";
const assetPath = "versions/0.1.38/fixture.exe";
const openssl =
  process.platform === "win32" &&
  existsSync("C:/Program Files/Git/usr/bin/openssl.exe")
    ? "C:/Program Files/Git/usr/bin/openssl.exe"
    : "openssl";
let opensslAvailable = true;
try {
  execFileSync(openssl, ["version"], { stdio: "ignore", windowsHide: true });
} catch {
  opensslAvailable = false;
}
const tlsTest = {
  skip: opensslAvailable
    ? false
    : "OpenSSL CLI unavailable for ephemeral HTTPS fixture",
  timeout: 15_000,
};

function signed(sequence = 12, overrides = {}) {
  const payload = Buffer.from(
    JSON.stringify({
      appId: "com.deltanube.gastronomy",
      platform: "win32",
      arch: "x64",
      channel: "stable",
      version: "0.1.38",
      sequence,
      issuedAt: "2026-11-17T11:59:00Z",
      expiresAt: "2026-11-17T13:00:00Z",
      minVerifierVersion: 1,
      artifactPath: assetPath,
      artifactSize: artifact.length,
      artifactSha512: digest,
      ...overrides,
    }),
  );
  return JSON.stringify({
    format: 1,
    keyId: "ephemeral",
    payload: payload.toString("base64"),
    signature: sign(
      null,
      Buffer.concat([Buffer.from("DeltaNubeGastronomia-Update-v1\0"), payload]),
      keys.privateKey,
    ).toString("base64"),
  });
}

function deferred<T>() {
  let resolve!: (result: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function until(fn: () => boolean) {
  for (let i = 0; i < 250; i++) {
    if (fn()) return;
    await sleep(12);
  }
  assert.fail("State transition timed out");
}

async function fixture(t: TestContext) {
  const temp = await realpath(tmpdir());
  const dir = await mkdtemp(join(temp, "gastronomy-signed-updates-"));
  const finishDownload = deferred<void>();
  let server: ReturnType<typeof createServer> | undefined;
  t.after(async () => {
    finishDownload.resolve();
    if (server?.listening) {
      const bound = server;
      await new Promise<void>((done) => {
        bound.close(() => done());
        bound.closeAllConnections();
      });
    }
    const target = await realpath(dir);
    assert.equal(dirname(target), temp);
    assert.match(basename(target), /^gastronomy-signed-updates-/);
    await rm(target, { recursive: true, force: true });
  });
  const certPath = join(dir, "cert.pem");
  const keyPath = join(dir, "key.pem");
  execFileSync(
    openssl,
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-sha256",
      "-days",
      "1",
      "-subj",
      "/CN=loopback-updates",
      "-addext",
      "subjectAltName=IP:127.0.0.1",
      "-out",
      certPath,
      "-keyout",
      keyPath,
    ],
    { windowsHide: true, stdio: "ignore" },
  );
  const ca = await readFile(certPath);
  const tlsKey = await readFile(keyPath);
  await unlink(keyPath);
  await unlink(certPath);
  const requests: string[] = [];
  const firstHalf = deferred<void>();
  const knobs = {
    split: false,
    manifest: signed(),
    badBody: false,
    redirect: false,
  };
  server = createServer({ cert: ca, key: tlsKey }, async (req, res) => {
    const url = req.url ?? "";
    requests.push(url);
    if (url === basePath + "release.json") {
      if (knobs.redirect) {
        res.writeHead(302, { Location: "/untrusted-manifest" }).end();
      } else res.end(knobs.manifest);
    } else if (url === basePath + assetPath) {
      res.writeHead(200, { "Content-Length": artifact.length });
      if (knobs.split) {
        res.write(artifact.subarray(0, artifact.length / 2));
        firstHalf.resolve();
        await finishDownload.promise;
        res.end(artifact.subarray(artifact.length / 2));
      } else {
        res.end(knobs.badBody ? Buffer.alloc(artifact.length, 0x60) : artifact);
      }
    } else res.writeHead(404).end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const feedUrl = `https://127.0.0.1:${address.port}${basePath}`;
  const launchStarted = deferred<void>();
  const finishLaunch = deferred<void>();
  const launches: string[] = [];
  const events: string[] = [];
  let now = clock;
  let launched = 0;
  const configured = {
    isPackaged: true,
    platform: "win32" as const,
    arch: "x64",
    currentVersion: "0.1.37",
    configPath: "fixture",
    resourcesPath: dir,
    appPath: dir,
    onStatusChange: (state: { state: string }) => events.push(state.state),
  };
  function runtime(overrides = {}, setup = {}) {
    return createUpdateRuntime(
      { ...configured, ...overrides },
      {
        readText: async (path) => {
          assert.equal(path, "fixture"); // no app-update.yml fallback
          return JSON.stringify({
            enabled: true,
            target: "win32-x64",
            mode: "windows-ed25519-v1",
            feedUrl,
            ...setup,
          });
        },
        async verifyMacSignature() {
          throw new Error("Unexpected Mac verification");
        },
        async createAdapter() {
          assert.fail("Unexpected legacy adapter");
        },
        createWindowsSignedAdapter: (options, url, channel) =>
          new WindowsSignedUpdateAdapter({
            userDataPath: dir,
            // The pilot production URL is only compared in config; requests
            // from this test factory are always against the local TLS fixture.
            feedUrl: channel === "pilot" ? feedUrl : url,
            installedVersion: options.currentVersion,
            channel,
            trustedKeys: new Map([["ephemeral", keys.publicKey]]),
            request: (url, signal) => requestWindowsUpdate(url, signal, ca),
            now: () => now,
            launch: async (input) => {
              assert.equal(input.sha512, digest);
              assert.equal(input.size, artifact.length);
              assert.deepEqual(await readFile(input.installerPath), artifact);
              launches.push(input.installerPath);
              launchStarted.resolve();
              await finishLaunch.promise;
            },
            onLaunched: () => {
              launched++;
            },
          }),
      },
    );
  }
  return {
    dir,
    requests,
    knobs,
    feedUrl,
    runtime,
    firstHalf,
    finishDownload,
    launches,
    launchStarted,
    finishLaunch,
    events,
    launched: () => launched,
    setNow: (time: number) => {
      now = time;
    },
  };
}

test(
  "loopback TLS: background download, cancel, open cash, recheck and exclusive confirmed launch",
  tlsTest,
  async (t) => {
    const f = await fixture(t);
    f.knobs.split = true;
    const updater = await f.runtime();
    const gate = new UpdateInstallGate();
    let permitted = true;
    let cashOpen = true;
    let confirmation = deferred<boolean>();
    let prompts = 0;
    const install = createUpdateInstallRequest({
      updater,
      gate,
      readState: () => ({ permitted, cashOpen }),
      confirm: async (version) => {
        assert.equal(version, "0.1.38");
        prompts++;
        return confirmation.promise;
      },
    });
    await assert.rejects(install(), /No hay/);
    const result = await updater.check();
    assert.equal(result.state, "DOWNLOADING");
    await f.firstHalf.promise;
    await until(() => updater.getStatus().progress === 50);
    const completeOperation = gate.enterOperation();
    completeOperation();
    assert.equal(gate.installationInProgress, false);
    assert.equal(f.launches.length, 0);

    // Feed changes mid-transfer do not replace the authenticated snapshot.
    f.knobs.manifest = "not the original manifest";
    f.finishDownload.resolve();
    await until(() => updater.getStatus().state === "READY");
    await assert.rejects(install(), /Cerrá la caja/);
    assert.equal(prompts, 0);
    cashOpen = false;
    permitted = false;
    await assert.rejects(install(), /permiso/);
    permitted = true;
    let attempt = install();
    await assert.rejects(install(), /en curso/);
    confirmation.resolve(false);
    assert.equal((await attempt).state, "READY");
    assert.equal(f.launches.length, 0);

    confirmation = deferred<boolean>();
    attempt = install();
    cashOpen = true; // opened after the native prompt began
    confirmation.resolve(true);
    await assert.rejects(attempt, /Cerrá la caja/);
    assert.equal(f.launches.length, 0);

    confirmation = deferred<boolean>();
    cashOpen = false;
    attempt = install();
    const pendingOperation = gate.enterOperation();
    confirmation.resolve(true);
    await assert.rejects(attempt, /Esperá/);
    pendingOperation();
    assert.equal(f.launches.length, 0);

    confirmation = deferred<boolean>();
    attempt = install();
    confirmation.resolve(true);
    await f.launchStarted.promise;
    assert.equal(updater.getStatus().state, "INSTALLING");
    assert.throws(() => gate.enterOperation(), /instalando/);
    await assert.rejects(install(), /en curso/);
    assert.equal(f.launched(), 0);
    f.finishLaunch.resolve();
    assert.equal((await attempt).state, "INSTALLING");
    assert.equal(f.launched(), 1);
    assert.equal(f.launches.length, 1);
    assert.deepEqual(f.requests, [
      basePath + "release.json",
      basePath + assetPath,
    ]);
    updater.dispose();
  },
);

test(
  "loopback TLS: no trust override, no redirects, no download on bad signature",
  tlsTest,
  async (t) => {
    const f = await fixture(t);
    await assert.rejects(
      requestWindowsUpdate(
        new URL("release.json", f.feedUrl),
        AbortSignal.timeout(2000),
      ),
    );
    const updater = await f.runtime();
    f.knobs.redirect = true;
    assert.equal((await updater.check()).state, "ERROR");
    f.knobs.redirect = false;
    f.knobs.manifest = JSON.stringify({
      ...JSON.parse(signed()),
      signature: Buffer.alloc(64).toString("base64"),
    });
    assert.equal((await updater.check()).state, "ERROR");
    assert.deepEqual(f.requests, [
      basePath + "release.json",
      basePath + "release.json",
    ]);
    assert.equal(f.launches.length, 0);
    updater.dispose();
  },
);

test(
  "loopback TLS: corrupted download and replay after restart never become READY",
  tlsTest,
  async (t) => {
    const f = await fixture(t);
    const updater = await f.runtime();
    f.knobs.badBody = true;
    await updater.check();
    await until(() => updater.getStatus().state === "ERROR");
    assert.ok(!f.events.includes("READY"));
    updater.dispose();
    f.knobs.badBody = false;
    f.knobs.manifest = signed(11);
    const restarted = await f.runtime();
    assert.equal((await restarted.check()).state, "ERROR");
    assert.deepEqual(f.requests, [
      basePath + "release.json",
      basePath + assetPath,
      basePath + "release.json",
    ]);
    restarted.dispose();
    const state = join(f.dir, "windows-signed-updates-v1", "checkpoint.json");
    await unlink(state);
    assert.equal((await (await f.runtime()).check()).state, "ERROR");
    assert.equal(f.requests.length, 3); // damaged local state did not reset trust
  },
);

test(
  "loopback TLS: expiration before confirmation releases gate without launching",
  tlsTest,
  async (t) => {
    const f = await fixture(t);
    const updater = await f.runtime();
    await updater.check();
    await until(() => updater.getStatus().state === "READY");
    f.setNow(Date.parse("2026-11-17T13:00:00Z"));
    const gate = new UpdateInstallGate();
    const install = createUpdateInstallRequest({
      updater,
      gate,
      readState: () => ({ permitted: true, cashOpen: false }),
      confirm: async () => true,
    });
    assert.equal((await install()).state, "ERROR");
    assert.equal(gate.installationInProgress, false);
    gate.enterOperation()();
    assert.equal(f.launches.length, 0);
    updater.dispose();
  },
);

test(
  "loopback TLS: the pilot download reaches READY only in pilot mode",
  tlsTest,
  async (t) => {
    const f = await fixture(t);
    f.knobs.manifest = signed(1, { channel: "pilot" });
    const stable = await f.runtime();
    assert.equal((await stable.check()).state, "ERROR");
    assert.deepEqual(f.requests, [basePath + "release.json"]);
    const pilot = await f.runtime(
      {},
      {
        mode: "windows-ed25519-pilot-v1",
        feedUrl:
          "https://actualizaciones.deltanubeweb.com/gastronomia/piloto/windows/x64/",
      },
    );
    await pilot.check();
    await until(() => pilot.getStatus().state === "READY");
    assert.deepEqual(f.requests, [
      basePath + "release.json",
      basePath + "release.json",
      basePath + assetPath,
    ]);
    const contexts = [
      "windows-signed-updates-v1",
      "windows-signed-updates-pilot-v1",
    ];
    const checkpoints = await Promise.all(
      contexts.map(async (dir) =>
        JSON.parse(await readFile(join(f.dir, dir, "checkpoint.json"), "utf8")),
      ),
    );
    assert.equal(checkpoints[0], null);
    assert.equal(checkpoints[1]?.sequence, 1);
    assert.equal(f.launches.length, 0);
  },
);

test("explicit Ed25519 mode never falls back or trusts a key from packaged config", async (t) => {
  const base = await realpath(tmpdir());
  const dir = await mkdtemp(join(base, "gastronomy-signed-updates-"));
  t.after(async () => {
    const target = await realpath(dir);
    assert.equal(dirname(target), base);
    assert.match(basename(target), /^gastronomy-signed-updates-/);
    await rm(target, { recursive: true, force: true });
  });
  const configPath = join(dir, "updates-config.json");
  const { writeFile } = await import("node:fs/promises");
  const feedUrl =
    "https://actualizaciones.deltanubeweb.com/gastronomia/windows/x64/";
  // Never check or contact this host: initialization must refuse the empty embedded keyring.
  await writeFile(
    configPath,
    JSON.stringify({
      enabled: true,
      target: "win32-x64",
      mode: "windows-ed25519-v1",
      feedUrl,
      publicKey: keys.publicKey.export({ type: "spki", format: "pem" }),
    }),
  );
  const options = {
    isPackaged: true,
    platform: "win32" as const,
    arch: "x64",
    currentVersion: "0.1.37",
    userDataPath: dir,
    configPath,
    resourcesPath: dir,
    appPath: dir,
    onWindowsInstallerLaunched: () => assert.fail("Unexpected launch"),
  };
  assert.equal(
    (await createUpdateRuntime(options)).getStatus().state,
    "DISABLED",
  );
  let legacyCalls = 0;
  const result = await createUpdateRuntime(options, {
    readText: async () =>
      JSON.stringify({
        enabled: true,
        target: "win32-x64",
        mode: "typo",
        feedUrl,
      }),
    async verifyMacSignature() {
      throw new Error("Unexpected Mac verification");
    },
    async createAdapter() {
      legacyCalls++;
      throw new Error("Unexpected legacy adapter");
    },
  });
  assert.equal(result.getStatus().state, "DISABLED");
  assert.equal(legacyCalls, 0);
});
