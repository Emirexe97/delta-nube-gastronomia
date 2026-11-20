import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test, { type TestContext } from "node:test";
// @ts-expect-error Node 24 runs TypeScript test files directly.
import { createUpdateRuntime } from "./update-runtime.ts";
// @ts-expect-error Node 24 runs TypeScript test files directly.
import { readWindowsPilotKeys } from "./windows-pilot-trust.ts";
// @ts-expect-error Node 24 runs TypeScript test files directly.
import { WindowsUpdateStorage } from "./windows-update-storage.ts";

const feedUrl =
  "https://actualizaciones.deltanubeweb.com/gastronomia/piloto/windows/x64/";
const config = {
  enabled: true,
  mode: "windows-ed25519-pilot-v1",
  target: "win32-x64",
  feedUrl,
};
const runtime = (dir: string) => ({
  isPackaged: true,
  platform: "win32" as NodeJS.Platform,
  arch: "x64",
  currentVersion: "0.1.37",
  configPath: join(dir, "updates.json"),
  resourcesPath: dir,
  appPath: dir,
  userDataPath: dir,
  onWindowsInstallerLaunched: () => assert.fail("No installer may launch"),
});

async function disposable(t: TestContext) {
  const temp = await realpath(tmpdir());
  const dir = await mkdtemp(join(temp, "gastronomy-pilot-"));
  t.after(async () => {
    const checked = await realpath(dir);
    assert.equal(dirname(checked), temp);
    assert.match(basename(checked), /^gastronomy-pilot-/);
    await rm(checked, { recursive: true, force: true });
  });
  return dir;
}

test("empty compiled pilot pins fail closed even when config asks to enable and supplies a key", async (t) => {
  const opts = runtime(await disposable(t));
  const { publicKey } = generateKeyPairSync("ed25519");
  assert.equal(readWindowsPilotKeys().size, 0);
  await writeFile(
    opts.configPath,
    JSON.stringify({
      ...config,
      publicKey: publicKey.export({ type: "spki", format: "pem" }),
    }),
  );
  assert.equal((await createUpdateRuntime(opts)).getStatus().state, "DISABLED");
});

test("pilot accepts only the dedicated URL and correct platform, without legacy fallback", async () => {
  let factories = 0;
  const opts = runtime("/fixture");
  const create = (record: unknown, overrides = {}) =>
    createUpdateRuntime(
      { ...opts, ...overrides },
      {
        readText: async () => JSON.stringify(record),
        createAdapter: async () => assert.fail("Legacy adapter attempted"),
        verifyMacSignature: async () => assert.fail("Legacy signer attempted"),
        createWindowsSignedAdapter: (_options, url, channel) => {
          factories++;
          assert.equal(url, feedUrl);
          assert.equal(channel, "pilot");
          return {
            on() {},
            async checkForUpdates() {},
            async downloadUpdate() {},
            quitAndInstall() {},
          };
        },
      },
    );
  assert.equal((await create(config)).getStatus().state, "IDLE");
  assert.equal(
    (await create({ ...config, enabled: false })).getStatus().state,
    "DISABLED",
  );
  for (const url of [
    "https://actualizaciones.deltanubeweb.com/gastronomia/windows/x64/",
    feedUrl + "?hidden=1",
    "https://example.invalid/gastronomia/piloto/windows/x64/",
  ])
    assert.equal(
      (await create({ ...config, feedUrl: url })).getStatus().state,
      "DISABLED",
    );
  assert.equal(
    (
      await create({ ...config, target: "win32-arm64" }, { arch: "arm64" })
    ).getStatus().state,
    "DISABLED",
  );
  assert.equal(
    (
      await create({ ...config, target: "darwin-x64" }, { platform: "darwin" })
    ).getStatus().state,
    "DISABLED",
  );
  assert.equal(
    (await create(config, { isPackaged: false })).getStatus().state,
    "DISABLED",
  );
  assert.equal(factories, 1);
});

test("compiled trust accepts only public Ed25519 pins matching their fingerprint", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pin = {
    keyId: "pilot-01",
    spkiPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    sha256: createHash("sha256")
      .update(publicKey.export({ type: "spki", format: "der" }))
      .digest("hex"),
  };
  assert.equal(
    readWindowsPilotKeys([pin]).get(pin.keyId)?.asymmetricKeyType,
    "ed25519",
  );
  assert.throws(() => readWindowsPilotKeys([pin, pin]));
  assert.throws(() =>
    readWindowsPilotKeys([{ ...pin, sha256: "0".repeat(64) }]),
  );
  assert.throws(() =>
    readWindowsPilotKeys([
      {
        ...pin,
        spkiPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      },
    ]),
  );
  const wrong = generateKeyPairSync("ed448").publicKey;
  assert.throws(() =>
    readWindowsPilotKeys([
      {
        ...pin,
        spkiPem: wrong.export({ type: "spki", format: "pem" }).toString(),
        sha256: createHash("sha256")
          .update(wrong.export({ type: "spki", format: "der" }))
          .digest("hex"),
      },
    ]),
  );
});

test("pilot and stable persist independent rollback checkpoints in the same profile", async (t) => {
  const dir = await disposable(t);
  const state = {
    sequence: 125,
    version: "2.1.0",
    payloadSha256: "1".repeat(64),
    observedAtMs: 10,
  };
  const stable = new WindowsUpdateStorage(dir);
  assert.equal(await stable.loadCheckpoint(), null);
  await stable.writeCheckpoint(state);
  const pilot = new WindowsUpdateStorage(dir, "pilot");
  assert.equal(await pilot.loadCheckpoint(), null);
  await pilot.writeCheckpoint({ ...state, sequence: 1 });
  assert.equal(
    (await new WindowsUpdateStorage(dir, "pilot").loadCheckpoint())?.sequence,
    1,
  );
  assert.deepEqual(await new WindowsUpdateStorage(dir).loadCheckpoint(), state);
});
